-- Add a bounded manual-job cleanup path without changing existing rows or RLS policies.
create index ai_processing_jobs_manual_cleanup_page_idx
  on public.ai_processing_jobs(transcript_id, user_id, created_at desc, id desc)
  where execution_mode = 'manual';

-- classify_manual_ai_job_cleanup_v1 is the single lifecycle/dependency classifier shared by reads and cleanup.
create function public.classify_manual_ai_job_cleanup_v1(
  p_status public.job_status,
  p_execution_mode text,
  p_attempt_count integer,
  p_max_attempts integer,
  p_prompt_snapshot_exact boolean,
  p_model text,
  p_prompt_text_snapshot text,
  p_provider public.ai_provider,
  p_provider_config jsonb,
  p_created_at timestamptz,
  p_lease_token uuid,
  p_lease_expires_at timestamptz,
  p_has_output boolean,
  p_has_projection boolean,
  p_now timestamptz
)
returns table (cleanup_reason text, poll_eligible boolean, actions text[])
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_exact_shape boolean;
begin
  if p_now is null then
    raise exception 'invalid manual AI cleanup time' using errcode = '22023';
  end if;

  if p_execution_mode is distinct from 'manual' then
    return query select 'ownership_mismatch'::text, false, array[]::text[];
    return;
  end if;

  v_exact_shape := p_max_attempts = 1
    and p_prompt_snapshot_exact is true
    and p_model is not null
    and btrim(p_model) <> ''
    and p_prompt_text_snapshot is not null
    and btrim(p_prompt_text_snapshot) <> ''
    and p_provider is not null
    and p_provider_config is not null
    and coalesce(jsonb_typeof(p_provider_config -> 'metadata') = 'object', false)
    and (
      case
        when jsonb_typeof(p_provider_config -> 'temperature') = 'number'
          then (p_provider_config ->> 'temperature')::numeric between 0 and 2
        else false
      end
    )
    and (
      (p_status = 'queued' and p_attempt_count = 0 and p_lease_token is null and p_lease_expires_at is null)
      or
      (p_status = 'running' and p_attempt_count = 1 and p_lease_token is not null and p_lease_expires_at is not null)
    );

  if p_has_output then
    return query select
      'protected_output'::text,
      false,
      case
        when p_status = 'running' and v_exact_shape and p_lease_expires_at <= p_now
          then array['reconcile']::text[]
        else array[]::text[]
      end;
    return;
  end if;

  if p_has_projection then
    return query select 'protected_projection'::text, false, array[]::text[];
    return;
  end if;

  if p_status in ('done', 'failed', 'cancelled') then
    return query select 'eligible_terminal_no_output'::text, false, array['delete']::text[];
    return;
  end if;

  if not v_exact_shape then
    return query select 'unsupported_legacy'::text, false, array[]::text[];
    return;
  end if;

  if p_status = 'queued' and p_created_at <= p_now - make_interval(secs => 480) then
    return query select 'eligible_stale_unclaimed'::text, false, array['delete']::text[];
    return;
  end if;

  if p_status = 'running' and p_lease_expires_at <= p_now then
    return query select 'eligible_terminal_no_output'::text, false, array['delete']::text[];
    return;
  end if;

  return query select
    'active_or_slow'::text,
    true,
    case when p_status = 'running'
      then array['reconcile', 'interrupt']::text[]
      else array['reconcile', 'interrupt']::text[]
    end;
end;
$$;

