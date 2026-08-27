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

-- Every persisted generation gets one non-PII transition key, including disabled/historical rows.
alter table public.transcripts
  add column completion_generation_key text,
  add constraint transcripts_completion_generation_key_check
    check (
      completion_generation_key is null
      or length(completion_generation_key) between 16 and 128
    );

create unique index ai_processing_jobs_automatic_idempotency_unique_idx
  on public.ai_processing_jobs(automatic_idempotency_key)
  where automatic_idempotency_key is not null;

create index ai_processing_jobs_automatic_reconcile_idx
  on public.ai_processing_jobs(transcript_id, user_id, status, created_at desc)
  where execution_mode = 'automatic';

-- Durable completion intent keeps the consent/config snapshot recoverable if first enqueue fails.
create table public.automatic_timeline_intents (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  automatic_idempotency_key text not null unique,
  consent_snapshot boolean not null default true check (consent_snapshot = true),
  provider public.ai_provider not null,
  model text not null,
  prompt_id uuid not null,
  prompt_override_id uuid,
  prompt_source text not null check (prompt_source in ('system', 'user_override')),
  prompt_name_snapshot text not null,
  prompt_text_snapshot text not null,
  prompt_output_schema_snapshot jsonb,
  prompt_revision_snapshot integer check (
    prompt_revision_snapshot is null or prompt_revision_snapshot > 0
  ),
  provider_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint automatic_timeline_intents_transcript_user_fk
    foreign key (transcript_id, user_id)
    references public.transcripts(id, user_id) on delete cascade
);

create index automatic_timeline_intents_owner_transcript_idx
  on public.automatic_timeline_intents(transcript_id, user_id, created_at desc);

create index automatic_timeline_intents_user_idx
  on public.automatic_timeline_intents(user_id);

alter table public.automatic_timeline_intents enable row level security;
alter table public.automatic_timeline_intents force row level security;

revoke all on table public.automatic_timeline_intents from public, anon, authenticated;
grant select, insert, delete on table public.automatic_timeline_intents to service_role;

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

