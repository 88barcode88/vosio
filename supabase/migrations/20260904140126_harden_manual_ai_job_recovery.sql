-- Add machine-readable, non-sensitive failure metadata without rewriting legacy rows.
alter table public.ai_processing_jobs
  add column failure_code text,
  add column retry_after_at timestamptz,
  add constraint ai_processing_jobs_failure_code_check check (
    failure_code is null or failure_code in (
      'insufficient_credit_or_quota',
      'rate_limited',
      'invalid_model',
      'provider_unavailable',
      'provider_configuration',
      'execution_interrupted',
      'persistence_failed',
      'unknown'
    )
  ),
  add constraint ai_processing_jobs_retry_after_check check (
    retry_after_at is null or failure_code = 'rate_limited'
  ),
  add constraint ai_processing_jobs_failure_state_check check (
    status = 'failed'
    or (failure_code is null and retry_after_at is null)
  );

-- claim_manual_ai_job_v1 is the only paid-call gate for a new manual job UUID.
create function public.claim_manual_ai_job_v1(
  p_job_id uuid,
  p_transcript_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_now timestamptz
)
returns setof public.ai_processing_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.ai_processing_jobs%rowtype;
begin
  if p_lease_token is null or p_now is null then
    raise exception 'invalid manual AI claim lease' using errcode = '22023';
  end if;

  select j.*
  into v_job
  from public.ai_processing_jobs j
  where j.id = p_job_id
    and j.transcript_id = p_transcript_id
    and j.user_id = p_user_id
    and j.execution_mode = 'manual'
  for update;

  if not found
    or v_job.status <> 'queued'
    or v_job.attempt_count <> 0
    or v_job.max_attempts <> 1
    or v_job.lease_token is not null
    or v_job.lease_expires_at is not null
    or v_job.prompt_snapshot_exact is distinct from true
    or v_job.model is null
    or btrim(v_job.model) = ''
    or v_job.prompt_text_snapshot is null
    or btrim(v_job.prompt_text_snapshot) = ''
    or v_job.provider is null
    or v_job.provider_config is null
    or jsonb_typeof(v_job.provider_config -> 'metadata') is distinct from 'object'
    or not (
      case
        when jsonb_typeof(v_job.provider_config -> 'temperature') = 'number'
          then (v_job.provider_config ->> 'temperature')::numeric between 0 and 2
        else false
      end
    ) then
    return;
  end if;

  return query
  update public.ai_processing_jobs j
  set attempt_count = 1,
      completed_at = null,
      error_message = null,
      failure_code = null,
      lease_expires_at = p_now + make_interval(secs => 480),
      lease_token = p_lease_token,
      retry_after_at = null,
      started_at = p_now,
      status = 'running'
  where j.id = p_job_id
    and j.transcript_id = p_transcript_id
    and j.user_id = p_user_id
    and j.execution_mode = 'manual'
    and j.status = 'queued'
  returning j.*;
end;
$$;

