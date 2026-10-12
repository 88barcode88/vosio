-- SOURCE ONLY: apply transactionally after 20260923000000; coordinated capture/provider worker adoption required.
alter table public.recordings add column capture_revision bigint not null default 0 check(capture_revision>=0);
alter table public.recordings add column capture_transcript_id uuid;

-- Finite reviewed provider configuration, not a browser-controlled provider model/cost selector.
create table public.recording_transcription_models_v1 (
  model text primary key, config_version integer not null check(config_version>0), active boolean not null
);
insert into public.recording_transcription_models_v1 values('stt-async-v5',1,true);

-- Receipts contain hashes and safe results only, never transcript/provider secrets; they survive content deletion.
create table public.recording_capture_receipts (
  actor_id uuid not null, request_id uuid not null, recording_id uuid not null,
  payload_fingerprint text not null, result jsonb not null, completed_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_id)
);
create table public.recording_transcription_operations (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null, request_id uuid not null,
  recording_id uuid not null, technical_owner_id uuid not null, capture_author_id uuid not null, project_id uuid,
  payload_fingerprint text not null, expected_capture_revision bigint not null,
  purpose text not null check(purpose in ('capture','retry','retranscribe')),
  phase text not null check(phase in ('prepared','started','accepted','uncertain','completed','failed','released')),
  region text not null check(region in ('global','eu')), model text not null, model_config_version integer not null,
  created_at timestamptz not null default clock_timestamp(), started_at timestamptz, completed_at timestamptz,
  last_claimed_at timestamptz,
  finalize_claim_id uuid, finalize_claimed_at timestamptz, finalize_attempt_count integer not null default 0,
  completion_fingerprint text, transcript_id uuid,
  unique(actor_id,request_id)
);
create unique index recording_transcription_operations_active_idx on public.recording_transcription_operations(recording_id)
  where phase in ('prepared','started','accepted','uncertain');
create index recording_transcription_operations_worker_idx on public.recording_transcription_operations(last_claimed_at,created_at,id)
  where phase in ('started','accepted','uncertain');
create index recording_transcription_operations_actor_idx on public.recording_transcription_operations(actor_id,created_at);
create index recording_transcription_operations_recording_idx on public.recording_transcription_operations(recording_id,created_at desc,id desc);
-- Exact frozen provider work manifest. Job IDs are references, not cascading FKs: terminal receipts survive purge.
create table public.recording_transcription_work (
  job_id uuid primary key, operation_id uuid not null references public.recording_transcription_operations(id),
  position integer not null, storage_path text not null,
  phase text not null check(phase in ('prepared','ready','submitting','accepted','uncertain','done','failed','cancelled')),
  provider_job_id text, claim_id uuid, submission_claim_id uuid, claimed_at timestamptz, poll_attempt_count integer not null default 0,
  audio_duration_ms bigint, terminal_fingerprint text, error_code text, next_poll_at timestamptz,
  unique(operation_id,position)
);
create index recording_transcription_work_claim_idx on public.recording_transcription_work(phase,claimed_at,operation_id);
create table public.recording_transcription_resolutions (
  id uuid primary key default gen_random_uuid(), operation_id uuid not null, job_id uuid not null,
  resolution text not null, evidence_sha256 text not null, created_at timestamptz not null default clock_timestamp()
);
-- Single-use transaction-bound permit; only the capture RPC can insert it, only the binding trigger consumes it.
create table public.recording_capture_binding_permits (
  transaction_id bigint not null, backend_pid integer not null, recording_id uuid not null,
  transition text not null check(transition='text_only'), primary key(transaction_id,backend_pid,recording_id)
);

-- Lock before reading authority or mutable custody; internal only, never a broad public row projection.
create function public.lock_recording_capture_v1(p_recording_id uuid) returns public.recordings
language plpgsql volatile security definer set search_path = '' as $lock$
declare v_record public.recordings; v_project uuid;
begin
  perform public.recording_sharing_lock_v1();
  select r.project_id into v_project from public.recordings r where r.id=p_recording_id;
  perform 1 from public.recording_projects p where p.id=v_project for update;
  perform 1 from public.recording_project_members m where m.project_id=v_project order by m.user_id for update;
  select r.* into v_record from public.recordings r where r.id=p_recording_id for update;
  if v_record.id is null or v_record.project_id is distinct from v_project then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  return v_record;
end;
$lock$;

-- Current author authority without the upload-only status predicate; callers separately enforce transition states.
create function public.has_recording_capture_authority_v1(p_recording_id uuid) returns boolean
language sql stable security definer set search_path = '' as $authority$
select auth.uid() is not null and exists(select 1 from public.recordings r where r.id=p_recording_id
  and r.created_by=auth.uid() and r.user_id=auth.uid() and r.status<>'deleted' and r.purge_claim_id is null
  and public.can_edit_recording(r.id)
  and (r.project_id is null or r.visibility='private' or public.can_capture_in_recording_project(r.project_id)));
$authority$;

-- One canonical prefix/path check shared by capture and exact provider work, with no Storage enumeration in session output.
create function public.is_canonical_capture_path_v1(p_owner uuid,p_recording uuid,p_path text) returns boolean
language sql immutable security definer set search_path = '' as $path$
select p_path is not null and left(p_path,length(p_owner::text||'/'||p_recording::text||'/'))=p_owner::text||'/'||p_recording::text||'/'
  and length(p_path)>length(p_owner::text||'/'||p_recording::text||'/')
  and position(chr(92) in p_path)=0 and (p_path=p_owner::text||'/'||p_recording::text||'/live/'
    or not exists(select 1 from unnest(string_to_array(substr(p_path,length(p_owner::text||'/'||p_recording::text||'/')+1),'/')) part where part in ('','.','..')));
$path$;

