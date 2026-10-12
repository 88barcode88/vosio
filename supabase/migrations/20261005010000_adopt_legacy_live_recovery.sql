begin;
-- Forward only. Backout revokes adoption; never undo adopted identity or delete retained audio.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- A legacy adoption freezes the expected tail; interrupted recovery cannot append a different scope.
create table public.legacy_live_part_adoptions (
  recording_id uuid primary key references public.recordings(id) on delete cascade,
  capture_request_id uuid not null, manifest_fingerprint text not null, expected_count integer not null check(expected_count between 1 and 1000)
);
alter table public.legacy_live_part_adoptions enable row level security;
alter table public.legacy_live_part_adoptions force row level security;
revoke all on table public.legacy_live_part_adoptions from public,anon,authenticated,service_role;

-- Adopt all expected local parts together, preserving existing bytes and strict new-capture completion.
create function public.adopt_legacy_live_parts_v1(p_recording_id uuid,p_expected_capture_revision bigint,p_parts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $adopt$
declare v_record public.recordings; v_prefix text; v_count integer; v_request uuid; v_limit bigint;
begin
  v_record:=public.lock_recording_capture_v1(p_recording_id);
  if not public.has_recording_capture_authority_v1(v_record.id) then raise exception 'capture denied' using errcode='42501'; end if;
  if p_expected_capture_revision is null or p_expected_capture_revision<0 then raise exception 'invalid revision' using errcode='22023'; end if;
  if v_record.capture_revision<>p_expected_capture_revision then raise exception 'capture changed' using errcode='40001'; end if;
  -- New captures already have an immutable registered scope; adoption grants them nothing.
  if v_record.capture_request_id is not null then
    if exists(select 1 from public.legacy_live_part_adoptions a where a.recording_id=v_record.id
      and (a.capture_request_id<>v_record.capture_request_id or a.manifest_fingerprint<>encode(sha256(convert_to(p_parts::text,'UTF8')),'hex'))) then
      raise exception 'legacy local manifest changed' using errcode='22023'; end if;
    return jsonb_build_object('recordingId',v_record.id,'status',v_record.status,'captureRevision',v_record.capture_revision);
  end if;
  if v_record.source_type<>'in_app_recording' or v_record.status not in ('created','uploading','failed')
    or v_record.storage_path is not null or v_record.capture_revision<>0 then
    raise exception 'legacy adoption unavailable' using errcode='55000'; end if;
  perform public.assert_live_capture_idle_v1(v_record.id);
  if jsonb_typeof(p_parts) is distinct from 'array' then raise exception 'invalid local manifest' using errcode='22023'; end if;
  v_count:=jsonb_array_length(p_parts);
  select file_size_limit into v_limit from storage.buckets where id='recordings';
  if v_count not between 1 and 1000 or exists(select 1 from jsonb_array_elements(p_parts) with ordinality x(part,position) where
    jsonb_typeof(part) is distinct from 'object' or part->>'index' is distinct from (position-1)::text
    or coalesce(part->>'mimeType','') not in ('audio/webm','video/webm','audio/mp4','audio/m4a','audio/x-m4a','video/mp4')
    or case when coalesce(part->>'bytes','') ~ '^[1-9][0-9]{0,9}$' then
      (part->>'bytes')::bigint>least(coalesce(v_limit,5368709120),5368709120) else true end)
    or (select count(distinct part->>'mimeType') from jsonb_array_elements(p_parts) part)<>1 then
    raise exception 'invalid local manifest' using errcode='22023'; end if;
  v_prefix:=v_record.user_id::text||'/'||v_record.id::text||'/live/';
  -- Lock confirmed legacy metadata before comparison. No arbitrary prefix, archive or invisible extras.
  perform 1 from storage.objects where bucket_id='recordings' and left(name,length(v_prefix))=v_prefix order by name for update;
  if not exists(select 1 from storage.objects where bucket_id='recordings' and left(name,length(v_prefix))=v_prefix)
    or exists(select 1 from storage.objects s where s.bucket_id='recordings' and left(s.name,length(v_prefix))=v_prefix
      and not exists(select 1 from jsonb_array_elements(p_parts) part where
        s.name=v_prefix||'part-'||lpad(part->>'index',6,'0')||'.'||case when part->>'mimeType' in ('audio/webm','video/webm') then 'webm' else 'm4a' end
        and s.metadata->>'size'=part->>'bytes' and s.metadata->>'mimetype'=part->>'mimeType'))
    or exists(select 1 from public.recording_live_part_registrations where recording_id=v_record.id) then
    raise exception 'legacy audio does not match local manifest' using errcode='22023'; end if;
  v_request:=gen_random_uuid();
  insert into public.recording_live_part_registrations(recording_id,capture_request_id,storage_path,part_index,mime_type,file_size_bytes)
    select v_record.id,v_request,v_prefix||'part-'||lpad(part->>'index',6,'0')||'.'||case when part->>'mimeType' in ('audio/webm','video/webm') then 'webm' else 'm4a' end,
      (part->>'index')::integer,part->>'mimeType',(part->>'bytes')::bigint from jsonb_array_elements(p_parts) part;
  update public.recordings set capture_request_id=v_request where id=v_record.id;
  insert into public.legacy_live_part_adoptions values(v_record.id,v_request,encode(sha256(convert_to(p_parts::text,'UTF8')),'hex'),v_count);
  return jsonb_build_object('recordingId',v_record.id,'status',v_record.status,'captureRevision',v_record.capture_revision);
end;
$adopt$;
revoke all on function public.adopt_legacy_live_parts_v1(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.adopt_legacy_live_parts_v1(uuid,bigint,jsonb) to authenticated;

-- The existing part API remains the sole upload admission; only adopted legacy scope is additionally frozen.
create or replace function public.prepare_recording_live_part_v1(p_recording_id uuid,p_expected_capture_revision bigint,p_part_index integer,p_mime_type text,p_file_size_bytes bigint)
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
    if exists(select 1 from public.legacy_live_part_adoptions where recording_id=v_record.id) then
      raise exception 'legacy local manifest changed' using errcode='22023'; end if;
    insert into public.recording_live_part_registrations values(v_record.id,v_record.capture_request_id,v_path,p_part_index,p_mime_type,p_file_size_bytes);
  end if;
  if v_record.status in ('created','failed') then update public.recordings set status='uploading' where id=v_record.id; end if;
  return v_path;
end;
$part$;

-- Bounded metadata-only diagnostics. Missing indices are observed gaps or registered expectations, never invented audio.
create function public.get_live_recovery_diagnostics_v1(p_recording_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $diagnostics$
declare v_record public.recordings; v_prefix text; v_objects jsonb; v_expected integer; v_indices integer[]; v_missing integer[]; v_invalid boolean; v_bytes bigint;
begin
  select * into v_record from public.recordings where id=p_recording_id;
  v_prefix:=v_record.user_id::text||'/'||v_record.id::text||'/live/';
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into v_objects from
    (select name,metadata from storage.objects where bucket_id='recordings' and left(name,length(v_prefix))=v_prefix
      and not coalesce(name=v_record.storage_path and name in (v_prefix||'recording.webm',v_prefix||'recording.m4a')
        and metadata->>'size'=v_record.file_size_bytes::text and metadata->>'mimetype'=v_record.mime_type,false)
      order by name limit 1001) s;
  select coalesce(bool_or(substring(x->>'name' from length(v_prefix)+1) !~ '^part-[0-9]{6}\.(webm|m4a)$'
      or coalesce(x->'metadata'->>'size','') !~ '^[1-9][0-9]{0,9}$'),false),
    coalesce(sum(case when x->'metadata'->>'size' ~ '^[1-9][0-9]{0,9}$' then (x->'metadata'->>'size')::bigint else 0 end),0)
    into v_invalid,v_bytes from jsonb_array_elements(v_objects) x;
  select coalesce(array_agg(distinct substring(x->>'name' from length(v_prefix)+6 for 6)::integer),array[]::integer[])
    into v_indices from jsonb_array_elements(v_objects) x where substring(x->>'name' from length(v_prefix)+1) ~ '^part-[0-9]{6}\.(webm|m4a)$';
  select coalesce(max(part_index)+1,(select max(i)+1 from unnest(v_indices) i),0) into v_expected
    from public.recording_live_part_registrations where recording_id=p_recording_id;
  v_invalid:=v_invalid or jsonb_array_length(v_objects)>1000 or v_expected>1000
    or (select count(distinct substring(x->>'name' from '\.([^.]+)$')) from jsonb_array_elements(v_objects) x)>1
    or (select count(distinct x->'metadata'->>'mimetype') from jsonb_array_elements(v_objects) x)>1
    or exists(select 1 from jsonb_array_elements(v_objects) x where
      coalesce(x->'metadata'->>'mimetype','') not in ('audio/webm','video/webm','audio/mp4','audio/m4a','audio/x-m4a','video/mp4')
      or substring(x->>'name' from '\.([^.]+)$') is distinct from
        case when x->'metadata'->>'mimetype' in ('audio/webm','video/webm') then 'webm' else 'm4a' end);
  if cardinality(v_indices)=0 then
    v_invalid:=jsonb_array_length(v_objects)>1000 or exists(select 1 from jsonb_array_elements(v_objects) x
      where substring(x->>'name' from length(v_prefix)+1) !~ '^[A-Za-z0-9_-]+\.(webm|ogg|mp3|m4a|wav|mp4|flac)$'
        or coalesce(x->'metadata'->>'size','') !~ '^[1-9][0-9]{0,9}$');
  end if;
  if exists(select 1 from public.recording_live_part_registrations p join storage.objects s
    on s.bucket_id='recordings' and s.name=p.storage_path where p.recording_id=p_recording_id
      and (s.metadata->>'size' is distinct from p.file_size_bytes::text or s.metadata->>'mimetype' is distinct from p.mime_type)) then
    v_invalid:=true;
  end if;
  if exists(select 1 from public.recording_live_part_registrations where recording_id=p_recording_id) then
    if exists(select 1 from jsonb_array_elements(v_objects) x where not exists(select 1
      from public.recording_live_part_registrations p where p.recording_id=p_recording_id and p.storage_path=x->>'name'))
      or exists(select 1 from public.recording_live_part_registrations p where p.recording_id=p_recording_id
        and (p.capture_request_id is distinct from v_record.capture_request_id or p.part_index>=(select count(*)
          from public.recording_live_part_registrations where recording_id=p_recording_id)))
      or (select count(distinct mime_type) from public.recording_live_part_registrations where recording_id=p_recording_id)>1 then
      v_invalid:=true;
    end if;
  elsif v_record.capture_request_id is not null and cardinality(v_indices)>0 then
    v_invalid:=true;
  end if;
  select coalesce(array_agg(i),array[]::integer[]) into v_missing from generate_series(0,least(v_expected,1000)-1) i where not(i=any(v_indices));
  return jsonb_build_object('segment_count',cardinality(v_indices),'expected_segment_count',least(v_expected,1000),
    'missing_part_indices',v_missing,'storage_bytes',v_bytes,'legacy_capture',v_record.capture_request_id is null,
    'recovery_issue',case when v_invalid then 'invalid_audio_manifest' when cardinality(v_missing)>0 then 'missing_audio_parts' else null end);
end;
$diagnostics$;
revoke all on function public.get_live_recovery_diagnostics_v1(uuid) from public,anon,authenticated,service_role;

-- Preserve the existing authenticated list contract, adding real Storage counts and safe diagnostics.
drop function public.list_recoverable_recording_captures_v1();
create function public.list_recoverable_recording_captures_v1()
returns table(id uuid,title text,created_at timestamptz,duration_seconds integer,"captureRevision" bigint,
  transcript_chars integer,storage_bytes bigint,phase text,"canRecover" boolean,segment_count integer,
  expected_segment_count integer,missing_part_indices integer[],legacy_capture boolean,recovery_issue text,legacy_adoption_state text,"canDelete" boolean)
language sql stable security definer set search_path = '' as $$
  select r.id,r.title,r.created_at,r.duration_seconds,r.capture_revision,coalesce(t.chars,0),
    greatest(coalesce(r.file_size_bytes,0),(d.value->>'storage_bytes')::bigint),o.phase,
    (public.has_recording_capture_authority_v1(r.id) or public.can_manage_recording(r.id)) and r.source_type in ('in_app_recording','realtime')
      and coalesce(o.phase,'') not in ('prepared','started','accepted','manual_required','uncertain')
      and not exists(select 1 from public.transcription_jobs j where j.recording_id=r.id and j.status in ('queued','running'))
      and d.value->>'recovery_issue' is null,
    (d.value->>'segment_count')::integer,(d.value->>'expected_segment_count')::integer,
    array(select jsonb_array_elements_text(d.value->'missing_part_indices')::integer),
    (d.value->>'legacy_capture')::boolean,
    case when coalesce(o.phase,'') in ('prepared','started','accepted','uncertain')
      or exists(select 1 from public.transcription_jobs j where j.recording_id=r.id and j.status in ('queued','running')) then 'active_transcription'
      when o.phase='manual_required' then 'transcription_review_required' else d.value->>'recovery_issue' end,
    case when r.capture_request_id is null and (d.value->>'segment_count')::integer>0 then
      case when r.source_type='in_app_recording' and r.status in ('created','uploading','failed') and r.storage_path is null and r.capture_revision=0
        and d.value->>'recovery_issue' is distinct from 'invalid_audio_manifest'
        and coalesce(o.phase,'') not in ('prepared','started','accepted','uncertain','manual_required')
        and not exists(select 1 from public.transcription_jobs j where j.recording_id=r.id and j.status in ('queued','running'))
        then 'requires_local_manifest' else 'blocked' end else null end,
    public.can_manage_recording(r.id) and r.purge_claim_id is null
      and not exists(select 1 from public.recording_purge_operations p where p.recording_id=r.id and p.phase in ('prepared','started'))
      and not exists(select 1 from public.recording_transcription_operations x where x.recording_id=r.id and x.phase in ('prepared','started','accepted','uncertain'))
      and not exists(select 1 from public.transcription_jobs j where j.recording_id=r.id and j.status in ('queued','running'))
  from public.recordings r
  left join lateral (select length(raw_text) chars from public.transcripts where recording_id=r.id order by created_at desc,id desc limit 1) t on true
  left join lateral public.get_managed_recording_transcription_v1(array[r.id]) o on true
  cross join lateral (select public.get_live_recovery_diagnostics_v1(r.id) value) d
  where auth.uid() is not null and r.status in ('created','uploading','failed','transcribing')
    and (public.has_recording_capture_authority_v1(r.id) or public.can_manage_recording(r.id))
    and (coalesce(t.chars,0)>0 or coalesce(r.file_size_bytes,0)>0 or o.operation_id is not null or (d.value->>'segment_count')::integer>0)
  order by r.created_at desc,r.id desc limit 100;
$$;
revoke all on function public.list_recoverable_recording_captures_v1() from public,anon,authenticated,service_role;
grant execute on function public.list_recoverable_recording_captures_v1() to authenticated;
commit;
