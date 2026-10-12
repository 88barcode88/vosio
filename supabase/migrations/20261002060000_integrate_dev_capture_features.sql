begin;
-- SOURCE ONLY: current-dev compatibility after all reviewed sharing forwards.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Capture completion preserves all six private snapshots without creating jobs or changing history.
create or replace function public.mark_capture_timeline_consent_v1() returns trigger
language plpgsql security definer set search_path = '' as $snapshot$
declare v_settings jsonb; v_model text; v_provider public.ai_provider; v_config jsonb;
  v_type text; v_prompt public.prompt_templates; v_override public.prompt_template_overrides;
  v_override_found boolean; v_outputs jsonb := '[]'::jsonb; v_transcript public.transcripts;
begin
  if new.status<>'completed' or old.status='completed'
    or not(new.capture_request_id is not null or exists(select 1 from public.transcripts t
      where t.recording_id=new.id and t.completion_generation_key like 'async:%'))
    or not(new.project_id is null or new.visibility='private' or exists(select 1 from public.recording_projects p
      where p.id=new.project_id and p.user_id=new.user_id)) then return new; end if;
  select raw_user_meta_data->'vosio_settings' into v_settings from auth.users where id=new.user_id;
  if v_settings ? 'aiTemperature' and not (case when jsonb_typeof(v_settings->'aiTemperature')='number'
    then (v_settings->>'aiTemperature')::numeric between 0 and 2 else false end) then return new; end if;
  if v_settings ? 'autoTimelineAfterTranscription' and jsonb_typeof(v_settings->'autoTimelineAfterTranscription')<>'boolean'
    then return new; end if;
  if jsonb_typeof(v_settings->'automaticOutputTypes')='array' and exists(select 1
    from jsonb_array_elements(v_settings->'automaticOutputTypes') x where jsonb_typeof(x)<>'string'
      or x#>>'{}' not in ('summary','action_items','meeting_minutes','crm_note','follow_up_email')) then
    v_settings:=jsonb_set(v_settings,'{automaticOutputTypes}','[]');
  end if;
  v_model:=coalesce(v_settings->>'defaultOpenaiModel','gpt-5.6-terra');
  v_model:=case when v_model in ('gemini-3.1-flash-lite','gemini-3.1-pro-preview','gemini-3.5-flash') then 'gemini-3.6-flash'
    when v_model in ('gpt-4.1-mini','gpt-4.1-nano','gpt-5.4','gpt-5.4-mini','gpt-5.4-nano') then 'gpt-5.6-terra' else v_model end;
  if v_model not in ('gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gemini-3.6-flash','gemini-3.8-flash',
    'gpt-6-astra-low','gpt-6-astra-medium','mistral-small-2603','mistral-large-2512') then return new; end if;
  v_provider:=case when v_model like 'gemini-%' then 'gemini'::public.ai_provider
    when v_model like 'mistral-%' then 'mistral'::public.ai_provider else 'openai'::public.ai_provider end;
  v_config:=jsonb_build_object('provider',v_provider,'provider_model',case when v_model like 'gpt-6-astra-%' then 'gpt-6-astra' else v_model end,
    'reasoning_effort',case v_model when 'gpt-5.6-terra' then 'high' when 'gpt-5.6-sol' then 'xhigh'
      when 'gpt-5.6-luna' then 'xhigh' when 'gpt-6-astra-low' then 'low' when 'gpt-6-astra-medium' then 'medium' end,
    'thinking_level',case when v_provider='gemini' then 'medium' end);
  if v_provider='mistral' then
    v_config:=v_config||jsonb_build_object('temperature',case when jsonb_typeof(v_settings->'aiTemperature')='number'
      and (v_settings->>'aiTemperature')::numeric between 0 and 2 then (v_settings->>'aiTemperature')::numeric else 0.2 end);
  end if;
  select * into v_transcript from public.transcripts where recording_id=new.id and user_id=new.user_id
    order by created_at desc,id desc limit 1;
  if not found or v_transcript.completion_generation_key is null then return new; end if;
  for v_type in select unnest(array['summary','action_items','meeting_minutes','crm_note','follow_up_email','timeline_chapters']) loop
    if not coalesce(case when v_type='timeline_chapters' then v_settings->'autoTimelineAfterTranscription'='true'::jsonb
      else jsonb_typeof(v_settings->'automaticOutputTypes')='array' and v_settings->'automaticOutputTypes' ? v_type end,false) then continue; end if;
    select * into v_prompt from public.prompt_templates where is_system and processing_type::text=v_type order by id limit 1 for share;
    if not found then continue; end if;
    select * into v_override from public.prompt_template_overrides where system_prompt_id=v_prompt.id and user_id=new.user_id and is_active for share;
    v_override_found:=found;
    v_outputs:=v_outputs||jsonb_build_array(jsonb_build_object('processing_type',v_type,'model',v_model,'provider',v_provider,
      'provider_config',v_config||jsonb_build_object('response_format',case when v_prompt.output_schema is null then 'text' else 'json_schema' end),
      'prompt_id',v_prompt.id,'prompt_name',v_prompt.name,'output_schema',v_prompt.output_schema,
      'override_id',case when v_override_found then v_override.id end,'revision',case when v_override_found then v_override.revision end,
      'source',case when v_override_found then 'user_override' else 'system' end,
      'text',case when v_override_found then v_override.prompt_text else v_prompt.prompt_text end));
  end loop;
  if jsonb_array_length(v_outputs)>0 then
    insert into public.capture_timeline_snapshots values(v_transcript.id,new.user_id,
      jsonb_build_object('completion_generation_key',v_transcript.completion_generation_key,'outputs',v_outputs))
    on conflict(transcript_id) do nothing;
  end if;
  return new;
end;
$snapshot$;

-- Current personal authority and current opt-in consume only the immutable completion-time snapshots.
create function public.schedule_capture_automatic_intents_v2(p_transcript_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $schedule$
declare v_record public.recordings; v_transcript public.transcripts; v_snapshot jsonb; v_output jsonb;
  v_settings jsonb; v_type text; v_key text; v_scheduled boolean:=false;
begin
  if auth.uid() is null then raise exception 'AI not permitted' using errcode='42501'; end if;
  select * into v_transcript from public.transcripts where id=p_transcript_id;
  v_record:=public.lock_recording_capture_v1(v_transcript.recording_id);
  if v_record.user_id<>auth.uid() or v_transcript.user_id<>auth.uid() or v_record.status<>'completed'
    or not public.can_read_recording(v_record.id) or not public.can_manage_recording(v_record.id) then
    raise exception 'AI not permitted' using errcode='42501'; end if;
  select snapshot into v_snapshot from public.capture_timeline_snapshots where transcript_id=p_transcript_id and user_id=auth.uid();
  if not found or v_snapshot->>'completion_generation_key' is distinct from v_transcript.completion_generation_key then return false; end if;
  select raw_user_meta_data->'vosio_settings' into v_settings from auth.users where id=auth.uid();
  for v_output in select value from jsonb_array_elements(v_snapshot->'outputs') loop
    v_type:=v_output->>'processing_type';
    if not coalesce(case when v_type='timeline_chapters' then v_settings->'autoTimelineAfterTranscription'='true'::jsonb
      else jsonb_typeof(v_settings->'automaticOutputTypes')='array' and v_settings->'automaticOutputTypes' ? v_type end,false) then continue; end if;
    v_key:='aai_capture_v2_'||encode(sha256(convert_to(auth.uid()::text||E'\n'||p_transcript_id::text||E'\n'||v_transcript.completion_generation_key||E'\n'||v_type,'UTF8')),'hex');
    insert into public.automatic_timeline_intents(processing_type,completion_generation_key,automatic_idempotency_key,consent_snapshot,
      model,prompt_id,prompt_name_snapshot,prompt_output_schema_snapshot,prompt_override_id,prompt_revision_snapshot,prompt_source,
      prompt_text_snapshot,provider,provider_config,transcript_id,user_id)
    values(v_type::public.ai_processing_type,v_transcript.completion_generation_key,v_key,true,v_output->>'model',
      (v_output->>'prompt_id')::uuid,v_output->>'prompt_name',nullif(v_output->'output_schema','null'::jsonb),
      (v_output->>'override_id')::uuid,(v_output->>'revision')::integer,v_output->>'source',v_output->>'text',
      (v_output->>'provider')::public.ai_provider,v_output->'provider_config',p_transcript_id,auth.uid())
    on conflict(transcript_id,user_id,completion_generation_key,processing_type) do nothing;
    v_scheduled:=true;
  end loop;
  return v_scheduled;
end;
$schedule$;
create or replace function public.schedule_capture_timeline_intent_v1(p_transcript_id uuid) returns boolean
language sql security definer set search_path = '' as $$ select public.schedule_capture_automatic_intents_v2(p_transcript_id); $$;

-- Exact append-only durable safety-part registrations are private; no broad folder upload permission.
-- Legacy single chunks remain supported; durable part manifests must be contiguous and homogeneous.
create or replace function public.get_recording_live_manifest_v1(p_owner uuid,p_recording uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $manifest$
declare v_prefix text:=p_owner::text||'/'||p_recording::text||'/live/'; v_paths text[]; v_count integer;
begin
  select coalesce(array_agg(s.name order by s.name),array[]::text[]) into v_paths from (
    select name from storage.objects where bucket_id='recordings' and left(name,length(v_prefix))=v_prefix
    order by name limit 1001
  ) s;
  v_count:=cardinality(v_paths);
  if v_count>1000 or exists(select 1 from unnest(v_paths) p where
    substr(p,length(v_prefix)+1) !~ '^[A-Za-z0-9_-]+\.(webm|ogg|mp3|m4a|wav|mp4|flac)$') then
    raise exception 'invalid live manifest' using errcode='55000'; end if;
  if exists(select 1 from unnest(v_paths) p where substr(p,length(v_prefix)+1) like 'part-%') then
    if exists(select 1 from unnest(v_paths) with ordinality p(name,position) where
      substr(name,length(v_prefix)+1) !~ '^part-[0-9]{6}\.(webm|m4a)$'
      or case when substr(name,length(v_prefix)+1) ~ '^part-[0-9]{6}\.(webm|m4a)$'
        then substr(name,length(v_prefix)+6,6)::integer<>position-1 else true end)
      or (select count(distinct substring(name from '\.([^.]+)$')) from unnest(v_paths) name)>1 then
      raise exception 'invalid safety sequence' using errcode='55000'; end if;
  end if;
  return v_paths;
end;
$manifest$;

create table public.recording_live_part_registrations(
  recording_id uuid not null references public.recordings(id) on delete cascade,
  capture_request_id uuid not null, storage_path text not null unique,
  part_index integer not null check(part_index between 0 and 999),
  mime_type text not null, file_size_bytes bigint not null check(file_size_bytes between 1 and 5368709120),
  primary key(recording_id,part_index)
);
alter table public.recording_live_part_registrations enable row level security;
alter table public.recording_live_part_registrations force row level security;
revoke all on table public.recording_live_part_registrations from public,anon,authenticated,service_role;

-- Register one immutable object under the exact capture and locked current-author revision.
-- Mutable user audio admission cannot invalidate an already reserved transcription attempt.
create function public.assert_live_capture_idle_v1(p_recording_id uuid) returns void
language plpgsql security definer set search_path = '' as $idle$
begin
  perform public.lock_recording_capture_v1(p_recording_id);
  if exists(select 1 from public.recording_transcription_operations where recording_id=p_recording_id
    and phase in ('prepared','started','accepted','uncertain'))
    or exists(select 1 from public.transcription_jobs where recording_id=p_recording_id and status in ('queued','running')) then
    raise exception 'transcription already reserved' using errcode='55000'; end if;
end;
$idle$;
revoke all on function public.assert_live_capture_idle_v1(uuid) from public,anon,authenticated,service_role;

-- Only a complete exact registered object set can back a new capture recovery or fallback.
create function public.get_registered_live_parts_manifest_v1(p_recording_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $registered$
declare v_record public.recordings; v_count integer; v_paths text[];
begin
  v_record:=public.lock_recording_capture_v1(p_recording_id);
  select count(*) into v_count from public.recording_live_part_registrations where recording_id=v_record.id;
  select coalesce(array_agg(s.name order by s.name),array[]::text[]) into v_paths from (
    select name from storage.objects where bucket_id='recordings'
      and left(name,length(v_record.user_id::text||'/'||v_record.id::text||'/live/'))=v_record.user_id::text||'/'||v_record.id::text||'/live/'
      and not coalesce(name=v_record.storage_path and name in (v_record.user_id::text||'/'||v_record.id::text||'/live/recording.webm',
        v_record.user_id::text||'/'||v_record.id::text||'/live/recording.m4a')
        and metadata->>'size'=v_record.file_size_bytes::text and metadata->>'mimetype'=v_record.mime_type,false)
    order by name limit 1001
  ) s;
  if v_count=0 or cardinality(v_paths)<>v_count or cardinality(v_paths)>1000
    or (select count(distinct mime_type) from public.recording_live_part_registrations where recording_id=v_record.id)>1
    or exists(select 1 from public.recording_live_part_registrations p where p.recording_id=v_record.id and
      (p.capture_request_id<>v_record.capture_request_id or p.part_index>=v_count
        or not exists(select 1 from storage.objects s where s.bucket_id='recordings' and s.name=p.storage_path
          and s.metadata->>'size'=p.file_size_bytes::text and s.metadata->>'mimetype'=p.mime_type))) then
    raise exception 'safety manifest incomplete' using errcode='55000'; end if;
  return v_paths;
end;
$registered$;
revoke all on function public.get_registered_live_parts_manifest_v1(uuid) from public,anon,authenticated,service_role;

alter table public.recording_capture_binding_permits drop constraint recording_capture_binding_permits_transition_check;
alter table public.recording_capture_binding_permits add check(transition in ('text_only','parts_fallback'));

-- The sole additive retarget is an absent prepared archive to its complete exact safety manifest.
create or replace function public.guard_recording_object_binding_v1() returns trigger
language plpgsql security definer set search_path = '' as $binding$
declare v_permitted uuid; v_path text;
begin
  if new.storage_path is not null and not public.is_canonical_capture_path_v1(new.user_id,new.id,new.storage_path) then
    raise exception 'recording object binding mismatch' using errcode='23514'; end if;
  if tg_op='UPDATE' and old.storage_path is not null and new.storage_path is distinct from old.storage_path then
    v_path:=old.user_id::text||'/'||old.id::text||'/live/';
    if new.storage_path is null and new.source_type='realtime' and new.file_size_bytes=0
      and new.user_id=old.user_id and new.id=old.id and old.status in ('created','uploading','failed','transcribing')
      and not exists(select 1 from storage.objects s where s.bucket_id='recordings'
        and left(s.name,length(old.user_id::text||'/'||old.id::text||'/'))=old.user_id::text||'/'||old.id::text||'/') then
      delete from public.recording_capture_binding_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid()
        and recording_id=old.id and transition='text_only' returning recording_id into v_permitted;
    elsif new.user_id=old.user_id and new.id=old.id and new.capture_request_id=old.capture_request_id
      and old.capture_request_id is not null and old.source_type='in_app_recording'
      and old.status in ('created','uploading','failed') and new.storage_path=v_path
      and old.storage_path in (v_path||'recording.webm',v_path||'recording.m4a')
      and not exists(select 1 from storage.objects where bucket_id='recordings' and name=old.storage_path) then
      perform public.assert_live_capture_idle_v1(old.id);
      perform public.get_registered_live_parts_manifest_v1(old.id);
      delete from public.recording_capture_binding_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid()
        and recording_id=old.id and transition='parts_fallback' returning recording_id into v_permitted;
    end if;
    if v_permitted is null then raise exception 'recording object binding is immutable' using errcode='23514'; end if;
  end if;
  return new;
end;
$binding$;

create function public.prepare_recording_live_part_v1(p_recording_id uuid,p_expected_capture_revision bigint,p_part_index integer,p_mime_type text,p_file_size_bytes bigint)
returns text language plpgsql security definer set search_path = '' as $part$
declare v_record public.recordings; v_part public.recording_live_part_registrations; v_path text; v_extension text; v_limit bigint;
begin
  if p_expected_capture_revision is null or p_expected_capture_revision<0 then raise exception 'invalid capture revision' using errcode='22023'; end if;
  v_record:=public.lock_recording_capture_v1(p_recording_id);
  if not public.has_recording_capture_authority_v1(v_record.id) or v_record.capture_request_id is null
    or v_record.source_type<>'in_app_recording' or v_record.status not in ('created','uploading','failed') then
    raise exception 'capture denied' using errcode='42501'; end if;
  if v_record.capture_revision<>p_expected_capture_revision then raise exception 'capture changed' using errcode='40001'; end if;
  perform public.assert_live_capture_idle_v1(v_record.id);
  select file_size_limit into v_limit from storage.buckets where id='recordings';
  if p_part_index is null or p_part_index not between 0 and 999 or p_file_size_bytes is null
    or p_file_size_bytes not between 1 and least(coalesce(v_limit,5368709120),5368709120)
    or p_mime_type not in ('audio/webm','video/webm','audio/mp4','audio/m4a','audio/x-m4a','video/mp4') then
    raise exception 'invalid safety part' using errcode='22023'; end if;
  v_extension:=case when p_mime_type in ('audio/webm','video/webm') then 'webm' else 'm4a' end;
  v_path:=v_record.user_id::text||'/'||v_record.id::text||'/live/part-'||lpad(p_part_index::text,6,'0')||'.'||v_extension;
  select * into v_part from public.recording_live_part_registrations where recording_id=v_record.id and part_index=p_part_index;
  if found then
    if v_part.capture_request_id<>v_record.capture_request_id or v_part.storage_path<>v_path
      or v_part.mime_type<>p_mime_type or v_part.file_size_bytes<>p_file_size_bytes then
      raise exception 'safety identity changed' using errcode='22023'; end if;
  else
    insert into public.recording_live_part_registrations values(v_record.id,v_record.capture_request_id,v_path,p_part_index,p_mime_type,p_file_size_bytes);
  end if;
  if v_record.status in ('created','failed') then update public.recordings set status='uploading' where id=v_record.id; end if;
  return v_path;
end;
$part$;

-- Storage evaluates current authority for every new user upload, including an already registered retry.
create or replace function public.can_write_recording_object_v1(p_name text) returns boolean
language plpgsql volatile security definer set search_path = '' as $write$
declare v_id uuid;
begin
  select id into v_id from public.recordings r where r.storage_path=p_name
    and public.is_canonical_capture_path_v1(r.user_id,r.id,p_name);
  if v_id is null then
    select r.id into v_id from public.recording_live_part_registrations p join public.recordings r on r.id=p.recording_id
      where p.storage_path=p_name and p.capture_request_id=r.capture_request_id;
    -- A completed registered part is immutable, including same-size content replacements.
    if exists(select 1 from storage.objects s where s.bucket_id='recordings' and s.name=p_name
      and s.metadata->>'size' ~ '^[1-9][0-9]*$') then return false; end if;
  end if;
  if v_id is null or not public.can_write_recording_capture_v1(v_id) then return false; end if;
  return not exists(select 1 from public.recording_transcription_operations where recording_id=v_id
      and phase in ('prepared','started','accepted','uncertain'))
    and not exists(select 1 from public.transcription_jobs where recording_id=v_id and status in ('queued','running'));
end;
$write$;

-- Validate the complete deterministic manifest before binding segmented audio, replayed by request receipt.
create function public.complete_recording_live_parts_v1(p_recording_id uuid,p_request_id uuid,p_expected_capture_revision bigint,p_duration_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $complete$
declare v_record public.recordings; v_receipt public.recording_capture_receipts; v_hash text;
  v_count integer; v_bytes bigint; v_path text; v_result jsonb;
begin
  if p_expected_capture_revision is null or p_expected_capture_revision<0 then raise exception 'invalid capture revision' using errcode='22023'; end if;
  v_record:=public.lock_recording_capture_v1(p_recording_id);
  if not public.has_recording_capture_authority_v1(v_record.id) then raise exception 'capture denied' using errcode='42501'; end if;
  if p_request_id is null or p_duration_seconds is null or p_duration_seconds<0 then raise exception 'invalid completion' using errcode='22023'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_array('live_parts',p_recording_id,p_expected_capture_revision,p_duration_seconds)::text,'UTF8')),'hex');
  select * into v_receipt from public.recording_capture_receipts where actor_id=auth.uid() and request_id=p_request_id;
  if found then
    if v_receipt.recording_id<>p_recording_id or v_receipt.payload_fingerprint<>v_hash then raise exception 'request changed' using errcode='22023'; end if;
    return v_receipt.result;
  end if;
  if v_record.capture_revision<>p_expected_capture_revision then raise exception 'capture changed' using errcode='40001'; end if;
  perform public.assert_live_capture_idle_v1(v_record.id);
  if v_record.status not in ('created','uploading','failed') then raise exception 'invalid capture state' using errcode='55000'; end if;
  v_path:=v_record.user_id::text||'/'||v_record.id::text||'/live/';
  if v_record.storage_path is not null and v_record.storage_path<>v_path and
    (v_record.storage_path not in (v_path||'recording.webm',v_path||'recording.m4a')
      or exists(select 1 from storage.objects where bucket_id='recordings' and name=v_record.storage_path)) then
    raise exception 'audio binding already fixed' using errcode='22023'; end if;
  select count(*),sum(file_size_bytes) into v_count,v_bytes from public.recording_live_part_registrations where recording_id=v_record.id;
  perform public.get_registered_live_parts_manifest_v1(v_record.id);
  if v_count=0 or (select count(distinct mime_type) from public.recording_live_part_registrations where recording_id=v_record.id)>1
    or exists(select 1 from public.recording_live_part_registrations p
    where p.recording_id=v_record.id and (p.part_index>=v_count or p.capture_request_id<>v_record.capture_request_id
      or not exists(select 1 from storage.objects s where s.bucket_id='recordings' and s.name=p.storage_path
        and s.metadata->>'size'=p.file_size_bytes::text and s.metadata->>'mimetype'=p.mime_type)))
    or cardinality(public.get_recording_live_manifest_v1(v_record.user_id,v_record.id))<>v_count then
    raise exception 'safety manifest incomplete' using errcode='55000'; end if;
  insert into public.recording_capture_binding_permits values(txid_current(),pg_backend_pid(),v_record.id,'parts_fallback');
  update public.recordings set storage_path=v_path,status='uploaded',file_size_bytes=v_bytes,
    duration_seconds=p_duration_seconds,capture_revision=capture_revision+1,error_message=null where id=v_record.id returning * into v_record;
  v_result:=jsonb_build_object('recordingId',v_record.id,'status',v_record.status,'captureRevision',v_record.capture_revision,'transcriptId',null,'jobId',null);
  insert into public.recording_capture_receipts values(auth.uid(),p_request_id,v_record.id,v_hash,v_result,clock_timestamp());
  delete from public.recording_capture_binding_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid() and recording_id=v_record.id;
  return v_result;
end;
$complete$;

-- Recovery now returns the exact persisted transcript receipt and binds only a previously unbound new completion.
create or replace function public.apply_recording_capture_transition_v1(
  p_recording_id uuid,p_request_id uuid,p_expected_capture_revision bigint,p_transition text,
  p_duration_seconds integer default null,p_mime_type text default null,p_file_size_bytes bigint default null,
  p_raw_text text default null,p_segments jsonb default null,p_speakers jsonb default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $capture$
declare v_record public.recordings; v_receipt public.recording_capture_receipts; v_hash text; v_result jsonb;
  v_transcript uuid; v_job uuid; v_prefix text; v_count bigint; v_bytes bigint; v_has_text boolean; v_invalid_audio boolean; v_paths text[];
begin
  if auth.uid() is null then raise exception 'capture denied' using errcode='42501'; end if;
  if p_request_id is null or p_expected_capture_revision is null or p_expected_capture_revision<0
    or p_transition is null or p_transition not in ('upload_complete','capture_failed','text_only','live_draft','live_final','import_final','recover')
    or p_duration_seconds<0 or p_file_size_bytes<0 then raise exception 'invalid capture transition' using errcode='22023'; end if;
  if p_transition in ('live_draft','live_final','import_final') then
    perform public.validate_capture_transcript_v1(p_raw_text,p_segments,p_speakers);
    if p_transition<>'live_draft' and btrim(p_raw_text)='' then raise exception 'empty final transcript' using errcode='22023'; end if;
  elsif p_raw_text is not null or p_segments is not null or p_speakers is not null then
    raise exception 'unexpected transcript payload' using errcode='22023'; end if;
  if p_transition<>'upload_complete' and (p_mime_type is not null or p_file_size_bytes is not null) then
    raise exception 'unexpected upload metadata' using errcode='22023'; end if;
  if p_transition in ('capture_failed','recover') and p_duration_seconds is not null then
    raise exception 'unexpected duration' using errcode='22023'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_array(p_recording_id,p_expected_capture_revision,p_transition,
    p_duration_seconds,p_mime_type,p_file_size_bytes,p_raw_text,p_segments,p_speakers)::text,'UTF8')),'hex');
  v_record:=public.lock_recording_capture_v1(p_recording_id);
  if not public.has_recording_capture_authority_v1(v_record.id)
    and not(p_transition='recover' and public.can_manage_recording(v_record.id) and v_record.status<>'deleted') then
    raise exception 'capture denied' using errcode='42501'; end if;
  select * into v_receipt from public.recording_capture_receipts where actor_id=auth.uid() and request_id=p_request_id;
  if found then
    if v_receipt.payload_fingerprint<>v_hash then raise exception 'capture denied' using errcode='42501'; end if;
    return v_receipt.result;
  end if;
  if v_record.capture_revision<>p_expected_capture_revision then raise exception 'capture changed' using errcode='40001'; end if;
  if exists(select 1 from public.recording_transcription_operations o where o.recording_id=v_record.id
    and o.phase in ('prepared','started','accepted','uncertain')) or v_record.purge_claim_id is not null then
    raise exception 'capture operation already reserved' using errcode='55000'; end if;
  if exists(select 1 from public.transcription_jobs j where j.recording_id=v_record.id and j.status in ('queued','running')) then
    raise exception 'legacy in-flight work requires operator review' using errcode='55000'; end if;
  if (p_transition in ('upload_complete','text_only','capture_failed','live_draft') and v_record.status not in ('created','uploading','failed'))
    or (p_transition in ('live_final','import_final') and v_record.status not in ('created','uploading','uploaded','failed'))
    or (p_transition='recover' and v_record.status not in ('created','uploading','failed','transcribing')) then
    raise exception 'invalid capture state' using errcode='55000'; end if;
  if p_transition in ('live_draft','live_final','text_only','recover') and v_record.source_type not in ('in_app_recording','realtime') then
    raise exception 'invalid capture source' using errcode='22023'; end if;
  if p_transition='import_final' and (v_record.source_type<>'realtime' or v_record.storage_path is not null) then
    raise exception 'invalid import source' using errcode='22023'; end if;
  v_prefix:=v_record.user_id::text||'/'||v_record.id::text||'/';
  if p_transition='live_final' and v_record.storage_path is not null then
    if not public.is_canonical_capture_path_v1(v_record.user_id,v_record.id,v_record.storage_path) then
      raise exception 'live audio not confirmed' using errcode='55000'; end if;
    if v_record.storage_path=v_prefix||'live/' then
      v_paths:=public.get_recording_live_manifest_v1(v_record.user_id,v_record.id);
      if cardinality(v_paths)=0 then raise exception 'live audio not confirmed' using errcode='55000'; end if;
    elsif not exists(select 1 from storage.objects s where s.bucket_id='recordings' and s.name=v_record.storage_path) then
      raise exception 'live audio not confirmed' using errcode='55000'; end if;
  end if;
  if p_transition='upload_complete' then
    if p_mime_type is null or p_file_size_bytes is null or p_file_size_bytes<=0
      or p_mime_type is distinct from v_record.mime_type
      or not public.is_canonical_capture_path_v1(v_record.user_id,v_record.id,v_record.storage_path)
      or v_record.storage_path=v_prefix||'live/' then raise exception 'invalid upload metadata' using errcode='22023'; end if;
    if not exists(select 1 from storage.objects s where s.bucket_id='recordings' and s.name=v_record.storage_path
      and s.metadata->>'size'=p_file_size_bytes::text and s.metadata->>'mimetype'=p_mime_type) then
      raise exception 'uploaded object not confirmed' using errcode='55000'; end if;
    update public.recordings set status='uploaded',file_size_bytes=p_file_size_bytes,mime_type=p_mime_type,
      duration_seconds=coalesce(p_duration_seconds,duration_seconds),error_message=null where id=v_record.id;
  elsif p_transition='capture_failed' then
    update public.recordings set status='failed',error_message='Capture failed' where id=v_record.id;
  elsif p_transition='text_only' then
    if exists(select 1 from storage.objects s where s.bucket_id='recordings' and left(s.name,length(v_prefix))=v_prefix) then
      raise exception 'audio exists; use audio-preserving recovery' using errcode='55000'; end if;
    insert into public.recording_capture_binding_permits values(txid_current(),pg_backend_pid(),v_record.id,'text_only');
    update public.recordings set storage_path=null,source_type='realtime',file_size_bytes=0,status='uploaded',
      duration_seconds=coalesce(p_duration_seconds,duration_seconds),error_message=null where id=v_record.id;
    delete from public.recording_capture_binding_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid() and recording_id=v_record.id;
  elsif p_transition='recover' then
    perform public.assert_live_capture_idle_v1(v_record.id);
    if exists(select 1 from public.recording_live_part_registrations where recording_id=v_record.id) then
      perform public.get_registered_live_parts_manifest_v1(v_record.id);
      if v_record.storage_path in (v_prefix||'live/recording.webm',v_prefix||'live/recording.m4a')
        and not exists(select 1 from storage.objects where bucket_id='recordings' and name=v_record.storage_path) then
        insert into public.recording_capture_binding_permits values(txid_current(),pg_backend_pid(),v_record.id,'parts_fallback');
        update public.recordings set storage_path=v_prefix||'live/' where id=v_record.id returning * into v_record;
        delete from public.recording_capture_binding_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid() and recording_id=v_record.id;
      end if;
    elsif v_record.capture_request_id is not null and exists(select 1 from storage.objects where bucket_id='recordings'
      and left(name,length(v_prefix||'live/part-'))=v_prefix||'live/part-') then
      raise exception 'unregistered safety manifest' using errcode='55000';
    end if;
    select exists(select 1 from public.transcripts t where t.id=v_record.capture_transcript_id and t.recording_id=v_record.id
      and t.user_id=v_record.user_id and btrim(t.raw_text)<>'') into v_has_text;
    -- Legacy recovery can use the latest persisted transcript without accepting a new browser payload.
    if not v_has_text then select exists(select 1 from public.transcripts t where t.recording_id=v_record.id and t.user_id=v_record.user_id and btrim(t.raw_text)<>'') into v_has_text; end if;
    if v_record.storage_path is null or v_record.storage_path=v_prefix||'live/' then
      v_paths:=public.get_recording_live_manifest_v1(v_record.user_id,v_record.id);
    else v_paths:=array[v_record.storage_path]; end if;
    select count(*),sum(case when s.metadata->>'size' ~ '^[0-9]{1,15}$' then (s.metadata->>'size')::bigint end),
      coalesce(bool_or(coalesce(s.metadata->>'size','') !~ '^[0-9]{1,15}$'),false)
      into v_count,v_bytes,v_invalid_audio from (select name,metadata from storage.objects
      where bucket_id='recordings' and name=any(v_paths)
      order by name limit 1001) s;
    if v_invalid_audio or v_count>1000 then raise exception 'audio metadata requires review' using errcode='55000'; end if;
    if v_count=0 then
      if not v_has_text then raise exception 'nothing to recover' using errcode='55000'; end if;
      if exists(select 1 from storage.objects s where s.bucket_id='recordings' and left(s.name,length(v_prefix))=v_prefix) then
        raise exception 'audio metadata requires review' using errcode='55000'; end if;
      insert into public.recording_capture_binding_permits values(txid_current(),pg_backend_pid(),v_record.id,'text_only');
      update public.recordings set storage_path=null,source_type='realtime',file_size_bytes=0 where id=v_record.id;
      delete from public.recording_capture_binding_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid() and recording_id=v_record.id;
    else
      if v_record.storage_path is not null and not public.is_canonical_capture_path_v1(v_record.user_id,v_record.id,v_record.storage_path) then
        raise exception 'invalid audio binding' using errcode='55000'; end if;
      update public.recordings set storage_path=coalesce(storage_path,v_prefix||'live/'),file_size_bytes=v_bytes where id=v_record.id;
    end if;
    if v_has_text then
      select id into v_transcript from public.transcripts where recording_id=v_record.id and user_id=v_record.user_id
        and btrim(raw_text)<>'' order by (id=v_record.capture_transcript_id) desc,created_at desc,id desc limit 1 for update;
      update public.transcripts set completion_generation_key=coalesce(completion_generation_key,'capture:'||p_request_id::text)
        where id=v_transcript;
    end if;
    update public.recordings set status=case when v_has_text then 'completed'::public.recording_status else 'uploaded'::public.recording_status end,
      error_message=null where id=v_record.id;
  else
    v_transcript:=v_record.capture_transcript_id;
    if v_transcript is not null then
      perform 1 from public.transcripts t where t.id=v_transcript and t.recording_id=v_record.id and t.user_id=v_record.user_id for update;
      if not found then raise exception 'capture transcript changed' using errcode='40001'; end if;
    end if;
    if p_transition<>'live_draft' or btrim(p_raw_text)<>'' then
      if v_transcript is null then
        insert into public.transcripts(recording_id,user_id,raw_text,segments,speakers,created_at)
          values(v_record.id,v_record.user_id,p_raw_text,p_segments,p_speakers,clock_timestamp()) returning id into v_transcript;
      else update public.transcripts set raw_text=p_raw_text,segments=p_segments,speakers=p_speakers where id=v_transcript; end if;
    end if;
    if p_transition='live_final' then
      insert into public.transcription_jobs(recording_id,user_id,provider,mode,status,provider_config,started_at,completed_at)
        values(v_record.id,v_record.user_id,'soniox','realtime','done',jsonb_build_object('audio_source',
          case when v_record.storage_path is null then 'browser_microphone_text_only' else 'browser_microphone' end),clock_timestamp(),clock_timestamp()) returning id into v_job;
      update public.transcripts set transcription_job_id=v_job,completion_generation_key='capture:'||p_request_id::text where id=v_transcript;
    elsif p_transition='import_final' then
      update public.transcripts set completion_generation_key='capture:'||p_request_id::text where id=v_transcript;
    end if;
    update public.recordings set capture_transcript_id=v_transcript,duration_seconds=coalesce(p_duration_seconds,duration_seconds),
      status=case when p_transition='live_draft' then status else 'completed'::public.recording_status end,error_message=null where id=v_record.id;
  end if;
  update public.recordings set capture_revision=capture_revision+1 where id=v_record.id returning * into v_record;
  v_result:=jsonb_build_object('recordingId',v_record.id,'status',v_record.status,'captureRevision',v_record.capture_revision,
    'transcriptId',v_transcript,'jobId',v_job);
  insert into public.recording_capture_receipts values(auth.uid(),p_request_id,v_record.id,v_hash,v_result,clock_timestamp());
  return v_result;