-- Enumerate ALL prefix members before validating; invalid/nested/uppercase/root objects may never disappear from a partial manifest.
create function public.get_recording_live_manifest_v1(p_owner uuid,p_recording uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $manifest$
declare v_prefix text:=p_owner::text||'/'||p_recording::text||'/live/'; v_paths text[];
begin
  select coalesce(array_agg(s.name order by s.name),array[]::text[]) into v_paths from (
    select name from storage.objects where bucket_id='recordings' and left(name,length(v_prefix))=v_prefix
    order by name limit 1001
  ) s;
  if cardinality(v_paths)>1000 then raise exception 'live manifest too large' using errcode='55000'; end if;
  if exists(select 1 from unnest(v_paths) p where substr(p,length(v_prefix)+1) !~ '^[A-Za-z0-9_-]+\.(webm|ogg|mp3|m4a|wav|mp4|flac)$') then
    raise exception 'invalid live manifest member' using errcode='55000'; end if;
  return v_paths;
end;
$manifest$;

-- Validate bounded transcript payloads before persistence; no caller-controlled column names or SQL.
create function public.validate_capture_transcript_v1(p_raw_text text,p_segments jsonb,p_speakers jsonb) returns void
language plpgsql immutable security definer set search_path = '' as $payload$
begin
  if p_raw_text is null or octet_length(p_raw_text)>4000000 or length(p_raw_text)>1000000 or jsonb_typeof(p_segments) is distinct from 'array'
    or jsonb_typeof(p_speakers) is distinct from 'array' then raise exception 'invalid transcript' using errcode='22023'; end if;
  if jsonb_array_length(p_segments)>200000 or octet_length(p_segments::text)>33554432
    or jsonb_array_length(p_speakers)>1000 or octet_length(p_speakers::text)>33554432 then raise exception 'transcript too large' using errcode='22023'; end if;
end;
$payload$;

-- Session-safe revision read for optimistic capture mutation; no owner/locator/provider fields.
create function public.get_recording_capture_state_v1(p_recording_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $state$
select jsonb_build_object('recordingId',r.id,'status',r.status,'captureRevision',r.capture_revision)
from public.recordings r where r.id=p_recording_id and r.status<>'deleted'
  and (public.has_recording_capture_authority_v1(r.id) or public.can_manage_recording(r.id));
$state$;

-- Exact transition state machine: current session authority and all writes share one locked transaction.
create function public.apply_recording_capture_transition_v1(
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

-- Preserve T1 immutable bindings, allowing only a single-use permit issued by the locked text-only transition.
create or replace function public.guard_recording_object_binding_v1() returns trigger
language plpgsql security definer set search_path = '' as $binding$
declare v_permitted uuid;
begin
  if new.storage_path is not null and not public.is_canonical_capture_path_v1(new.user_id,new.id,new.storage_path) then
    raise exception 'recording object binding mismatch' using errcode='23514'; end if;
  if tg_op='UPDATE' and old.storage_path is not null and new.storage_path is distinct from old.storage_path then
    if new.storage_path is null and new.source_type='realtime' and new.file_size_bytes=0
      and new.user_id=old.user_id and new.id=old.id and old.status in ('created','uploading','failed','transcribing')
      and not exists(select 1 from storage.objects s where s.bucket_id='recordings'
        and left(s.name,length(old.user_id::text||'/'||old.id::text||'/'))=old.user_id::text||'/'||old.id::text||'/') then
      delete from public.recording_capture_binding_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid()
        and recording_id=old.id and transition='text_only' returning recording_id into v_permitted;
    end if;
    if v_permitted is null then raise exception 'recording object binding is immutable' using errcode='23514'; end if;
  end if;
  return new;
end;
$binding$;

-- Lock immutable operation custody and all exact jobs before permitting any service continuation.
create function public.lock_recording_transcription_operation_v1(p_operation_id uuid)
returns public.recording_transcription_operations language plpgsql volatile security definer set search_path = '' as $operation_lock$
declare v_op public.recording_transcription_operations; v_record public.recordings;
begin
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_transcription_operations where id=p_operation_id;
  if not found then raise exception 'operation unavailable' using errcode='42501'; end if;
  v_record:=public.lock_recording_capture_v1(v_op.recording_id);
  perform 1 from public.transcription_jobs j join public.recording_transcription_work w on w.job_id=j.id
    where w.operation_id=v_op.id order by j.id for update of j;
  select * into v_op from public.recording_transcription_operations where id=p_operation_id for update;
  perform 1 from public.recording_transcription_work w where w.operation_id=v_op.id order by w.job_id for update;
  if v_record.user_id<>v_op.technical_owner_id or v_record.created_by<>v_op.capture_author_id
    or v_record.project_id is distinct from v_op.project_id or v_record.status='deleted' or v_record.purge_claim_id is not null
    or exists(select 1 from public.recording_transcription_work w left join public.transcription_jobs j on j.id=w.job_id
      left join public.recording_job_custody c on c.job_id=w.job_id
      where w.operation_id=v_op.id and (j.id is null or j.recording_id<>v_record.id or j.user_id<>v_record.user_id
        or j.provider<>'soniox' or j.mode<>'async' or j.provider_job_id is distinct from w.provider_job_id
        or (w.provider_job_id is not null and (c.job_id is null or c.recording_id is distinct from v_record.id
          or c.project_id is distinct from v_op.project_id or c.capture_author is distinct from v_op.capture_author_id
          or c.provider_job_id is distinct from w.provider_job_id)))) then
    raise exception 'operation custody mismatch' using errcode='42501'; end if;
  return v_op;
end;
$operation_lock$;

-- New requests alone may allocate exact job IDs; own retries return only their historical opaque receipt.
create function public.prepare_recording_transcription_v1(
  p_recording_id uuid,p_request_id uuid,p_expected_capture_revision bigint,p_region text,p_model text,p_purpose text default 'capture'
) returns jsonb language plpgsql volatile security definer set search_path = '' as $prepare$
declare v_op public.recording_transcription_operations; v_record public.recordings; v_hash text; v_paths text[]; v_path text;
  v_job uuid; v_index integer:=0; v_prefix text; v_model_version integer;
begin
  if auth.uid() is null then raise exception 'operation unavailable' using errcode='42501'; end if;
  if p_recording_id is null or p_request_id is null or p_expected_capture_revision is null or p_expected_capture_revision<0
    or p_region is null or p_region not in ('global','eu') or p_model is null or p_model !~ '^[A-Za-z0-9._-]{1,100}$'
    or p_purpose is null or p_purpose not in ('capture','retry','retranscribe') then
    raise exception 'invalid transcription request' using errcode='22023'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_array(p_recording_id,p_expected_capture_revision,p_region,p_model,p_purpose)::text,'UTF8')),'hex');
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_transcription_operations where actor_id=auth.uid() and request_id=p_request_id;
  if found then
    if v_op.payload_fingerprint<>v_hash then raise exception 'operation unavailable' using errcode='42501'; end if;
    return jsonb_build_object('operationId',v_op.id,'phase',v_op.phase);
  end if;
  select config_version into v_model_version from public.recording_transcription_models_v1 where model=p_model and active;
  if not found then raise exception 'unsupported transcription model' using errcode='22023'; end if;
  v_record:=public.lock_recording_capture_v1(p_recording_id);
  if not ((p_purpose in ('capture','retranscribe') and public.has_recording_capture_authority_v1(v_record.id))
    or (p_purpose='retry' and public.can_manage_recording(v_record.id))) then
    raise exception 'operation unavailable' using errcode='42501'; end if;
  if v_record.capture_revision<>p_expected_capture_revision then raise exception 'capture changed' using errcode='40001'; end if;
  if (p_purpose='capture' and v_record.status<>'uploaded') or (p_purpose='retry' and v_record.status<>'failed')
    or (p_purpose='retranscribe' and v_record.status<>'completed') or v_record.purge_claim_id is not null then
    raise exception 'invalid transcription state' using errcode='55000'; end if;
  if exists(select 1 from public.recording_transcription_operations where recording_id=v_record.id and phase in ('prepared','started','accepted','uncertain')) then
    raise exception 'operation already reserved' using errcode='55000'; end if;
  if exists(select 1 from public.transcription_jobs j where j.recording_id=v_record.id and j.status in ('queued','running')) then
    raise exception 'legacy in-flight work requires operator review' using errcode='55000'; end if;
  if not public.is_canonical_capture_path_v1(v_record.user_id,v_record.id,v_record.storage_path) then
    raise exception 'audio unavailable' using errcode='55000'; end if;
  v_prefix:=v_record.user_id::text||'/'||v_record.id::text||'/live/';
  if v_record.storage_path=v_prefix then
    v_paths:=public.get_recording_live_manifest_v1(v_record.user_id,v_record.id);
  else
    select array[s.name] into v_paths from storage.objects s where s.bucket_id='recordings' and s.name=v_record.storage_path;
  end if;
  if coalesce(cardinality(v_paths),0) not between 1 and 1000 then raise exception 'audio manifest unavailable' using errcode='55000'; end if;
  insert into public.recording_transcription_operations(actor_id,request_id,recording_id,technical_owner_id,capture_author_id,project_id,
    payload_fingerprint,expected_capture_revision,purpose,phase,region,model,model_config_version)
    values(auth.uid(),p_request_id,v_record.id,v_record.user_id,v_record.created_by,v_record.project_id,v_hash,p_expected_capture_revision,p_purpose,'prepared',p_region,p_model,v_model_version)
    returning * into v_op;
  foreach v_path in array v_paths loop
    insert into public.transcription_jobs(recording_id,user_id,provider,mode,status,provider_config)
      values(v_record.id,v_record.user_id,'soniox','async','queued',jsonb_build_object('region',p_region,'model',p_model,
        'enable_language_identification',true,'enable_speaker_diarization',true,'language_hints',jsonb_build_array('cs'),
        'batch_id',v_op.id,'segment_index',v_index,'segment_count',cardinality(v_paths),
        'audio_source',case when cardinality(v_paths)>1 or v_record.storage_path=v_prefix then 'supabase_recording_segments' else 'supabase_signed_url' end))
      returning id into v_job;
    insert into public.recording_transcription_work(job_id,operation_id,position,storage_path,phase)
      values(v_job,v_op.id,v_index,v_path,'prepared');
    v_index:=v_index+1;
  end loop;
  return jsonb_build_object('operationId',v_op.id,'phase',v_op.phase);
