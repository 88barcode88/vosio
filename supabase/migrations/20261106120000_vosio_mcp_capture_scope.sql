-- Additive: OAuth scope set {vosio:capture} for the Vosio browser extension, its recording bindings and a safe extension identifier.
-- Allowed scope sets become exactly {read}, {read,write} and {capture}; {capture} requires a verified chromiumapp.org redirect.
-- Existing grants/pending rows, custody RPC ACLs and the dynamic-registration RPC (it validates no scopes) stay unchanged.
-- Reversal: see the ROLLBACK block at the end (restores the old checks only when no capture rows exist; additive objects stay).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_roles r where r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted owner' using errcode='42501';
  end if;
end; $owner$;

-- 1. Scope-set checks: write still entails read; capture is a separate set bound to an extension redirect URI.
alter table vosio_mcp_private.pending drop constraint pending_scopes_check;
alter table vosio_mcp_private.pending add constraint pending_scopes_check check (
  (scopes @> array['vosio:read'] and scopes <@ array['vosio:read','vosio:write'])
  or (scopes @> array['vosio:capture'] and scopes <@ array['vosio:capture']
    and redirect_uri ~ '^https://[a-p]{32}[.]chromiumapp[.]org/'));
alter table vosio_mcp_private.grants drop constraint grants_scopes_check;
alter table vosio_mcp_private.grants add constraint grants_scopes_check check (
  (scopes @> array['vosio:read'] and scopes <@ array['vosio:read','vosio:write'])
  or (scopes @> array['vosio:capture'] and scopes <@ array['vosio:capture']
    and redirect_uri ~ '^https://[a-p]{32}[.]chromiumapp[.]org/'));

