create table public.recording_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_clients_id_user_id_unique unique (id, user_id)
);

create table public.recording_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_projects_id_user_id_unique unique (id, user_id),
  constraint recording_projects_id_client_id_user_id_unique unique (id, client_id, user_id),
  -- Deferred NO ACTION preserves normal client-delete blocking while allowing auth-user cascades to remove children first.
  constraint recording_projects_client_user_fk
    foreign key (client_id, user_id)
    references public.recording_clients(id, user_id)
    on delete no action deferrable initially deferred
);

create table public.recording_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_folders_id_user_id_unique unique (id, user_id)
);

create table public.recording_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recording_tags_id_user_id_unique unique (id, user_id)
);

alter table public.recordings
  add column client_id uuid,
  add column project_id uuid,
  add column folder_id uuid,
  add constraint recordings_project_requires_client_check
    check (project_id is null or client_id is not null),
  -- Deferred NO ACTION preserves normal client-delete blocking while allowing auth-user cascades to remove children first.
  add constraint recordings_client_user_fk
    foreign key (client_id, user_id)
    references public.recording_clients(id, user_id)
    on delete no action deferrable initially deferred,
  add constraint recordings_project_client_user_fk
    foreign key (project_id, client_id, user_id)
    references public.recording_projects(id, client_id, user_id)
    on delete set null (project_id),
  add constraint recordings_folder_user_fk
    foreign key (folder_id, user_id)
    references public.recording_folders(id, user_id)
    on delete set null (folder_id);

create table public.recording_tag_links (
  recording_id uuid not null,
  tag_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint recording_tag_links_pkey primary key (recording_id, tag_id),
  constraint recording_tag_links_recording_user_fk
    foreign key (recording_id, user_id)
    references public.recordings(id, user_id) on delete cascade,
  constraint recording_tag_links_tag_user_fk
    foreign key (tag_id, user_id)
    references public.recording_tags(id, user_id) on delete cascade
);

-- RELEASE GATE: verify the full auth.users account cascade in a disposable database before applying this migration live.

create unique index recording_clients_user_name_ci_uidx
  on public.recording_clients(user_id, lower(btrim(name)));
create unique index recording_projects_user_client_name_ci_uidx
  on public.recording_projects(user_id, client_id, lower(btrim(name)));
create unique index recording_folders_user_name_ci_uidx
  on public.recording_folders(user_id, lower(btrim(name)));
create unique index recording_tags_user_name_ci_uidx
  on public.recording_tags(user_id, lower(btrim(name)));
create index recordings_user_client_created_idx
  on public.recordings(user_id, client_id, created_at desc, id desc);
create index recordings_user_project_created_idx
  on public.recordings(user_id, project_id, created_at desc, id desc);
create index recordings_user_folder_created_idx
  on public.recordings(user_id, folder_id, created_at desc, id desc);
create index recording_tag_links_user_tag_recording_idx
  on public.recording_tag_links(user_id, tag_id, recording_id);

create trigger recording_clients_set_updated_at
before update on public.recording_clients
for each row execute function public.set_updated_at();

create trigger recording_projects_set_updated_at
before update on public.recording_projects
for each row execute function public.set_updated_at();

create trigger recording_folders_set_updated_at
before update on public.recording_folders
for each row execute function public.set_updated_at();

create trigger recording_tags_set_updated_at
before update on public.recording_tags
for each row execute function public.set_updated_at();

alter table public.recording_clients enable row level security;
alter table public.recording_clients force row level security;
alter table public.recording_projects enable row level security;
alter table public.recording_projects force row level security;
alter table public.recording_folders enable row level security;
alter table public.recording_folders force row level security;
alter table public.recording_tags enable row level security;
alter table public.recording_tags force row level security;
alter table public.recording_tag_links enable row level security;
alter table public.recording_tag_links force row level security;

revoke all on table public.recording_clients from public, anon, authenticated;
revoke all on table public.recording_projects, public.recording_folders,
  public.recording_tags, public.recording_tag_links from public, anon, authenticated;
grant select, insert, update, delete on public.recording_clients to authenticated;
grant select, insert, update, delete on public.recording_projects,
  public.recording_folders, public.recording_tags, public.recording_tag_links to authenticated;
