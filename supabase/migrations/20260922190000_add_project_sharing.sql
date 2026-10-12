-- SOURCE ONLY: requires coordinated server/capture adoption and disposable PG tests before apply.
-- Keep legacy user_id/IDs/paths/cascades intact; created_by is attribution, never authorization.
-- Apply this migration in one transaction (Supabase runner or psql --single-transaction).

alter table public.recording_projects alter column client_id drop not null;
create unique index recording_projects_clientless_name_uidx
  on public.recording_projects(user_id, lower(btrim(name))) where client_id is null;
alter table public.recordings
  drop constraint recordings_project_requires_client_check,
  drop constraint recordings_project_client_user_fk,
  add column visibility text not null default 'private' check (visibility in ('private','project','selected')),
  add column created_by uuid references auth.users(id) on delete no action deferrable initially deferred,
  add column capture_request_id uuid,
  add column capture_request_fingerprint text check (capture_request_fingerprint is null or capture_request_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint recordings_project_fk foreign key (project_id)
    references public.recording_projects(id) on delete set null,
  add constraint recordings_project_visibility_check check (visibility <> 'project' or project_id is not null);
alter table public.recordings disable trigger recordings_set_updated_at;
update public.recordings set created_by = user_id;
-- Drain the backfill's deferred RI events before ALTER TABLE; keep the FK deferrable.
set constraints public.recordings_created_by_fkey immediate;
alter table public.recordings enable trigger recordings_set_updated_at;
alter table public.recordings alter column created_by set not null;
alter table public.recordings alter column created_by set default auth.uid();
set constraints public.recordings_created_by_fkey deferred;
create unique index recordings_capture_request_uidx
  on public.recordings(created_by,capture_request_id) where capture_request_id is not null;
create index recordings_project_visibility_idx on public.recordings(project_id,visibility,created_at desc,id desc);

create table public.recording_project_members (
  project_id uuid not null references public.recording_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('reader','editor')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (project_id,user_id)
);
create index recording_project_members_user_idx on public.recording_project_members(user_id,project_id) where revoked_at is null;

create table public.recording_access_grants (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('reader','editor')),
  scope_project_id uuid references public.recording_projects(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index recording_access_grants_active_uidx on public.recording_access_grants(recording_id,user_id) where revoked_at is null;
create index recording_access_grants_user_idx on public.recording_access_grants(user_id,recording_id) where revoked_at is null;
create index recording_access_grants_project_idx on public.recording_access_grants(scope_project_id,user_id) where revoked_at is null;

create table public.recording_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254 and position('@' in email)>1),
  role text not null check (role in ('reader','editor')),
  scope text not null check (scope in ('project','recordings')),
  recording_item_count integer not null default 0 check (recording_item_count between 0 and 100),
  project_id uuid references public.recording_projects(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_by uuid references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  authorized_by uuid references auth.users(id) on delete set null,
  delivery_attempt_count smallint not null default 1 check (delivery_attempt_count between 1 and 5),
  delivery_attempt_id uuid not null default gen_random_uuid(),
  last_delivery_attempt_at timestamptz not null default clock_timestamp(),
  delivery_state text not null default 'pending' check (delivery_state in ('pending','sent','failed')),
  created_at timestamptz not null default now(),
  check (scope <> 'project' or project_id is not null),
  check ((accepted_by is null) = (accepted_at is null)),
  check (expires_at > created_at)
);
create index recording_invitations_pending_project_idx on public.recording_invitations(project_id,email) where revoked_at is null and accepted_at is null;
create index recording_invitations_creator_idx on public.recording_invitations(created_by);
create index recording_invitations_acceptor_idx on public.recording_invitations(accepted_by);
create index recording_invitations_authorizer_idx on public.recording_invitations(authorized_by);
create table public.recording_invitation_items (
  invitation_id uuid not null references public.recording_invitations(id) on delete cascade,
  recording_id uuid not null references public.recordings(id) on delete cascade,
  primary key (invitation_id,recording_id)
);
create index recording_invitation_items_recording_idx on public.recording_invitation_items(recording_id);

-- Sharing audit has a fixed metadata-free schema: no token/hash/email/content snapshots.
create table public.recording_sharing_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('create','assign','share','grant','revoke_grant','revoke_member','invite','resend_invite','accept','revoke_invite')),
  recording_id uuid,
  project_id uuid,
  subject_id uuid,
  created_at timestamptz not null default now()
);
create index recording_sharing_audit_actor_idx on public.recording_sharing_audit(actor_id);

