begin;
-- New SECURITY DEFINER contracts must retain the reviewed privileged, non-API owner.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;
alter table public.transcripts add column search_indexed_version bigint not null default -1,
  add column search_index_attempted_at timestamptz;

-- Persist successful derived-index coverage under the same transcript version fence.
create or replace function public.replace_transcript_search_chunks_v2(p_transcript_id uuid,p_chunks jsonb,p_expected_version bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_version bigint;
begin
  select search_version into v_version from public.transcripts where id=p_transcript_id for update;
  if not found or p_expected_version is distinct from v_version then return false; end if;
  perform public.replace_transcript_search_chunks_v1(p_transcript_id,p_chunks);
  update public.transcripts set search_indexed_version=v_version where id=p_transcript_id;
  return true;
end;
$$;

-- Resume index-only failures after completion; rotating attempts prevents one invalid row starving new work.
create function public.claim_pending_capture_indexes_v1(p_limit integer default 5) returns table(transcript_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'invalid index bound' using errcode='22023'; end if;
  return query with pending as (
    select t.id from public.transcripts t join public.recordings r on r.id=t.recording_id
    where t.search_indexed_version<t.search_version and r.status<>'deleted'
      and (r.capture_request_id is not null or t.completion_generation_key like 'async:%')
    order by t.search_index_attempted_at nulls first,t.created_at,t.id limit p_limit for update of t skip locked
  ) update public.transcripts t set search_index_attempted_at=clock_timestamp()
    from pending p where t.id=p.id returning t.id;
end;
$$;
revoke all on function public.claim_pending_capture_indexes_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_pending_capture_indexes_v1(integer) to service_role;

-- Materialize a missing legacy speaker only when its ID is proved by persisted tokens; preserve other slots.
create or replace function public.patch_transcript_speaker_v1(p_transcript_id uuid,p_speaker_id text,p_expected_version bigint,p_name text,p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_recording_id uuid; v_transcript public.transcripts; v_slot jsonb; v_index integer;
  v_version bigint; v_search_version bigint; v_speakers jsonb;
begin
  if p_speaker_id is null or length(p_speaker_id) not between 1 and 100 or p_expected_version is null or p_expected_version<0
    or length(p_name)>100 or p_role is null or p_role not in ('client_customer','delivery_team','unknown') then
    raise exception 'invalid speaker patch' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  select recording_id into v_recording_id from public.transcripts where id=p_transcript_id;
  perform 1 from public.recordings where id=v_recording_id for update;
  if not public.can_edit_recording(v_recording_id) then raise exception 'edit denied' using errcode='42501'; end if;
  select * into v_transcript from public.transcripts where id=p_transcript_id for update;
  v_speakers:=case when jsonb_typeof(v_transcript.speakers)='array' then v_transcript.speakers else '[]'::jsonb end;
  select x.item,(x.ordinality-1)::integer into v_slot,v_index from jsonb_array_elements(v_speakers) with ordinality x(item,ordinality)
    where item->>'id'=p_speaker_id;
  if v_index is null then
    if not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(v_transcript.segments)='array' then v_transcript.segments else '[]'::jsonb end) segment
      cross join lateral jsonb_array_elements(case when jsonb_typeof(segment->'tokens')='array' then segment->'tokens' else jsonb_build_array(segment) end) token
      where jsonb_typeof(token->'speaker') in ('string','number') and token->>'speaker'=p_speaker_id) then
      raise exception 'speaker not found' using errcode='22023'; end if;
    v_index:=jsonb_array_length(v_speakers);
    v_slot:=jsonb_build_object('id',p_speaker_id,'label','Mluvčí '||p_speaker_id,'name',null,'role','unknown','source','soniox_diarization');
    v_speakers:=v_speakers||jsonb_build_array(v_slot);
  end if;
  v_version:=coalesce((v_transcript.speaker_versions->>p_speaker_id)::bigint,0);
  if v_version<>p_expected_version then return jsonb_build_object('outcome','conflict','speaker',v_slot,'version',v_version,'searchVersion',v_transcript.search_version); end if;
  v_slot:=v_slot||jsonb_build_object('name',nullif(btrim(p_name),''),'role',p_role,'source','manual');
  update public.transcripts set speakers=jsonb_set(v_speakers,array[v_index::text],v_slot),
    speaker_versions=jsonb_set(speaker_versions,array[p_speaker_id],to_jsonb(v_version+1)) where id=p_transcript_id returning search_version into v_search_version;
  return jsonb_build_object('outcome','saved','speaker',v_slot,'version',v_version+1,'searchVersion',v_search_version);
end;
$$;

do $$ begin
  if (select proowner from pg_proc where oid='public.claim_pending_capture_indexes_v1(integer)'::regprocedure)
    is distinct from (select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure) then
    raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
end $$;
commit;
