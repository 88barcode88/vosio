alter table public.transcripts
  add constraint transcripts_id_recording_id_user_id_unique
  unique (id, recording_id, user_id);

create table public.transcript_search_chunks (
  transcript_id uuid not null,
  recording_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position > 0),
  start_ms bigint check (start_ms is null or start_ms >= 0),
  end_ms bigint check (
    end_ms is null
    or (end_ms >= 0 and (start_ms is null or end_ms >= start_ms))
  ),
  speaker_label text,
  text text not null check (char_length(btrim(text)) > 0),
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(text, ''))
  ) stored,
  constraint transcript_search_chunks_pkey primary key (transcript_id, position),
  constraint transcript_search_chunks_transcript_owner_fk
    foreign key (transcript_id, recording_id, user_id)
    references public.transcripts(id, recording_id, user_id) on delete cascade
);

create index transcript_search_chunks_vector_idx
  on public.transcript_search_chunks using gin (search_vector);
create index transcripts_user_recording_latest_idx
  on public.transcripts(user_id, recording_id, created_at desc, id desc);

alter table public.recordings
  add column metadata_search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, ''))
  ) stored;
alter table public.recording_clients
  add column metadata_search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(name, ''))
  ) stored;
alter table public.recording_projects
  add column metadata_search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(name, ''))
  ) stored;
alter table public.recording_folders
  add column metadata_search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(name, ''))
  ) stored;
alter table public.recording_tags
  add column metadata_search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(name, ''))
  ) stored;

create index recordings_metadata_search_idx
  on public.recordings using gin (metadata_search_vector);
create index recording_clients_metadata_search_idx
  on public.recording_clients using gin (metadata_search_vector);
create index recording_projects_metadata_search_idx
  on public.recording_projects using gin (metadata_search_vector);
create index recording_folders_metadata_search_idx
  on public.recording_folders using gin (metadata_search_vector);
create index recording_tags_metadata_search_idx
  on public.recording_tags using gin (metadata_search_vector);

alter table public.transcript_search_chunks enable row level security;
alter table public.transcript_search_chunks force row level security;

revoke all on table public.transcript_search_chunks from public, anon, authenticated;
grant select on public.transcript_search_chunks to authenticated;
grant all on public.transcript_search_chunks to service_role;

create policy "transcript search chunks select own"
on public.transcript_search_chunks
for select
to authenticated
using ((select auth.uid()) = user_id);

