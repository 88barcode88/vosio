-- Expand the existing outbox without changing legacy keys, snapshots or manual jobs.
alter table public.automatic_timeline_intents
  add column processing_type public.ai_processing_type not null default 'timeline_chapters',
  add column completion_generation_key text;
update public.automatic_timeline_intents set completion_generation_key = automatic_idempotency_key;
alter table public.automatic_timeline_intents
  alter column completion_generation_key set not null,
  add constraint automatic_ai_intents_type_check check (processing_type in
    ('summary','action_items','meeting_minutes','crm_note','follow_up_email','timeline_chapters'));

-- Abort on contradictory lineage; never guess or deduplicate production data.
do $preflight$
begin
  if exists (select 1 from public.automatic_timeline_intents
    group by user_id, transcript_id, completion_generation_key, processing_type having count(*) > 1)
  then raise exception 'automatic AI uniqueness preflight failed'; end if;
end;
$preflight$;
create unique index automatic_ai_intents_generation_type_idx on public.automatic_timeline_intents
  (transcript_id, user_id, completion_generation_key, processing_type);
alter table public.ai_processing_jobs drop constraint ai_processing_jobs_automatic_shape_check;
alter table public.ai_processing_jobs add constraint ai_processing_jobs_automatic_shape_check check (
  (execution_mode = 'manual' and automatic_idempotency_key is null) or
  (execution_mode = 'automatic' and automatic_idempotency_key is not null and prompt_snapshot_exact = true
    and processing_type in ('summary','action_items','meeting_minutes','crm_note','follow_up_email','timeline_chapters'))
);