grant all on public.recording_clients to service_role;
grant all on public.recording_projects, public.recording_folders,
  public.recording_tags, public.recording_tag_links to service_role;

create policy "recording clients select own" on public.recording_clients
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "recording clients insert own" on public.recording_clients
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "recording clients update own" on public.recording_clients
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "recording clients delete own" on public.recording_clients
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "recording projects select own" on public.recording_projects
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "recording projects insert own" on public.recording_projects
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "recording projects update own" on public.recording_projects
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "recording projects delete own" on public.recording_projects
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "recording folders select own" on public.recording_folders
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "recording folders insert own" on public.recording_folders
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "recording folders update own" on public.recording_folders
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "recording folders delete own" on public.recording_folders
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "recording tags select own" on public.recording_tags
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "recording tags insert own" on public.recording_tags
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "recording tags update own" on public.recording_tags
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "recording tags delete own" on public.recording_tags
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "recording tag links select own" on public.recording_tag_links
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "recording tag links insert own" on public.recording_tag_links
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "recording tag links update own" on public.recording_tag_links
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "recording tag links delete own" on public.recording_tag_links
for delete to authenticated
using ((select auth.uid()) = user_id);

-- assign_recording_organization_v1 atomically replaces one owned recording's organization.
create or replace function public.assign_recording_organization_v1(
  p_recording_id uuid,
  p_client_id uuid,
  p_project_id uuid,
  p_folder_id uuid,
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $assign$
declare
  current_user_id uuid := (select auth.uid());
  normalized_tag_ids uuid[];
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  perform 1
  from public.recordings r
  where r.id = p_recording_id
    and r.user_id = current_user_id
    and r.status <> 'deleted'
  for update;
  if not found then
    raise exception 'recording not found';
  end if;

  if p_client_id is not null and not exists (
    select 1
    from public.recording_clients c
    where c.id = p_client_id and c.user_id = current_user_id
  ) then
    raise exception 'client not found';
  end if;

  if p_project_id is not null and not exists (
    select 1
    from public.recording_projects p
    where p.id = p_project_id
      and p.client_id = p_client_id
      and p.user_id = current_user_id
  ) then
    raise exception 'project does not belong to client';
  end if;

  if p_folder_id is not null and not exists (
    select 1
    from public.recording_folders f
    where f.id = p_folder_id and f.user_id = current_user_id
  ) then
    raise exception 'folder not found';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as requested(tag_id)
    where requested.tag_id is null
  ) then
    raise exception 'tag ids cannot contain null';
  end if;

  select coalesce(
    array_agg(distinct requested.tag_id order by requested.tag_id),
    '{}'::uuid[]
  )
  into normalized_tag_ids
  from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as requested(tag_id);

  if (
    select count(*)
    from public.recording_tags t
    where t.user_id = current_user_id
      and t.id = any(normalized_tag_ids)
  ) <> cardinality(normalized_tag_ids) then
    raise exception 'one or more tags not found';
  end if;

  update public.recordings
  set client_id = p_client_id,
      project_id = p_project_id,
      folder_id = p_folder_id
  where id = p_recording_id and user_id = current_user_id;

  delete from public.recording_tag_links
  where recording_id = p_recording_id and user_id = current_user_id;

  insert into public.recording_tag_links(recording_id, tag_id, user_id)
  select p_recording_id, requested.tag_id, current_user_id
  from unnest(normalized_tag_ids) as requested(tag_id);
end;
$assign$;

-- list_own_recordings_v1 returns owned active recordings matching every selected tag.
create or replace function public.list_own_recordings_v1(
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'::uuid[],
  p_limit integer default 100,
  p_offset integer default 0
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
order by r.created_at desc, r.id desc
limit greatest(1, least(coalesce(p_limit, 100), 1000))
offset greatest(coalesce(p_offset, 0), 0);
$list$;

revoke all on function public.assign_recording_organization_v1(uuid,uuid,uuid,uuid,uuid[])
from public, anon;
grant execute on function public.assign_recording_organization_v1(uuid,uuid,uuid,uuid,uuid[])
to authenticated;

revoke all on function public.list_own_recordings_v1(uuid,uuid,uuid,uuid[],integer,integer)
from public, anon;
grant execute on function public.list_own_recordings_v1(uuid,uuid,uuid,uuid[],integer,integer)
to authenticated;
