-- Additive T4 contract. Apply transactionally after 20260922230000 as the trusted T1 owner.
-- Completed receipts deliberately survive recording/user deletion: no content, recipients or foreign-key cascade.
create table public.recording_bulk_share_receipts (
  actor_id uuid not null,
  request_id uuid not null,
  payload_fingerprint text not null check(payload_fingerprint ~ '^[0-9a-f]{64}$'),
  recording_ids uuid[] not null check(array_ndims(recording_ids)=1 and cardinality(recording_ids) between 1 and 100),
  visibility text not null check(visibility in ('private','project','selected')),
  completed_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table public.recording_bulk_share_receipts enable row level security;
alter table public.recording_bulk_share_receipts force row level security;
revoke all on table public.recording_bulk_share_receipts from public,anon,authenticated,service_role;

-- Preauthorize the entire bounded set, then apply the single-share transition atomically; retries return only the historical receipt.
create function public.bulk_share_recordings_v1(
  p_request_id uuid,p_recording_ids uuid[],p_visibility text,p_recipients jsonb default '[]'
) returns table(recording_id uuid,visibility text)
language plpgsql volatile security definer set search_path = '' as $bulk$
declare
  v_actor uuid:=auth.uid();
  v_ids uuid[];
  v_projects uuid[];
  v_recipients jsonb;
  v_fingerprint text;
  v_receipt public.recording_bulk_share_receipts%rowtype;
  v_record public.recordings%rowtype;
  v_count integer:=0;
begin
  if v_actor is null then raise exception 'sharing denied' using errcode='42501'; end if;
  if p_request_id is null or p_recording_ids is null or cardinality(p_recording_ids)<1
    or cardinality(p_recording_ids)>100 or array_ndims(p_recording_ids) is distinct from 1 then
    raise exception 'invalid bulk sharing input' using errcode='22023'; end if;
  if array_position(p_recording_ids,null) is not null then
    raise exception 'invalid bulk sharing input' using errcode='22023'; end if;
  if p_visibility is null or p_visibility not in ('private','project','selected')
    or p_recipients is null or jsonb_typeof(p_recipients)<>'array' then
    raise exception 'invalid sharing input' using errcode='22023'; end if;
  if jsonb_array_length(p_recipients)>100
    or (p_visibility='selected') is distinct from (jsonb_array_length(p_recipients)>0) then
    raise exception 'invalid recipient count' using errcode='22023'; end if;
  -- Syntax only before replay: never depend on recipients still existing in auth.users.
  if exists(select 1 from jsonb_array_elements(p_recipients) x where jsonb_typeof(x)<>'object'
    or x->>'userId' is null or x->>'role' is null or x->>'role' not in ('reader','editor')
    or x-'userId'-'role'<>'{}'::jsonb) then
    raise exception 'invalid recipients' using errcode='22023'; end if;
  v_recipients:=public.canonical_recording_recipients_v1(p_recipients);
  if (select count(*)<>count(distinct x->>'userId') from jsonb_array_elements(v_recipients) x) then
    raise exception 'invalid recipients' using errcode='22023'; end if;
  select array_agg(x.id order by x.id) into v_ids from(select distinct unnest(p_recording_ids) as id) x;
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('recordingIds',v_ids,
    'visibility',p_visibility,'recipients',v_recipients)::text,'UTF8')),'hex');

  perform public.recording_sharing_lock_v1();
  select b.* into v_receipt from public.recording_bulk_share_receipts b
    where b.actor_id=v_actor and b.request_id=p_request_id;
  if found then
    if v_receipt.payload_fingerprint<>v_fingerprint then
      raise exception 'sharing denied' using errcode='42501'; end if;
    return query select x.id,v_receipt.visibility from unnest(v_receipt.recording_ids) x(id) order by x.id;
    return;
  end if;

  -- New requests alone need current recipient existence and current authority.
  perform public.validate_recording_recipients_v1(p_visibility,v_recipients);
  select coalesce(array_agg(distinct r.project_id order by r.project_id) filter(where r.project_id is not null),'{}'::uuid[])
    into v_projects from public.recordings r where r.id=any(v_ids);
  perform p.id from public.recording_projects p where p.id=any(v_projects) order by p.id for update;
  perform r.id from public.recordings r where r.id=any(v_ids) order by r.id for update;
  -- Re-fetch only after all locks. No mutation (including audit/receipt writes) occurs in this pass.
  for v_record in select r.* from public.recordings r where r.id=any(v_ids) order by r.id loop
    v_count:=v_count+1;
    if not public.can_manage_recording(v_record.id) or v_record.status='deleted' then
      raise exception 'sharing denied' using errcode='42501'; end if;
    if v_record.project_id is not null and (not(v_record.project_id=any(v_projects)) or not exists(
      select 1 from public.recording_projects p where p.id=v_record.project_id)) then
      raise exception 'sharing denied' using errcode='42501'; end if;
    if v_record.project_id is not null and p_visibility='selected' and not exists(
      select 1 from public.recording_projects p where p.id=v_record.project_id and p.user_id=v_actor) then
      raise exception 'project grants require founder' using errcode='42501'; end if;
    if v_record.project_id is not null and v_record.visibility='private' and p_visibility<>'private'
      and not public.can_capture_in_recording_project(v_record.project_id) then
      raise exception 'sharing denied' using errcode='42501'; end if;
    if p_visibility='project' and v_record.project_id is null then
      raise exception 'project required' using errcode='22023'; end if;
    if v_record.project_id is not null and v_record.visibility<>'private' and p_visibility='private' then
      raise exception 'project custody cannot become private' using errcode='22023'; end if;
  end loop;
  if v_count<>cardinality(v_ids) then raise exception 'sharing denied' using errcode='42501'; end if;

  -- All rows and transitions authorized: revoke old grants/pending bundles exactly as single-share does.
  update public.recording_access_grants g set revoked_at=now() where g.recording_id=any(v_ids) and g.revoked_at is null;
  update public.recording_invitations i set revoked_at=now() where i.accepted_at is null and i.revoked_at is null
    and exists(select 1 from public.recording_invitation_items x where x.invitation_id=i.id and x.recording_id=any(v_ids));
  update public.recordings r set visibility=p_visibility where r.id=any(v_ids);
  insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id)
    select r.id,(x->>'userId')::uuid,x->>'role',r.project_id
    from public.recordings r cross join jsonb_array_elements(v_recipients) x
    where r.id=any(v_ids) order by r.id,(x->>'userId')::uuid;
  insert into public.recording_sharing_audit(actor_id,action,recording_id,project_id)
    select v_actor,'share',r.id,r.project_id from public.recordings r where r.id=any(v_ids) order by r.id;
  insert into public.recording_bulk_share_receipts(actor_id,request_id,payload_fingerprint,recording_ids,visibility)
    values(v_actor,p_request_id,v_fingerprint,v_ids,p_visibility);
  return query select x.id,p_visibility from unnest(v_ids) x(id) order by x.id;
end;
$bulk$;

-- Match the reviewed helper owner, not the API roles; no direct access to the immutable receipt ledger.
do $owner$
declare v_owner name;
begin
  select r.rolname into v_owner from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and (r.rolsuper or r.rolbypassrls)
      and r.rolname not in ('anon','authenticated','service_role');
  if v_owner is null or v_owner<>current_user then raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
  execute format('alter table public.recording_bulk_share_receipts owner to %I',v_owner);
  execute format('alter function public.bulk_share_recordings_v1(uuid,uuid[],text,jsonb) owner to %I',v_owner);
end;
$owner$;
revoke all on function public.bulk_share_recordings_v1(uuid,uuid[],text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.bulk_share_recordings_v1(uuid,uuid[],text,jsonb) to authenticated;
