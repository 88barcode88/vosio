begin;
-- New SECURITY DEFINER contracts must retain the reviewed privileged, non-API owner.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Offer only the current editor's unconsumed founder-approved captures, never another author's reservations.
create function public.list_selected_recording_capture_authorizations_v1(p_project_id uuid)
returns table(request_id uuid, recipients jsonb, expires_at timestamptz, recipient_labels jsonb)
language sql stable security definer set search_path = '' as $$
  select a.request_id,a.recipients,a.expires_at,
    (select coalesce(jsonb_agg(u.email::text order by u.id),'[]'::jsonb)
      from jsonb_array_elements(a.recipients) x join auth.users u on u.id=(x->>'userId')::uuid)
  from public.recording_selected_capture_authorizations a
  join public.recording_projects p on p.id=a.project_id
  where auth.uid() is not null and a.project_id=p_project_id
    and a.capture_author=auth.uid() and a.created_by=p.user_id
    and a.revoked_at is null and a.recording_id is null and a.expires_at>now()
    and public.can_capture_in_recording_project(a.project_id)
  order by a.created_at,a.request_id limit 100;
$$;
revoke all on function public.list_selected_recording_capture_authorizations_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_selected_recording_capture_authorizations_v1(uuid) to authenticated;

-- Apply authority before the bound and return only recovery metadata, not transcript content or locators.
create function public.list_recoverable_recording_captures_v1()
returns table(id uuid,title text,created_at timestamptz,duration_seconds integer,
  "captureRevision" bigint,transcript_chars integer,storage_bytes bigint,phase text,"canRecover" boolean)
language sql stable security definer set search_path = '' as $$
  select r.id,r.title,r.created_at,r.duration_seconds,r.capture_revision,
    coalesce(t.chars,0),coalesce(r.file_size_bytes,0),o.phase,
    r.source_type in ('in_app_recording','realtime') and coalesce(o.phase,'') not in ('prepared','started','accepted','manual_required')
  from public.recordings r
  left join lateral (select length(raw_text) chars from public.transcripts where recording_id=r.id
    order by created_at desc,id desc limit 1) t on true
  left join lateral public.get_managed_recording_transcription_v1(array[r.id]) o on true
  where auth.uid() is not null and r.status in ('created','uploading','failed','transcribing')
    and (public.has_recording_capture_authority_v1(r.id) or public.can_manage_recording(r.id))
    and (coalesce(t.chars,0)>0 or coalesce(r.file_size_bytes,0)>0 or o.operation_id is not null)
  order by r.created_at desc,r.id desc limit 100;
$$;
revoke all on function public.list_recoverable_recording_captures_v1() from public,anon,authenticated,service_role;
grant execute on function public.list_recoverable_recording_captures_v1() to authenticated;

commit;