end;
$prepare$;

-- The irreversible authorization point: current session and frozen custody must still agree before any provider request.
create function public.start_recording_transcription_v1(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $start$
declare v_op public.recording_transcription_operations; v_record public.recordings;
begin
  if auth.uid() is null then raise exception 'operation unavailable' using errcode='42501'; end if;
  v_op:=public.lock_recording_transcription_operation_v1(p_operation_id);
  if v_op.actor_id<>auth.uid() or not ((v_op.purpose in ('capture','retranscribe') and public.has_recording_capture_authority_v1(v_op.recording_id))
    or (v_op.purpose='retry' and public.can_manage_recording(v_op.recording_id))) then
    raise exception 'operation unavailable' using errcode='42501'; end if;
  if v_op.phase in ('started','accepted','uncertain','completed','failed') then
    return jsonb_build_object('operationId',v_op.id,'phase',v_op.phase); end if;
  if v_op.phase<>'prepared' or v_op.created_at<=clock_timestamp()-interval '24 hours' then raise exception 'operation not prepared' using errcode='55000'; end if;
  if not exists(select 1 from public.recording_transcription_models_v1 where model=v_op.model and config_version=v_op.model_config_version and active) then
    raise exception 'unsupported transcription model' using errcode='22023'; end if;
  select * into v_record from public.recordings where id=v_op.recording_id;
  if v_record.capture_revision<>v_op.expected_capture_revision then raise exception 'capture changed' using errcode='40001'; end if;
  if (v_op.purpose='capture' and v_record.status<>'uploaded') or (v_op.purpose='retry' and v_record.status<>'failed')
    or (v_op.purpose='retranscribe' and v_record.status<>'completed') then raise exception 'invalid transcription state' using errcode='55000'; end if;
  update public.recording_transcription_operations set phase='started',started_at=clock_timestamp() where id=v_op.id;
  update public.recording_transcription_work set phase='ready' where operation_id=v_op.id;
  update public.recordings set status='transcribing',capture_revision=capture_revision+1,error_message=null where id=v_op.recording_id;
  return jsonb_build_object('operationId',v_op.id,'phase','started');
end;
$start$;

-- An unstarted reservation can be released by its actor after revoke or its current manager; never cancel irreversible work.
create function public.release_recording_transcription_v1(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $release$
declare v_op public.recording_transcription_operations;
begin
  if auth.uid() is null then raise exception 'operation unavailable' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_transcription_operations where id=p_operation_id;
  if not found or (v_op.actor_id<>auth.uid() and not public.can_manage_recording(v_op.recording_id)) then
    raise exception 'operation unavailable' using errcode='42501'; end if;
  if v_op.phase='released' then return jsonb_build_object('operationId',v_op.id,'phase','released'); end if;
  v_op:=public.lock_recording_transcription_operation_v1(v_op.id);
  if v_op.phase<>'prepared' then raise exception 'operation already irreversible' using errcode='55000'; end if;
  update public.transcription_jobs set status='cancelled',completed_at=clock_timestamp() where id in(select job_id from public.recording_transcription_work where operation_id=v_op.id);
  update public.recording_transcription_work set phase='cancelled',storage_path='' where operation_id=v_op.id;
  update public.recording_transcription_operations set phase='released',completed_at=clock_timestamp() where id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'phase','released');
end;
$release$;

-- Keep the operation active until every external unit is terminal; one failure never abandons still-accepted sibling work.
create function public.refresh_recording_transcription_phase_v1(p_operation_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $phase$
declare v_phase text; v_recording uuid;
begin
  select recording_id into v_recording from public.recording_transcription_operations where id=p_operation_id;
  if exists(select 1 from public.recording_transcription_work where operation_id=p_operation_id and phase='failed') then
    update public.transcription_jobs set status='cancelled',completed_at=clock_timestamp()
      where id in(select job_id from public.recording_transcription_work where operation_id=p_operation_id and phase='ready');
    update public.recording_transcription_work set phase='cancelled' where operation_id=p_operation_id and phase='ready';
  end if;
  if exists(select 1 from public.recording_transcription_work where operation_id=p_operation_id and phase='uncertain') then v_phase:='uncertain';
  elsif exists(select 1 from public.recording_transcription_work where operation_id=p_operation_id and phase in ('accepted','done')) then v_phase:='accepted';
  else v_phase:='started'; end if;
  if not exists(select 1 from public.recording_transcription_work where operation_id=p_operation_id and phase in ('ready','submitting','accepted','uncertain'))
    and exists(select 1 from public.recording_transcription_work where operation_id=p_operation_id and phase in ('failed','cancelled')) then
    v_phase:='failed';
    update public.recording_transcription_work set storage_path='' where operation_id=p_operation_id;
    update public.recordings set status='failed',error_message='Transcription failed',capture_revision=capture_revision+1 where id=v_recording;
  end if;
  update public.recording_transcription_operations set phase=v_phase,completed_at=case when v_phase='failed' then clock_timestamp() else null end where id=p_operation_id;
end;
$phase$;

-- Service discovery never resubmits a possibly sent POST: expired submitting leases become uncertain and retain their original token.
create function public.claim_recording_transcription_work_v1(p_limit integer default 5)
returns table(operation_id uuid,job_id uuid,claim_id uuid,work_kind text,storage_path text,client_reference_id text,
  region text,model text,provider_job_id text,manifest jsonb)
language plpgsql volatile security definer set search_path = '' as $claim$
declare v_id uuid; v_op public.recording_transcription_operations; v_work public.recording_transcription_work;
begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'invalid work limit' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  for v_id in select o.id from public.recording_transcription_operations o
    where o.phase in ('started','accepted','uncertain') and o.started_at>clock_timestamp()-interval '7 days'
      and (exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id
        and ((w.phase='ready' and o.phase<>'uncertain') or (w.phase='submitting' and w.claimed_at<=clock_timestamp()-interval '15 minutes')
          or (w.phase='accepted' and w.poll_attempt_count<5 and coalesce(w.next_poll_at,'-infinity'::timestamptz)<=clock_timestamp()
            and (w.claimed_at is null or w.claimed_at<=clock_timestamp()-interval '15 minutes'))))
        or (not exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id and w.phase<>'done')
          and o.finalize_attempt_count<5 and (o.finalize_claimed_at is null or o.finalize_claimed_at<=clock_timestamp()-interval '15 minutes')))
    order by o.last_claimed_at nulls first,o.created_at,o.id limit p_limit loop
    v_op:=public.lock_recording_transcription_operation_v1(v_id);
    update public.recording_transcription_work w set phase='uncertain' where w.operation_id=v_id and w.phase='submitting'
      and w.claimed_at<=clock_timestamp()-interval '15 minutes';
    perform public.refresh_recording_transcription_phase_v1(v_id);
    select w.* into v_work from public.recording_transcription_work w where w.operation_id=v_id
      and ((w.phase='ready' and not exists(select 1 from public.recording_transcription_work u where u.operation_id=v_id and u.phase='uncertain'))
        or (w.phase='accepted' and w.poll_attempt_count<5 and coalesce(w.next_poll_at,'-infinity'::timestamptz)<=clock_timestamp()
        and (w.claimed_at is null or w.claimed_at<=clock_timestamp()-interval '15 minutes')))
      order by case when w.phase='ready' then 0 else 1 end,w.position for update skip locked limit 1;
    operation_id:=v_id; region:=v_op.region; model:=v_op.model; manifest:=null;
    if found then
      claim_id:=gen_random_uuid(); job_id:=v_work.job_id; provider_job_id:=v_work.provider_job_id;
      work_kind:=case when v_work.phase='ready' then 'submit' else 'poll' end;
      storage_path:=case when work_kind='submit' then v_work.storage_path else null end;
      client_reference_id:=v_work.job_id::text;
      update public.recording_transcription_work w set claim_id=claim_recording_transcription_work_v1.claim_id,
        submission_claim_id=case when w.phase='ready' then claim_recording_transcription_work_v1.claim_id else w.submission_claim_id end,
        claimed_at=clock_timestamp(),poll_attempt_count=case when w.phase='accepted' then w.poll_attempt_count+1 else w.poll_attempt_count end,
        phase=case when w.phase='ready' then 'submitting' else w.phase end where w.job_id=v_work.job_id;
      update public.recording_transcription_operations set last_claimed_at=clock_timestamp() where id=v_id;
      return next;
    elsif not exists(select 1 from public.recording_transcription_work w where w.operation_id=v_id and w.phase<>'done')
      and v_op.finalize_attempt_count<5 and (v_op.finalize_claimed_at is null or v_op.finalize_claimed_at<=clock_timestamp()-interval '15 minutes') then
      claim_id:=gen_random_uuid(); job_id:=null; work_kind:='finalize'; storage_path:=null; client_reference_id:=v_op.id::text; provider_job_id:=null;
      select jsonb_agg(jsonb_build_object('jobId',w.job_id,'providerJobId',w.provider_job_id,'position',w.position,'audioDurationMs',w.audio_duration_ms) order by w.position)
        into manifest from public.recording_transcription_work w where w.operation_id=v_id;
      update public.recording_transcription_operations o set finalize_claim_id=claim_recording_transcription_work_v1.claim_id,
        finalize_claimed_at=clock_timestamp(),finalize_attempt_count=finalize_attempt_count+1,last_claimed_at=clock_timestamp() where o.id=v_id;
      return next;
    end if;
  end loop;