-- settle_manual_ai_job_v1 accepts only the exact active lease owner and exact row identity.
create function public.settle_manual_ai_job_v1(
  p_job_id uuid,
  p_transcript_id uuid,
  p_user_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_input_token_count integer,
  p_output_token_count integer,
  p_failure_code text,
  p_retry_after_at timestamptz,
  p_now timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_lease_token is null or p_now is null then
    raise exception 'invalid manual AI settlement lease' using errcode = '22023';
  end if;

  if not p_succeeded and (p_failure_code is null or p_failure_code not in (
    'insufficient_credit_or_quota', 'rate_limited', 'invalid_model',
    'provider_unavailable', 'provider_configuration', 'execution_interrupted',
    'persistence_failed', 'unknown'
  )) then
    raise exception 'invalid manual AI failure code' using errcode = '22023';
  end if;

  if not p_succeeded
    and p_retry_after_at is not null
    and p_failure_code <> 'rate_limited' then
    raise exception 'invalid manual AI retry deadline' using errcode = '22023';
  end if;

  update public.ai_processing_jobs j
  set completed_at = p_now,
      error_message = null,
      failure_code = case when p_succeeded then null else p_failure_code end,
      input_token_count = case when p_succeeded then p_input_token_count else j.input_token_count end,
      lease_expires_at = null,
      lease_token = null,
      output_token_count = case when p_succeeded then p_output_token_count else j.output_token_count end,
      retry_after_at = case when not p_succeeded and p_failure_code = 'rate_limited' then p_retry_after_at else null end,
      status = case when p_succeeded then 'done'::public.job_status else 'failed'::public.job_status end
  where j.id = p_job_id
    and j.transcript_id = p_transcript_id
    and j.user_id = p_user_id
    and j.execution_mode = 'manual'
    and j.status = 'running'
    and j.lease_token = p_lease_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

-- reconcile_manual_ai_job_v1 repairs durable output or classifies one exact job without provider work.
create function public.reconcile_manual_ai_job_v1(
  p_job_id uuid,
  p_transcript_id uuid,
  p_user_id uuid,
  p_action text,
  p_now timestamptz
)
returns table (result text, job_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_has_output boolean;
  v_is_new_shape boolean;
  v_job public.ai_processing_jobs%rowtype;
begin
  if p_now is null or p_action not in ('reconcile', 'interrupt') then
    raise exception 'invalid manual AI reconciliation action' using errcode = '22023';
  end if;

  select j.*
  into v_job
  from public.ai_processing_jobs j
  where j.id = p_job_id
    and j.transcript_id = p_transcript_id
    and j.user_id = p_user_id
    and j.execution_mode = 'manual'
  for update;

  if not found then
    return query select 'missing'::text, p_job_id;
    return;
  end if;

  if v_job.status in ('done', 'failed', 'cancelled') then
    return query select 'terminal'::text, p_job_id;
    return;
  end if;

  v_is_new_shape := v_job.max_attempts = 1
    and v_job.prompt_snapshot_exact is true
    and v_job.model is not null
    and btrim(v_job.model) <> ''
    and v_job.prompt_text_snapshot is not null
    and btrim(v_job.prompt_text_snapshot) <> ''
    and v_job.provider is not null
    and v_job.provider_config is not null
    and coalesce(jsonb_typeof(v_job.provider_config -> 'metadata') = 'object', false)
    and (
      case
        when jsonb_typeof(v_job.provider_config -> 'temperature') = 'number'
          then (v_job.provider_config ->> 'temperature')::numeric between 0 and 2
        else false
      end
    )
    and (
      (
        v_job.status = 'queued'
        and v_job.attempt_count = 0
        and v_job.lease_token is null
        and v_job.lease_expires_at is null
      )
      or
      (
        v_job.status = 'running'
        and v_job.attempt_count = 1
        and v_job.lease_token is not null
        and v_job.lease_expires_at is not null
      )
    );

  if not v_is_new_shape then
    return query select 'operator_required'::text, p_job_id;
    return;
  end if;

  if v_job.status = 'queued' then
    if p_action = 'reconcile' then
      return query select 'schedule'::text, p_job_id;
    else
      update public.ai_processing_jobs j
      set completed_at = p_now,
          error_message = null,
          failure_code = 'execution_interrupted',
          retry_after_at = null,
          status = 'failed'
      where j.id = p_job_id
        and j.transcript_id = p_transcript_id
        and j.user_id = p_user_id
        and j.status = 'queued';
      return query select 'interrupted'::text, p_job_id;
    end if;
  end if;

  if v_job.status = 'running' then
    if v_job.lease_expires_at is null or v_job.lease_expires_at > p_now then
      return query select 'busy'::text, p_job_id;
      return;
    end if;

    select exists (
      select 1
      from public.ai_outputs o
      where o.processing_job_id = p_job_id
        and o.transcript_id = p_transcript_id
        and o.user_id = p_user_id
    ) into v_has_output;

    if v_has_output then
      update public.ai_processing_jobs j
      set completed_at = coalesce(j.completed_at, p_now),
          error_message = null,
          failure_code = null,
          lease_expires_at = null,
          lease_token = null,
          retry_after_at = null,
          status = 'done'
      where j.id = p_job_id
        and j.transcript_id = p_transcript_id
        and j.user_id = p_user_id
        and j.status = 'running'
        and j.lease_token is not distinct from v_job.lease_token;
      return query select 'done'::text, p_job_id;
      return;
    end if;

    update public.ai_processing_jobs j
    set completed_at = p_now,
        error_message = null,
        failure_code = 'execution_interrupted',
        lease_expires_at = null,
        lease_token = null,
        retry_after_at = null,
        status = 'failed'
    where j.id = p_job_id
      and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and j.status = 'running'
      and j.lease_token is not distinct from v_job.lease_token;
    return query select 'interrupted'::text, p_job_id;
    return;
  end if;

  return query select 'operator_required'::text, p_job_id;
end;
$$;

revoke all on function public.claim_manual_ai_job_v1(uuid,uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.settle_manual_ai_job_v1(
  uuid,uuid,uuid,uuid,boolean,integer,integer,text,timestamptz,timestamptz
) from public, anon, authenticated;
revoke all on function public.reconcile_manual_ai_job_v1(uuid,uuid,uuid,text,timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_manual_ai_job_v1(uuid,uuid,uuid,uuid,timestamptz)
  to service_role;
grant execute on function public.settle_manual_ai_job_v1(
  uuid,uuid,uuid,uuid,boolean,integer,integer,text,timestamptz,timestamptz
) to service_role;
grant execute on function public.reconcile_manual_ai_job_v1(uuid,uuid,uuid,text,timestamptz)
  to service_role;
