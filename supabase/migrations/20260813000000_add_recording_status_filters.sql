-- Status-aware V2 list keeps V1 callable and preserves owner, ALL-tag and keyset semantics.
create or replace function public.list_own_recordings_v2(
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[],
  p_status public.recording_status default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
)
returns setof public.recordings
language sql
stable
security invoker
set search_path = public, pg_temp
as $list$
with tag_filter as (
  select coalesce(
    array_agg(distinct requested.tag_id order by requested.tag_id)
      filter (where requested.tag_id is not null),
    '{}'::uuid[]
  ) as tag_ids
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as requested(tag_id)
)
select r.*
from public.recordings r
cross join tag_filter tf
where r.user_id = (select auth.uid())
  and r.status <> 'deleted'
  and (p_status is null or r.status = p_status)
  and (p_client_id is null or r.client_id = p_client_id)
  and (p_project_id is null or r.project_id = p_project_id)
  and (p_folder_id is null or r.folder_id = p_folder_id)
  and (
    (p_before_created_at is null and p_before_id is null)
    or (
      p_before_created_at is not null
      and p_before_id is not null
      and (r.created_at, r.id) < (p_before_created_at, p_before_id)
    )
  )
  and (
    cardinality(tf.tag_ids) = 0
    or (
      select count(distinct rtl.tag_id)
      from public.recording_tag_links rtl
      where rtl.recording_id = r.id
        and rtl.user_id = (select auth.uid())
        and rtl.tag_id = any(tf.tag_ids)
    ) = cardinality(tf.tag_ids)
  )
order by r.created_at desc, r.id desc
limit greatest(1, least(coalesce(p_limit, 100), 1000));
$list$;

