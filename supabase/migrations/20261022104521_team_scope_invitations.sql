-- SOURCE ONLY: existing token/delivery/verified-recipient protocol, with explicit dynamic scope targets.
begin;
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
end; $owner$;
alter table public.recording_invitations drop constraint recording_invitations_scope_check,
  add column team_client_id uuid references public.recording_clients(id) on delete cascade,
  add column team_folder_id uuid references public.recording_folders(id) on delete cascade,
  add constraint recording_invitations_scope_check check(scope in ('project','recordings','client','folder')),
  add constraint recording_invitations_team_scope_check check(
    (scope='client' and team_client_id is not null and team_folder_id is null and recording_item_count=0)
    or (scope='folder' and team_folder_id is not null and team_client_id is null and recording_item_count=0)
    or (scope in ('project','recordings') and team_client_id is null and team_folder_id is null));
create index recording_invitations_team_client_idx on public.recording_invitations(team_client_id) where team_client_id is not null;
create index recording_invitations_team_folder_idx on public.recording_invitations(team_folder_id) where team_folder_id is not null;

-- The invitation issuer's current object authority is checked again when a recipient redeems the token.
create function vosio_team_private.scope_authorized(p_actor uuid,p_kind text,p_scope uuid,p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_actor is not null and (
    (p_project is null and vosio_team_private.is_administrator(p_actor))
    or (p_project is not null and exists(select 1 from public.recording_projects p where p.id=p_project and p.user_id=p_actor)))
  and ((p_kind='client' and exists(select 1 from public.recording_clients c where c.id=p_scope and c.user_id=p_actor))
    or (p_kind='folder' and exists(select 1 from public.recording_folders f where f.id=p_scope and f.user_id=p_actor)));
$$;
revoke all on function vosio_team_private.scope_authorized(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;

-- Preflight consumes no invitation/recipient budget until the current Team scope is authorized.
create function public.assert_team_invitation_scope_v1(p_scope_kind text,p_scope_id uuid,p_project_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.recording_sharing_lock_v1();
  if public.team_authority_v1() is null or not vosio_team_private.scope_authorized(auth.uid(),p_scope_kind,p_scope_id,p_project_id) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
end;
$$;

-- Explicit revoke also cancels matching pending invitation paths, so they cannot restore the removed path.
create or replace function public.revoke_team_access_v1(p_scope_kind text,p_scope_id uuid,p_project_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.recording_sharing_lock_v1();
  if not exists(select 1 from vosio_team_private.scopes() s where s.scope_kind=p_scope_kind and s.scope_id=p_scope_id and s.project_id is not distinct from p_project_id) then raise exception 'team access denied' using errcode='42501'; end if;
  if p_scope_kind='project' then
    update public.recording_project_members set revoked_at=now() where project_id=p_scope_id and user_id=p_user_id and revoked_at is null;
    update public.recording_invitations set revoked_at=now() where scope='project' and project_id=p_scope_id and accepted_at is null and revoked_at is null and email=(select lower(email) from auth.users where id=p_user_id);
  elsif p_scope_kind='recording' then
    perform public.revoke_recording_grant_v1(p_scope_id,p_user_id);
  else
    update vosio_team_private.scope_grants set revoked_at=now() where grantor_id=auth.uid() and user_id=p_user_id and scope_kind=p_scope_kind and coalesce(client_id,folder_id)=p_scope_id and project_id is not distinct from p_project_id and revoked_at is null;
    update public.recording_invitations set revoked_at=now() where scope=p_scope_kind and coalesce(team_client_id,team_folder_id)=p_scope_id and project_id is not distinct from p_project_id and accepted_at is null and revoked_at is null and email=(select lower(email) from auth.users where id=p_user_id) and public.recording_invitation_manager_v1(id,auth.uid());
  end if;
  insert into public.recording_sharing_audit(actor_id,action,project_id,recording_id,subject_id) values(auth.uid(),'revoke_grant',p_project_id,case when p_scope_kind='recording' then p_scope_id end,p_user_id);
end;
$$;

-- Extend the existing manager helper rather than authorizing through a service-role client.
create or replace function public.recording_invitation_manager_v1(p_invitation_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(p_user_id is not null and (select case
    when i.scope in ('client','folder') then vosio_team_private.scope_authorized(p_user_id,i.scope,coalesce(i.team_client_id,i.team_folder_id),i.project_id)
    else (i.project_id is not null and exists(select 1 from public.recording_projects p where p.id=i.project_id and p.user_id=p_user_id))
      or (i.project_id is null and i.scope='recordings' and exists(select 1 from public.recording_invitation_items x where x.invitation_id=i.id)
        and i.recording_item_count=(select count(*) from public.recording_invitation_items x where x.invitation_id=i.id)
        and not exists(select 1 from public.recording_invitation_items x join public.recordings r on r.id=x.recording_id where x.invitation_id=i.id and (r.project_id is not null or r.user_id<>p_user_id)))
    end from public.recording_invitations i where i.id=p_invitation_id),false);
$$;

-- Keep the original RPC unambiguous for PostgREST while sharing its existing invitation/token tables.
create function public.create_team_scope_invitation_v1(p_token_hash text,p_email text,p_role text,p_scope text,p_project_id uuid,p_recording_ids uuid[],p_expires_at timestamptz,p_scope_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  perform public.assert_team_invitation_scope_v1(p_scope,p_scope_id,p_project_id);
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_email is null or length(btrim(p_email)) not between 3 and 254
    or position('@' in p_email)<2 or p_role is null or p_role not in ('reader','editor') or p_scope not in ('client','folder')
    or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '30 days'
    or p_recording_ids is null or cardinality(p_recording_ids)<>0 then raise exception 'invalid invitation' using errcode='22023'; end if;
  insert into public.recording_invitations(token_hash,email,role,scope,project_id,team_client_id,team_folder_id,expires_at,created_by,authorized_by)
    values(p_token_hash,lower(btrim(p_email)),p_role,p_scope,p_project_id,case when p_scope='client' then p_scope_id end,case when p_scope='folder' then p_scope_id end,p_expires_at,auth.uid(),auth.uid()) returning id into v_id;
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'invite',p_project_id,v_id);
  return v_id;
end;
$$;

-- Target identity is safe manager metadata; no tokens, hashes or content cross this projection.
create or replace function public.recording_invitation_summary_v1(p_invitation_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'scope',i.scope,'scopeId',coalesce(i.team_client_id,i.team_folder_id),'projectId',i.project_id,'expiresAt',i.expires_at,
    'acceptedAt',i.accepted_at,'revokedAt',i.revoked_at,'attemptId',i.delivery_attempt_id,'attemptCount',i.delivery_attempt_count,'deliveryState',i.delivery_state,
    'lastAttemptAt',i.last_delivery_attempt_at,'nextAttemptAt',i.last_delivery_attempt_at+interval '60 seconds',
    'authorizationCurrent',public.recording_invitation_manager_v1(i.id,coalesce(i.authorized_by,i.created_by))) from public.recording_invitations i where i.id=p_invitation_id;
$$;

create or replace function public.accept_recording_invitation_v1(p_token_hash text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_invite public.recording_invitations%rowtype; v_email text; v_item record; v_processed integer:=0;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select * into v_invite from public.recording_invitations where token_hash=p_token_hash for update;
  if not found or v_invite.email is distinct from v_email or v_invite.revoked_at is not null
    or (v_invite.accepted_at is null and v_invite.expires_at<=clock_timestamp()) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
  if not public.recording_invitation_manager_v1(v_invite.id,coalesce(v_invite.authorized_by,v_invite.created_by)) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
  if v_invite.accepted_at is not null then
    if v_invite.accepted_by<>auth.uid() then raise exception 'invitation unavailable' using errcode='42501'; end if;
    -- A replay returns a receipt, never reinstates revoked access.
    return v_invite.id;
  end if;
  if v_invite.scope in ('client','folder') then
    if not public.mcp_auth_session_active_v1() or v_invite.created_by=auth.uid() then
      raise exception 'invitation unavailable' using errcode='42501'; end if;
    -- A pending invite grants nothing; acceptance publishes exactly one dynamic, project-fenced scope.
    update vosio_team_private.scope_grants set revoked_at=now() where grantor_id=coalesce(v_invite.authorized_by,v_invite.created_by)
      and user_id=auth.uid() and scope_kind=v_invite.scope and coalesce(client_id,folder_id)=coalesce(v_invite.team_client_id,v_invite.team_folder_id)
      and project_id is not distinct from v_invite.project_id and revoked_at is null;
    insert into vosio_team_private.scope_grants(grantor_id,user_id,scope_kind,client_id,folder_id,project_id,role)
      values(coalesce(v_invite.authorized_by,v_invite.created_by),auth.uid(),v_invite.scope,v_invite.team_client_id,v_invite.team_folder_id,v_invite.project_id,v_invite.role);
    insert into vosio_team_private.contacts(owner_id,user_id) values(coalesce(v_invite.authorized_by,v_invite.created_by),auth.uid()) on conflict do nothing;
  elsif v_invite.scope='project' then
    insert into public.recording_project_members(project_id,user_id,role)
    values(v_invite.project_id,auth.uid(),v_invite.role)
    on conflict(project_id,user_id) do update set role=excluded.role,revoked_at=null;
  else
    if not exists(select 1 from public.recording_invitation_items where invitation_id=v_invite.id) then
      raise exception 'invitation unavailable' using errcode='42501'; end if;
    for v_item in select r.* from public.recording_invitation_items x join public.recordings r on r.id=x.recording_id
      where x.invitation_id=v_invite.id order by r.id for update of r loop
      v_processed:=v_processed+1;
      if (v_item.visibility<>'selected' and not (v_invite.project_id is null and v_item.project_id is null and v_item.visibility='private'))
        or v_item.status='deleted' or v_item.project_id is distinct from v_invite.project_id
        or (v_item.project_id is null and v_item.user_id<>coalesce(v_invite.authorized_by,v_invite.created_by)) then
        raise exception 'invitation unavailable' using errcode='42501'; end if;
      if v_item.visibility='private' then
        update public.recordings set visibility='selected' where id=v_item.id;
      end if;
      insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id)
      values(v_item.id,auth.uid(),v_invite.role,v_invite.project_id)
      on conflict(recording_id,user_id) where revoked_at is null do update set role=excluded.role;
    end loop;
    -- A concurrent privileged purge must not shrink the set while row locks are acquired.
    if v_invite.project_id is null and v_processed<>v_invite.recording_item_count then
      raise exception 'invitation unavailable' using errcode='42501'; end if;
  end if;
  if v_invite.expires_at<=clock_timestamp() then raise exception 'invitation unavailable' using errcode='42501'; end if;
  update public.recording_invitations set accepted_at=now(),accepted_by=auth.uid() where id=v_invite.id;
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'accept',v_invite.project_id,v_invite.id);
  return v_invite.id;
end;
$$;


revoke all on function public.assert_team_invitation_scope_v1(text,uuid,uuid),public.create_team_scope_invitation_v1(text,text,text,text,uuid,uuid[],timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assert_team_invitation_scope_v1(text,uuid,uuid),public.create_team_scope_invitation_v1(text,text,text,text,uuid,uuid[],timestamptz,uuid) to authenticated;
commit;
