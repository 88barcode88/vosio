-- Distinguish user-triggered processing from one opt-in automatic timeline job.
alter table public.ai_processing_jobs
  add column execution_mode text not null default 'manual',
  add column automatic_idempotency_key text,
  add column attempt_count integer not null default 0,
  add column max_attempts integer not null default 3,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add constraint ai_processing_jobs_execution_mode_check
    check (execution_mode in ('manual', 'automatic')),
  add constraint ai_processing_jobs_attempt_count_check
    check (attempt_count >= 0 and attempt_count <= max_attempts),
  add constraint ai_processing_jobs_max_attempts_check
    check (max_attempts between 1 and 5),
  add constraint ai_processing_jobs_lease_pair_check
    check ((lease_token is null) = (lease_expires_at is null)),
  add constraint ai_processing_jobs_automatic_shape_check
    check (
      (execution_mode = 'manual' and automatic_idempotency_key is null)
      or
      (
        execution_mode = 'automatic'
        and automatic_idempotency_key is not null
        and processing_type = 'timeline_chapters'
        and prompt_snapshot_exact = true
      )
    );

create unique index ai_processing_jobs_automatic_idempotency_unique_idx
  on public.ai_processing_jobs(automatic_idempotency_key)
  where automatic_idempotency_key is not null;

create index ai_processing_jobs_automatic_reconcile_idx
  on public.ai_processing_jobs(transcript_id, user_id, status, created_at desc)
  where execution_mode = 'automatic';

-- One processing job owns one raw provider artifact. Existing manual behavior already follows this rule.
-- Fail closed if historical rows contradict that invariant. Operators must inspect lineage; this migration
-- intentionally does not guess which output is authoritative or delete any user data.
do $automatic_timeline_output_preflight$
begin
  if exists (
    select 1
    from public.ai_outputs
    group by processing_job_id
    having count(*) > 1
  ) then
    raise exception 'automatic timeline output uniqueness preflight failed: duplicate ai_outputs.processing_job_id rows require explicit lineage review; migration aborted';
  end if;
end;
$automatic_timeline_output_preflight$;

create unique index ai_outputs_processing_job_unique_idx
  on public.ai_outputs(processing_job_id);

-- enqueue_automatic_timeline_job_v1 atomically creates or returns one immutable automatic job snapshot.
create function public.enqueue_automatic_timeline_job_v1(
  p_automatic_idempotency_key text,
  p_transcript_id uuid,
  p_user_id uuid,
  p_provider public.ai_provider,
  p_model text,
  p_prompt_id uuid,
  p_prompt_override_id uuid,
  p_prompt_source text,
  p_prompt_name_snapshot text,
  p_prompt_text_snapshot text,
  p_prompt_output_schema_snapshot jsonb,
  p_prompt_revision_snapshot integer,
  p_provider_config jsonb
)
returns setof public.ai_processing_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_automatic_idempotency_key is null or length(p_automatic_idempotency_key) < 16 then
    raise exception 'invalid automatic timeline idempotency key' using errcode = '22023';
  end if;

  insert into public.ai_processing_jobs (
    automatic_idempotency_key,
    execution_mode,
    max_attempts,
    model,
    processing_type,
    prompt_id,
    prompt_name_snapshot,
    prompt_output_schema_snapshot,
    prompt_override_id,
    prompt_revision_snapshot,
    prompt_snapshot_exact,
    prompt_source,
    prompt_text_snapshot,
    provider,
    provider_config,
    status,
    transcript_id,
    user_id
  ) values (
    p_automatic_idempotency_key,
    'automatic',
    3,
    p_model,
    'timeline_chapters',
    p_prompt_id,
    p_prompt_name_snapshot,
    p_prompt_output_schema_snapshot,
    p_prompt_override_id,
    p_prompt_revision_snapshot,
    true,
    p_prompt_source,
    p_prompt_text_snapshot,
    p_provider,
    coalesce(p_provider_config, '{}'::jsonb),
    'queued',
    p_transcript_id,
    p_user_id
  )
  on conflict (automatic_idempotency_key)
    where automatic_idempotency_key is not null
  do nothing;

  return query
  select j.*
  from public.ai_processing_jobs j
  where j.automatic_idempotency_key = p_automatic_idempotency_key
    and j.execution_mode = 'automatic'
    and j.transcript_id = p_transcript_id
    and j.user_id = p_user_id;
end;
$$;

-- claim_automatic_timeline_job_v1 starts one queued/retry job or reclaims one expired lease.
create function public.claim_automatic_timeline_job_v1(
  p_job_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_lease_seconds integer
)
returns setof public.ai_processing_jobs
language sql
security invoker
set search_path = ''
as $$
  update public.ai_processing_jobs
  set attempt_count = attempt_count + 1,
      completed_at = null,
      error_message = null,
      lease_expires_at = p_now + make_interval(secs => greatest(60, least(p_lease_seconds, 3600))),
      lease_token = p_lease_token,
      started_at = p_now,
      status = 'running'
  where id = p_job_id
    and execution_mode = 'automatic'
    and processing_type = 'timeline_chapters'
    and attempt_count < max_attempts
    and (
      status in ('queued', 'failed')
      or (status = 'running' and lease_expires_at <= p_now)
    )
  returning *;
$$;

-- settle_automatic_timeline_job_v1 accepts settlement only from the current bounded lease owner.
create function public.settle_automatic_timeline_job_v1(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_input_token_count integer,
  p_output_token_count integer,
  p_error_message text,
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
  update public.ai_processing_jobs
  set completed_at = p_now,
      error_message = case when p_succeeded then null else left(coalesce(p_error_message, 'Automatic timeline failed.'), 500) end,
      input_token_count = case when p_succeeded then p_input_token_count else input_token_count end,
      lease_expires_at = null,
      lease_token = null,
      output_token_count = case when p_succeeded then p_output_token_count else output_token_count end,
      status = case when p_succeeded then 'done'::public.job_status else 'failed'::public.job_status end
  where id = p_job_id
    and execution_mode = 'automatic'
    and status = 'running'
    and lease_token = p_lease_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.enqueue_automatic_timeline_job_v1(
  text,uuid,uuid,public.ai_provider,text,uuid,uuid,text,text,text,jsonb,integer,jsonb
) from public, anon, authenticated;
revoke all on function public.claim_automatic_timeline_job_v1(uuid,uuid,timestamptz,integer)
  from public, anon, authenticated;
revoke all on function public.settle_automatic_timeline_job_v1(
  uuid,uuid,boolean,integer,integer,text,timestamptz
) from public, anon, authenticated;

grant execute on function public.enqueue_automatic_timeline_job_v1(
  text,uuid,uuid,public.ai_provider,text,uuid,uuid,text,text,text,jsonb,integer,jsonb
) to service_role;
grant execute on function public.claim_automatic_timeline_job_v1(uuid,uuid,timestamptz,integer)
  to service_role;
grant execute on function public.settle_automatic_timeline_job_v1(
  uuid,uuid,boolean,integer,integer,text,timestamptz
) to service_role;
