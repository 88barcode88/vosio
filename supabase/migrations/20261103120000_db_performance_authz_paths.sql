-- DB performance without changing who can see what.
-- A1 storage read policy helper no longer scans every recording; A2 capabilities computed once and batchable;
-- A3 list/count rows start from an indexable candidate superset; A4 initplan-safe policies, redundant indexes, FK indexes.
begin;
-- The candidate rows function reads vosio_team_private.scope_grants (force RLS, no policy): only a trusted owner may apply this.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- A1: Resolves candidate recordings by exact path lookups (unique indexes) or the id embedded in the path, then applies the unchanged read rules.
create or replace function public.can_read_recording_object_v1(p_name text) returns boolean
language sql stable security definer set search_path = '' as $read$
  select coalesce((
    select exists(
      select 1 from public.recordings r
      where r.id in (
          select o.id from public.recordings o where o.storage_path=p_name
          union all
          select reg.recording_id from public.recording_live_part_registrations reg where reg.storage_path=p_name
          union all
          select case when split_part(p_name,'/',2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then split_part(p_name,'/',2)::uuid end
        )
        and public.can_read_recording(r.id) and (
          p_name=r.storage_path or exists(select 1 from public.recording_live_part_registrations p
            where p.recording_id=r.id and p.storage_path=p_name and p.capture_request_id=r.capture_request_id)
          or (r.storage_path=r.user_id::text||'/'||r.id::text||'/live/'
            and left(p_name,length(r.storage_path))=r.storage_path
            and substring(p_name from length(r.storage_path)+1) ~ '^[A-Za-z0-9_-]+\.(webm|ogg|mp3|m4a|wav|mp4|flac)$'))
    )), false);
$read$;

-- A2: Computes the caller role once per recording for up to 1000 ids and returns the capability JSON only for readable rows.
create or replace function public.recording_capabilities_batch_v1(p_recording_ids uuid[])
returns table(recording_id uuid, capabilities jsonb)
language plpgsql stable security definer set search_path = '' as $batch$
begin
  if cardinality(coalesce(p_recording_ids,'{}'::uuid[]))>1000 then
    raise exception 'too many recording ids' using errcode='22023';
  end if;
  return query
  with ids as (
    select distinct i.id from unnest(coalesce(p_recording_ids,'{}'::uuid[])) as i(id) where i.id is not null
  ), roles as materialized (
    -- Materialized so the role is resolved once per recording, not once per reference in the select list.
    select r.id, r.user_id, r.status, public.recording_access_role_v1(r.id) as role
    from ids join public.recordings r on r.id=ids.id
  )
  select ro.id, jsonb_build_object('read',true,
    'editTitle',ro.role in ('manager','editor') and ro.status<>'deleted',
    'editSpeakers',ro.role in ('manager','editor') and ro.status<>'deleted',
    'editTaskStatus',ro.role in ('manager','editor') and ro.status<>'deleted',
    'manageAccess',ro.role='manager' and ro.status<>'deleted',
    'delete',ro.role='manager' and ro.status<>'deleted',
    'restore',ro.role='manager' and ro.status='deleted',
    'purge',ro.role='manager' and ro.status='deleted',
    'runPersonalAi',ro.role='manager' and ro.user_id=auth.uid() and ro.status<>'deleted',
    'usePrivateChat',ro.role='manager' and ro.user_id=auth.uid() and ro.status<>'deleted')
  from roles ro where ro.role is not null;
end;
$batch$;

-- A2: Single-recording capabilities delegate to the batch implementation so both paths share one definition.
create or replace function public.recording_capabilities_v1(p_recording_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $capabilities$
  select b.capabilities from public.recording_capabilities_batch_v1(array[p_recording_id]) b;
$capabilities$;

revoke all on function public.recording_capabilities_batch_v1(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.recording_capabilities_batch_v1(uuid[]) to authenticated;

-- A3: Candidate-first rows: owned, owned/member project, explicit grant and team client/folder scope recordings are a superset of every
-- path recording_access_role_v1 can grant; can_read_recording still decides each candidate. A fixed id short-circuits to that id only.
create or replace function public.accessible_recording_rows_v1(p_client_id uuid, p_project_id uuid, p_folder_id uuid, p_tag_ids uuid[], p_recording_id uuid, p_status public.recording_status, p_include_deleted boolean, p_before_created_at timestamptz, p_before_id uuid, p_limit integer)
returns setof public.accessible_recording_row_v1
language sql stable security definer set search_path = '' as $rows$
with actor as (
  select auth.uid() as id
), tag_filter as (
  select coalesce(array_agg(distinct tag_id order by tag_id)
    filter (where tag_id is not null), '{}'::uuid[]) as ids
  from unnest(coalesce(p_tag_ids,'{}'::uuid[])) as requested(tag_id)
), candidate_ids as materialized (
  select r.id from public.recordings r where p_recording_id is not null and r.id=p_recording_id
  union
  select r.id from public.recordings r cross join actor a
    where p_recording_id is null and a.id is not null and r.user_id=a.id
  union
  select r.id from public.recording_projects p cross join actor a
    join public.recordings r on r.project_id=p.id
    where p_recording_id is null and a.id is not null and p.user_id=a.id
  union
  select r.id from public.recording_project_members m cross join actor a
    join public.recordings r on r.project_id=m.project_id
    where p_recording_id is null and a.id is not null and m.user_id=a.id and m.revoked_at is null
  union
  select g.recording_id from public.recording_access_grants g cross join actor a
    where p_recording_id is null and a.id is not null and g.user_id=a.id and g.revoked_at is null
  union
  select r.id from vosio_team_private.scope_grants sg cross join actor a
    join public.recordings r on r.client_id=sg.client_id
    where p_recording_id is null and a.id is not null and sg.user_id=a.id and sg.revoked_at is null and sg.scope_kind='client'
  union
  select r.id from vosio_team_private.scope_grants sg cross join actor a
    join public.recordings r on r.folder_id=sg.folder_id
    where p_recording_id is null and a.id is not null and sg.user_id=a.id and sg.revoked_at is null and sg.scope_kind='folder'
), allowed as (
  select r.id, r.user_id, r.title, r.source_type, r.mime_type, r.duration_seconds,
    r.file_size_bytes, r.status, r.created_at, r.updated_at,
    r.client_id, r.project_id, r.folder_id, r.visibility,
    a.id as actor_id,
    (public.can_read_recording_project(r.project_id) or r.visibility='selected') as project_allowed
  from candidate_ids c join public.recordings r on r.id=c.id cross join actor a
  where a.id is not null and public.can_read_recording(r.id)
    and (p_recording_id is null or r.id=p_recording_id)
    and (p_status is null or r.status=p_status)
    and (p_include_deleted or r.status<>'deleted')
    and ((p_before_created_at is null and p_before_id is null)
      or (p_before_created_at is not null and p_before_id is not null
        and (r.created_at,r.id)<(p_before_created_at,p_before_id)))
    and (r.status<>'deleted' or public.can_manage_recording(r.id))
)
select r.id, r.title, r.source_type, r.mime_type, r.duration_seconds,
  r.file_size_bytes, r.status, r.created_at, r.updated_at,
  case when r.user_id=r.actor_id then r.client_id end,
  case when r.project_allowed then r.project_id end,
  case when r.user_id=r.actor_id then r.folder_id end,
  r.visibility, p.name,
  case when r.user_id=r.actor_id then array(
    select rtl.tag_id from public.recording_tag_links rtl
    where rtl.recording_id=r.id and rtl.user_id=r.actor_id order by rtl.tag_id
  ) end
from allowed r cross join tag_filter tf
left join public.recording_projects p on p.id=r.project_id and r.project_allowed
where (p_client_id is null or (r.user_id=r.actor_id and r.client_id=p_client_id))
  and (p_folder_id is null or (r.user_id=r.actor_id and r.folder_id=p_folder_id))
  and (p_project_id is null or (r.project_allowed and r.project_id=p_project_id))
  and (cardinality(tf.ids)=0 or (r.user_id=r.actor_id and (
    select count(distinct rtl.tag_id) from public.recording_tag_links rtl
    where rtl.recording_id=r.id and rtl.user_id=r.actor_id and rtl.tag_id=any(tf.ids)
  )=cardinality(tf.ids)))
order by r.created_at desc,r.id desc
limit p_limit;
$rows$;

-- A4: Evaluate auth.uid() once per statement (initplan) in the ten flagged policies; predicates are otherwise unchanged.
alter policy "recordings update private owner" on public.recordings
  using (user_id=(select auth.uid()) and (visibility='private' or project_id is null))
  with check (user_id=(select auth.uid()) and (visibility='private' or project_id is null));
alter policy "recordings insert private" on public.recordings
  with check (user_id=(select auth.uid()) and created_by=(select auth.uid()) and visibility='private'
    and capture_request_id is null and capture_request_fingerprint is null and project_id is null and storage_path is null);
alter policy "transcription jobs private metadata" on public.transcription_jobs
  using (user_id=(select auth.uid()) and public.can_read_recording(recording_id));
alter policy "ai jobs private metadata" on public.ai_processing_jobs
  using (user_id=(select auth.uid()) and exists(select 1 from public.transcripts t
    where t.id=ai_processing_jobs.transcript_id and public.can_read_recording(t.recording_id)));
alter policy "transcript chat threads current personal access" on public.transcript_chat_threads
  using (user_id=(select auth.uid()) and public.can_read_recording(recording_id));
alter policy "transcript chat turns current personal access" on public.transcript_chat_turns
  using (user_id=(select auth.uid()) and public.can_read_recording(recording_id));
alter policy "recording markers insert capture" on public.recording_markers
  with check (user_id=(select auth.uid()) and public.can_write_recording_capture_v1(recording_id));
alter policy "recording markers update private" on public.recording_markers
  using (user_id=(select auth.uid()) and public.can_manage_recording(recording_id))
  with check (user_id=(select auth.uid()) and public.can_manage_recording(recording_id));
alter policy "members read self or founder" on public.recording_project_members
  using (user_id=(select auth.uid()) or public.is_recording_project_founder_v1(project_id));
alter policy "grants read self or manager" on public.recording_access_grants
  using (user_id=(select auth.uid()) or public.can_manage_recording(recording_id));

-- A4: Both indexes are strict prefixes of transcripts_recording_user_idx / transcripts_user_recording_latest_idx.
drop index if exists public.transcripts_recording_idx;
drop index if exists public.transcripts_user_recording_created_idx;

-- A4: Composite-FK covering indexes for the heaviest child tables and for team scope candidate lookups (client/folder leading).
create index if not exists transcript_tasks_transcript_user_idx on public.transcript_tasks(transcript_id, user_id);
create index if not exists transcript_decisions_transcript_user_idx on public.transcript_decisions(transcript_id, user_id);
create index if not exists transcript_risks_transcript_user_idx on public.transcript_risks(transcript_id, user_id);
create index if not exists transcript_chapters_transcript_user_idx on public.transcript_chapters(transcript_id, user_id);
create index if not exists transcript_search_chunks_transcript_owner_idx on public.transcript_search_chunks(transcript_id, recording_id, user_id);
create index if not exists transcript_search_chunks_user_idx on public.transcript_search_chunks(user_id);
create index if not exists recordings_client_user_idx on public.recordings(client_id, user_id);
create index if not exists recordings_folder_user_idx on public.recordings(folder_id, user_id);

commit;