end;
$claim$;

-- Exact token heartbeat; it cannot acquire another unit or turn an uncertain POST back into a submit opportunity.
create function public.refresh_recording_transcription_claim_v1(p_operation_id uuid,p_job_id uuid,p_claim_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $heartbeat$
declare v_op public.recording_transcription_operations; v_count integer;
begin
  v_op:=public.lock_recording_transcription_operation_v1(p_operation_id);
  if p_job_id is null then
    update public.recording_transcription_operations set finalize_claimed_at=clock_timestamp()
      where id=v_op.id and phase='accepted' and finalize_claim_id=p_claim_id;
  else
    update public.recording_transcription_work set claimed_at=clock_timestamp()
      where operation_id=v_op.id and job_id=p_job_id and claim_id=p_claim_id and phase in ('submitting','accepted');
  end if;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'claim unavailable' using errcode='42501'; end if;
  return true;
end;
$heartbeat$;

-- A real provider ID may bind only an exact already-authorized submission; later membership is deliberately irrelevant.
create function public.accept_recording_provider_job_v1(p_operation_id uuid,p_job_id uuid,p_claim_id uuid,p_provider_job_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $accept$
declare v_op public.recording_transcription_operations; v_work public.recording_transcription_work;
begin
  if p_provider_job_id is null or p_provider_job_id !~ '^[A-Za-z0-9._:-]{1,200}$' then raise exception 'invalid provider ID' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_work from public.recording_transcription_work where operation_id=p_operation_id and job_id=p_job_id;
  if not found or v_work.submission_claim_id is distinct from p_claim_id or p_claim_id is null then
    raise exception 'submission unavailable' using errcode='42501'; end if;
  if v_work.provider_job_id is not null then
    if v_work.provider_job_id<>p_provider_job_id then raise exception 'provider binding conflict' using errcode='42501'; end if;
    return jsonb_build_object('operationId',p_operation_id,'jobId',p_job_id,'phase',v_work.phase);
  end if;
  v_op:=public.lock_recording_transcription_operation_v1(p_operation_id);
  if v_op.phase not in ('started','accepted','uncertain') or v_work.phase not in ('submitting','uncertain') then
    raise exception 'submission unavailable' using errcode='42501'; end if;
  update public.transcription_jobs set provider_job_id=p_provider_job_id,status='queued',started_at=coalesce(started_at,clock_timestamp()) where id=p_job_id;
  update public.recording_transcription_work set provider_job_id=p_provider_job_id,phase='accepted',claim_id=null,claimed_at=null,poll_attempt_count=0,
    next_poll_at=clock_timestamp()+interval '15 seconds' where job_id=p_job_id;
  -- Write the reviewed custody shape without its obsolete current-author authority recheck.
  insert into public.recording_job_custody(job_id,recording_id,project_id,capture_author,provider_job_id)
    values(p_job_id,v_op.recording_id,v_op.project_id,v_op.capture_author_id,p_provider_job_id);
  perform public.refresh_recording_transcription_phase_v1(v_op.id);
  return jsonb_build_object('operationId',v_op.id,'jobId',p_job_id,'phase','accepted');
end;
$accept$;

-- Persist one provider poll outcome under a fenced exact claim; completed siblings survive a partial batch failure.
create function public.settle_recording_provider_job_v1(
  p_operation_id uuid,p_job_id uuid,p_claim_id uuid,p_status text,p_audio_duration_ms bigint default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $settle$
declare v_op public.recording_transcription_operations; v_work public.recording_transcription_work; v_hash text;
begin
  if p_status is null or p_status not in ('queued','running','done','failed') or p_audio_duration_ms<0 then
    raise exception 'invalid provider status' using errcode='22023'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_array(p_status,p_audio_duration_ms)::text,'UTF8')),'hex');
  perform public.recording_sharing_lock_v1();
  select * into v_work from public.recording_transcription_work where operation_id=p_operation_id and job_id=p_job_id;
  if not found or p_claim_id is null or v_work.claim_id is distinct from p_claim_id then raise exception 'claim unavailable' using errcode='42501'; end if;
  v_op:=public.lock_recording_transcription_operation_v1(p_operation_id);
  if v_work.phase<>'accepted' or v_work.provider_job_id is null or v_op.phase not in ('accepted','uncertain') then
    raise exception 'provider job unavailable' using errcode='42501'; end if;
  update public.transcription_jobs set status=p_status::public.job_status,
    completed_at=case when p_status in ('done','failed') then clock_timestamp() else null end,
    error_message=case when p_status='failed' then 'Provider transcription failed' else null end where id=p_job_id;
  update public.recording_transcription_work set phase=case when p_status in ('done','failed') then p_status else 'accepted' end,
    claim_id=null,claimed_at=null,poll_attempt_count=0,next_poll_at=clock_timestamp()+interval '15 seconds',audio_duration_ms=coalesce(p_audio_duration_ms,audio_duration_ms),
    terminal_fingerprint=case when p_status in ('done','failed') then v_hash else null end,
    error_code=case when p_status='failed' then 'provider_failed' else null end where job_id=p_job_id;
  perform public.refresh_recording_transcription_phase_v1(v_op.id);
  return jsonb_build_object('operationId',v_op.id,'jobId',p_job_id,'phase',case when p_status in ('done','failed') then p_status else 'accepted' end);