-- search_own_recordings_v1 returns one ranked owned recording per transcript or metadata match.
create or replace function public.search_own_recordings_v1(
  p_query text,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[],
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

revoke all on function public.search_own_recordings_v1(text,uuid,uuid,uuid,uuid[],integer,integer)
from public, anon;
grant execute on function public.search_own_recordings_v1(text,uuid,uuid,uuid,uuid[],integer,integer)
to authenticated;

-- replace_transcript_search_chunks_v1 validates and atomically replaces one stored transcript index.
create or replace function public.replace_transcript_search_chunks_v1(
  p_transcript_id uuid,
  p_chunks jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $replace$
declare
  transcript_row record;
begin
  if jsonb_typeof(coalesce(p_chunks, '[]'::jsonb)) <> 'array' then
    raise exception 'p_chunks must be a JSON array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as chunk(item)
    where jsonb_typeof(chunk.item) <> 'object'
      or jsonb_typeof(chunk.item->'position') is distinct from 'number'
      or jsonb_typeof(chunk.item->'text') is distinct from 'string'
      or char_length(btrim(chunk.item->>'text')) = 0
      or coalesce(jsonb_typeof(chunk.item->'speaker_label'), 'null') not in ('null', 'string')
      or coalesce(jsonb_typeof(chunk.item->'start_ms'), 'null') not in ('null', 'number')
      or coalesce(jsonb_typeof(chunk.item->'end_ms'), 'null') not in ('null', 'number')
  ) then
    raise exception 'invalid transcript search chunk';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as chunk(item)
    where (chunk.item->>'position')::numeric <> trunc((chunk.item->>'position')::numeric)
      or (chunk.item->>'position')::numeric < 1
      or (chunk.item->>'position')::numeric > 2147483647
  ) then
    raise exception 'invalid transcript search chunk position';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as chunk(item)
    where (
      coalesce(jsonb_typeof(chunk.item->'start_ms'), 'null') = 'number'
      and (
        (chunk.item->>'start_ms')::numeric <> trunc((chunk.item->>'start_ms')::numeric)
        or (chunk.item->>'start_ms')::numeric < 0
        or (chunk.item->>'start_ms')::numeric > 9223372036854775807
      )
    )
      or (
        coalesce(jsonb_typeof(chunk.item->'end_ms'), 'null') = 'number'
        and (
          (chunk.item->>'end_ms')::numeric <> trunc((chunk.item->>'end_ms')::numeric)
          or (chunk.item->>'end_ms')::numeric < 0
          or (chunk.item->>'end_ms')::numeric > 9223372036854775807
        )
      )
      or (
        coalesce(jsonb_typeof(chunk.item->'start_ms'), 'null') = 'number'
        and coalesce(jsonb_typeof(chunk.item->'end_ms'), 'null') = 'number'
        and (chunk.item->>'end_ms')::numeric < (chunk.item->>'start_ms')::numeric
      )
  ) then
    raise exception 'invalid transcript search chunk timestamp range';
  end if;

  if (
    select count(*) <> count(distinct (chunk.item->>'position')::integer)
    from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) as chunk(item)
  ) then
    raise exception 'duplicate transcript search chunk position';
  end if;

  select t.id, t.recording_id, t.user_id
  into transcript_row
  from public.transcripts t
  where t.id = p_transcript_id
  for update;

  if not found then
    raise exception 'transcript not found';
  end if;

  delete from public.transcript_search_chunks c
  where c.transcript_id = transcript_row.id
    and c.recording_id = transcript_row.recording_id
    and c.user_id = transcript_row.user_id;

  insert into public.transcript_search_chunks (
    transcript_id,
    recording_id,
    user_id,
    position,
    start_ms,
    end_ms,
    speaker_label,
    text
  )
  select
    transcript_row.id,
    transcript_row.recording_id,
    transcript_row.user_id,
    chunk.position,
    chunk.start_ms,
    chunk.end_ms,
    nullif(btrim(chunk.speaker_label), ''),
    btrim(chunk.text)
  from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as chunk(
    position integer,
    start_ms bigint,
    end_ms bigint,
    speaker_label text,
    text text
  );
end;
$replace$;

revoke all on function public.replace_transcript_search_chunks_v1(uuid,jsonb)
from public, anon, authenticated;
grant execute on function public.replace_transcript_search_chunks_v1(uuid,jsonb)
to service_role;

-- refresh_transcript_search_fallback_v1 keeps a searchable raw-text row in the transcript write transaction.
create or replace function public.refresh_transcript_search_fallback_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fallback$
begin
  delete from public.transcript_search_chunks c
  where c.transcript_id = new.id
    and c.recording_id = new.recording_id
    and c.user_id = new.user_id;

  if btrim(new.raw_text) <> '' then
    insert into public.transcript_search_chunks (
      transcript_id,
      recording_id,
      user_id,
      position,
      start_ms,
      end_ms,
      speaker_label,
      text
    ) values (
      new.id,
      new.recording_id,
      new.user_id,
      1,
      null,
      null,
      null,
      btrim(new.raw_text)
    );
  end if;

  return new;
end;
$fallback$;

revoke all on function public.refresh_transcript_search_fallback_v1()
from public, anon, authenticated;

create trigger transcripts_refresh_search_fallback
after insert or update of raw_text, segments, speakers on public.transcripts
for each row execute function public.refresh_transcript_search_fallback_v1();

insert into public.transcript_search_chunks (
  transcript_id,
  recording_id,
  user_id,
  position,
  start_ms,
  end_ms,
  speaker_label,
  text
)
select
  t.id,
  t.recording_id,
  t.user_id,
  1,
  null,
  null,
  null,
  btrim(t.raw_text)
from public.transcripts t
where btrim(t.raw_text) <> ''
on conflict (transcript_id, position) do nothing;
