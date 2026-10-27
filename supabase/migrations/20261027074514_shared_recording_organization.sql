-- Local candidate only. Apply before the application adopts organization v2.
begin;

do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Resolve edit authority and redact the author's personal taxonomy for another founder.
create function public.recording_organization_context_v1(p_recording_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.recordings; v_personal boolean;
begin
  perform public.recording_sharing_lock_v1();
  select * into r from public.recordings where id=p_recording_id for update;
  if auth.uid() is null or r.id is null or r.status='deleted' or not public.can_manage_recording(r.id) then
    raise exception 'organization denied' using errcode='42501'; end if;
  v_personal := r.user_id=auth.uid();
  return jsonb_build_object('id',r.id,'visibility',r.visibility,
    'client_id',case when v_personal then r.client_id end,'project_id',r.project_id,
    'folder_id',case when v_personal then r.folder_id end,
    'tag_ids',case when v_personal then (select coalesce(jsonb_agg(t.tag_id order by t.tag_id),'[]') from public.recording_tag_links t where t.recording_id=r.id) else '[]'::jsonb end,
    'organization_policy',jsonb_build_object('personalEditable',v_personal,
      'projectIds',(select coalesce(jsonb_agg(p.id order by p.id),'[]') from public.recording_projects p
        where (r.visibility='private' and v_personal and public.can_capture_in_recording_project(p.id))
          or (r.visibility<>'private' and p.user_id=auth.uid()))));
end;
$$;

-- Build effective access paths with the same dynamic founder/administrator fences as scope_role.
create function vosio_team_private.organization_paths(p_recording_id uuid,p_client_id uuid,p_project_id uuid,p_folder_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(x.path order by x.path::text),'[]') from (
    select jsonb_build_object('id',g.id,'userId',g.user_id,'label',u.email,'role',g.role,'kind',g.scope_kind) path
    from public.recordings r join vosio_team_private.scope_grants g on g.revoked_at is null
      and ((g.scope_kind='client' and g.client_id=p_client_id) or (g.scope_kind='folder' and g.folder_id=p_folder_id))
      join auth.users u on u.id=g.user_id
    where r.id=p_recording_id and r.visibility<>'private'
      and (g.project_id is null or g.project_id=p_project_id)
      and ((g.project_id is null and vosio_team_private.is_administrator(g.grantor_id)
        and ((p_project_id is null and r.user_id=g.grantor_id)
          or exists(select 1 from public.recording_projects p where p.id=p_project_id and p.user_id=g.grantor_id)))
        or (g.project_id is not null and exists(select 1 from public.recording_projects p where p.id=g.project_id and p.user_id=g.grantor_id)))
      and ((g.scope_kind='client' and exists(select 1 from public.recording_clients c where c.id=g.client_id and c.user_id=g.grantor_id))
        or (g.scope_kind='folder' and exists(select 1 from public.recording_folders f where f.id=g.folder_id and f.user_id=g.grantor_id)))
    union all
    select jsonb_build_object('id',m.user_id,'userId',m.user_id,'label',u.email,'role',m.role,'kind','project')
    from public.recordings r join public.recording_project_members m on m.project_id=p_project_id and m.revoked_at is null
      join auth.users u on u.id=m.user_id where r.id=p_recording_id and r.visibility='project'
  ) x;
$$;

-- Pending is future scope only, never an active access path; expose it before joining that scope.
create function vosio_team_private.organization_pending(p_recording_id uuid,p_client_id uuid,p_project_id uuid,p_folder_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',i.email,'role',i.role,'kind',i.scope) order by i.id),'[]')
  from public.recordings r join public.recording_invitations i on i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
  where r.id=p_recording_id and r.visibility<>'private' and (
    (i.scope='recordings' and i.project_id is not distinct from p_project_id
      and exists(select 1 from public.recording_invitation_items x where x.invitation_id=i.id and x.recording_id=r.id))
    or (i.scope='project' and r.visibility='project' and i.project_id=p_project_id)
    or (i.scope in ('client','folder') and (i.project_id is null or i.project_id=p_project_id)
      and ((i.scope='client' and i.team_client_id=p_client_id) or (i.scope='folder' and i.team_folder_id=p_folder_id))
      and vosio_team_private.scope_authorized(coalesce(i.authorized_by,i.created_by),i.scope,coalesce(i.team_client_id,i.team_folder_id),i.project_id)
      and ((p_project_id is null and r.user_id=coalesce(i.authorized_by,i.created_by))
        or exists(select 1 from public.recording_projects p where p.id=p_project_id and p.user_id=coalesce(i.authorized_by,i.created_by)))));
$$;

-- Preview is also the locked save preflight; fingerprints bind assignment, exact grants and all effective paths.
create function public.preview_recording_organization_v1(p_recording_id uuid,p_client_id uuid,p_project_id uuid,p_folder_id uuid,p_tag_ids uuid[] default '{}')
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r public.recordings; v_context jsonb; v_before jsonb; v_after jsonb; v_exact jsonb; v_tags uuid[]; v_snapshot jsonb; v_pending_before jsonb; v_pending_after jsonb;
begin
  v_context:=public.recording_organization_context_v1(p_recording_id);
  select * into r from public.recordings where id=p_recording_id;
  if r.user_id<>auth.uid() then
    if p_client_id is not null or p_folder_id is not null or cardinality(coalesce(p_tag_ids,'{}'))>0 then
      raise exception 'personal organization denied' using errcode='42501'; end if;
  elsif (p_client_id is not null and not exists(select 1 from public.recording_clients where id=p_client_id and user_id=auth.uid()))
    or (p_folder_id is not null and not exists(select 1 from public.recording_folders where id=p_folder_id and user_id=auth.uid()))
    or exists(select 1 from unnest(coalesce(p_tag_ids,'{}')) t where t is null or not exists(select 1 from public.recording_tags where id=t and user_id=auth.uid())) then
    raise exception 'organization denied' using errcode='42501';
  end if;
  if p_project_id is not null and not exists(select 1 from jsonb_array_elements_text(v_context#>'{organization_policy,projectIds}') x where x::uuid=p_project_id) then
    raise exception 'organization custody transfer denied' using errcode='42501'; end if;
  if r.project_id is distinct from p_project_id then
    if (r.visibility='project' and p_project_id is null) or (r.visibility<>'private' and r.user_id<>auth.uid() and p_project_id is null) then
      raise exception 'organization custody transfer denied' using errcode='42501'; end if;
    if exists(select 1 from public.recording_invitations i where i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
      and (i.project_id=r.project_id or i.project_id=p_project_id
        or exists(select 1 from public.recording_invitation_items x where x.invitation_id=i.id and x.recording_id=r.id))) then
      raise exception 'organization pending invitation' using errcode='55000'; end if;
    if exists(select 1 from public.recording_transcription_operations o where o.recording_id=r.id and o.phase in ('prepared','started','accepted','uncertain'))
      or exists(select 1 from public.transcription_jobs j where j.recording_id=r.id and j.status in ('queued','running')) then
      raise exception 'organization active transcription' using errcode='55000'; end if;
  end if;
  if r.user_id=auth.uid() and p_project_id is not null and exists(select 1 from public.recording_projects
    where id=p_project_id and user_id=auth.uid() and client_id is distinct from p_client_id) then
    raise exception 'project client mismatch' using errcode='22023'; end if;
  select coalesce(array_agg(distinct t order by t),'{}') into v_tags from unnest(coalesce(p_tag_ids,'{}')) t;
  v_before:=vosio_team_private.organization_paths(r.id,r.client_id,r.project_id,r.folder_id);
  v_after:=vosio_team_private.organization_paths(r.id,case when r.user_id=auth.uid() then p_client_id else r.client_id end,
    p_project_id,case when r.user_id=auth.uid() then p_folder_id else r.folder_id end);
  v_pending_before:=vosio_team_private.organization_pending(r.id,r.client_id,r.project_id,r.folder_id);
  v_pending_after:=vosio_team_private.organization_pending(r.id,case when r.user_id=auth.uid() then p_client_id else r.client_id end,
    p_project_id,case when r.user_id=auth.uid() then p_folder_id else r.folder_id end);
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'userId',g.user_id,'label',u.email,'role',g.role,'scopeProjectId',g.scope_project_id) order by g.id),'[]') into v_exact
    from public.recording_access_grants g join auth.users u on u.id=g.user_id
    where g.recording_id=r.id and g.revoked_at is null;
  -- Inconsistent historical exact scope needs explicit repair, never automatic resurrection.
  if exists(select 1 from public.recording_access_grants g where g.recording_id=r.id and g.revoked_at is null and g.scope_project_id is distinct from r.project_id) then
    raise exception 'organization exact scope mismatch' using errcode='55000'; end if;
  v_snapshot:=jsonb_build_object('current',v_context,'target',jsonb_build_array(p_client_id,p_project_id,p_folder_id,v_tags),
    'before',v_before,'after',v_after,'exact',v_exact,'pendingBefore',v_pending_before,'pendingAfter',v_pending_after);
  return jsonb_build_object('fingerprint',md5(v_snapshot::text),'exactRecipients',v_exact,'pendingInvitations',v_pending_after,
    'addedPaths',(select coalesce(jsonb_agg(x order by x::text),'[]') from jsonb_array_elements(v_after) x where not v_before @> jsonb_build_array(x)),
    'removedPaths',(select coalesce(jsonb_agg(x order by x::text),'[]') from jsonb_array_elements(v_before) x where not v_after @> jsonb_build_array(x)));
end;
$$;

-- Commit only the reviewed impact, retaining visibility, custody and every active exact recipient/role.
create function public.assign_recording_organization_v2(p_recording_id uuid,p_client_id uuid,p_project_id uuid,p_folder_id uuid,p_tag_ids uuid[],p_expected_fingerprint text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_preview jsonb; r public.recordings;
begin
  v_preview:=public.preview_recording_organization_v1(p_recording_id,p_client_id,p_project_id,p_folder_id,p_tag_ids);
  if p_expected_fingerprint is null or p_expected_fingerprint is distinct from v_preview->>'fingerprint' then
    raise exception 'organization preview stale' using errcode='40001'; end if;
  select * into r from public.recordings where id=p_recording_id;
  update public.recordings set client_id=case when r.user_id=auth.uid() then p_client_id else r.client_id end,
    project_id=p_project_id,folder_id=case when r.user_id=auth.uid() then p_folder_id else r.folder_id end where id=r.id;
  update public.recording_access_grants set scope_project_id=p_project_id
    where recording_id=r.id and revoked_at is null and scope_project_id is not distinct from r.project_id;
  if r.user_id=auth.uid() then
    delete from public.recording_tag_links where recording_id=r.id;
    insert into public.recording_tag_links(recording_id,tag_id,user_id) select r.id,t,auth.uid() from (select distinct unnest(coalesce(p_tag_ids,'{}')) t) x;
  end if;
  insert into public.recording_sharing_audit(actor_id,action,recording_id,project_id) values(auth.uid(),'assign',r.id,p_project_id);
  return public.recording_organization_context_v1(r.id);
end;
$$;

-- Existing private callers remain compatible; shared assignments always require reviewed v2 impact.
create or replace function public.assign_recording_organization_v1(p_recording_id uuid,p_client_id uuid,p_project_id uuid,p_folder_id uuid,p_tag_ids uuid[] default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare v_context jsonb; v_preview jsonb;
begin
  v_context:=public.recording_organization_context_v1(p_recording_id);
  if v_context->>'visibility'<>'private' then raise exception 'organization confirmation required' using errcode='42501'; end if;
  v_preview:=public.preview_recording_organization_v1(p_recording_id,p_client_id,p_project_id,p_folder_id,p_tag_ids);
  perform public.assign_recording_organization_v2(p_recording_id,p_client_id,p_project_id,p_folder_id,p_tag_ids,v_preview->>'fingerprint');
end;
$$;

revoke all on function vosio_team_private.organization_paths(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function vosio_team_private.organization_pending(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.recording_organization_context_v1(uuid),public.preview_recording_organization_v1(uuid,uuid,uuid,uuid,uuid[]),public.assign_recording_organization_v2(uuid,uuid,uuid,uuid,uuid[],text) from public,anon,service_role;
grant execute on function public.recording_organization_context_v1(uuid),public.preview_recording_organization_v1(uuid,uuid,uuid,uuid,uuid[]),public.assign_recording_organization_v2(uuid,uuid,uuid,uuid,uuid[],text) to authenticated;
commit;