end;
$settle$;

-- The worker combines the exact frozen manifest's provider results, retaining segment timing offsets; one generation is inserted exactly once.
create function public.finalize_recording_transcription_v1(
  p_operation_id uuid,p_claim_id uuid,p_raw_text text,p_segments jsonb,p_speakers jsonb,p_duration_seconds integer
) returns jsonb language plpgsql volatile security definer set search_path = '' as $finalize$
declare v_op public.recording_transcription_operations; v_hash text; v_transcript uuid; v_job uuid; v_created timestamptz;
begin
  perform public.validate_capture_transcript_v1(p_raw_text,p_segments,p_speakers);
  if p_duration_seconds<0 then raise exception 'invalid duration' using errcode='22023'; end if;
  v_hash:=encode(sha256(convert_to(jsonb_build_array(p_raw_text,p_segments,p_speakers,p_duration_seconds)::text,'UTF8')),'hex');
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_transcription_operations where id=p_operation_id;
  if not found or p_claim_id is null or v_op.finalize_claim_id is distinct from p_claim_id then raise exception 'claim unavailable' using errcode='42501'; end if;
  if v_op.phase='completed' then
    if v_op.completion_fingerprint<>v_hash then raise exception 'completion conflict' using errcode='42501'; end if;
    return jsonb_build_object('operationId',v_op.id,'phase','completed','transcriptId',v_op.transcript_id);
  end if;
  v_op:=public.lock_recording_transcription_operation_v1(v_op.id);
  if v_op.phase<>'accepted' or exists(select 1 from public.recording_transcription_work where operation_id=v_op.id and phase<>'done')
    or not exists(select 1 from public.recording_transcription_work where operation_id=v_op.id) then
    raise exception 'transcription incomplete' using errcode='55000'; end if;
  select case when count(*)=1 then (array_agg(job_id))[1] end into v_job from public.recording_transcription_work where operation_id=v_op.id;
  select greatest(clock_timestamp(),coalesce(max(created_at)+interval '1 microsecond','-infinity'::timestamptz)) into v_created
    from public.transcripts where recording_id=v_op.recording_id;
  insert into public.transcripts(recording_id,user_id,transcription_job_id,raw_text,segments,speakers,completion_generation_key,created_at)
    values(v_op.recording_id,v_op.technical_owner_id,v_job,p_raw_text,p_segments,p_speakers,'async:'||v_op.id::text,v_created) returning id into v_transcript;
  update public.recordings set status='completed',duration_seconds=coalesce(p_duration_seconds,duration_seconds),error_message=null,
    capture_revision=capture_revision+1 where id=v_op.recording_id;
  update public.recording_job_custody set finalized_at=clock_timestamp(),transcript_id=v_transcript,completion_key='async:'||v_op.id::text
    where job_id in(select job_id from public.recording_transcription_work where operation_id=v_op.id);
  update public.recording_transcription_operations set phase='completed',completed_at=clock_timestamp(),transcript_id=v_transcript,
    completion_fingerprint=v_hash where id=v_op.id;
  update public.recording_transcription_work set storage_path='' where operation_id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'phase','completed','transcriptId',v_transcript);