-- One founder-approved selected set for one author's exact future capture request.
create table public.recording_selected_capture_authorizations (
  project_id uuid not null references public.recording_projects(id) on delete cascade,
  capture_author uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  recipients jsonb not null check (jsonb_typeof(recipients)='array' and jsonb_array_length(recipients) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  recording_id uuid references public.recordings(id) on delete cascade,
  primary key(project_id,capture_author,request_id),
  check(expires_at>created_at)
);
create index recording_selected_capture_author_idx on public.recording_selected_capture_authorizations(capture_author);
create index recording_selected_capture_creator_idx on public.recording_selected_capture_authorizations(created_by);
create index recording_selected_capture_recording_idx on public.recording_selected_capture_authorizations(recording_id);

-- One transaction lock serializes access changes, guarded writes and destructive cascades.
-- Lock order: sharing lock -> project -> recording -> job/transcript -> grants/invitations.
create function public.recording_sharing_lock_v1() returns void
language sql volatile security definer set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(741920,1);
$$;

-- A private helper resolves authority without RLS recursion or caller-supplied actor IDs.
create function public.recording_access_role_v1(p_recording_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when auth.uid() is null then null
    when r.project_id is not null and r.visibility <> 'private' and p.user_id = auth.uid() then 'manager'
    when (r.project_id is null or r.visibility = 'private') and r.user_id = auth.uid() then 'manager'
    when r.status = 'deleted' then null
    when r.visibility = 'project' then (
      select m.role from public.recording_project_members m
      where m.project_id=r.project_id and m.user_id=auth.uid() and m.revoked_at is null)
    when r.visibility = 'selected' then (
      select g.role from public.recording_access_grants g
      where g.recording_id=r.id and g.user_id=auth.uid() and g.revoked_at is null
        and g.scope_project_id is not distinct from r.project_id)
    else null end
  from public.recordings r left join public.recording_projects p on p.id=r.project_id
  where r.id=p_recording_id;
$$;

-- Read permission is shared by table RLS and exact-object Storage authorization.
create function public.can_read_recording(p_recording_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.recording_access_role_v1(p_recording_id) is not null,false);
$$;

-- Editor means title/speaker/task edits only; callers must not infer other permissions.
create function public.can_edit_recording(p_recording_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.recording_access_role_v1(p_recording_id) in ('manager','editor')
    and exists(select 1 from public.recordings where id=p_recording_id and status<>'deleted'),false);
$$;

-- Manager authority uses custody, not technical user_id or authorship.
create function public.can_manage_recording(p_recording_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.recording_access_role_v1(p_recording_id)='manager',false);
$$;

-- Expose capabilities without returning membership, invitation, or unrelated project metadata.
create function public.recording_capabilities_v1(p_recording_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('read',public.can_read_recording(r.id),
    'editTitle',public.can_edit_recording(r.id),'editSpeakers',public.can_edit_recording(r.id),
    'editTaskStatus',public.can_edit_recording(r.id),
    'manageAccess',public.can_manage_recording(r.id) and r.status<>'deleted',
    'delete',public.can_manage_recording(r.id) and r.status<>'deleted',
    'restore',public.can_manage_recording(r.id) and r.status='deleted',
    'purge',public.can_manage_recording(r.id) and r.status='deleted',
    'runPersonalAi',public.can_manage_recording(r.id) and r.user_id=auth.uid() and r.status<>'deleted',
    'usePrivateChat',public.can_manage_recording(r.id) and r.user_id=auth.uid() and r.status<>'deleted')
  from public.recordings r where r.id=p_recording_id and public.can_read_recording(r.id);
$$;

-- Sensitive recording metadata is available only to its personal owner with current read access.
create function public.get_personal_recording_metadata_v1(p_recording_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(r) from public.recordings r
    where r.id=p_recording_id and r.user_id=auth.uid() and public.can_read_recording(r.id);
$$;

-- Project visibility is separate from recording visibility; private content never contributes.
create function public.can_read_recording_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.recording_projects p where p.id=p_project_id
    and (p.user_id=auth.uid() or exists(select 1 from public.recording_project_members m
      where m.project_id=p.id and m.user_id=auth.uid() and m.revoked_at is null)));
$$;

-- Founder checks expose one boolean without revealing the project's personal client metadata.
create function public.is_recording_project_founder_v1(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.recording_projects where id=p_project_id and user_id=auth.uid());
$$;

-- Only the project's personal founder can retrieve its private client association.
create function public.get_personal_recording_project_v1(p_project_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) from public.recording_projects p where p.id=p_project_id and p.user_id=auth.uid();
$$;

-- Capture into a project is limited to the founder and active editors.
create function public.can_capture_in_recording_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.recording_projects p where p.id=p_project_id
    and (p.user_id=auth.uid() or exists(select 1 from public.recording_project_members m
      where m.project_id=p.id and m.user_id=auth.uid() and m.role='editor' and m.revoked_at is null)));
$$;

-- Validate a selected-recipient set once for create/share RPCs, before any durable write.
create function public.validate_recording_recipients_v1(p_visibility text,p_recipients jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_visibility is null or p_visibility not in ('private','project','selected')
    or p_recipients is null or jsonb_typeof(p_recipients)<>'array' then
    raise exception 'invalid sharing input' using errcode='22023';
  end if;
  if jsonb_array_length(p_recipients)>100
    or (p_visibility='selected') is distinct from (jsonb_array_length(p_recipients)>0) then
    raise exception 'invalid recipient count' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_recipients) x
      where jsonb_typeof(x)<>'object' or x->>'userId' is null or x->>'role' is null
        or x->>'role' not in ('reader','editor') or x - 'userId' - 'role' <> '{}'::jsonb)
    or (select count(*)<>count(distinct (x->>'userId')::uuid) from jsonb_array_elements(p_recipients) x)
    or exists(select 1 from jsonb_array_elements(p_recipients) x
      where not exists(select 1 from auth.users u where u.id=(x->>'userId')::uuid)) then
    raise exception 'invalid recipients' using errcode='22023';
  end if;
end;
$$;

-- Normalize recipient UUID spelling and order before fingerprinting, authorization, or insertion.
create function public.canonical_recording_recipients_v1(p_recipients jsonb) returns jsonb
language sql immutable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('userId',(x->>'userId')::uuid,'role',x->>'role')
    order by (x->>'userId')::uuid,x->>'role'),'[]'::jsonb) from jsonb_array_elements(p_recipients) x;
$$;

-- Only the founder may authorize one exact selected capture; it creates no recording or grant.
create function public.authorize_selected_recording_capture_v1(
  p_project_id uuid,p_capture_author uuid,p_request_id uuid,p_recipients jsonb,p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.recording_sharing_lock_v1();
  perform 1 from public.recording_projects where id=p_project_id and user_id=auth.uid() for update;
  if not found then raise exception 'selected capture authorization denied' using errcode='42501'; end if;
  if p_request_id is null or p_capture_author is null or p_expires_at is null
    or p_expires_at<=now() or p_expires_at>now()+interval '1 day' then
    raise exception 'invalid selected capture authorization' using errcode='22023'; end if;
  if p_capture_author<>auth.uid() and not exists(select 1 from public.recording_project_members
    where project_id=p_project_id and user_id=p_capture_author and role='editor' and revoked_at is null) then
    raise exception 'selected capture authorization denied' using errcode='42501'; end if;
  perform public.validate_recording_recipients_v1('selected',p_recipients);
  if exists(select 1 from public.recording_selected_capture_authorizations where project_id=p_project_id
    and capture_author=p_capture_author and request_id=p_request_id and recording_id is not null) then
    raise exception 'capture authorization already consumed' using errcode='22023'; end if;
  insert into public.recording_selected_capture_authorizations(project_id,capture_author,request_id,recipients,created_by,expires_at)
    values(p_project_id,p_capture_author,p_request_id,public.canonical_recording_recipients_v1(p_recipients),auth.uid(),p_expires_at)
    on conflict(project_id,capture_author,request_id) do update set recipients=excluded.recipients,
      expires_at=excluded.expires_at,revoked_at=null;
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'grant',p_project_id,p_capture_author);
end;
$$;

