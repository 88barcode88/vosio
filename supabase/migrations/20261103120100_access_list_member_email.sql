-- Access management shows the e-mail of listed members and grantees instead of a bare user id.
-- Callers are unchanged: only a project founder or the recording manager can run this RPC, and the e-mails belong
-- exclusively to users that caller has already invited or listed in the same scope.
begin;

-- list_recording_access_v1: same authorization and rows as before, plus the nullable e-mail of each member and grant.
create or replace function public.list_recording_access_v1(p_project_id uuid default null,p_recording_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $access$
declare v_members jsonb:='[]'; v_grants jsonb; v_invites jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_project_id is null)=(p_recording_id is null) then raise exception 'exactly one access scope required' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  if p_project_id is not null then
    if not public.is_recording_project_founder_v1(p_project_id) then raise exception 'access denied' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'email',u.email,'role',m.role) order by m.user_id),'[]')
      into v_members from public.recording_project_members m left join auth.users u on u.id=m.user_id
      where m.project_id=p_project_id and m.revoked_at is null;
  elsif not public.can_manage_recording(p_recording_id) then raise exception 'access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('recordingId',g.recording_id,'userId',g.user_id,'email',u.email,'role',g.role) order by g.recording_id,g.user_id),'[]')
    into v_grants from public.recording_access_grants g left join auth.users u on u.id=g.user_id where g.revoked_at is null
      and ((p_project_id is not null and g.scope_project_id=p_project_id) or (p_recording_id is not null and g.recording_id=p_recording_id));
  select coalesce(jsonb_agg(public.recording_invitation_summary_v1(i.id) order by i.created_at,i.id),'[]')
    into v_invites from public.recording_invitations i where i.revoked_at is null and i.accepted_at is null
      and public.recording_invitation_manager_v1(i.id,auth.uid())
      and ((p_project_id is not null and i.project_id=p_project_id) or (p_recording_id is not null and exists(
        select 1 from public.recording_invitation_items x where x.invitation_id=i.id and x.recording_id=p_recording_id)));
  return jsonb_build_object('members',v_members,'grants',v_grants,'invitations',v_invites);
end;
$access$;

commit;
