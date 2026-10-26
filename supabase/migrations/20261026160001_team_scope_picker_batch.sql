-- Additive Team picker metadata and atomic grants. Apply before the matching app build.
begin;

do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.set_team_access_v1(text,uuid,uuid,uuid,text)'::regprocedure
      and r.rolname=current_user and (r.rolsuper or r.rolbypassrls)
      and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted team owner' using errcode='42501';
  end if;
end; $owner$;

-- Receipts contain only command identity and IDs, never content or current permission claims.
create table vosio_team_private.access_batch_receipts (
  actor_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  saved_count integer not null check(saved_count between 1 and 100),
  completed_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table vosio_team_private.access_batch_receipts enable row level security;
alter table vosio_team_private.access_batch_receipts force row level security;
revoke all on table vosio_team_private.access_batch_receipts from public,anon,authenticated,service_role;

-- Enrich only already-manageable choices, masking taxonomy that belongs to another actor.
create function public.team_workspace_v2() returns jsonb
language plpgsql stable security definer set search_path='' as $workspace$
declare v_workspace jsonb; v_scopes jsonb;
begin
  v_workspace:=public.team_workspace_v1();
  select coalesce(jsonb_agg(s.value||jsonb_build_object(
    'clientId',case when c.user_id=auth.uid() then c.id end,
    'folderId',case when f.user_id=auth.uid() then f.id end,
    'visibility',r.visibility) order by s.ordinality),'[]'::jsonb)
  into v_scopes
  from jsonb_array_elements(v_workspace->'scopes') with ordinality s(value,ordinality)
  left join public.recordings r on s.value->>'scopeKind'='recording' and r.id=(s.value->>'scopeId')::uuid
  left join public.recording_projects p on s.value->>'scopeKind'='project' and p.id=(s.value->>'scopeId')::uuid
  left join public.recording_clients c on c.id=case
    when s.value->>'scopeKind'='client' then (s.value->>'scopeId')::uuid
    when s.value->>'scopeKind'='project' then p.client_id else r.client_id end
  left join public.recording_folders f on f.id=case
    when s.value->>'scopeKind'='folder' then (s.value->>'scopeId')::uuid else r.folder_id end;
  return v_workspace||jsonb_build_object('scopes',v_scopes);
end;
$workspace$;

-- A single transaction reuses the canonical exact-grant commands; retries never recreate revoked access.
create function public.set_team_access_batch_v1(
  p_request_id uuid,p_user_id uuid,p_role text,p_scopes jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $batch$
declare
  v_actor uuid:=auth.uid();
  v_scopes jsonb;
  v_payload jsonb;
  v_receipt vosio_team_private.access_batch_receipts%rowtype;
  v_scope record;
  v_count integer;
begin
  if v_actor is null or public.mcp_auth_session_active_v1() is not true then
    raise exception 'team access denied' using errcode='42501';
  end if;
  if p_request_id is null or p_user_id is null or p_user_id=v_actor
    or p_role is null or p_role not in ('reader','editor')
    or p_scopes is null or jsonb_typeof(p_scopes)<>'array' then
    raise exception 'invalid team batch' using errcode='22023';
  end if;
  v_count:=jsonb_array_length(p_scopes);
  if v_count not between 1 and 100 or exists(
    select 1 from jsonb_array_elements(p_scopes) x where jsonb_typeof(x)<>'object'
      or x-'scopeKind'-'scopeId'-'projectId'<>'{}'::jsonb
      or not(x ?& array['scopeKind','scopeId','projectId'])
      or x->>'scopeKind' is null or x->>'scopeKind' not in ('recording','project','client','folder')
      or jsonb_typeof(x->'scopeId')<>'string'
      or jsonb_typeof(x->'projectId') not in ('string','null')
  ) then raise exception 'invalid team batch' using errcode='22023'; end if;
  begin
    select jsonb_agg(jsonb_build_object('scopeKind',s."scopeKind",'scopeId',s."scopeId",'projectId',s."projectId")
      order by s."scopeKind",s."scopeId",s."projectId" nulls first)
    into v_scopes from jsonb_to_recordset(p_scopes) as s("scopeKind" text,"scopeId" uuid,"projectId" uuid);
  exception when invalid_text_representation then
    raise exception 'invalid team batch' using errcode='22023';
  end;
  if (select count(distinct x) from jsonb_array_elements(v_scopes) x)<>v_count
    or exists(select 1 from jsonb_array_elements(v_scopes) x where x->>'scopeId' is null) then
    raise exception 'duplicate or invalid team scope' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('userId',p_user_id,'role',p_role,'scopes',v_scopes);

  perform public.recording_sharing_lock_v1();
  select * into v_receipt from vosio_team_private.access_batch_receipts b
    where b.actor_id=v_actor and b.request_id=p_request_id;
  if found then
    if v_receipt.payload<>v_payload then
      raise exception 'team request identity conflict' using errcode='22023';
    end if;
    return jsonb_build_object('saved',true,'count',v_receipt.saved_count);
  end if;

  -- Authorize every exact boundary and the existing contact before the first write.
  if public.team_authority_v1() is null or exists(
    select 1 from jsonb_to_recordset(v_scopes) as s("scopeKind" text,"scopeId" uuid,"projectId" uuid)
    where not exists(select 1 from vosio_team_private.scopes() allowed
      where allowed.scope_kind=s."scopeKind" and allowed.scope_id=s."scopeId"
        and allowed.project_id is not distinct from s."projectId")
  ) or not exists(
    select 1 from jsonb_array_elements(public.team_workspace_v1()->'people') p where p->>'userId'=p_user_id::text
  ) then raise exception 'team access denied' using errcode='42501'; end if;

  for v_scope in select * from jsonb_to_recordset(v_scopes)
    as s("scopeKind" text,"scopeId" uuid,"projectId" uuid) loop
    perform public.set_team_access_v1(v_scope."scopeKind",v_scope."scopeId",v_scope."projectId",p_user_id,p_role);
  end loop;
  insert into vosio_team_private.access_batch_receipts(actor_id,request_id,payload,saved_count)
    values(v_actor,p_request_id,v_payload,v_count);
  return jsonb_build_object('saved',true,'count',v_count);
end;
$batch$;

revoke all on function public.team_workspace_v2(),public.set_team_access_batch_v1(uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.team_workspace_v2(),public.set_team_access_batch_v1(uuid,uuid,text,jsonb) to authenticated;
commit;