-- 2. Custody `access`/`code_claim`/`refresh_claim` return grant_json; add the redirect URI so the Function can bind
-- /capture/* requests to the extension origin. Same signature and ACL; only one key is appended.
create or replace function vosio_mcp_private.grant_json(g vosio_mcp_private.grants) returns jsonb
language sql immutable set search_path='' as $$
select jsonb_build_object('id',g.id,'user_id',g.user_id,'session_id',g.session_id,'client_id',g.client_id,
  'resource',g.resource,'scopes',g.scopes,'encrypted',g.encrypted,'upstream_expires_at',g.upstream_expires_at,'fence',g.fence,
  'redirect_uri',g.redirect_uri);
$$;
revoke all on function vosio_mcp_private.grant_json(vosio_mcp_private.grants) from public,anon,authenticated,service_role;

-- 3. Recording bindings: which extension created which recording, until its audio upload is completed.
create table vosio_mcp_private.capture_recordings (
  recording_id uuid primary key references public.recordings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  extension_id text not null check (extension_id ~ '^[a-p]{32}$'),
  request_id uuid not null,
  created_grant_id uuid,
  completed_at timestamptz,
  completion jsonb check (completion is null or (jsonb_typeof(completion)='object' and octet_length(completion::text)<=8192)),
  created_at timestamptz not null default clock_timestamp(),
  constraint capture_recordings_request_key unique (user_id,extension_id,request_id),
  constraint capture_recordings_completion_check check (completion is null or completed_at is not null)
);
alter table vosio_mcp_private.capture_recordings owner to postgres;
alter table vosio_mcp_private.capture_recordings enable row level security;
alter table vosio_mcp_private.capture_recordings force row level security;
revoke all on vosio_mcp_private.capture_recordings from public,anon,authenticated,service_role;

-- Project a binding row for the trusted Function; the user is already known to the caller.
create function vosio_mcp_private.capture_binding_json(b vosio_mcp_private.capture_recordings) returns jsonb
language sql immutable set search_path='' as $$
select case when b.recording_id is null then null else jsonb_build_object('recordingId',b.recording_id,'extensionId',b.extension_id,
  'requestId',b.request_id,'createdGrantId',b.created_grant_id,'completedAt',b.completed_at,'completion',b.completion,'createdAt',b.created_at) end;
$$;
alter function vosio_mcp_private.capture_binding_json(vosio_mcp_private.capture_recordings) owner to postgres;
revoke all on function vosio_mcp_private.capture_binding_json(vosio_mcp_private.capture_recordings) from public,anon,authenticated,service_role;

-- Bind a just-created own recording to an extension; idempotent by (user, extension, request) and returns the stored binding.
-- A recording that is already bound elsewhere violates the primary key (23505); a foreign recording is rejected (22023).
create function public.mcp_capture_binding_record_v1(p_user_id uuid,p_extension_id text,p_recording_id uuid,p_request_id uuid,p_created_grant_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b vosio_mcp_private.capture_recordings;
begin
  if p_user_id is null or p_recording_id is null or p_request_id is null or p_extension_id is null or p_extension_id !~ '^[a-p]{32}$' then
    raise exception 'invalid capture binding request' using errcode='22023'; end if;
  if not exists(select 1 from public.recordings r where r.id=p_recording_id and r.user_id=p_user_id) then
    raise exception 'invalid capture binding request' using errcode='22023'; end if;
  insert into vosio_mcp_private.capture_recordings(recording_id,user_id,extension_id,request_id,created_grant_id)
    values(p_recording_id,p_user_id,p_extension_id,p_request_id,p_created_grant_id)
    on conflict (user_id,extension_id,request_id) do nothing;
  select * into b from vosio_mcp_private.capture_recordings where user_id=p_user_id and extension_id=p_extension_id and request_id=p_request_id;
  return vosio_mcp_private.capture_binding_json(b);
end; $$;

-- Look up a binding only for the exact user, extension and recording; null for unknown and foreign ids alike.
create function public.mcp_capture_binding_by_recording_v1(p_user_id uuid,p_extension_id text,p_recording_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b vosio_mcp_private.capture_recordings;
begin
  if p_user_id is null or p_recording_id is null or p_extension_id is null or p_extension_id !~ '^[a-p]{32}$' then
    raise exception 'invalid capture binding request' using errcode='22023'; end if;
  select * into b from vosio_mcp_private.capture_recordings where recording_id=p_recording_id and user_id=p_user_id and extension_id=p_extension_id;
  return vosio_mcp_private.capture_binding_json(b);
end; $$;

-- Look up a binding by the extension's own idempotency request id (retry after a lost response).
create function public.mcp_capture_binding_by_request_v1(p_user_id uuid,p_extension_id text,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b vosio_mcp_private.capture_recordings;
begin
  if p_user_id is null or p_request_id is null or p_extension_id is null or p_extension_id !~ '^[a-p]{32}$' then
    raise exception 'invalid capture binding request' using errcode='22023'; end if;
  select * into b from vosio_mcp_private.capture_recordings where user_id=p_user_id and extension_id=p_extension_id and request_id=p_request_id;
  return vosio_mcp_private.capture_binding_json(b);
end; $$;

-- Mark the upload complete and keep the first completion result so a repeated /complete returns it unchanged; null if no binding.
create function public.mcp_capture_binding_complete_v1(p_user_id uuid,p_extension_id text,p_recording_id uuid,p_completion jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b vosio_mcp_private.capture_recordings;
begin
  if p_user_id is null or p_recording_id is null or p_extension_id is null or p_extension_id !~ '^[a-p]{32}$'
    or p_completion is null or jsonb_typeof(p_completion) is distinct from 'object' or octet_length(p_completion::text)>8192 then
    raise exception 'invalid capture binding request' using errcode='22023'; end if;
  update vosio_mcp_private.capture_recordings set completed_at=coalesce(completed_at,clock_timestamp()),completion=coalesce(completion,p_completion)
    where recording_id=p_recording_id and user_id=p_user_id and extension_id=p_extension_id returning * into b;
  return vosio_mcp_private.capture_binding_json(b);
end; $$;

-- Service-only: same ACL pattern as custody/installation RPCs; users and anon can never read or write bindings.
alter function public.mcp_capture_binding_record_v1(uuid,text,uuid,uuid,uuid) owner to postgres;
alter function public.mcp_capture_binding_by_recording_v1(uuid,text,uuid) owner to postgres;
alter function public.mcp_capture_binding_by_request_v1(uuid,text,uuid) owner to postgres;
alter function public.mcp_capture_binding_complete_v1(uuid,text,uuid,jsonb) owner to postgres;
revoke all on function public.mcp_capture_binding_record_v1(uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.mcp_capture_binding_by_recording_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.mcp_capture_binding_by_request_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.mcp_capture_binding_complete_v1(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mcp_capture_binding_record_v1(uuid,text,uuid,uuid,uuid) to service_role;
grant execute on function public.mcp_capture_binding_by_recording_v1(uuid,text,uuid) to service_role;
grant execute on function public.mcp_capture_binding_by_request_v1(uuid,text,uuid) to service_role;
grant execute on function public.mcp_capture_binding_complete_v1(uuid,text,uuid,jsonb) to service_role;

-- 4. Own-connection list gains the extension identifier (chromiumapp.org host label of the verified redirect URI, else null).
create or replace function public.mcp_list_own_connections_v1() returns jsonb
language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(x.item),'[]'::jsonb) from (select jsonb_build_object('id',g.id,'clientName',c.name,'scopes',g.scopes,'createdAt',g.created_at,'status',g.status,
    'extensionId',substring(g.redirect_uri from '^https://([a-p]{32})[.]chromiumapp[.]org/')) item
  from vosio_mcp_private.grants g join vosio_mcp_private.clients c on c.id=g.client_id
  where g.user_id=auth.uid() and public.mcp_auth_session_active_v1() and g.status in ('active','refreshing') order by g.created_at desc,g.id desc limit 50) x;
$$;
revoke all on function public.mcp_list_own_connections_v1() from public,anon;
grant execute on function public.mcp_list_own_connections_v1() to authenticated;

-- 5. Web recovery must not close an extension upload that is still being sent: bound, not yet completed recordings
-- younger than 7 days are hidden from the recoverable list. Body, signature and ACL equal 20261005010000 plus that one condition.
create or replace function public.list_recoverable_recording_captures_v1()
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
    and not exists(select 1 from vosio_mcp_private.capture_recordings b
      where b.recording_id=r.id and b.completed_at is null and b.created_at>now()-interval '7 days')
  order by r.created_at desc,r.id desc limit 100;
$$;
revoke all on function public.list_recoverable_recording_captures_v1() from public,anon,authenticated,service_role;
grant execute on function public.list_recoverable_recording_captures_v1() to authenticated;
commit;

-- ROLLBACK-BEGIN (the verification script strips the leading "-- " and runs this block; run it in one transaction)
-- begin;
-- do $rollback$ begin
--   if exists(select 1 from vosio_mcp_private.pending where scopes @> array['vosio:capture'])
--     or exists(select 1 from vosio_mcp_private.grants where scopes @> array['vosio:capture']) then
--     raise exception 'capture pending/grant rows exist; revoke and clean them up first' using errcode='55000';
--   end if;
-- end; $rollback$;
-- alter table vosio_mcp_private.pending drop constraint pending_scopes_check;
-- alter table vosio_mcp_private.pending add constraint pending_scopes_check check (scopes @> array['vosio:read'] and scopes <@ array['vosio:read','vosio:write']);
-- alter table vosio_mcp_private.grants drop constraint grants_scopes_check;
-- alter table vosio_mcp_private.grants add constraint grants_scopes_check check (scopes @> array['vosio:read'] and scopes <@ array['vosio:read','vosio:write']);
-- commit;
-- ROLLBACK-END
-- The block above restores only the scope checks. The additive objects (capture_recordings, the four mcp_capture_binding_* RPCs,
-- the redirect_uri key in grant_json, extensionId in mcp_list_own_connections_v1 and the recovery filter) are harmless without capture
-- grants and stay; drop them only in a separately authorized cleanup.