end;
$finalize$;

-- Network uncertainty is not a provider failure and never releases the irreversible reservation.
create function public.mark_recording_submission_uncertain_v1(p_operation_id uuid,p_job_id uuid,p_claim_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $uncertain$
declare v_op public.recording_transcription_operations;
begin
  v_op:=public.lock_recording_transcription_operation_v1(p_operation_id);
  update public.recording_transcription_work set phase='uncertain',error_code='submission_unknown'
    where operation_id=v_op.id and job_id=p_job_id and submission_claim_id=p_claim_id and p_claim_id is not null
      and phase in ('submitting','uncertain') and provider_job_id is null;
  if not found then raise exception 'submission unavailable' using errcode='42501'; end if;
  perform public.refresh_recording_transcription_phase_v1(v_op.id);
  return jsonb_build_object('operationId',v_op.id,'jobId',p_job_id,'phase','uncertain');
end;
$uncertain$;

-- Runbook-only service resolution after external verification; the evidence digest is an audit reference, never provider content.
create function public.resolve_uncertain_recording_job_v1(
  p_operation_id uuid,p_job_id uuid,p_resolution text,p_evidence_sha256 text,p_provider_job_id text default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $resolve$
declare v_op public.recording_transcription_operations; v_work public.recording_transcription_work;
begin
  if p_resolution is null or p_resolution not in ('not_submitted','bind_verified','resume_poll','resume_finalize')
    or p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
    or (p_resolution='bind_verified' and (p_provider_job_id is null or p_provider_job_id !~ '^[A-Za-z0-9._:-]{1,200}$'))
    or (p_resolution<>'bind_verified' and p_provider_job_id is not null) then raise exception 'invalid resolution' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_work from public.recording_transcription_work where operation_id=p_operation_id and job_id=p_job_id;
  if not found then raise exception 'work unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.recording_transcription_resolutions where operation_id=p_operation_id and job_id=p_job_id
    and resolution=p_resolution and evidence_sha256=p_evidence_sha256) then
    if p_resolution='bind_verified' and v_work.provider_job_id is distinct from p_provider_job_id then raise exception 'resolution conflict' using errcode='42501'; end if;
    return jsonb_build_object('operationId',p_operation_id,'jobId',p_job_id,'resolved',true);
  end if;
  v_op:=public.lock_recording_transcription_operation_v1(p_operation_id);
  if v_op.phase not in ('started','accepted','uncertain') then raise exception 'operation terminal' using errcode='55000'; end if;
  if p_resolution in ('not_submitted','bind_verified') then
    if v_work.phase not in ('submitting','uncertain') or v_work.provider_job_id is not null then raise exception 'submission not uncertain' using errcode='55000'; end if;
    if p_resolution='bind_verified' then
      perform public.accept_recording_provider_job_v1(v_op.id,v_work.job_id,v_work.submission_claim_id,p_provider_job_id);
    else
      update public.recording_transcription_work set phase='failed',error_code='verified_not_submitted',storage_path='' where job_id=p_job_id;
      update public.transcription_jobs set status='failed',error_message='Submission verified not accepted',completed_at=clock_timestamp() where id=p_job_id;
    end if;
  elsif p_resolution='resume_poll' then
    if v_work.phase<>'accepted' then raise exception 'poll not accepted' using errcode='55000'; end if;
    update public.recording_transcription_work set poll_attempt_count=0,claimed_at=null,next_poll_at=null,claim_id=gen_random_uuid() where job_id=p_job_id;
    -- Explicit audited operator renewal, never automatic provider submission.
    update public.recording_transcription_operations set started_at=clock_timestamp() where id=v_op.id;
  else
    if exists(select 1 from public.recording_transcription_work where operation_id=v_op.id and phase<>'done') then raise exception 'manifest incomplete' using errcode='55000'; end if;
    update public.recording_transcription_operations set finalize_attempt_count=0,finalize_claimed_at=null,finalize_claim_id=gen_random_uuid(),started_at=clock_timestamp() where id=v_op.id;
  end if;
  insert into public.recording_transcription_resolutions(operation_id,job_id,resolution,evidence_sha256)
    values(v_op.id,p_job_id,p_resolution,p_evidence_sha256);
  perform public.refresh_recording_transcription_phase_v1(v_op.id);
  return jsonb_build_object('operationId',v_op.id,'jobId',p_job_id,'resolved',true);
end;
$resolve$;

-- Session manager enrichment is bounded and omits receipts for foreign IDs, all claims, locators and provider diagnostics.
create function public.get_managed_recording_transcription_v1(p_recording_ids uuid[])
returns table(recording_id uuid,operation_id uuid,phase text,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $managed$
begin
  if auth.uid() is null or coalesce(cardinality(p_recording_ids),0)=0 then return; end if;
  if cardinality(p_recording_ids)>100 or array_ndims(p_recording_ids) is distinct from 1 then raise exception 'invalid IDs' using errcode='22023'; end if;
  return query select r.id,o.id,case when o.phase in ('started','accepted','uncertain') and (o.phase='uncertain'
    or o.started_at<=statement_timestamp()-interval '7 days' or o.finalize_attempt_count>=5
    or exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id and w.phase='accepted' and w.poll_attempt_count>=5))
      then 'manual_required' else o.phase end,o.created_at from public.recordings r
    cross join lateral(select x.* from public.recording_transcription_operations x where x.recording_id=r.id order by x.created_at desc,x.id desc limit 1)o
    where r.id=any(p_recording_ids) and public.can_manage_recording(r.id) order by r.id;
end;
$managed$;

-- Expire only prepared reservations. No provider request is authorized yet; started/uncertain work is never expired away.
create function public.expire_prepared_recording_transcriptions_v1(p_limit integer default 5) returns integer
language plpgsql volatile security definer set search_path = '' as $expire$
declare v_id uuid; v_op public.recording_transcription_operations; v_count integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'invalid expiry limit' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  for v_id in select id from public.recording_transcription_operations where phase='prepared' and created_at<=clock_timestamp()-interval '24 hours'
    order by created_at,id limit p_limit loop
    v_op:=public.lock_recording_transcription_operation_v1(v_id);
    update public.transcription_jobs set status='cancelled',completed_at=clock_timestamp() where id in(select job_id from public.recording_transcription_work where operation_id=v_id);
    update public.recording_transcription_work set phase='cancelled',storage_path='' where operation_id=v_id;
    update public.recording_transcription_operations set phase='released',completed_at=clock_timestamp() where id=v_id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$expire$;

-- Statement-level locking precedes row locks taken by direct DELETE/UPDATE and existing cascade guards.
create function public.lock_recording_transcription_mutation_v1() returns trigger
language plpgsql volatile security definer set search_path = '' as $statement_lock$
begin perform public.recording_sharing_lock_v1(); return null; end;
$statement_lock$;
create trigger recordings_transcription_statement_lock before delete or update of status,project_id,user_id,created_by on public.recordings
  for each statement execute function public.lock_recording_transcription_mutation_v1();
create trigger users_transcription_statement_lock before delete on auth.users for each statement execute function public.lock_recording_transcription_mutation_v1();
create trigger projects_transcription_statement_lock before delete on public.recording_projects for each statement execute function public.lock_recording_transcription_mutation_v1();
create trigger clients_transcription_statement_lock before delete on public.recording_clients for each statement execute function public.lock_recording_transcription_mutation_v1();
create trigger transcription_jobs_statement_lock before delete on public.transcription_jobs for each statement execute function public.lock_recording_transcription_mutation_v1();

-- Irreversible work blocks Trash and all custody-stranding cascades, including private-account deletion; prepared work is safely cancelled.
create function public.guard_recording_transcription_delete_v1() returns trigger
language plpgsql volatile security definer set search_path = '' as $delete_guard$
declare v_ids uuid[]; v_deleting_job uuid;
begin
  perform public.recording_sharing_lock_v1();
  if tg_table_name='recordings' then
    if tg_op='UPDATE' and not(new.status='deleted' and old.status<>'deleted') and new.project_id is not distinct from old.project_id
      and new.user_id=old.user_id and new.created_by=old.created_by then return new; end if;
    v_ids:=array[old.id];
  elsif tg_table_name='transcription_jobs' then
    v_ids:=array[old.recording_id];
    v_deleting_job:=old.id;
  else
    select array_agg(distinct r.id) into v_ids from public.recordings r left join public.recording_projects p on p.id=r.project_id
      left join public.recording_transcription_operations o on o.recording_id=r.id
      where (tg_table_schema='auth' and (r.user_id=old.id or r.created_by=old.id or p.user_id=old.id or o.actor_id=old.id))
        or (tg_table_name='recording_projects' and r.project_id=old.id)
        or (tg_table_name='recording_clients' and (r.client_id=old.id or p.client_id=old.id));
  end if;
  perform p.id from public.recording_projects p where p.id in(select r.project_id from public.recordings r where r.id=any(v_ids)) order by p.id for update;
  perform r.id from public.recordings r where r.id=any(v_ids) order by r.id for update;
  perform o.id from public.recording_transcription_operations o where o.recording_id=any(v_ids) order by o.id for update;
  if exists(select 1 from public.recording_transcription_operations where recording_id=any(v_ids) and phase in ('started','accepted','uncertain')) then
    raise exception 'irreversible transcription blocks destructive mutation' using errcode='55000'; end if;
  update public.transcription_jobs set status='cancelled',completed_at=clock_timestamp() where id in(
    select w.job_id from public.recording_transcription_work w join public.recording_transcription_operations o on o.id=w.operation_id
      where o.recording_id=any(v_ids) and o.phase='prepared' and w.job_id is distinct from v_deleting_job);
  update public.recording_transcription_work set phase='cancelled',storage_path='' where operation_id in(
    select id from public.recording_transcription_operations where recording_id=any(v_ids) and phase='prepared');
  update public.recording_transcription_operations set phase='released',completed_at=clock_timestamp() where recording_id=any(v_ids) and phase='prepared';
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$delete_guard$;
create trigger recordings_guard_transcription_delete before delete or update of status,project_id,user_id,created_by on public.recordings
  for each row execute function public.guard_recording_transcription_delete_v1();
create trigger users_guard_transcription_delete before delete on auth.users for each row execute function public.guard_recording_transcription_delete_v1();
create trigger projects_guard_transcription_delete before delete on public.recording_projects for each row execute function public.guard_recording_transcription_delete_v1();
create trigger clients_guard_transcription_delete before delete on public.recording_clients for each row execute function public.guard_recording_transcription_delete_v1();
create trigger transcription_jobs_guard_delete before delete on public.transcription_jobs for each row execute function public.guard_recording_transcription_delete_v1();

-- The old service entry points cannot mint/settle authority outside the started-operation protocol.
revoke execute on function public.accept_recording_job_custody_v1(uuid,uuid) from service_role;
revoke execute on function public.finalize_recording_job_v1(uuid,uuid,text,text,jsonb,jsonb,integer) from service_role;

-- All internals are private, forced-RLS, and owned by the canonical trusted T1 owner. Only enumerated session/service APIs receive EXECUTE.
do $owner$
declare v_owner name; v_table text; v_signature text; v_function regprocedure;
begin
  select r.rolname into v_owner from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role');
  if v_owner is null or v_owner<>current_user then raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
  foreach v_table in array array['recording_capture_receipts','recording_transcription_operations','recording_transcription_work','recording_transcription_resolutions','recording_capture_binding_permits','recording_transcription_models_v1'] loop
    execute format('alter table public.%I owner to %I',v_table,v_owner);
    execute format('alter table public.%I enable row level security',v_table);
    execute format('alter table public.%I force row level security',v_table);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',v_table);
  end loop;
  foreach v_signature in array array[
    'lock_recording_capture_v1(uuid)','has_recording_capture_authority_v1(uuid)','is_canonical_capture_path_v1(uuid,uuid,text)','get_recording_live_manifest_v1(uuid,uuid)',
    'validate_capture_transcript_v1(text,jsonb,jsonb)','get_recording_capture_state_v1(uuid)',
    'apply_recording_capture_transition_v1(uuid,uuid,bigint,text,integer,text,bigint,text,jsonb,jsonb)',
    'guard_recording_object_binding_v1()','lock_recording_transcription_operation_v1(uuid)',
    'prepare_recording_transcription_v1(uuid,uuid,bigint,text,text,text)','start_recording_transcription_v1(uuid)',
    'release_recording_transcription_v1(uuid)','refresh_recording_transcription_phase_v1(uuid)',
    'claim_recording_transcription_work_v1(integer)','refresh_recording_transcription_claim_v1(uuid,uuid,uuid)',
    'accept_recording_provider_job_v1(uuid,uuid,uuid,text)','settle_recording_provider_job_v1(uuid,uuid,uuid,text,bigint)',
    'finalize_recording_transcription_v1(uuid,uuid,text,jsonb,jsonb,integer)',
    'mark_recording_submission_uncertain_v1(uuid,uuid,uuid)','resolve_uncertain_recording_job_v1(uuid,uuid,text,text,text)',
    'get_managed_recording_transcription_v1(uuid[])','expire_prepared_recording_transcriptions_v1(integer)',
    'lock_recording_transcription_mutation_v1()','guard_recording_transcription_delete_v1()'
  ] loop
    v_function:=('public.'||v_signature)::regprocedure;
    execute format('alter function %s owner to %I',v_function,v_owner);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
  end loop;
end;
$owner$;
grant execute on function public.get_recording_capture_state_v1(uuid),
  public.apply_recording_capture_transition_v1(uuid,uuid,bigint,text,integer,text,bigint,text,jsonb,jsonb),
  public.prepare_recording_transcription_v1(uuid,uuid,bigint,text,text,text),public.start_recording_transcription_v1(uuid),
  public.release_recording_transcription_v1(uuid),public.get_managed_recording_transcription_v1(uuid[]) to authenticated;
grant execute on function public.claim_recording_transcription_work_v1(integer),public.refresh_recording_transcription_claim_v1(uuid,uuid,uuid),
  public.accept_recording_provider_job_v1(uuid,uuid,uuid,text),public.settle_recording_provider_job_v1(uuid,uuid,uuid,text,bigint),
  public.finalize_recording_transcription_v1(uuid,uuid,text,jsonb,jsonb,integer),public.mark_recording_submission_uncertain_v1(uuid,uuid,uuid),
  public.resolve_uncertain_recording_job_v1(uuid,uuid,text,text,text),public.expire_prepared_recording_transcriptions_v1(integer) to service_role;