end;
$capture$;

-- Admission, not UI ownership, decides whether a new service-created personal AI job may exist.
create function public.guard_personal_ai_admission_v1() returns trigger
language plpgsql security definer set search_path = '' as $admission$
declare v_record public.recordings; v_owner uuid;
begin
  select user_id,recording_id into v_owner,v_record.id from public.transcripts where id=new.transcript_id;
  v_record:=public.lock_recording_capture_v1(v_record.id);
  if new.user_id is distinct from v_owner or new.user_id is distinct from v_record.user_id
    or v_record.status<>'completed' or v_record.purge_claim_id is not null
    or not(v_record.project_id is null or v_record.visibility='private'
      or exists(select 1 from public.recording_projects p where p.id=v_record.project_id and p.user_id=new.user_id)) then
    raise exception 'personal AI not permitted' using errcode='42501'; end if;
  return new;
end;
$admission$;
create trigger ai_processing_jobs_guard_personal_admission before insert on public.ai_processing_jobs
for each row execute function public.guard_personal_ai_admission_v1();
revoke all on function public.guard_personal_ai_admission_v1() from public,anon,authenticated,service_role;

-- Exact registered parts remain readable under current recording RLS, including interrupted null main bindings.
create or replace function public.can_read_recording_object_v1(p_name text) returns boolean
language sql stable security definer set search_path = '' as $read$
  select exists(select 1 from public.recordings r where public.can_read_recording(r.id) and (
    p_name=r.storage_path or exists(select 1 from public.recording_live_part_registrations p
      where p.recording_id=r.id and p.storage_path=p_name and p.capture_request_id=r.capture_request_id)
    or (r.storage_path=r.user_id::text||'/'||r.id::text||'/live/'
      and left(p_name,length(r.storage_path))=r.storage_path
      and substring(p_name from length(r.storage_path)+1) ~ '^[A-Za-z0-9_-]+\.(webm|ogg|mp3|m4a|wav|mp4|flac)$')));