-- An idempotent capture request is all-or-nothing, including project permission and selected grants.
create function public.create_recording_with_access_v1(
  p_request_id uuid,p_title text,p_source_type public.recording_source_type,
  p_project_id uuid default null,p_visibility text default 'private',p_recipients jsonb default '[]'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_payload jsonb; v_fingerprint text; v_recipients jsonb; v_existing public.recordings%rowtype; v_preauthorized boolean:=false;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_request_id is null or p_title is null or length(btrim(p_title)) not between 1 and 300 or p_source_type is null then
    raise exception 'invalid capture input' using errcode='22023'; end if;
  perform public.validate_recording_recipients_v1(p_visibility,p_recipients);
  v_recipients:=public.canonical_recording_recipients_v1(p_recipients);
  if p_visibility='project' and p_project_id is null then raise exception 'project required' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  if p_project_id is not null then
    perform 1 from public.recording_projects where id=p_project_id for update;
    if not public.can_capture_in_recording_project(p_project_id) then raise exception 'capture denied' using errcode='42501'; end if;
  end if;
  v_payload:=jsonb_build_object('title',btrim(p_title),'sourceType',p_source_type,'projectId',p_project_id,
    'visibility',p_visibility,'recipients',v_recipients);
  v_fingerprint:=encode(sha256(convert_to(v_payload::text,'UTF8')),'hex');
  select * into v_existing from public.recordings where created_by=auth.uid() and capture_request_id=p_request_id for update;
  if found then
    if v_existing.capture_request_fingerprint is distinct from v_fingerprint then raise exception 'request conflict' using errcode='22023'; end if;
    if not public.can_read_recording(v_existing.id) then raise exception 'access revoked' using errcode='42501'; end if;
    return v_existing.id;
  end if;
  if p_project_id is not null and p_visibility='selected' and not exists(
    select 1 from public.recording_projects where id=p_project_id and user_id=auth.uid()) then
    perform 1 from public.recording_selected_capture_authorizations a join public.recording_projects p on p.id=a.project_id
      where a.project_id=p_project_id and a.capture_author=auth.uid() and a.request_id=p_request_id
        and a.created_by=p.user_id and a.revoked_at is null and a.expires_at>now()
        and a.recording_id is null and a.recipients=v_recipients for update of a;
    if not found then raise exception 'selected capture requires founder authorization' using errcode='42501'; end if;
    v_preauthorized:=true;
  end if;
  insert into public.recordings(user_id,created_by,title,source_type,project_id,visibility,capture_request_id,capture_request_fingerprint)
  values(auth.uid(),auth.uid(),btrim(p_title),p_source_type,p_project_id,p_visibility,p_request_id,v_fingerprint) returning id into v_id;
  insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id)
  select v_id,(x->>'userId')::uuid,x->>'role',p_project_id from jsonb_array_elements(v_recipients) x;
  if v_preauthorized then update public.recording_selected_capture_authorizations set recording_id=v_id
    where project_id=p_project_id and capture_author=auth.uid() and request_id=p_request_id; end if;
  insert into public.recording_sharing_audit(actor_id,action,recording_id,project_id)
  values(auth.uid(),'create',v_id,p_project_id);
  return v_id;
end;
$$;

-- Existing private recordings may be assigned without sharing; shared custody cannot be moved.
create or replace function public.assign_recording_organization_v1(
  p_recording_id uuid,p_client_id uuid,p_project_id uuid,p_folder_id uuid,p_tag_ids uuid[] default '{}'
) returns void language plpgsql security definer set search_path = '' as $$
declare v_record public.recordings%rowtype; v_tags uuid[];
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  if p_project_id is not null then
    perform 1 from public.recording_projects where id=p_project_id for update;
    if not public.can_capture_in_recording_project(p_project_id) then raise exception 'assignment denied' using errcode='42501'; end if;
  end if;
  select * into v_record from public.recordings where id=p_recording_id for update;
  if not found or v_record.user_id<>auth.uid() or v_record.visibility<>'private' or v_record.status='deleted' then
    raise exception 'assignment denied' using errcode='42501'; end if;
  if (p_client_id is not null and not exists(select 1 from public.recording_clients where id=p_client_id and user_id=auth.uid()))
    or (p_folder_id is not null and not exists(select 1 from public.recording_folders where id=p_folder_id and user_id=auth.uid()))
    or exists(select 1 from unnest(coalesce(p_tag_ids,'{}')) x where x is null or not exists(select 1 from public.recording_tags where id=x and user_id=auth.uid())) then
    raise exception 'organization denied' using errcode='42501'; end if;
  -- A founder project with a client must keep that same client; collaborator organization stays personal.
  if p_project_id is not null and exists(select 1 from public.recording_projects
    where id=p_project_id and user_id=auth.uid() and client_id is distinct from p_client_id) then
    raise exception 'project client mismatch' using errcode='22023'; end if;
  select coalesce(array_agg(distinct x),'{}') into v_tags from unnest(coalesce(p_tag_ids,'{}')) x;
  update public.recordings set client_id=p_client_id,project_id=p_project_id,folder_id=p_folder_id where id=p_recording_id;
  delete from public.recording_tag_links where recording_id=p_recording_id;
  insert into public.recording_tag_links(recording_id,tag_id,user_id) select p_recording_id,x,auth.uid() from unnest(v_tags) x;
  insert into public.recording_sharing_audit(actor_id,action,recording_id,project_id) values(auth.uid(),'assign',p_recording_id,p_project_id);
end;
$$;

-- Sharing transfers custody to the project founder; only that founder may later alter it.
create function public.share_recording_v1(p_recording_id uuid,p_visibility text,p_recipients jsonb default '[]')
returns void language plpgsql security definer set search_path = '' as $$
declare v_record public.recordings%rowtype;
begin
  perform public.validate_recording_recipients_v1(p_visibility,p_recipients);
  perform public.recording_sharing_lock_v1();
  select * into v_record from public.recordings where id=p_recording_id for update;
  if not found or not public.can_manage_recording(p_recording_id) or v_record.status='deleted' then
    raise exception 'sharing denied' using errcode='42501'; end if;
  if v_record.project_id is not null and p_visibility='selected' and not exists(
    select 1 from public.recording_projects where id=v_record.project_id and user_id=auth.uid()) then
    raise exception 'project grants require founder' using errcode='42501'; end if;
  if v_record.project_id is not null and v_record.visibility='private' and p_visibility<>'private'
    and not public.can_capture_in_recording_project(v_record.project_id) then
    raise exception 'sharing denied' using errcode='42501'; end if;
  if p_visibility='project' and v_record.project_id is null then raise exception 'project required' using errcode='22023'; end if;
  -- Once project-owned, custody cannot silently revert to the former technical owner.
  if v_record.project_id is not null and v_record.visibility<>'private' and p_visibility='private' then
    raise exception 'project custody cannot become private' using errcode='22023'; end if;
  update public.recording_access_grants set revoked_at=now() where recording_id=p_recording_id and revoked_at is null;
  update public.recording_invitations i set revoked_at=now() where accepted_at is null and revoked_at is null
    and exists(select 1 from public.recording_invitation_items x where x.invitation_id=i.id and x.recording_id=p_recording_id);
  update public.recordings set visibility=p_visibility where id=p_recording_id;
  insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id)
  select p_recording_id,(x->>'userId')::uuid,x->>'role',v_record.project_id
    from jsonb_array_elements(public.canonical_recording_recipients_v1(p_recipients)) x;
  insert into public.recording_sharing_audit(actor_id,action,recording_id,project_id) values(auth.uid(),'share',p_recording_id,v_record.project_id);
end;
$$;