create function public.complete_transcript_generation_v2(
  p_completion_generation_key text,
  p_generation_kind text,
  p_transcript_id uuid,
  p_user_id uuid,
  p_transcription_job_id uuid,
  p_duration_seconds integer,
  p_processing_types text[],
  p_provider public.ai_provider,
  p_model text,
  p_provider_config jsonb
)
returns table (
  transcript_id uuid,
  is_new_generation boolean,
  scheduled_types text[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_type text;
  v_key text;
  v_has_override boolean := false;
  v_is_new_generation boolean;
  v_override public.prompt_template_overrides%rowtype;
  v_prompt public.prompt_templates%rowtype;
  v_provider_config jsonb;
  v_transcript public.transcripts%rowtype;
begin
  if p_processing_types is null or exists (
    select 1 from unnest(p_processing_types) selected(type)
    where type is null or type not in ('summary','action_items','meeting_minutes','crm_note','follow_up_email','timeline_chapters')
  ) then raise exception 'invalid automatic processing types' using errcode = '22023'; end if;
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
    delete from public.automatic_timeline_intents i
      where i.transcript_id = p_transcript_id and i.user_id = p_user_id;
    delete from public.ai_processing_jobs j
      where j.transcript_id = p_transcript_id and j.user_id = p_user_id;
    for v_type in
      select type from unnest(array['summary','action_items','meeting_minutes','crm_note','follow_up_email','timeline_chapters']) selected(type)
      where type = any(p_processing_types)
    loop
      v_key := case when v_type = 'timeline_chapters' then p_completion_generation_key
        else 'aai_v2_' || encode(sha256(convert_to(p_user_id::text || E'\n' || p_transcript_id::text || E'\n' || p_completion_generation_key || E'\n' || v_type, 'UTF8')), 'hex') end;

      select p.*
      into v_prompt
      from public.prompt_templates p
      where p.is_system = true
        and p.processing_type::text = v_type
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

      insert into public.automatic_timeline_intents (
        processing_type, completion_generation_key,
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
        v_type::public.ai_processing_type, p_completion_generation_key,
        v_key,
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
      );
    end loop;
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
    array(select i.processing_type::text from public.automatic_timeline_intents i
      where i.completion_generation_key = p_completion_generation_key
        and i.transcript_id = p_transcript_id and i.user_id = p_user_id
      order by i.processing_type);
end;
$$;
create or replace function public.complete_transcript_generation_v1(
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
language sql security invoker set search_path = '' as $$
  select transcript_id, is_new_generation, 'timeline_chapters' = any(scheduled_types)
  from public.complete_transcript_generation_v2(p_completion_generation_key, p_generation_kind,
    p_transcript_id, p_user_id, p_transcription_job_id, p_duration_seconds,
    case when p_automatic_timeline_enabled then array['timeline_chapters'] else array[]::text[] end,
    p_provider, p_model, p_provider_config);
$$;

-- Enqueue derives every immutable snapshot from a current durable intent.
create function public.enqueue_automatic_ai_job_v2(p_transcript_id uuid, p_user_id uuid, p_processing_type text, p_automatic_idempotency_key text)
returns setof public.ai_processing_jobs language plpgsql security invoker set search_path = '' as $$
declare v_generation text; v_intent public.automatic_timeline_intents%rowtype;
begin
  select completion_generation_key into v_generation from public.transcripts
    where id = p_transcript_id and user_id = p_user_id for update;
  if not found then return; end if;
  select * into v_intent from public.automatic_timeline_intents
    where transcript_id = p_transcript_id and user_id = p_user_id
      and processing_type::text = p_processing_type and automatic_idempotency_key = p_automatic_idempotency_key
      and completion_generation_key = v_generation;
  if not found then return; end if;
  insert into public.ai_processing_jobs (
    automatic_idempotency_key, execution_mode, max_attempts, model, processing_type, prompt_id,
    prompt_name_snapshot, prompt_output_schema_snapshot, prompt_override_id, prompt_revision_snapshot,
    prompt_snapshot_exact, prompt_source, prompt_text_snapshot, provider, provider_config, status, transcript_id, user_id
  ) values (
    v_intent.automatic_idempotency_key, 'automatic', 3, v_intent.model, v_intent.processing_type, v_intent.prompt_id,
    v_intent.prompt_name_snapshot, v_intent.prompt_output_schema_snapshot, v_intent.prompt_override_id,
    v_intent.prompt_revision_snapshot, true, v_intent.prompt_source, v_intent.prompt_text_snapshot,
    v_intent.provider, v_intent.provider_config, 'queued', p_transcript_id, p_user_id
  ) on conflict (automatic_idempotency_key) where automatic_idempotency_key is not null do nothing;
  return query select j.* from public.ai_processing_jobs j
    where j.automatic_idempotency_key = p_automatic_idempotency_key and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.processing_type::text = p_processing_type and j.execution_mode = 'automatic';
end;
$$;

-- Lock transcript before job in every automatic writer, including claim and publication.
create function public.claim_automatic_ai_job_v2(p_job_id uuid, p_lease_token uuid, p_now timestamptz, p_lease_seconds integer)
returns setof public.ai_processing_jobs language plpgsql security invoker set search_path = '' as $$
declare v_job public.ai_processing_jobs%rowtype; v_generation text; v_now timestamptz;
begin
  select * into v_job from public.ai_processing_jobs where id = p_job_id and execution_mode = 'automatic';
  if not found or p_lease_token is null then return; end if;
  select completion_generation_key into v_generation from public.transcripts
    where id = v_job.transcript_id and user_id = v_job.user_id for update;
  if not found then return; end if;
  select * into v_job from public.ai_processing_jobs where id = p_job_id for update;
  if not found or not exists (select 1 from public.automatic_timeline_intents i
    where i.transcript_id = v_job.transcript_id and i.user_id = v_job.user_id
      and i.automatic_idempotency_key = v_job.automatic_idempotency_key and i.processing_type = v_job.processing_type
      and i.completion_generation_key = v_generation) then return; end if;
  v_now := clock_timestamp();
  -- The server clock is authoritative, never a caller-supplied future timestamp.
  return query update public.ai_processing_jobs
    set attempt_count = attempt_count + 1, completed_at = null, error_message = null,
      lease_expires_at = v_now + make_interval(secs => greatest(60, least(p_lease_seconds, 900))),
      lease_token = p_lease_token, started_at = v_now, status = 'running'
    where id = p_job_id and attempt_count < max_attempts
      and (status in ('queued','failed') or (status = 'running' and lease_expires_at <= v_now))
    returning *;
end;
$$;

-- Settle failures or repair a durable legacy output only under the current generation and lease.
create function public.settle_automatic_ai_job_v2(p_job_id uuid, p_lease_token uuid, p_succeeded boolean,
  p_input_token_count integer, p_output_token_count integer, p_error_message text, p_now timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_job public.ai_processing_jobs%rowtype; v_generation text; v_count integer;
begin
  select * into v_job from public.ai_processing_jobs where id = p_job_id and execution_mode = 'automatic';
  if not found then return false; end if;
  select completion_generation_key into v_generation from public.transcripts
    where id = v_job.transcript_id and user_id = v_job.user_id for update;
  select * into v_job from public.ai_processing_jobs where id = p_job_id for update;
  if not found or not exists (select 1 from public.automatic_timeline_intents i
    where i.automatic_idempotency_key = v_job.automatic_idempotency_key
      and i.transcript_id = v_job.transcript_id and i.user_id = v_job.user_id
      and i.processing_type = v_job.processing_type and i.completion_generation_key = v_generation)
    then return false; end if;
  if p_succeeded and not exists (select 1 from public.ai_outputs o where o.processing_job_id = p_job_id
    and o.transcript_id = v_job.transcript_id and o.user_id = v_job.user_id) then return false; end if;
  update public.ai_processing_jobs set completed_at = clock_timestamp(),
    error_message = case when p_succeeded then null else 'Automatic AI processing failed.' end,
    input_token_count = case when p_succeeded then coalesce(p_input_token_count, input_token_count) else input_token_count end,
    output_token_count = case when p_succeeded then coalesce(p_output_token_count, output_token_count) else output_token_count end,
    lease_expires_at = null, lease_token = null,
    status = case when p_succeeded then 'done'::public.job_status else 'failed'::public.job_status end
    where id = p_job_id and execution_mode = 'automatic' and status = 'running'
      and lease_token = p_lease_token and lease_expires_at > clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Publication validates authority before all writes; any SQL failure rolls back output, projections and settlement.
create function public.publish_automatic_ai_output_v2(p_job_id uuid, p_user_id uuid, p_transcript_id uuid,
  p_generation_key text, p_lease_token uuid, p_output_id uuid, p_output_text text, p_output_json jsonb,
  p_input_token_count integer, p_output_token_count integer, p_projections jsonb)
returns setof public.ai_outputs language plpgsql security invoker set search_path = '' as $$
declare v_generation text; v_job public.ai_processing_jobs%rowtype; v_output public.ai_outputs%rowtype;
  v_table text; v_row jsonb; v_now timestamptz;
begin
  select completion_generation_key into v_generation from public.transcripts
    where id = p_transcript_id and user_id = p_user_id for update;
  if not found or v_generation is distinct from p_generation_key then return; end if;
  select * into v_job from public.ai_processing_jobs where id = p_job_id for update;
  if not found or v_job.execution_mode <> 'automatic' or v_job.transcript_id <> p_transcript_id
    or v_job.user_id <> p_user_id or not exists (select 1 from public.automatic_timeline_intents i
      where i.automatic_idempotency_key = v_job.automatic_idempotency_key and i.user_id = p_user_id
        and i.transcript_id = p_transcript_id and i.processing_type = v_job.processing_type
        and i.completion_generation_key = p_generation_key) then return; end if;
  select * into v_output from public.ai_outputs where processing_job_id = p_job_id;
  if found then
    if v_output.user_id = p_user_id and v_output.transcript_id = p_transcript_id and v_job.status = 'done' then
      return next v_output;
    end if;
    return;
  end if;
  if v_job.status <> 'running' or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at <= clock_timestamp() or p_lease_token is null then return; end if;
  if p_output_id is null or jsonb_typeof(p_projections) is distinct from 'object'
    or exists (select 1 from jsonb_object_keys(p_projections) k where k not in ('tasks','chapters','decisions','risks'))
    then raise exception 'invalid automatic projection envelope' using errcode = '22023'; end if;
  -- Validate every supplied linkage before the first insert.
  foreach v_table in array array['tasks','chapters','decisions','risks'] loop
    if jsonb_typeof(p_projections->v_table) is distinct from 'array' then
      raise exception 'invalid automatic projection rows' using errcode = '22023'; end if;
    for v_row in select value from jsonb_array_elements(p_projections->v_table) loop
      if (v_row->>'ai_output_id')::uuid is distinct from p_output_id
        or (v_row->>'processing_job_id')::uuid is distinct from p_job_id
        or (v_row->>'transcript_id')::uuid is distinct from p_transcript_id
        or (v_row->>'user_id')::uuid is distinct from p_user_id
        then raise exception 'automatic projection ownership mismatch' using errcode = '22023'; end if;
    end loop;
  end loop;
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text,output_json)
    values (p_output_id,p_job_id,p_transcript_id,p_user_id,p_output_text,p_output_json) returning * into v_output;
  v_now := clock_timestamp();
  foreach v_table in array array['tasks','chapters','decisions','risks'] loop
    for v_row in select value from jsonb_array_elements(p_projections->v_table) loop
      -- Only server-derived fields are used; row identities and timestamps are reserved here.
      v_row := v_row || jsonb_build_object('id', gen_random_uuid(), 'created_at', v_now, 'updated_at', v_now);
      execute format('insert into public.%I select (jsonb_populate_record(null::public.%I, $1)).*',
        'transcript_' || v_table, 'transcript_' || v_table) using v_row;
    end loop;
  end loop;
  if not public.settle_automatic_ai_job_v2(p_job_id,p_lease_token,true,p_input_token_count,p_output_token_count,null,v_now)
    then raise exception 'automatic publication lease conflict' using errcode = '40001'; end if;
  return next v_output;
end;
$$;
create or replace function public.enqueue_automatic_timeline_job_v1(
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
language plpgsql security invoker set search_path = '' as $$
begin
  return query select * from public.enqueue_automatic_ai_job_v2(p_transcript_id,p_user_id,'timeline_chapters',p_automatic_idempotency_key);
end;
$$;
create or replace function public.claim_automatic_timeline_job_v1(
  p_job_id uuid,
  p_lease_token uuid,
  p_now timestamptz,
  p_lease_seconds integer
)
returns setof public.ai_processing_jobs
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.ai_processing_jobs where id = p_job_id and processing_type = 'timeline_chapters') then return; end if;
  return query select * from public.claim_automatic_ai_job_v2(p_job_id,p_lease_token,p_now,p_lease_seconds);
end;
$$;
create or replace function public.settle_automatic_timeline_job_v1(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_input_token_count integer,
  p_output_token_count integer,
  p_error_message text,
  p_now timestamptz
)
returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.ai_processing_jobs where id = p_job_id and processing_type = 'timeline_chapters') then return false; end if;
  return public.settle_automatic_ai_job_v2(p_job_id,p_lease_token,p_succeeded,p_input_token_count,p_output_token_count,p_error_message,p_now);
end;
$$;

-- No browser role can invoke either protocol; existing v1 ACLs are preserved by replacement.
revoke all on function public.complete_transcript_generation_v2(text,text,uuid,uuid,uuid,integer,text[],public.ai_provider,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_transcript_generation_v2(text,text,uuid,uuid,uuid,integer,text[],public.ai_provider,text,jsonb) to service_role;
revoke all on function public.enqueue_automatic_ai_job_v2(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_automatic_ai_job_v2(uuid,uuid,text,text) to service_role;
revoke all on function public.claim_automatic_ai_job_v2(uuid,uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.claim_automatic_ai_job_v2(uuid,uuid,timestamptz,integer) to service_role;
revoke all on function public.settle_automatic_ai_job_v2(uuid,uuid,boolean,integer,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_automatic_ai_job_v2(uuid,uuid,boolean,integer,integer,text,timestamptz) to service_role;
revoke all on function public.publish_automatic_ai_output_v2(uuid,uuid,uuid,text,uuid,uuid,text,jsonb,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.publish_automatic_ai_output_v2(uuid,uuid,uuid,text,uuid,uuid,text,jsonb,integer,integer,jsonb) to service_role;