$read$;

-- Redundant safety audio can be removed only by its current manager after a separate complete main object is proven.
create function public.can_remove_redundant_live_part_v1(p_name text) returns boolean
language plpgsql volatile security definer set search_path = '' as $remove$
declare v_record public.recordings; v_id uuid;
begin
  select recording_id into v_id from public.recording_live_part_registrations where storage_path=p_name;
  if v_id is null then return false; end if;
  v_record:=public.lock_recording_capture_v1(v_id);
  return public.can_manage_recording(v_id) and v_record.status in ('uploaded','completed')
    and v_record.purge_claim_id is null and v_record.storage_path is not null and v_record.storage_path<>p_name
    and v_record.storage_path<>v_record.user_id::text||'/'||v_record.id::text||'/live/'
    and exists(select 1 from storage.objects s where s.bucket_id='recordings' and s.name=v_record.storage_path
      and s.metadata->>'size'=v_record.file_size_bytes::text and s.metadata->>'mimetype'=v_record.mime_type)
    and not exists(select 1 from public.recording_transcription_operations o where o.recording_id=v_id
      and o.phase in ('prepared','started','accepted','uncertain'))
    and not exists(select 1 from public.transcription_jobs j where j.recording_id=v_id and j.status in ('queued','running'));
end;
$remove$;
create policy "recordings storage remove redundant registered part" on storage.objects for delete to authenticated
using(bucket_id='recordings' and public.can_remove_redundant_live_part_v1(name));

revoke all on function public.can_read_recording_object_v1(text),public.can_remove_redundant_live_part_v1(text)
  from public,anon,authenticated,service_role;
grant execute on function public.can_read_recording_object_v1(text),public.can_remove_redundant_live_part_v1(text) to authenticated;
revoke all on function public.mark_capture_timeline_consent_v1(),public.schedule_capture_automatic_intents_v2(uuid),
  public.schedule_capture_timeline_intent_v1(uuid),public.prepare_recording_live_part_v1(uuid,bigint,integer,text,bigint),
  public.complete_recording_live_parts_v1(uuid,uuid,bigint,integer),public.can_write_recording_object_v1(text)
  from public,anon,authenticated,service_role;
grant execute on function public.schedule_capture_automatic_intents_v2(uuid),public.schedule_capture_timeline_intent_v1(uuid),
  public.prepare_recording_live_part_v1(uuid,bigint,integer,text,bigint),public.complete_recording_live_parts_v1(uuid,uuid,bigint,integer),
  public.can_write_recording_object_v1(text) to authenticated;
commit;