-- search_own_recordings_v2 adds one active status while preserving the V1 ranked search contract.
create or replace function public.search_own_recordings_v2(
  p_query text,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[],
  p_status public.recording_status default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  recording_id uuid,
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
  matched_excerpt text,
  match_start_ms bigint,
  match_end_ms bigint,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $search$
with authenticated_user as (
  select auth.uid() as user_id
), normalized_input as (
  select left(
    regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'),
    120
  ) as query_text
), parsed_input as (
  select query_text, websearch_to_tsquery('simple'::regconfig, query_text) as ts_query
  from normalized_input
  where query_text <> ''
), tag_filter as (
  select coalesce(
    array_agg(distinct requested.tag_id order by requested.tag_id)
      filter (where requested.tag_id is not null),
    '{}'::uuid[]
  ) as tag_ids
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as requested(tag_id)
), latest_transcripts as (
  select distinct on (t.recording_id)
    t.id,
    t.recording_id,
    t.user_id
  from public.transcripts t
  cross join authenticated_user au
  where t.user_id = au.user_id
  order by t.recording_id, t.created_at desc, t.id desc
), eligible_recordings as (
  select r.*
  from public.recordings r
  cross join authenticated_user au
  cross join tag_filter tf
  where au.user_id is not null
    and r.user_id = au.user_id
    and r.status <> 'deleted'
    and (p_status is null or r.status = p_status)
    and (p_client_id is null or r.client_id = p_client_id)
    and (p_project_id is null or r.project_id = p_project_id)
    and (p_folder_id is null or r.folder_id = p_folder_id)
    and (
      cardinality(tf.tag_ids) = 0
      or (
        select count(distinct rtl.tag_id)
        from public.recording_tag_links rtl
        where rtl.recording_id = r.id
          and rtl.user_id = au.user_id
          and rtl.tag_id = any(tf.tag_ids)
      ) = cardinality(tf.tag_ids)
    )
), transcript_candidates as (
  select
    r.id as recording_id,
    r.title,
    r.source_type,
    r.mime_type,
    r.duration_seconds,
    r.file_size_bytes,
    r.status,
    r.created_at,
    r.updated_at,
    r.client_id,
    r.project_id,
    r.folder_id,
    ts_headline(
      'simple'::regconfig,
      c.text,
      i.ts_query,
      'StartSel=[[H]], StopSel=[[/H]], MaxWords=35, MinWords=15'
    ) as matched_excerpt,
    c.start_ms as match_start_ms,
    c.end_ms as match_end_ms,
    ts_rank_cd(c.search_vector, i.ts_query) as match_rank,
    0 as match_kind,
    c.position as candidate_position
  from eligible_recordings r
  join latest_transcripts lt
    on lt.recording_id = r.id and lt.user_id = r.user_id
  join public.transcript_search_chunks c
    on c.transcript_id = lt.id and c.recording_id = r.id and c.user_id = r.user_id
  cross join parsed_input i
  where c.search_vector @@ i.ts_query
), metadata_candidates as (
  select
    r.id as recording_id,
    r.title,
    r.source_type,
    r.mime_type,
    r.duration_seconds,
    r.file_size_bytes,
    r.status,
    r.created_at,
    r.updated_at,
    r.client_id,
    r.project_id,
    r.folder_id,
    ts_headline(
      'simple'::regconfig,
      concat_ws(' · ', r.title, rc.name, rp.name, rf.name, mt.names),
      i.ts_query,
      'StartSel=[[H]], StopSel=[[/H]], MaxWords=35, MinWords=15'
    ) as matched_excerpt,
    null::bigint as match_start_ms,
    null::bigint as match_end_ms,
    greatest(
      ts_rank_cd(r.metadata_search_vector, i.ts_query),
      coalesce(ts_rank_cd(rc.metadata_search_vector, i.ts_query), 0),
      coalesce(ts_rank_cd(rp.metadata_search_vector, i.ts_query), 0),
      coalesce(ts_rank_cd(rf.metadata_search_vector, i.ts_query), 0),
      coalesce(mt.tag_rank, 0)
    ) as match_rank,
    1 as match_kind,
    0 as candidate_position
  from eligible_recordings r
  left join public.recording_clients rc
    on rc.id = r.client_id and rc.user_id = r.user_id
  left join public.recording_projects rp
    on rp.id = r.project_id and rp.user_id = r.user_id
  left join public.recording_folders rf
    on rf.id = r.folder_id and rf.user_id = r.user_id
  cross join parsed_input i
  left join lateral (
    select
      string_agg(rt.name, ' · ' order by rt.name) as names,
      max(ts_rank_cd(rt.metadata_search_vector, i.ts_query)) as tag_rank,
      bool_or(rt.metadata_search_vector @@ i.ts_query) as tag_matches
    from public.recording_tag_links rtl
    join public.recording_tags rt
      on rt.id = rtl.tag_id and rt.user_id = rtl.user_id
    where rtl.recording_id = r.id and rtl.user_id = r.user_id
  ) mt on true
  where r.metadata_search_vector @@ i.ts_query
    or rc.metadata_search_vector @@ i.ts_query
    or rp.metadata_search_vector @@ i.ts_query
    or rf.metadata_search_vector @@ i.ts_query
    or coalesce(mt.tag_matches, false)
), all_candidates as (
  select * from transcript_candidates
  union all
  select * from metadata_candidates
), ranked as (
  select
    c.*,
    row_number() over (
      partition by c.recording_id
      order by
        c.match_rank desc,
        c.match_kind asc,
        c.match_start_ms asc nulls last,
        c.candidate_position asc,
        c.recording_id desc
    ) as candidate_number
  from all_candidates c
), winners as (
  select *
  from ranked
  where candidate_number = 1
)
select
  w.recording_id,
  w.title,
  w.source_type,
  w.mime_type,
  w.duration_seconds,
  w.file_size_bytes,
  w.status,
  w.created_at,
  w.updated_at,
  w.client_id,
  w.project_id,
  w.folder_id,
  w.matched_excerpt,
  w.match_start_ms,
  w.match_end_ms,
  count(*) over () as total_count
from winners w
order by w.match_rank desc, w.created_at desc, w.recording_id desc
limit greatest(1, least(coalesce(p_limit, 25), 50))
offset greatest(coalesce(p_offset, 0), 0);
$search$;

-- count_own_recording_statuses_v1 returns exact active status facets for one owned filter scope.
create or replace function public.count_own_recording_statuses_v1(
  p_query text default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns table (status public.recording_status, total_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $counts$
with requested_statuses(status) as (
  values
    ('created'::public.recording_status),
    ('uploading'::public.recording_status),
    ('uploaded'::public.recording_status),
    ('transcribing'::public.recording_status),
    ('completed'::public.recording_status),
    ('failed'::public.recording_status)
), normalized as (
  select left(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'), 120) as query_text
), tag_filter as (
  select coalesce(
    array_agg(distinct requested.tag_id order by requested.tag_id)
      filter (where requested.tag_id is not null),
    '{}'::uuid[]
  ) as tag_ids
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as requested(tag_id)
), direct_counts as (
  select r.status, count(*)::bigint as total_count
  from public.recordings r
  cross join tag_filter tf
  where r.user_id = (select auth.uid())
    and r.status <> 'deleted'
    and (p_client_id is null or r.client_id = p_client_id)
    and (p_project_id is null or r.project_id = p_project_id)
    and (p_folder_id is null or r.folder_id = p_folder_id)
    and (
      cardinality(tf.tag_ids) = 0
      or (
        select count(distinct rtl.tag_id)
        from public.recording_tag_links rtl
        where rtl.recording_id = r.id
          and rtl.user_id = (select auth.uid())
          and rtl.tag_id = any(tf.tag_ids)
      ) = cardinality(tf.tag_ids)
    )
  group by r.status
)
select rs.status,
  case
    when n.query_text = '' then coalesce(dc.total_count, 0)
    else coalesce(search_count.total_count, 0)
  end as total_count
from requested_statuses rs
cross join normalized n
cross join tag_filter tf
left join direct_counts dc on dc.status = rs.status
left join lateral (
  select result.total_count
  from public.search_own_recordings_v2(
    n.query_text,
    p_client_id,
    p_project_id,
    p_folder_id,
    tf.tag_ids,
    rs.status,
    1,
    0
  ) result
  limit 1
) search_count on n.query_text <> ''
order by array_position(
  array['created','uploading','uploaded','transcribing','completed','failed']::public.recording_status[],
  rs.status
);
$counts$;

revoke all on function public.list_own_recordings_v2(uuid,uuid,uuid,uuid[],public.recording_status,timestamptz,uuid,integer)
from public, anon;
grant execute on function public.list_own_recordings_v2(uuid,uuid,uuid,uuid[],public.recording_status,timestamptz,uuid,integer)
to authenticated, service_role;

revoke all on function public.search_own_recordings_v2(text,uuid,uuid,uuid,uuid[],public.recording_status,integer,integer)
from public, anon;
grant execute on function public.search_own_recordings_v2(text,uuid,uuid,uuid,uuid[],public.recording_status,integer,integer)
to authenticated, service_role;

revoke all on function public.count_own_recording_statuses_v1(text,uuid,uuid,uuid,uuid[])
from public, anon;
grant execute on function public.count_own_recording_statuses_v1(text,uuid,uuid,uuid,uuid[])
to authenticated, service_role;