-- Revoke exact grants without touching another recording or standalone scope.
create function public.revoke_recording_grant_v1(p_recording_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recording_sharing_lock_v1();
  perform 1 from public.recordings where id=p_recording_id for update;
  if not public.can_manage_recording(p_recording_id) then raise exception 'revoke denied' using errcode='42501'; end if;
  update public.recording_access_grants set revoked_at=now() where recording_id=p_recording_id and user_id=p_user_id and revoked_at is null;
  update public.recording_invitations i set revoked_at=now() where accepted_at is null and revoked_at is null
    and email=(select lower(email) from auth.users where id=p_user_id)
    and exists(select 1 from public.recording_invitation_items x where x.invitation_id=i.id and x.recording_id=p_recording_id);
  insert into public.recording_sharing_audit(actor_id,action,recording_id,subject_id) values(auth.uid(),'revoke_grant',p_recording_id,p_user_id);
end;
$$;

-- Membership, selected project grants and pending invites are revoked in one locked transaction.
create function public.revoke_project_member_v1(p_project_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recording_sharing_lock_v1();
  perform 1 from public.recording_projects where id=p_project_id and user_id=auth.uid() for update;
  if not found then raise exception 'revoke denied' using errcode='42501'; end if;
  update public.recording_project_members set revoked_at=now() where project_id=p_project_id and user_id=p_user_id and revoked_at is null;
  update public.recording_access_grants set revoked_at=now() where scope_project_id=p_project_id and user_id=p_user_id and revoked_at is null;
  update public.recording_selected_capture_authorizations set revoked_at=now() where project_id=p_project_id and revoked_at is null
    and (capture_author=p_user_id or exists(select 1 from jsonb_array_elements(recipients) x where (x->>'userId')::uuid=p_user_id));
  update public.recording_invitations set revoked_at=now() where project_id=p_project_id and accepted_at is null and revoked_at is null
    and email=(select lower(email) from auth.users where id=p_user_id);
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'revoke_member',p_project_id,p_user_id);
end;
$$;

-- Title changes recheck access under the same lock that serializes revoke.
create function public.edit_recording_title_v1(p_recording_id uuid,p_title text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 300 then raise exception 'invalid title' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  perform 1 from public.recordings where id=p_recording_id for update;
  if not public.can_edit_recording(p_recording_id) then raise exception 'edit denied' using errcode='42501'; end if;
  update public.recordings set title=btrim(p_title) where id=p_recording_id;
end;
$$;

-- Task edits are limited to status, preserving AI content and its historical attribution.
create function public.edit_recording_task_status_v1(p_task_id uuid,p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_recording_id uuid;
begin
  if p_status is null or p_status not in ('new','in_progress','waiting','done','unclear','ignored') then raise exception 'invalid status' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  select t.recording_id into v_recording_id from public.transcript_tasks x join public.transcripts t on t.id=x.transcript_id where x.id=p_task_id;
  perform 1 from public.recordings where id=v_recording_id for update;
  if not public.can_edit_recording(v_recording_id) then raise exception 'edit denied' using errcode='42501'; end if;
  update public.transcript_tasks set status=p_status where id=p_task_id;
end;
$$;

alter table public.transcripts add column speaker_versions jsonb not null default '{}',
  add column search_version bigint not null default 0;

-- Every transcript content mutation invalidates derived search work from earlier snapshots.
create function public.advance_transcript_search_version_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_version:=old.search_version+1;
  return new;
end;
$$;
create trigger transcripts_advance_search_version before update of raw_text,segments,speakers on public.transcripts
for each row execute function public.advance_transcript_search_version_v1();

-- Patch one speaker slot under a row lock, with per-slot DB revision and fresh conflict payload.
create function public.patch_transcript_speaker_v1(p_transcript_id uuid,p_speaker_id text,p_expected_version bigint,p_name text,p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_recording_id uuid; v_transcript public.transcripts%rowtype; v_slot jsonb; v_index integer; v_version bigint; v_search_version bigint;
begin
  if p_speaker_id is null or length(p_speaker_id) not between 1 and 100 or p_expected_version is null or p_expected_version<0
    or length(p_name)>100 or p_role is null or p_role not in ('client_customer','delivery_team','unknown') then
    raise exception 'invalid speaker patch' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  select recording_id into v_recording_id from public.transcripts where id=p_transcript_id;
  perform 1 from public.recordings where id=v_recording_id for update;
  if not public.can_edit_recording(v_recording_id) then raise exception 'edit denied' using errcode='42501'; end if;
  select * into v_transcript from public.transcripts where id=p_transcript_id for update;
  select x.item,(x.ordinality-1)::integer into v_slot,v_index
    from jsonb_array_elements(v_transcript.speakers) with ordinality x(item,ordinality) where item->>'id'=p_speaker_id;
  if v_index is null then raise exception 'speaker not found' using errcode='22023'; end if;
  v_version:=coalesce((v_transcript.speaker_versions->>p_speaker_id)::bigint,0);
  if v_version<>p_expected_version then return jsonb_build_object('outcome','conflict','speaker',v_slot,'version',v_version,'searchVersion',v_transcript.search_version); end if;
  v_slot:=v_slot || jsonb_build_object('name',nullif(btrim(p_name),''),'role',p_role,'source','manual');
  update public.transcripts set speakers=jsonb_set(speakers,array[v_index::text],v_slot),
    speaker_versions=jsonb_set(speaker_versions,array[p_speaker_id],to_jsonb(v_version+1))
    where id=p_transcript_id returning search_version into v_search_version;
  return jsonb_build_object('outcome','saved','speaker',v_slot,'version',v_version+1,'searchVersion',v_search_version);
end;
$$;

-- Versioned service-only reindex rejects stale results before replacing derived chunks.
create function public.replace_transcript_search_chunks_v2(p_transcript_id uuid,p_chunks jsonb,p_expected_version bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_version bigint;
begin
  select search_version into v_version from public.transcripts where id=p_transcript_id for update;
  if not found or p_expected_version is distinct from v_version then return false; end if;
  perform public.replace_transcript_search_chunks_v1(p_transcript_id,p_chunks);
  return true;
end;
$$;
-- Only the versioned wrapper may invoke the old implementation after coordinated server adoption.
revoke execute on function public.replace_transcript_search_chunks_v1(uuid,jsonb) from service_role;

-- Resolve current scope authority independently of the historical invitation creator.
create function public.recording_invitation_manager_v1(p_invitation_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists(select 1 from public.recording_invitations i where i.id=p_invitation_id and (
    (i.project_id is not null and exists(select 1 from public.recording_projects p where p.id=i.project_id and p.user_id=p_user_id))
    or (i.project_id is null and i.scope='recordings'
      and exists(select 1 from public.recording_invitation_items x where x.invitation_id=i.id)
      and i.recording_item_count=(select count(*) from public.recording_invitation_items x where x.invitation_id=i.id)
      and not exists(select 1 from public.recording_invitation_items x join public.recordings r on r.id=x.recording_id
        where x.invitation_id=i.id and (r.project_id is not null or r.user_id<>p_user_id)))
  ));
$$;

-- The narrow manager summary deliberately excludes hashes, content, paths and provider data.
create function public.recording_invitation_summary_v1(p_invitation_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',i.id,'email',i.email,'role',i.role,'scope',i.scope,'expiresAt',i.expires_at,
    'acceptedAt',i.accepted_at,'revokedAt',i.revoked_at,'attemptId',i.delivery_attempt_id,
    'attemptCount',i.delivery_attempt_count,'deliveryState',i.delivery_state,
    'lastAttemptAt',i.last_delivery_attempt_at,'nextAttemptAt',i.last_delivery_attempt_at+interval '60 seconds',
    'authorizationCurrent',public.recording_invitation_manager_v1(i.id,coalesce(i.authorized_by,i.created_by)))
  from public.recording_invitations i where i.id=p_invitation_id;
$$;

-- Creating pending invitations never changes visibility; private targets are allowed only standalone.
create function public.create_recording_invitation_v1(
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
        or (v_record.visibility<>'selected' and not (v_record.project_id is null and v_record.visibility='private'))
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

-- Verified redemption atomically publishes only standalone private targets with their exact grants.
create function public.accept_recording_invitation_v1(p_token_hash text) returns uuid
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
  if v_invite.scope='project' then
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

-- Confirm a pending-token revoke; accepted invitations require a separate grant/member operation.
create function public.revoke_recording_invitation_v1(p_invitation_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_invite public.recording_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_invite from public.recording_invitations where id=p_invitation_id for update;
  if not found or not public.recording_invitation_manager_v1(v_invite.id,auth.uid()) then raise exception 'revoke denied' using errcode='42501'; end if;
  if v_invite.accepted_at is not null then raise exception 'invitation already accepted' using errcode='55000'; end if;
  if v_invite.revoked_at is not null then return false; end if;
  update public.recording_invitations set revoked_at=now() where id=p_invitation_id and revoked_at is null and accepted_at is null;
  if not found then raise exception 'invitation not pending' using errcode='55000'; end if;
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'revoke_invite',v_invite.project_id,p_invitation_id);
  return true;
end;
$$;

-- Intended verified recipients may preview safe invitation facts without consuming the token.
create function public.preview_recording_invitation_v1(p_token_hash text) returns jsonb
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
      and ((r.visibility<>'selected' and not (v_invite.project_id is null and r.project_id is null and r.visibility='private'))
        or r.status='deleted' or r.project_id is distinct from v_invite.project_id))) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
  return jsonb_build_object('id',v_invite.id,'role',v_invite.role,'scope',v_invite.scope,
    'expiresAt',v_invite.expires_at,'recordingCount',v_count);
end;
$$;

-- Managers can fetch one safe delivery receipt after create; creator identity never grants access.
create function public.get_recording_invitation_delivery_v1(p_invitation_id uuid,p_expected_token_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  if not public.recording_invitation_manager_v1(p_invitation_id,auth.uid()) then raise exception 'access denied' using errcode='42501'; end if;
  if p_expected_token_hash is not null and not exists(select 1 from public.recording_invitations
    where id=p_invitation_id and token_hash=p_expected_token_hash and accepted_at is null and revoked_at is null
      and expires_at>clock_timestamp()) then raise exception 'invitation unavailable' using errcode='42501'; end if;
  return public.recording_invitation_summary_v1(p_invitation_id);
end;
$$;

-- List active members/grants and pending invitations only for the current scope manager.
create function public.list_recording_access_v1(p_project_id uuid default null,p_recording_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_members jsonb:='[]'; v_grants jsonb; v_invites jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_project_id is null)=(p_recording_id is null) then raise exception 'exactly one access scope required' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  if p_project_id is not null then
    if not public.is_recording_project_founder_v1(p_project_id) then raise exception 'access denied' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'role',m.role) order by m.user_id),'[]')
      into v_members from public.recording_project_members m where m.project_id=p_project_id and m.revoked_at is null;
  elsif not public.can_manage_recording(p_recording_id) then raise exception 'access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('recordingId',g.recording_id,'userId',g.user_id,'role',g.role) order by g.recording_id,g.user_id),'[]')
    into v_grants from public.recording_access_grants g where g.revoked_at is null
      and ((p_project_id is not null and g.scope_project_id=p_project_id) or (p_recording_id is not null and g.recording_id=p_recording_id));
  select coalesce(jsonb_agg(public.recording_invitation_summary_v1(i.id) order by i.created_at,i.id),'[]')
    into v_invites from public.recording_invitations i where i.revoked_at is null and i.accepted_at is null
      and public.recording_invitation_manager_v1(i.id,auth.uid())
      and ((p_project_id is not null and i.project_id=p_project_id) or (p_recording_id is not null and exists(
        select 1 from public.recording_invitation_items x where x.invitation_id=i.id and x.recording_id=p_recording_id)));
  return jsonb_build_object('members',v_members,'grants',v_grants,'invitations',v_invites);
end;
$$;

-- Reserve one resend under the same lock: rotate the hash, preserve ID, and bound attempts/rate.
create function public.resend_recording_invitation_v1(p_invitation_id uuid,p_token_hash text,p_expires_at timestamptz) returns jsonb
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
      where x.invitation_id=v_invite.id and ((r.visibility<>'selected' and not (v_invite.project_id is null and r.project_id is null and r.visibility='private'))
        or r.status='deleted' or r.project_id is distinct from v_invite.project_id))) then
    raise exception 'invitation unavailable' using errcode='42501'; end if;
  update public.recording_invitations set token_hash=p_token_hash,expires_at=p_expires_at,authorized_by=auth.uid(),
    delivery_attempt_count=delivery_attempt_count+1,delivery_attempt_id=gen_random_uuid(),last_delivery_attempt_at=v_now,delivery_state='pending'
    where id=v_invite.id;
  insert into public.recording_sharing_audit(actor_id,action,project_id,subject_id) values(auth.uid(),'resend_invite',v_invite.project_id,v_invite.id);
  return public.recording_invitation_summary_v1(v_invite.id);
end;
$$;

-- Settle only the exact current attempt; a late mail response cannot overwrite a newer resend.
create function public.settle_recording_invitation_delivery_v1(p_invitation_id uuid,p_attempt_id uuid,p_delivered boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_attempt_id is null or p_delivered is null then raise exception 'invalid delivery receipt' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  if not public.recording_invitation_manager_v1(p_invitation_id,auth.uid()) then raise exception 'access denied' using errcode='42501'; end if;
  update public.recording_invitations set delivery_state=case when p_delivered then 'sent' else 'failed' end
    where id=p_invitation_id and delivery_attempt_id=p_attempt_id and delivery_state='pending' and revoked_at is null and accepted_at is null;
  return found;
end;
$$;

-- A grant cannot survive scope reassignment or be attached to private/project visibility.
create function public.validate_recording_grant_scope_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is null and not exists(select 1 from public.recordings r where r.id=new.recording_id
    and r.visibility='selected' and r.project_id is not distinct from new.scope_project_id) then
    raise exception 'grant scope mismatch' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger recording_access_grants_validate before insert or update on public.recording_access_grants
for each row execute function public.validate_recording_grant_scope_v1();

-- Capture authorization expires with membership; being the original author never reopens access.
create function public.can_write_recording_capture_v1(p_recording_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_record public.recordings%rowtype;
begin
  if auth.uid() is null then return false; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_record from public.recordings where id=p_recording_id for update;
  return found and v_record.created_by=auth.uid() and v_record.status in ('created','uploading')
    and v_record.purge_claim_id is null and public.can_edit_recording(p_recording_id)
    and (v_record.project_id is null or v_record.visibility='private' or public.can_capture_in_recording_project(v_record.project_id));
end;
$$;

-- Reads match one canonical object (or an exact legacy recording's live segment), never user prefix alone.
create function public.can_read_recording_object_v1(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.recordings r where public.can_read_recording(r.id)
    and left(p_name,length(r.user_id::text||'/'||r.id::text||'/'))=r.user_id::text||'/'||r.id::text||'/'
    and (p_name=r.storage_path or (r.storage_path=r.user_id::text||'/'||r.id::text||'/live/'
      and left(p_name,length(r.storage_path))=r.storage_path
      and substring(p_name from length(r.storage_path)+1) ~ '^[A-Za-z0-9_-]+\.(webm|ogg|mp3|m4a|wav|mp4|flac)$')));
$$;

-- Direct TUS stays authenticated and scoped to the durable capture row and exact planned object.
create function public.can_write_recording_object_v1(p_name text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.recordings r where r.storage_path=p_name
    and p_name like r.user_id::text||'/'||r.id::text||'/%';
  return v_id is not null and public.can_write_recording_capture_v1(v_id);
end;
$$;

-- Even trusted writers cannot alias another recording's object or replace an already fixed path.
create function public.guard_recording_object_binding_v1() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.storage_path is not null and
    (left(new.storage_path,length(new.user_id::text||'/'||new.id::text||'/'))<>new.user_id::text||'/'||new.id::text||'/'
      or new.storage_path like '%/../%' or new.storage_path like '%/./%') then
    raise exception 'recording object binding mismatch' using errcode='23514'; end if;
  if tg_op='UPDATE' and old.storage_path is not null and new.storage_path is distinct from old.storage_path then
    raise exception 'recording object binding is immutable' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger recordings_guard_object_binding before insert or update of storage_path,user_id,id on public.recordings
for each row execute function public.guard_recording_object_binding_v1();

-- Register the exact upload object before TUS; a revoked author cannot register another upload.
create function public.prepare_recording_upload_v1(p_recording_id uuid,p_filename text,p_mime_type text,p_file_size_bytes bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare v_record public.recordings%rowtype; v_path text;
begin
  if p_filename is null or p_filename !~ '^(live/)?[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    or p_filename like '%..%' or p_mime_type is null or length(p_mime_type)>100 or p_file_size_bytes is null or p_file_size_bytes<0 then
    raise exception 'invalid upload metadata' using errcode='22023'; end if;
  if not public.can_write_recording_capture_v1(p_recording_id) then raise exception 'capture denied' using errcode='42501'; end if;
  select * into v_record from public.recordings where id=p_recording_id for update;
  v_path:=v_record.user_id::text||'/'||v_record.id::text||'/'||p_filename;
  if v_record.storage_path is not null and v_record.storage_path<>v_path then raise exception 'upload object already fixed' using errcode='22023'; end if;
  update public.recordings set storage_path=v_path,mime_type=p_mime_type,file_size_bytes=p_file_size_bytes,status='uploading' where id=p_recording_id;
  return v_path;
end;
$$;

-- Auth/project/client cascades must never destroy retained project content or its descendants.
create function public.guard_project_shared_delete_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.recording_sharing_lock_v1();
  if exists(select 1 from public.recordings r join public.recording_projects p on p.id=r.project_id
    where r.visibility<>'private' and
      ((tg_table_schema='auth' and tg_table_name='users' and (r.user_id=old.id or r.created_by=old.id or p.user_id=old.id))
        or (tg_table_name='recording_projects' and p.id=old.id)
        or (tg_table_name='recording_clients' and (p.client_id=old.id or r.client_id=old.id)))) then
    raise exception 'retained project content blocks deletion' using errcode='23503'; end if;
  return old;
end;
$$;
create trigger users_guard_project_shared_delete before delete on auth.users for each row execute function public.guard_project_shared_delete_v1();
create trigger recording_projects_guard_shared_delete before delete on public.recording_projects for each row execute function public.guard_project_shared_delete_v1();
create trigger recording_clients_guard_shared_delete before delete on public.recording_clients for each row execute function public.guard_project_shared_delete_v1();

-- New persisted jobs receive a custody receipt only while their capture author is authorized.
-- Provider acceptance remains a server assertion; browser roles have no job write privilege.
create table public.recording_job_custody (
  job_id uuid primary key references public.transcription_jobs(id) on delete cascade,
  recording_id uuid not null references public.recordings(id) on delete cascade,
  project_id uuid references public.recording_projects(id) on delete set null,
  capture_author uuid not null references auth.users(id) on delete no action deferrable initially deferred,
  provider_job_id text,
  acceptance_order bigint generated always as identity unique,
  accepted_at timestamptz not null default now(),
  finalized_at timestamptz,
  transcript_id uuid references public.transcripts(id) on delete set null,
  completion_key text
);
create index recording_job_custody_recording_idx on public.recording_job_custody(recording_id);
create index recording_job_custody_project_idx on public.recording_job_custody(project_id);
create index recording_job_custody_author_idx on public.recording_job_custody(capture_author);
create index recording_job_custody_transcript_idx on public.recording_job_custody(transcript_id);

-- Persist an accepted job's exact immutable authority before any possible member revocation.
create function public.accept_recording_job_custody_v1(p_job_id uuid,p_capture_author uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_job public.transcription_jobs%rowtype; v_record public.recordings%rowtype;
begin
  perform public.recording_sharing_lock_v1();
  select * into v_job from public.transcription_jobs where id=p_job_id;
  select * into v_record from public.recordings where id=v_job.recording_id for update;
  perform 1 from public.transcription_jobs where id=p_job_id for update;
  if v_record.id is null or p_capture_author is distinct from v_record.created_by or v_job.user_id<>v_record.user_id
    or v_record.status='deleted' or v_job.status not in ('queued','running','done')
    or (v_job.mode='async' and nullif(v_job.provider_job_id,'') is null)
    or (v_record.project_id is not null and v_record.visibility<>'private' and not exists(
      select 1 from public.recording_projects p where p.id=v_record.project_id and (p.user_id=p_capture_author or exists(
        select 1 from public.recording_project_members m where m.project_id=p.id and m.user_id=p_capture_author and m.role='editor' and m.revoked_at is null))))
    or (v_record.project_id is not null and v_record.visibility='selected'
      and not exists(select 1 from public.recording_projects p where p.id=v_record.project_id and p.user_id=p_capture_author)
      and not exists(select 1 from public.recording_access_grants g where g.recording_id=v_record.id and g.user_id=p_capture_author
        and g.scope_project_id=v_record.project_id and g.role='editor' and g.revoked_at is null)) then
    raise exception 'job custody denied' using errcode='42501'; end if;
  insert into public.recording_job_custody(job_id,recording_id,project_id,capture_author,provider_job_id)
    values(v_job.id,v_record.id,v_record.project_id,p_capture_author,v_job.provider_job_id)
    on conflict(job_id) do nothing;
end;
$$;

-- Accepted work may settle after revoke without reading current personal settings or scheduling AI.
create function public.finalize_recording_job_v1(
  p_job_id uuid,p_recording_id uuid,p_completion_key text,p_raw_text text,p_segments jsonb,p_speakers jsonb,p_duration_seconds integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_custody public.recording_job_custody%rowtype; v_record public.recordings%rowtype; v_job public.transcription_jobs%rowtype; v_transcript_id uuid;
begin
  if p_completion_key is null or length(p_completion_key) not between 16 and 128 or p_raw_text is null
    or jsonb_typeof(p_segments) is distinct from 'array' or jsonb_typeof(p_speakers) is distinct from 'array'
    or p_duration_seconds<0 then raise exception 'invalid finalization' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_record from public.recordings where id=p_recording_id for update;
  select * into v_job from public.transcription_jobs where id=p_job_id for update;
  select * into v_custody from public.recording_job_custody where job_id=p_job_id for update;
  if v_custody.job_id is null or v_custody.recording_id is distinct from p_recording_id
    or v_custody.project_id is distinct from v_record.project_id or v_custody.capture_author is distinct from v_record.created_by
    or v_job.recording_id is distinct from p_recording_id or v_job.provider_job_id is distinct from v_custody.provider_job_id
    or v_job.status in ('cancelled','failed') or v_record.status='deleted' or v_record.purge_claim_id is not null then
    raise exception 'finalization denied' using errcode='42501'; end if;
  if v_custody.finalized_at is not null then
    if v_custody.completion_key<>p_completion_key then raise exception 'finalization conflict' using errcode='22023'; end if;
    return v_custody.transcript_id;
  end if;
  -- A newer accepted generation makes the older provider completion stale.
  if exists(select 1 from public.recording_job_custody c where c.recording_id=p_recording_id
    and c.acceptance_order>v_custody.acceptance_order) then
    raise exception 'stale finalization' using errcode='40001'; end if;
  select id into v_transcript_id from public.transcripts where transcription_job_id=p_job_id and recording_id=p_recording_id
    order by created_at desc,id desc limit 1 for update;
  if v_transcript_id is null then
    insert into public.transcripts(recording_id,transcription_job_id,user_id,raw_text,segments,speakers,completion_generation_key)
      values(p_recording_id,p_job_id,v_record.user_id,p_raw_text,p_segments,p_speakers,p_completion_key) returning id into v_transcript_id;
  else
    update public.transcripts set raw_text=p_raw_text,segments=p_segments,speakers=p_speakers,completion_generation_key=p_completion_key
      where id=v_transcript_id;
  end if;
  update public.transcription_jobs set status='done',completed_at=coalesce(completed_at,now()),error_message=null where id=p_job_id;
  update public.recordings set status='completed',duration_seconds=coalesce(p_duration_seconds,duration_seconds),error_message=null where id=p_recording_id;
  update public.recording_job_custody set finalized_at=now(),transcript_id=v_transcript_id,completion_key=p_completion_key where job_id=p_job_id;
  return v_transcript_id;
end;
$$;

-- Replace only recording-content policies; personal prompts, clients, folders, tags and audit stay private.
drop policy "recordings select own" on public.recordings;
drop policy "recordings insert own" on public.recordings;
drop policy "recordings update own" on public.recordings;
drop policy "recordings delete own" on public.recordings;
create policy "recordings read access" on public.recordings for select to authenticated using(public.can_read_recording(id));
create policy "recordings insert private" on public.recordings for insert to authenticated
  with check(user_id=auth.uid() and created_by=auth.uid() and visibility='private' and capture_request_id is null and capture_request_fingerprint is null
    and project_id is null and storage_path is null);
create policy "recordings update private owner" on public.recordings for update to authenticated
  using(user_id=auth.uid() and (visibility='private' or project_id is null))
  with check(user_id=auth.uid() and (visibility='private' or project_id is null));
create policy "recordings delete through purge only" on public.recordings for delete to authenticated using(false);
-- Keep private legacy capture/title/Trash paths; shared mutation is exclusively through locked RPCs.
revoke update on public.recordings from authenticated;
grant update(title,status,mime_type,duration_seconds,file_size_bytes,error_message,trash_retention_hours) on public.recordings to authenticated;
-- A table-wide SELECT would disclose owner metadata on every shared row. All callers must enumerate safe columns.
revoke select on public.recordings from public,anon,authenticated;
grant select(id,title,source_type,visibility,project_id,status,duration_seconds,file_size_bytes,created_at,updated_at,created_by)
  on public.recordings to authenticated;
revoke select on public.recording_projects from public,anon,authenticated;
grant select(id,name,color,created_at,updated_at) on public.recording_projects to authenticated;
revoke update(status) on public.transcript_tasks from authenticated;

drop policy "recording projects select own" on public.recording_projects;
create policy "recording projects read access" on public.recording_projects for select to authenticated using(public.can_read_recording_project(id));
drop policy "transcripts select own" on public.transcripts;
create policy "transcripts read access" on public.transcripts for select to authenticated using(public.can_read_recording(recording_id));
drop policy "transcript search chunks select own" on public.transcript_search_chunks;
create policy "transcript chunks read access" on public.transcript_search_chunks for select to authenticated using(public.can_read_recording(recording_id));
drop policy "ai outputs select own" on public.ai_outputs;
create policy "ai outputs read access" on public.ai_outputs for select to authenticated
  using(exists(select 1 from public.transcripts t where t.id=transcript_id and public.can_read_recording(t.recording_id)));
drop policy "transcription jobs select own" on public.transcription_jobs;
create policy "transcription jobs private metadata" on public.transcription_jobs for select to authenticated
  using(user_id=auth.uid() and public.can_read_recording(recording_id));
drop policy "ai processing jobs select own" on public.ai_processing_jobs;
create policy "ai jobs private metadata" on public.ai_processing_jobs for select to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.transcripts t where t.id=transcript_id and public.can_read_recording(t.recording_id)));

drop policy "transcript chat threads select own" on public.transcript_chat_threads;
drop policy "transcript chat turns select own" on public.transcript_chat_turns;
create policy "transcript chat threads current personal access" on public.transcript_chat_threads for select to authenticated
  using(user_id=auth.uid() and public.can_read_recording(recording_id));
create policy "transcript chat turns current personal access" on public.transcript_chat_turns for select to authenticated
  using(user_id=auth.uid() and public.can_read_recording(recording_id));

do $$
declare v_table text; v_old_policy text;
begin
  foreach v_table in array array['transcript_tasks','transcript_chapters','transcript_decisions','transcript_risks'] loop
    v_old_policy:=replace(v_table,'_',' ')||' select own';
    execute format('drop policy %I on public.%I',v_old_policy,v_table);
    execute format('create policy %I on public.%I for select to authenticated using(exists(select 1 from public.transcripts t where t.id=transcript_id and public.can_read_recording(t.recording_id)))',v_table||' read access',v_table);
  end loop;
end;
$$;
drop policy "transcript tasks update own" on public.transcript_tasks;

-- Existing markers remain usable during a valid capture, but cannot provide a post-revoke bypass.
drop policy "recording markers select own" on public.recording_markers;
drop policy "recording markers insert own" on public.recording_markers;
drop policy "recording markers update own" on public.recording_markers;
drop policy "recording markers delete own" on public.recording_markers;
create policy "recording markers read access" on public.recording_markers for select to authenticated using(public.can_read_recording(recording_id));
create policy "recording markers insert capture" on public.recording_markers for insert to authenticated
  with check(user_id=auth.uid() and public.can_write_recording_capture_v1(recording_id));
create policy "recording markers update private" on public.recording_markers for update to authenticated
  using(user_id=auth.uid() and public.can_manage_recording(recording_id)) with check(user_id=auth.uid() and public.can_manage_recording(recording_id));
create policy "recording markers delete manager" on public.recording_markers for delete to authenticated using(public.can_manage_recording(recording_id));

drop policy "recordings storage select own folder" on storage.objects;
drop policy "recordings storage insert own folder" on storage.objects;
drop policy "recordings storage update own folder" on storage.objects;
drop policy "recordings storage delete own folder" on storage.objects;
create policy "recordings storage read exact object" on storage.objects for select to authenticated
  using(bucket_id='recordings' and public.can_read_recording_object_v1(name));
create policy "recordings storage insert capture" on storage.objects for insert to authenticated
  with check(bucket_id='recordings' and public.can_write_recording_object_v1(name));
create policy "recordings storage update capture" on storage.objects for update to authenticated
  using(bucket_id='recordings' and public.can_write_recording_object_v1(name))
  with check(bucket_id='recordings' and public.can_write_recording_object_v1(name));
-- Deletion remains through the service-side purge fence, never an editor or TUS credential.

do $$
declare v_table text;
begin
  foreach v_table in array array['recording_project_members','recording_access_grants','recording_invitations',
    'recording_invitation_items','recording_sharing_audit','recording_job_custody','recording_selected_capture_authorizations'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('alter table public.%I force row level security',v_table);
    execute format('revoke all on public.%I from public,anon,authenticated',v_table);
    execute format('grant all on public.%I to service_role',v_table);
  end loop;
end;
$$;
grant select on public.recording_project_members,public.recording_access_grants to authenticated;
create policy "members read self or founder" on public.recording_project_members for select to authenticated
  using(user_id=auth.uid() or public.is_recording_project_founder_v1(project_id));
create policy "grants read self or manager" on public.recording_access_grants for select to authenticated
  using(user_id=auth.uid() or public.can_manage_recording(recording_id));

-- Grant only explicitly supported entry points; helper functions have no direct browser ACL.
do $$
declare v_function regprocedure; v_name text;
begin
  for v_function,v_name in select p.oid::regprocedure,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'recording_sharing_lock_v1','recording_access_role_v1','can_read_recording','can_edit_recording','can_manage_recording',
      'recording_capabilities_v1','get_personal_recording_metadata_v1','can_read_recording_project','can_capture_in_recording_project',
      'is_recording_project_founder_v1','get_personal_recording_project_v1',
      'validate_recording_recipients_v1','canonical_recording_recipients_v1','authorize_selected_recording_capture_v1',
      'create_recording_with_access_v1','assign_recording_organization_v1','share_recording_v1','revoke_recording_grant_v1',
      'revoke_project_member_v1','edit_recording_title_v1','edit_recording_task_status_v1','advance_transcript_search_version_v1',
      'patch_transcript_speaker_v1','replace_transcript_search_chunks_v2','create_recording_invitation_v1',
      'accept_recording_invitation_v1','revoke_recording_invitation_v1','validate_recording_grant_scope_v1',
      'recording_invitation_manager_v1','recording_invitation_summary_v1','preview_recording_invitation_v1',
      'get_recording_invitation_delivery_v1','list_recording_access_v1','resend_recording_invitation_v1','settle_recording_invitation_delivery_v1',
      'can_write_recording_capture_v1','can_read_recording_object_v1','can_write_recording_object_v1','guard_recording_object_binding_v1','prepare_recording_upload_v1',
      'guard_project_shared_delete_v1','accept_recording_job_custody_v1','finalize_recording_job_v1']) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
    if v_name=any(array['can_read_recording','can_edit_recording','can_manage_recording','recording_capabilities_v1',
      'get_personal_recording_metadata_v1','authorize_selected_recording_capture_v1',
      'is_recording_project_founder_v1','get_personal_recording_project_v1',
      'can_read_recording_project','can_capture_in_recording_project','create_recording_with_access_v1','assign_recording_organization_v1',
      'share_recording_v1','revoke_recording_grant_v1','revoke_project_member_v1','edit_recording_title_v1','edit_recording_task_status_v1',
      'patch_transcript_speaker_v1','create_recording_invitation_v1','accept_recording_invitation_v1','revoke_recording_invitation_v1',
      'preview_recording_invitation_v1','get_recording_invitation_delivery_v1','list_recording_access_v1',
      'resend_recording_invitation_v1','settle_recording_invitation_delivery_v1',
      'can_write_recording_capture_v1','can_read_recording_object_v1','can_write_recording_object_v1','prepare_recording_upload_v1']) then
      execute format('grant execute on function %s to authenticated',v_function);
    elsif v_name=any(array['replace_transcript_search_chunks_v2','accept_recording_job_custody_v1','finalize_recording_job_v1']) then
      execute format('grant execute on function %s to service_role',v_function);
    end if;
  end loop;
end;
$$;