-- complete_transcript_generation_v1 is the single locked completion/outbox transition.
create function public.complete_transcript_generation_v1(
  p_completion_generation_key text,
  p_generation_kind text,
  p_transcript_id uuid,
  p_user_id uuid,
  p_transcription_job_id uuid,
  p_duration_seconds integer,
  p_automatic_timeline_enabled boolean,
  p_provider public.ai_provider,
  p_model text,
  p_provider_config jsonb
)
returns table (
  transcript_id uuid,
  is_new_generation boolean,
  automatic_timeline_scheduled boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_has_override boolean := false;
  v_is_new_generation boolean;
  v_override public.prompt_template_overrides%rowtype;
  v_prompt public.prompt_templates%rowtype;
  v_provider_config jsonb;
  v_transcript public.transcripts%rowtype;
begin
  if p_completion_generation_key is null
    or length(p_completion_generation_key) not between 16 and 128 then
    raise exception 'invalid completion generation key' using errcode = '22023';
  end if;

  if p_generation_kind not in ('async', 'segmented', 'live', 'import') then
    raise exception 'invalid completion generation kind' using errcode = '22023';
  end if;

  if p_duration_seconds is not null and p_duration_seconds < 0 then
    raise exception 'invalid completion duration' using errcode = '22023';
  end if;

  if p_model is null or btrim(p_model) = '' then
    raise exception 'invalid completion model snapshot' using errcode = '22023';
  end if;

  select t.*
  into v_transcript
  from public.transcripts t
  where t.id = p_transcript_id
    and t.user_id = p_user_id
  for update;

  if not found then
    raise exception 'completion transcript not found' using errcode = 'P0002';
  end if;

  v_is_new_generation :=
    v_transcript.completion_generation_key is distinct from p_completion_generation_key;

  -- Lazily bind pre-migration completed rows without treating current settings as retroactive consent.
  if v_transcript.completion_generation_key is null then
    if p_generation_kind in ('async', 'segmented')
      and v_transcript.transcription_job_id is not null
      and v_transcript.transcription_job_id is not distinct from p_transcription_job_id then
      v_is_new_generation := false;
    elsif p_generation_kind = 'live'
      and v_transcript.transcription_job_id is not null then
      v_is_new_generation := false;
    end if;
  end if;

  if v_is_new_generation then
    if p_automatic_timeline_enabled then
      select p.*
      into v_prompt
      from public.prompt_templates p
      where p.is_system = true
        and p.processing_type = 'timeline_chapters'
      limit 1
      for share;

      if not found then
        raise exception 'timeline prompt not found' using errcode = 'P0002';
      end if;

      select o.*
      into v_override
      from public.prompt_template_overrides o
      where o.system_prompt_id = v_prompt.id
        and o.user_id = p_user_id
        and o.is_active = true
      for share;
      v_has_override := found;

      v_provider_config := jsonb_set(
        coalesce(p_provider_config, '{}'::jsonb),
        '{response_format}',
        to_jsonb((case when v_prompt.output_schema is null then 'text' else 'json_schema' end)::text),
        true
      );
    end if;

    delete from public.automatic_timeline_intents i
    where i.transcript_id = p_transcript_id
      and i.user_id = p_user_id
      and i.automatic_idempotency_key <> p_completion_generation_key;

    delete from public.ai_processing_jobs j
    where j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and (
        j.execution_mode = 'manual'
        or j.automatic_idempotency_key is distinct from p_completion_generation_key
      );

    if p_automatic_timeline_enabled then
      insert into public.automatic_timeline_intents (
        automatic_idempotency_key,
        consent_snapshot,
        model,
        prompt_id,
        prompt_name_snapshot,
        prompt_output_schema_snapshot,
        prompt_override_id,
        prompt_revision_snapshot,
        prompt_source,
        prompt_text_snapshot,
        provider,
        provider_config,
        transcript_id,
        user_id
      ) values (
        p_completion_generation_key,
        true,
        p_model,
        v_prompt.id,
        v_prompt.name,
        v_prompt.output_schema,
        case when v_has_override then v_override.id else null end,
        case when v_has_override then v_override.revision else null end,
        case when v_has_override then 'user_override' else 'system' end,
        case when v_has_override then v_override.prompt_text else v_prompt.prompt_text end,
        p_provider,
        v_provider_config,
        p_transcript_id,
        p_user_id
      )
      on conflict (automatic_idempotency_key) do nothing;
    end if;
  end if;

  update public.transcripts t
  set completion_generation_key = p_completion_generation_key,
      transcription_job_id = p_transcription_job_id
  where t.id = p_transcript_id
    and t.user_id = p_user_id;

  update public.recordings r
  set duration_seconds = coalesce(p_duration_seconds, r.duration_seconds),
      error_message = null,
      status = 'completed'
  where r.id = v_transcript.recording_id
    and r.user_id = p_user_id;

  if not found then
    raise exception 'completion recording not found' using errcode = 'P0002';
  end if;

  return query
  select
    p_transcript_id,
    v_is_new_generation,
    exists (
      select 1
      from public.automatic_timeline_intents i
      where i.automatic_idempotency_key = p_completion_generation_key
        and i.consent_snapshot = true
        and i.transcript_id = p_transcript_id
        and i.user_id = p_user_id
    );
end;
$$;

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

revoke all on function public.complete_transcript_generation_v1(
  text,text,uuid,uuid,uuid,integer,boolean,public.ai_provider,text,jsonb
) from public, anon, authenticated;
revoke all on function public.enqueue_automatic_timeline_job_v1(
  text,uuid,uuid,public.ai_provider,text,uuid,uuid,text,text,text,jsonb,integer,jsonb
) from public, anon, authenticated;
revoke all on function public.claim_automatic_timeline_job_v1(uuid,uuid,timestamptz,integer)
  from public, anon, authenticated;
revoke all on function public.settle_automatic_timeline_job_v1(
  uuid,uuid,boolean,integer,integer,text,timestamptz
) from public, anon, authenticated;

grant execute on function public.complete_transcript_generation_v1(
  text,text,uuid,uuid,uuid,integer,boolean,public.ai_provider,text,jsonb
) to service_role;
grant execute on function public.enqueue_automatic_timeline_job_v1(
  text,uuid,uuid,public.ai_provider,text,uuid,uuid,text,text,text,jsonb,integer,jsonb
) to service_role;
grant execute on function public.claim_automatic_timeline_job_v1(uuid,uuid,timestamptz,integer)
  to service_role;
grant execute on function public.settle_automatic_timeline_job_v1(
  uuid,uuid,boolean,integer,integer,text,timestamptz
) to service_role;
