-- Source-only forward: apply after 20260922190000 and only with coordinated T3 callers.
-- Apply in one transaction under the same trusted migration owner as T1.
-- Project associations require scope-aware masking; author UUIDs are not a public display identity.
revoke select (project_id, created_by) on public.recordings from authenticated;
-- The legacy owner-only JSON still exposes masked associations; use the safe detail RPC.
revoke execute on function public.get_personal_recording_metadata_v1(uuid)
  from authenticated;

-- Shared title search has its own safe expression index, independent of private metadata vectors.
create index recordings_shared_title_search_idx
  on public.recordings using gin (to_tsvector('simple'::regconfig,coalesce(title,'')));

-- Explicit allowlist shared by list/detail projections; never return recordings.*.
create type public.accessible_recording_row_v1 as (
  id uuid,
  title text,
  source_type public.recording_source_type,
  mime_type text,
  duration_seconds integer,
  file_size_bytes bigint,
  status public.recording_status,
  created_at timestamptz,
  updated_at timestamptz,
  client_id uuid,
  project_id uuid,
  folder_id uuid,
  visibility text,
  project_name text,
  tag_ids uuid[]
);

-- Private session-scoped base: one row per recording, with personal taxonomy masked.
-- Exact selected access permits only this recording's project label, not project inventory.
create function public.accessible_recording_rows_v1(
  p_client_id uuid, p_project_id uuid, p_folder_id uuid, p_tag_ids uuid[],
  p_recording_id uuid, p_status public.recording_status, p_include_deleted boolean,
  p_before_created_at timestamptz, p_before_id uuid, p_limit integer
) returns setof public.accessible_recording_row_v1
language sql stable security definer set search_path = '' as $rows$
with actor as (
  select auth.uid() as id
), tag_filter as (
  select coalesce(array_agg(distinct tag_id order by tag_id)
    filter (where tag_id is not null), '{}'::uuid[]) as ids
  from unnest(coalesce(p_tag_ids,'{}'::uuid[])) as requested(tag_id)
), allowed as (
  select r.id, r.user_id, r.title, r.source_type, r.mime_type, r.duration_seconds,
    r.file_size_bytes, r.status, r.created_at, r.updated_at,
    r.client_id, r.project_id, r.folder_id, r.visibility,
    a.id as actor_id,
    (public.can_read_recording_project(r.project_id) or r.visibility='selected') as project_allowed
  from public.recordings r cross join actor a
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

-- Private unpaged search winners; both search pages and exact facets consume this set.
create function public.accessible_recording_search_winners_v1(
  p_query text, p_client_id uuid, p_project_id uuid, p_folder_id uuid, p_tag_ids uuid[],
  p_status public.recording_status
) returns table (
  recording public.accessible_recording_row_v1,
  matched_excerpt text,
  match_start_ms bigint,
  match_end_ms bigint,
  match_rank real
)
language sql stable security definer set search_path = '' as $winners$
with normalized as (
  select left(regexp_replace(btrim(coalesce(p_query,'')), '\s+', ' ', 'g'),120) as query_text
), input as (
  select websearch_to_tsquery('simple'::regconfig,query_text) as query
  from normalized where query_text<>''
), authorized_ids as materialized (
  -- Resolve authority before reading any searchable content; only IDs cross this boundary.
  select r.id from public.recordings r
  where auth.uid() is not null and exists(select 1 from input)
    and r.status<>'deleted' and (p_status is null or r.status=p_status)
    and public.can_read_recording(r.id)
), candidate_ids as materialized (
  -- The correlated OFFSET 0 fence prevents flattening into a global content-first search.
  -- Hidden text matches cannot increase exact-ID projection/helper invocations.
  select matched.id from authorized_ids a
  cross join lateral (
    select original.id from public.recordings original cross join input i
    where original.id=a.id and (
      to_tsvector('simple'::regconfig,coalesce(original.title,'')) @@ i.query
      or (original.user_id=auth.uid() and (
        original.metadata_search_vector @@ i.query
        or exists(select 1 from public.recording_clients rc
          where rc.id=original.client_id and rc.user_id=auth.uid() and rc.metadata_search_vector @@ i.query)
        or exists(select 1 from public.recording_folders rf
          where rf.id=original.folder_id and rf.user_id=auth.uid() and rf.metadata_search_vector @@ i.query)
        or exists(select 1 from public.recording_tag_links rtl
          join public.recording_tags rt on rt.id=rtl.tag_id and rt.user_id=rtl.user_id
          where rtl.recording_id=original.id and rtl.user_id=auth.uid() and rt.metadata_search_vector @@ i.query)
      ))
      or exists(select 1 from public.recording_projects rp
        where rp.id=original.project_id
          and (public.can_read_recording_project(rp.id) or original.visibility='selected')
          and rp.metadata_search_vector @@ i.query)
      or exists(
        select 1 from public.transcript_search_chunks c
        where c.recording_id=original.id and c.search_vector @@ i.query
          and c.transcript_id=(select t.id from public.transcripts t
            where t.recording_id=original.id order by t.created_at desc,t.id desc limit 1)
      )
    )
    offset 0
  ) matched
), eligible as materialized (
  -- Only potential matches are projected; there is no full accessible-set materialization.
  select r from candidate_ids c cross join lateral public.accessible_recording_rows_v1(
    p_client_id,p_project_id,p_folder_id,p_tag_ids,c.id,p_status,false,null,null,1
  ) r
), transcript_candidates as (
  select e.r as recording,
    ts_headline('simple'::regconfig,c.text,i.query,
      'StartSel=[[H]], StopSel=[[/H]], MaxWords=35, MinWords=15') as matched_excerpt,
    c.start_ms as match_start_ms, c.end_ms as match_end_ms,
    ts_rank_cd(c.search_vector,i.query) as match_rank,
    0 as match_kind, c.position as candidate_position
  from eligible e
  join lateral (
    select t.id from public.transcripts t where t.recording_id=(e.r).id
    order by t.created_at desc,t.id desc limit 1
  ) latest on true
  join public.transcript_search_chunks c on c.transcript_id=latest.id and c.recording_id=(e.r).id
  cross join input i
  where c.search_vector @@ i.query
), metadata_candidates as (
  select e.r as recording,
    ts_headline('simple'::regconfig,
      concat_ws(' · ',(e.r).title,rc.name,(e.r).project_name,rf.name,mt.names),i.query,
      'StartSel=[[H]], StopSel=[[/H]], MaxWords=35, MinWords=15') as matched_excerpt,
    null::bigint as match_start_ms, null::bigint as match_end_ms,
    greatest(ts_rank_cd(v.recording_vector,i.query),
      coalesce(ts_rank_cd(rc.metadata_search_vector,i.query),0),
      ts_rank_cd(v.project_vector,i.query),
      coalesce(ts_rank_cd(rf.metadata_search_vector,i.query),0),
      coalesce(mt.tag_rank,0)) as match_rank,
    1 as match_kind, 0 as candidate_position
  from eligible e
  join public.recordings original on original.id=(e.r).id
  cross join input i
  cross join lateral (
    select case when original.user_id=auth.uid() then original.metadata_search_vector
      else to_tsvector('simple'::regconfig,coalesce((e.r).title,'')) end as recording_vector,
      to_tsvector('simple'::regconfig,coalesce((e.r).project_name,'')) as project_vector
  ) v
  left join public.recording_clients rc on rc.id=(e.r).client_id and rc.user_id=auth.uid()
  left join public.recording_folders rf on rf.id=(e.r).folder_id and rf.user_id=auth.uid()
  left join lateral (
    select string_agg(rt.name,' · ' order by rt.name) as names,
      max(ts_rank_cd(rt.metadata_search_vector,i.query)) as tag_rank,
      bool_or(rt.metadata_search_vector @@ i.query) as tag_matches
    from public.recording_tags rt
    where rt.id=any((e.r).tag_ids) and rt.user_id=auth.uid()
  ) mt on true
  where v.recording_vector @@ i.query or v.project_vector @@ i.query
    or rc.metadata_search_vector @@ i.query or rf.metadata_search_vector @@ i.query
    or coalesce(mt.tag_matches,false)
), candidates as (
  select * from transcript_candidates union all select * from metadata_candidates
), ranked as (
  select c.*,row_number() over (
    partition by (c.recording).id
    order by c.match_rank desc,c.match_kind asc,c.match_start_ms asc nulls last,
      c.candidate_position asc,(c.recording).id desc
  ) as candidate_number from candidates c
)
select w.recording,w.matched_excerpt,w.match_start_ms,w.match_end_ms,w.match_rank
from ranked w where w.candidate_number=1;
$winners$;

-- Session list preserves the V2 keyset, bounds and filters; explicit deleted selects custody Trash.
create function public.list_accessible_recordings_v1(
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[],
  p_status public.recording_status default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
) returns setof public.accessible_recording_row_v1
language sql stable security definer set search_path = '' as $list$
select r.*
from public.accessible_recording_rows_v1(
  p_client_id,p_project_id,p_folder_id,p_tag_ids,null,p_status,coalesce(p_status='deleted',false),
  p_before_created_at,p_before_id,greatest(1,least(coalesce(p_limit,100),1000))
) r
where auth.uid() is not null
order by r.created_at desc,r.id desc;
$list$;

-- Detail uses the identical allowlist and access set, including custody-only Trash reads.
create function public.get_accessible_recording_v1(p_recording_id uuid)
returns setof public.accessible_recording_row_v1
language sql stable security definer set search_path = '' as $detail$
select r.* from public.accessible_recording_rows_v1(
  null,null,null,'{}'::uuid[],p_recording_id,null,true,null,null,1
) r
where auth.uid() is not null and p_recording_id is not null;
$detail$;

-- Session search preserves SQL rank/headline, exact pre-page total and deterministic ordering.
create function public.search_accessible_recordings_v1(
  p_query text,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[],
  p_status public.recording_status default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  recording_id uuid, title text, source_type public.recording_source_type, mime_type text,
  duration_seconds integer, file_size_bytes bigint, status public.recording_status,
  created_at timestamptz, updated_at timestamptz, client_id uuid, project_id uuid,
  folder_id uuid, matched_excerpt text, match_start_ms bigint, match_end_ms bigint,
  total_count bigint, visibility text, project_name text, tag_ids uuid[]
)
language sql stable security definer set search_path = '' as $search$
select (w.recording).id,(w.recording).title,(w.recording).source_type,(w.recording).mime_type,
  (w.recording).duration_seconds,(w.recording).file_size_bytes,(w.recording).status,
  (w.recording).created_at,(w.recording).updated_at,(w.recording).client_id,
  (w.recording).project_id,(w.recording).folder_id,w.matched_excerpt,w.match_start_ms,w.match_end_ms,
  count(*) over(),(w.recording).visibility,
  (w.recording).project_name,(w.recording).tag_ids
from public.accessible_recording_search_winners_v1(p_query,p_client_id,p_project_id,p_folder_id,p_tag_ids,p_status) w
where auth.uid() is not null
order by w.match_rank desc,(w.recording).created_at desc,(w.recording).id desc
limit greatest(1,least(coalesce(p_limit,25),50))
offset greatest(coalesce(p_offset,0),0);
$search$;

-- Facets ignore active status; deleted is the separate unfiltered current-custody Trash total.
create function public.count_accessible_recording_statuses_v1(
  p_query text default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[]
) returns table(status public.recording_status,total_count bigint)
language sql stable security definer set search_path = '' as $counts$
with normalized as (
  select left(regexp_replace(btrim(coalesce(p_query,'')), '\s+', ' ', 'g'),120) as query_text
), eligible as (
  select r.id,r.status from normalized n
  cross join lateral public.accessible_recording_rows_v1(
    p_client_id,p_project_id,p_folder_id,p_tag_ids,null,null,false,null,null,null
  ) r
  where n.query_text='' and r.status<>'deleted' and auth.uid() is not null
  union all
  select (w.recording).id,(w.recording).status from normalized n
  cross join lateral public.accessible_recording_search_winners_v1(n.query_text,p_client_id,p_project_id,p_folder_id,p_tag_ids,null) w
  where n.query_text<>'' and auth.uid() is not null
), counts as (
  select e.status,count(*) as total_count from eligible e group by e.status
), requested as (
  select s.status from unnest(
    array['created','uploading','uploaded','transcribing','completed','failed']::public.recording_status[]
  ) s(status)
)
select rs.status,coalesce(c.total_count,0) from requested rs
left join counts c on c.status=rs.status
union all
select 'deleted'::public.recording_status,count(*)
from public.accessible_recording_rows_v1(null,null,null,'{}'::uuid[],null,'deleted',true,null,null,null) r
where auth.uid() is not null and r.status='deleted'
order by status;
$counts$;

-- Private helpers are callable only by the trusted migration/function owner.
-- Service-role direct RPC execution is deliberately denied: these APIs require user sessions.
revoke all on function public.accessible_recording_rows_v1(uuid,uuid,uuid,uuid[],uuid,public.recording_status,boolean,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.accessible_recording_search_winners_v1(text,uuid,uuid,uuid,uuid[],public.recording_status)
  from public,anon,authenticated,service_role;
revoke all on function public.list_accessible_recordings_v1(uuid,uuid,uuid,uuid[],public.recording_status,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.search_accessible_recordings_v1(text,uuid,uuid,uuid,uuid[],public.recording_status,integer,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.count_accessible_recording_statuses_v1(text,uuid,uuid,uuid,uuid[])
  from public,anon,authenticated,service_role;
revoke all on function public.get_accessible_recording_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.list_accessible_recordings_v1(uuid,uuid,uuid,uuid[],public.recording_status,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.search_accessible_recordings_v1(text,uuid,uuid,uuid,uuid[],public.recording_status,integer,integer)
  to authenticated;
grant execute on function public.count_accessible_recording_statuses_v1(text,uuid,uuid,uuid,uuid[])
  to authenticated;
grant execute on function public.get_accessible_recording_v1(uuid) to authenticated;
