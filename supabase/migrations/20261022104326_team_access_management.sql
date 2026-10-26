-- SOURCE ONLY: requires isolated role/concurrency proof and separately authorized deployment.
begin;
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

create schema vosio_team_private;
revoke all on schema vosio_team_private from public,anon,authenticated,service_role;
-- Provision/revoke actual installation administrators only in a separately authorized operator step.
create table vosio_team_private.installation_administrators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- A personal address book retains only deliberately managed people, not every Auth account.
create table vosio_team_private.contacts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key(owner_id,user_id), check(owner_id<>user_id)
);
create table vosio_team_private.scope_grants (
  id uuid primary key default gen_random_uuid(),
  grantor_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_kind text not null check(scope_kind in ('client','folder')),
  client_id uuid references public.recording_clients(id) on delete cascade,
  folder_id uuid references public.recording_folders(id) on delete cascade,
  project_id uuid references public.recording_projects(id) on delete cascade,
  role text not null check(role in ('reader','editor')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check((scope_kind='client' and client_id is not null and folder_id is null)
    or (scope_kind='folder' and folder_id is not null and client_id is null)),
  check(grantor_id<>user_id)
);
create unique index team_scope_grants_identity on vosio_team_private.scope_grants
  (grantor_id,user_id,scope_kind,coalesce(client_id,folder_id),coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;
create index team_scope_grants_recipient on vosio_team_private.scope_grants(user_id) where revoked_at is null;
alter table vosio_team_private.installation_administrators enable row level security;
alter table vosio_team_private.installation_administrators force row level security;
alter table vosio_team_private.contacts enable row level security;
alter table vosio_team_private.contacts force row level security;
alter table vosio_team_private.scope_grants enable row level security;
alter table vosio_team_private.scope_grants force row level security;
revoke all on all tables in schema vosio_team_private from public,anon,authenticated,service_role;

-- Current registry membership is never inferred from JWT metadata, service role or signup order.
create function vosio_team_private.is_administrator(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from vosio_team_private.installation_administrators a where a.user_id=p_user_id and a.revoked_at is null);
$$;

-- Existing auth/session validation also rejects an old token after its backing session is removed.
create function public.team_authority_v1() returns text
language sql stable security definer set search_path='' as $$
  select case when public.mcp_auth_session_active_v1() then case
    when vosio_team_private.is_administrator(auth.uid()) then 'installation_admin'
    when exists(select 1 from public.recording_projects p where p.user_id=auth.uid()) then 'project_founder'
  end end;
$$;

-- Scope choices are authority facts, not a list of all objects visible to the installation admin.
create function vosio_team_private.scopes() returns table(scope_kind text,scope_id uuid,label text,project_id uuid)
language sql stable security definer set search_path='' as $$
  with actor as (select auth.uid() id,public.team_authority_v1() role)
  select 'project',p.id,p.name,p.id from public.recording_projects p,actor a where a.role is not null and p.user_id=a.id
  union all
  select 'recording',r.id,r.title,r.project_id from public.recordings r,actor a
    where a.role is not null and r.status<>'deleted' and public.can_manage_recording(r.id)
      and (a.role='installation_admin' or (r.visibility<>'private' and exists(select 1 from public.recording_projects p where p.id=r.project_id and p.user_id=a.id)))
  union all
  select 'client',c.id,c.name,null::uuid from public.recording_clients c,actor a where a.role='installation_admin' and c.user_id=a.id
  union all
  select 'folder',f.id,f.name,null::uuid from public.recording_folders f,actor a where a.role='installation_admin' and f.user_id=a.id
  union all
  select 'client',c.id,c.name,p.id from public.recording_clients c join public.recording_projects p on p.client_id=c.id,actor a
    where a.role is not null and p.user_id=a.id and c.user_id=a.id
  union all
  select 'folder',f.id,f.name,p.id from public.recording_folders f cross join public.recording_projects p cross join actor a
    where a.role is not null and p.user_id=a.id and f.user_id=a.id;
$$;

-- Resolve grants dynamically against current organization and founder fences; no materialized copies to become stale.
create function vosio_team_private.scope_role(p_recording_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when bool_or(g.role='editor') then 'editor' when count(*)>0 then 'reader' end
  from public.recordings r join vosio_team_private.scope_grants g on g.user_id=auth.uid() and g.revoked_at is null
    and ((g.scope_kind='client' and g.client_id=r.client_id) or (g.scope_kind='folder' and g.folder_id=r.folder_id))
  where r.id=p_recording_id and r.visibility<>'private' and r.status<>'deleted'
    and (g.project_id is null or g.project_id=r.project_id)
    and ((g.project_id is null and vosio_team_private.is_administrator(g.grantor_id) and
      ((r.project_id is null and r.user_id=g.grantor_id) or exists(select 1 from public.recording_projects p where p.id=r.project_id and p.user_id=g.grantor_id)))
      or (g.project_id is not null and exists(select 1 from public.recording_projects p where p.id=g.project_id and p.user_id=g.grantor_id)))
    and ((g.scope_kind='client' and exists(select 1 from public.recording_clients c where c.id=g.client_id and c.user_id=g.grantor_id))
      or (g.scope_kind='folder' and exists(select 1 from public.recording_folders f where f.id=g.folder_id and f.user_id=g.grantor_id)));
$$;

-- Keep custody/private early returns; combine explicit nonprivate grant paths using the strongest editing role.
create or replace function public.recording_access_role_v1(p_recording_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select case
    when auth.uid() is null then null
    when r.project_id is not null and r.visibility<>'private' and p.user_id=auth.uid() then 'manager'
    when (r.project_id is null or r.visibility='private') and r.user_id=auth.uid() then 'manager'
    when r.status='deleted' or r.visibility='private' then null
    else (select case when bool_or(x.role='editor') then 'editor' when count(x.role)>0 then 'reader' end from (
      select m.role from public.recording_project_members m where r.visibility='project' and m.project_id=r.project_id and m.user_id=auth.uid() and m.revoked_at is null
      union all
      select g.role from public.recording_access_grants g where g.recording_id=r.id and g.user_id=auth.uid() and g.revoked_at is null and g.scope_project_id is not distinct from r.project_id
      union all select vosio_team_private.scope_role(r.id)
    ) x) end
  from public.recordings r left join public.recording_projects p on p.id=r.project_id where r.id=p_recording_id;
$$;

-- Exact grants can add one recipient to a project-visible record without dropping project members.
create or replace function public.validate_recording_grant_scope_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.revoked_at is null and not exists(select 1 from public.recordings r where r.id=new.recording_id
    and r.visibility in ('selected','project') and r.project_id is not distinct from new.scope_project_id) then
    raise exception 'grant scope mismatch' using errcode='23514'; end if;
  return new;
end;
$$;

-- Build one own-team projection under the same transaction lock as grant and organization changes.
create function public.team_workspace_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_role text; v_people jsonb; v_scopes jsonb; v_invites jsonb;
begin
  perform public.recording_sharing_lock_v1();
  v_role:=public.team_authority_v1();
  if v_role is null then raise exception 'team access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('scopeKind',s.scope_kind,'scopeId',s.scope_id,'label',s.label,'projectId',s.project_id) order by s.scope_kind,s.label,s.scope_id,s.project_id),'[]') into v_scopes from vosio_team_private.scopes() s;
  with paths as (
    select m.user_id,s.scope_kind,s.scope_id,s.label,s.project_id,m.role from vosio_team_private.scopes() s join public.recording_project_members m on s.scope_kind='project' and s.scope_id=m.project_id and m.revoked_at is null
    union all
    select g.user_id,s.scope_kind,s.scope_id,s.label,s.project_id,g.role from vosio_team_private.scopes() s join public.recording_access_grants g on s.scope_kind='recording' and s.scope_id=g.recording_id and g.revoked_at is null
    union all
    select g.user_id,s.scope_kind,s.scope_id,s.label,s.project_id,g.role from vosio_team_private.scopes() s join vosio_team_private.scope_grants g on g.grantor_id=auth.uid() and g.scope_kind=s.scope_kind and coalesce(g.client_id,g.folder_id)=s.scope_id and g.project_id is not distinct from s.project_id and g.revoked_at is null
  ), people as (
    select distinct user_id from paths
    union select c.user_id from vosio_team_private.contacts c where c.owner_id=auth.uid() and v_role='installation_admin'
    union select i.accepted_by from public.recording_invitations i where i.accepted_by is not null and i.revoked_at is null and public.recording_invitation_manager_v1(i.id,auth.uid())
      and (v_role='installation_admin' or exists(select 1 from public.recording_projects p where p.id=i.project_id and p.user_id=auth.uid()))
  )
  select coalesce(jsonb_agg(jsonb_build_object('userId',u.id,'email',u.email,'accesses',coalesce((select jsonb_agg(jsonb_build_object('scopeKind',x.scope_kind,'scopeId',x.scope_id,'label',x.label,'projectId',x.project_id,'role',x.role) order by x.scope_kind,x.label,x.scope_id,x.project_id) from paths x where x.user_id=u.id),'[]')) order by u.email,u.id),'[]')
    into v_people from people pp join auth.users u on u.id=pp.user_id where u.id<>auth.uid() and u.email_confirmed_at is not null;
  select coalesce(jsonb_agg(public.recording_invitation_summary_v1(i.id)||jsonb_build_object('projectId',i.project_id) order by i.created_at,i.id),'[]') into v_invites
    from public.recording_invitations i where i.accepted_at is null and i.revoked_at is null and public.recording_invitation_manager_v1(i.id,auth.uid())
      and (v_role='installation_admin' or exists(select 1 from public.recording_projects p where p.id=i.project_id and p.user_id=auth.uid()));
  return jsonb_build_object('role',v_role,'people',v_people,'invitations',v_invites,'scopes',v_scopes);
end;
$$;

-- One exact target is authorized before contact lookup, preventing arbitrary user-ID directory probes.
create function public.set_team_access_v1(p_scope_kind text,p_scope_id uuid,p_project_id uuid,p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
declare v_workspace jsonb; v_record public.recordings; v_recipients jsonb;
begin
  perform public.recording_sharing_lock_v1();
  if p_role is null or p_role not in ('reader','editor') then raise exception 'invalid role' using errcode='22023'; end if;
  if not exists(select 1 from vosio_team_private.scopes() s where s.scope_kind=p_scope_kind and s.scope_id=p_scope_id and s.project_id is not distinct from p_project_id) then raise exception 'team access denied' using errcode='42501'; end if;
  v_workspace:=public.team_workspace_v1();
  if p_user_id=auth.uid() or not exists(select 1 from jsonb_array_elements(v_workspace->'people') p where p->>'userId'=p_user_id::text) then raise exception 'team recipient unavailable' using errcode='42501'; end if;
  if p_scope_kind='project' then
    insert into public.recording_project_members(project_id,user_id,role) values(p_scope_id,p_user_id,p_role)
      on conflict(project_id,user_id) do update set role=excluded.role,revoked_at=null;
  elsif p_scope_kind='recording' then
    select * into v_record from public.recordings where id=p_scope_id for update;
    if v_record.visibility='project' then
      insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id) values(p_scope_id,p_user_id,p_role,v_record.project_id)
        on conflict(recording_id,user_id) where revoked_at is null do update set role=excluded.role;
    else
      select coalesce(jsonb_agg(jsonb_build_object('userId',g.user_id,'role',g.role) order by g.user_id),'[]') into v_recipients
        from public.recording_access_grants g where g.recording_id=p_scope_id and g.revoked_at is null and g.user_id<>p_user_id;
      perform public.share_recording_v1(p_scope_id,'selected',v_recipients||jsonb_build_array(jsonb_build_object('userId',p_user_id,'role',p_role)));
    end if;
  else
    update vosio_team_private.scope_grants set revoked_at=now() where grantor_id=auth.uid() and user_id=p_user_id and scope_kind=p_scope_kind and coalesce(client_id,folder_id)=p_scope_id and project_id is not distinct from p_project_id and revoked_at is null;
    insert into vosio_team_private.scope_grants(grantor_id,user_id,scope_kind,client_id,folder_id,project_id,role)
      values(auth.uid(),p_user_id,p_scope_kind,case when p_scope_kind='client' then p_scope_id end,case when p_scope_kind='folder' then p_scope_id end,p_project_id,p_role);
  end if;
  insert into vosio_team_private.contacts(owner_id,user_id) values(auth.uid(),p_user_id) on conflict do nothing;
  insert into public.recording_sharing_audit(actor_id,action,project_id,recording_id,subject_id) values(auth.uid(),'grant',p_project_id,case when p_scope_kind='recording' then p_scope_id end,p_user_id);
end;
$$;

-- Revoke one path while preserving independent project, recording, client and folder grants.
create function public.revoke_team_access_v1(p_scope_kind text,p_scope_id uuid,p_project_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.recording_sharing_lock_v1();
  if not exists(select 1 from vosio_team_private.scopes() s where s.scope_kind=p_scope_kind and s.scope_id=p_scope_id and s.project_id is not distinct from p_project_id) then raise exception 'team access denied' using errcode='42501'; end if;
  if p_scope_kind='project' then
    update public.recording_project_members set revoked_at=now() where project_id=p_scope_id and user_id=p_user_id and revoked_at is null;
  elsif p_scope_kind='recording' then
    perform public.revoke_recording_grant_v1(p_scope_id,p_user_id);
  else
    update vosio_team_private.scope_grants set revoked_at=now() where grantor_id=auth.uid() and user_id=p_user_id and scope_kind=p_scope_kind and coalesce(client_id,folder_id)=p_scope_id and project_id is not distinct from p_project_id and revoked_at is null;
  end if;
  insert into public.recording_sharing_audit(actor_id,action,project_id,recording_id,subject_id) values(auth.uid(),'revoke_grant',p_project_id,case when p_scope_kind='recording' then p_scope_id end,p_user_id);
end;
$$;

revoke all on all functions in schema vosio_team_private from public,anon,authenticated,service_role;
revoke all on function public.team_authority_v1(),public.team_workspace_v1(),public.set_team_access_v1(text,uuid,uuid,uuid,text),public.revoke_team_access_v1(text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.team_authority_v1(),public.team_workspace_v1(),public.set_team_access_v1(text,uuid,uuid,uuid,text),public.revoke_team_access_v1(text,uuid,uuid,uuid) to authenticated;
commit;
