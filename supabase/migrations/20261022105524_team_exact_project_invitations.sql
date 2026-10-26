-- SOURCE ONLY: exact invitations add a grant without replacing existing project membership.
begin;
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Existing verified-recipient/founder protocol; exact nonprivate visibility may retain project members.
create or replace function public.create_recording_invitation_v1(
  p_token_hash text,p_email text,p_role text,p_scope text,p_project_id uuid,
  p_recording_ids uuid[],p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_record public.recordings%rowtype; v_recording_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_email is null or length(btrim(p_email)) not between 3 and 254
    or position('@' in p_email)<2 or p_role is null or p_role not in ('reader','editor')
    or p_scope is null or p_scope not in ('project','recordings') or p_expires_at is null
    or p_expires_at<=now() or p_expires_at>now()+interval '30 days' or p_recording_ids is null then
    raise exception 'invalid invitation' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  if p_project_id is not null then
    perform 1 from public.recording_projects where id=p_project_id and user_id=auth.uid() for update;
    if not found then raise exception 'invite denied' using errcode='42501'; end if;
  end if;
  if p_scope='project' then
    if p_project_id is null or cardinality(p_recording_ids)<>0 then raise exception 'invalid project invitation' using errcode='22023'; end if;
  else
    if cardinality(p_recording_ids) not between 1 and 100
      or cardinality(p_recording_ids)<>(select count(distinct x) from unnest(p_recording_ids) x) then
      raise exception 'invalid invitation items' using errcode='22023'; end if;
    for v_recording_id in select x from unnest(p_recording_ids) x order by x loop
      select * into v_record from public.recordings where id=v_recording_id for update;
      if not found or v_record.status='deleted'
        or (v_record.visibility not in ('selected','project') and not (v_record.project_id is null and v_record.visibility='private'))
        or v_record.project_id is distinct from p_project_id or not public.can_manage_recording(v_recording_id) then
        raise exception 'invite denied' using errcode='42501'; end if;
    end loop;
  end if;
  insert into public.recording_invitations(token_hash,email,role,scope,project_id,recording_item_count,expires_at,created_by,authorized_by)
    values(p_token_hash,lower(btrim(p_email)),p_role,p_scope,p_project_id,cardinality(p_recording_ids),p_expires_at,auth.uid(),auth.uid()) returning id into v_id;
  insert into public.recording_invitation_items(invitation_id,recording_id) select v_id,x from unnest(p_recording_ids) x;
  if not public.recording_invitation_manager_v1(v_id,auth.uid()) then raise exception 'invite denied' using errcode='42501'; end if;
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'invite',p_project_id,v_id);
  return v_id;
end;
$$;

-- Existing verified-recipient/founder protocol; exact nonprivate visibility may retain project members.
create or replace function public.preview_recording_invitation_v1(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_invite public.recording_invitations%rowtype; v_email text; v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select * into v_invite from public.recording_invitations where token_hash=p_token_hash;
  if not found or v_invite.email is distinct from v_email or v_invite.accepted_at is not null
    or v_invite.revoked_at is not null or v_invite.expires_at<=clock_timestamp()
    or not public.recording_invitation_manager_v1(v_invite.id,coalesce(v_invite.authorized_by,v_invite.created_by)) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
  select count(*)::integer into v_count from public.recording_invitation_items where invitation_id=v_invite.id;
  if v_invite.scope='recordings' and (v_count=0 or exists(select 1 from public.recording_invitation_items x
    join public.recordings r on r.id=x.recording_id where x.invitation_id=v_invite.id
      and ((r.visibility not in ('selected','project') and not (v_invite.project_id is null and r.project_id is null and r.visibility='private'))
        or r.status='deleted' or r.project_id is distinct from v_invite.project_id))) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
  return jsonb_build_object('id',v_invite.id,'role',v_invite.role,'scope',v_invite.scope,
    'expiresAt',v_invite.expires_at,'recordingCount',v_count);
end;
$$;

-- Existing verified-recipient/founder protocol; exact nonprivate visibility may retain project members.
create or replace function public.resend_recording_invitation_v1(p_invitation_id uuid,p_token_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_invite public.recording_invitations%rowtype; v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_invite from public.recording_invitations where id=p_invitation_id for update;
  if not found or not public.recording_invitation_manager_v1(v_invite.id,auth.uid()) then raise exception 'access denied' using errcode='42501'; end if;
  if v_invite.accepted_at is not null or v_invite.revoked_at is not null then raise exception 'invitation unavailable' using errcode='42501'; end if;
  v_now:=clock_timestamp();
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_token_hash=v_invite.token_hash
    or p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '30 days' then
    raise exception 'invalid resend' using errcode='22023'; end if;
  if v_invite.delivery_attempt_count>=5 or v_now<v_invite.last_delivery_attempt_at+interval '60 seconds' then
    raise exception 'invitation delivery limit reached' using errcode='55000'; end if;
  if v_invite.scope='recordings' and (not exists(select 1 from public.recording_invitation_items where invitation_id=v_invite.id)
    or exists(select 1 from public.recording_invitation_items x join public.recordings r on r.id=x.recording_id
      where x.invitation_id=v_invite.id and ((r.visibility not in ('selected','project') and not (v_invite.project_id is null and r.project_id is null and r.visibility='private'))
        or r.status='deleted' or r.project_id is distinct from v_invite.project_id))) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
  update public.recording_invitations set token_hash=p_token_hash,expires_at=p_expires_at,authorized_by=auth.uid(),
    delivery_attempt_count=delivery_attempt_count+1,delivery_attempt_id=gen_random_uuid(),last_delivery_attempt_at=v_now,delivery_state='pending'
    where id=v_invite.id;
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'resend_invite',v_invite.project_id,v_invite.id);
  return public.recording_invitation_summary_v1(v_invite.id);
end;
$$;

-- Existing scoped acceptance and replay semantics, preserving project visibility on exact invitations.
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
      if (v_item.visibility not in ('selected','project') and not (v_invite.project_id is null and v_item.project_id is null and v_item.visibility='private'))
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

commit;
