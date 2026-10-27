-- A stale confirmation is a terminal HTTP conflict, never a retryable serialization failure.
begin;

do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Preserve the authorization, sharing lock, exact recipients and atomic write contract.
create or replace function public.assign_recording_organization_v2(p_recording_id uuid,p_client_id uuid,p_project_id uuid,p_folder_id uuid,p_tag_ids uuid[],p_expected_fingerprint text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_preview jsonb; r public.recordings;
begin
  v_preview:=public.preview_recording_organization_v1(p_recording_id,p_client_id,p_project_id,p_folder_id,p_tag_ids);
  if p_expected_fingerprint is null or p_expected_fingerprint is distinct from v_preview->>'fingerprint' then
    raise exception 'organization preview stale' using errcode='PT409'; end if;
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

commit;