-- classify_manual_ai_jobs_v1 decorates only exact owner/transcript/manual job summaries supplied by ai-state.
create function public.classify_manual_ai_jobs_v1(
  p_job_ids uuid[],
  p_transcript_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns table (
  job_id uuid,
  cleanup_reason text,
  poll_eligible boolean,
  actions text[],
  attempt_count integer,
  completed_at timestamptz,
  created_at timestamptz,
  failure_code text,
  lease_expires_at timestamptz,
  max_attempts integer,
  model text,
  processing_type text,
  retry_after_at timestamptz,
  started_at timestamptz,
  status text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_job_ids is null or cardinality(p_job_ids) > 50 or p_now is null then
    raise exception 'invalid manual AI classification request' using errcode = '22023';
  end if;

  return query
  select
    j.id,
    c.cleanup_reason,
    c.poll_eligible,
    c.actions,
    j.attempt_count,
    j.completed_at,
    j.created_at,
    j.failure_code,
    j.lease_expires_at,
    j.max_attempts,
    j.model,
    j.processing_type::text,
    j.retry_after_at,
    j.started_at,
    j.status::text
  from unnest(p_job_ids) with ordinality requested(id, ordinal)
  join public.ai_processing_jobs j
    on j.id = requested.id
   and j.transcript_id = p_transcript_id
   and j.user_id = p_user_id
   and j.execution_mode = 'manual'
  cross join lateral public.classify_manual_ai_job_cleanup_v1(
    j.status, j.execution_mode, j.attempt_count, j.max_attempts,
    j.prompt_snapshot_exact, j.model, j.prompt_text_snapshot, j.provider,
    j.provider_config, j.created_at, j.lease_token, j.lease_expires_at,
    exists(select 1 from public.ai_outputs o where o.processing_job_id = j.id),
    exists(select 1 from public.transcript_tasks p where p.processing_job_id = j.id)
      or exists(select 1 from public.transcript_chapters p where p.processing_job_id = j.id)
      or exists(select 1 from public.transcript_decisions p where p.processing_job_id = j.id)
      or exists(select 1 from public.transcript_risks p where p.processing_job_id = j.id),
    p_now
  ) c
  order by requested.ordinal;
end;
$$;

-- list_manual_ai_job_cleanup_v1 keyset-pages all historical manual jobs and carries the total delete count.
create function public.list_manual_ai_job_cleanup_v1(
  p_transcript_id uuid,
  p_user_id uuid,
  p_before_created_at timestamptz,
  p_before_job_id uuid,
  p_limit integer,
  p_now timestamptz
)
returns table (
  job_id uuid,
  cleanup_reason text,
  poll_eligible boolean,
  actions text[],
  created_at timestamptz,
  eligible_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit not between 1 and 51 or p_now is null
    or ((p_before_created_at is null) <> (p_before_job_id is null)) then
    raise exception 'invalid manual AI cleanup page' using errcode = '22023';
  end if;

  return query
  with classified as (
    select
      j.id as job_id,
      c.cleanup_reason,
      c.poll_eligible,
      c.actions,
      j.created_at
    from public.ai_processing_jobs j
    cross join lateral public.classify_manual_ai_job_cleanup_v1(
      j.status, j.execution_mode, j.attempt_count, j.max_attempts,
      j.prompt_snapshot_exact, j.model, j.prompt_text_snapshot, j.provider,
      j.provider_config, j.created_at, j.lease_token, j.lease_expires_at,
      exists(select 1 from public.ai_outputs o where o.processing_job_id = j.id),
      exists(select 1 from public.transcript_tasks p where p.processing_job_id = j.id)
        or exists(select 1 from public.transcript_chapters p where p.processing_job_id = j.id)
        or exists(select 1 from public.transcript_decisions p where p.processing_job_id = j.id)
        or exists(select 1 from public.transcript_risks p where p.processing_job_id = j.id),
      p_now
    ) c
    where j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and j.execution_mode = 'manual'
  ), counted as (
    select classified.*,
      count(*) filter (where 'delete' = any(classified.actions)) over () as eligible_count
    from classified
  )
  select counted.job_id, counted.cleanup_reason, counted.poll_eligible,
    counted.actions, counted.created_at, counted.eligible_count
  from counted
  where p_before_created_at is null
    or (counted.created_at, counted.job_id) < (p_before_created_at, p_before_job_id)
  order by counted.created_at desc, counted.job_id desc
  limit p_limit;
end;
$$;

-- settle_manual_ai_job_v1 now explicitly locks the same parent row used by cleanup before persisting status.
create or replace function public.settle_manual_ai_job_v1(
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
  v_job public.ai_processing_jobs%rowtype;
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

  if not p_succeeded and p_retry_after_at is not null and p_failure_code <> 'rate_limited' then
    raise exception 'invalid manual AI retry deadline' using errcode = '22023';
  end if;

  select j.*
  into v_job
  from public.ai_processing_jobs j
  where j.id = p_job_id
    and j.transcript_id = p_transcript_id
    and j.user_id = p_user_id
    and j.execution_mode = 'manual'
  for update;

  if not found or v_job.status <> 'running' or v_job.lease_token is distinct from p_lease_token then
    return false;
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
  where j.id = p_job_id;

  return true;
end;
$$;

-- cleanup_manual_ai_jobs_v1 locks every requested parent in UUID order, then every dependency family.
create function public.cleanup_manual_ai_jobs_v1(
  p_job_ids uuid[],
  p_transcript_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns table (job_id uuid, result text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actions text[];
  v_has_output boolean;
  v_has_projection boolean;
  v_job public.ai_processing_jobs%rowtype;
  v_reason text;
  v_results text[];
  v_requested record;
begin
  if p_job_ids is null or cardinality(p_job_ids) not between 1 and 50 or p_now is null
    or cardinality(p_job_ids) <> (select count(distinct id) from unnest(p_job_ids) ids(id)) then
    raise exception 'invalid manual AI cleanup request' using errcode = '22023';
  end if;

  -- Parent FOR UPDATE locks are acquired for the whole batch before dependency inspection.
  for v_requested in
    select requested.id from unnest(p_job_ids) requested(id) order by requested.id
  loop
    perform j.id
    from public.ai_processing_jobs j
    where j.id = v_requested.id
      and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and j.execution_mode = 'manual'
    for update;
  end loop;

  -- Existing children are locked in one global order; parent locks also block late FK inserts.
  perform o.id from public.ai_outputs o
    join public.ai_processing_jobs j on j.id = o.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by o.processing_job_id, o.id for update of o;
  perform p.id from public.transcript_tasks p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;
  perform p.id from public.transcript_chapters p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;
  perform p.id from public.transcript_decisions p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;
  perform p.id from public.transcript_risks p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;

  for v_requested in
    select requested.id, requested.ordinal
    from unnest(p_job_ids) with ordinality requested(id, ordinal)
    order by requested.ordinal
  loop
    select j.*
    into v_job
    from public.ai_processing_jobs j
    where j.id = v_requested.id
      and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and j.execution_mode = 'manual';
    if not found then
      v_results[v_requested.ordinal] := 'missing';
      continue;
    end if;

    select exists(select 1 from public.ai_outputs o where o.processing_job_id = v_job.id)
      into v_has_output;
    select
      exists(select 1 from public.transcript_tasks p where p.processing_job_id = v_job.id)
      or exists(select 1 from public.transcript_chapters p where p.processing_job_id = v_job.id)
      or exists(select 1 from public.transcript_decisions p where p.processing_job_id = v_job.id)
      or exists(select 1 from public.transcript_risks p where p.processing_job_id = v_job.id)
      into v_has_projection;

    select c.cleanup_reason, c.actions
    into v_reason, v_actions
    from public.classify_manual_ai_job_cleanup_v1(
      v_job.status, v_job.execution_mode, v_job.attempt_count, v_job.max_attempts,
      v_job.prompt_snapshot_exact, v_job.model, v_job.prompt_text_snapshot, v_job.provider,
      v_job.provider_config, v_job.created_at, v_job.lease_token, v_job.lease_expires_at,
      v_has_output, v_has_projection, p_now
    ) c;

    if v_reason = 'protected_output' then
      if 'reconcile' = any(v_actions) then
        update public.ai_processing_jobs j
        set completed_at = coalesce(j.completed_at, p_now),
            error_message = null,
            failure_code = null,
            lease_expires_at = null,
            lease_token = null,
            retry_after_at = null,
            status = 'done'
        where j.id = v_job.id
          and j.status = 'running'
          and j.lease_token is not distinct from v_job.lease_token;
        v_results[v_requested.ordinal] := 'reconciled';
      elsif v_job.status = 'running' then
        v_results[v_requested.ordinal] := 'busy';
      else
        v_results[v_requested.ordinal] := 'protected';
      end if;
      continue;
    end if;

    if v_reason = 'protected_projection' then
      v_results[v_requested.ordinal] := 'protected';
      continue;
    end if;

    if 'delete' = any(v_actions) then
      if v_job.status in ('queued', 'running') then
        update public.ai_processing_jobs j
        set completed_at = p_now,
            error_message = null,
            failure_code = 'execution_interrupted',
            lease_expires_at = null,
            lease_token = null,
            retry_after_at = null,
            status = 'failed'
        where j.id = v_job.id;
      end if;
      delete from public.ai_processing_jobs j where j.id = v_job.id;
      v_results[v_requested.ordinal] := 'deleted';
      continue;
    end if;

    v_results[v_requested.ordinal] := case
      when v_reason = 'active_or_slow' then 'busy'
      else 'conflict'
    end;
  end loop;

  return query
  select requested.id, v_results[requested.ordinal]
  from unnest(p_job_ids) with ordinality requested(id, ordinal)
  order by requested.ordinal;
end;
$$;

revoke all on function public.classify_manual_ai_job_cleanup_v1(
  public.job_status,text,integer,integer,boolean,text,text,public.ai_provider,jsonb,
  timestamptz,uuid,timestamptz,boolean,boolean,timestamptz
) from public, anon, authenticated;
revoke all on function public.classify_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.list_manual_ai_job_cleanup_v1(uuid,uuid,timestamptz,uuid,integer,timestamptz)
  from public, anon, authenticated;
revoke all on function public.cleanup_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.settle_manual_ai_job_v1(
  uuid,uuid,uuid,uuid,boolean,integer,integer,text,timestamptz,timestamptz
) from public, anon, authenticated;

grant execute on function public.classify_manual_ai_job_cleanup_v1(
  public.job_status,text,integer,integer,boolean,text,text,public.ai_provider,jsonb,
  timestamptz,uuid,timestamptz,boolean,boolean,timestamptz
) to service_role;
grant execute on function public.classify_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz)
  to service_role;
grant execute on function public.list_manual_ai_job_cleanup_v1(uuid,uuid,timestamptz,uuid,integer,timestamptz)
  to service_role;
grant execute on function public.cleanup_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz)
  to service_role;
grant execute on function public.settle_manual_ai_job_v1(
  uuid,uuid,uuid,uuid,boolean,integer,integer,text,timestamptz,timestamptz
) to service_role;
