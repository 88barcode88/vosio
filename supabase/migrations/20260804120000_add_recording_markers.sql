create table public.recording_markers (
  id uuid primary key default gen_random_uuid(),
  client_marker_id uuid not null,
  recording_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  offset_ms bigint not null check (offset_ms between 0 and 86400000),
  marker_type text not null default 'important'
    check (marker_type in ('important', 'task', 'decision', 'follow_up')),
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_marker_id),
  foreign key (recording_id, user_id)
    references public.recordings(id, user_id) on delete cascade
);

create index recording_markers_recording_offset_idx
  on public.recording_markers(user_id, recording_id, offset_ms, id);

create trigger recording_markers_set_updated_at
before update on public.recording_markers
for each row execute function public.set_updated_at();

alter table public.recording_markers enable row level security;
alter table public.recording_markers force row level security;

revoke all on table public.recording_markers from public, anon, authenticated;
grant select, insert, update, delete on public.recording_markers to authenticated;
grant all on public.recording_markers to service_role;

create policy "recording markers select own" on public.recording_markers
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "recording markers insert own" on public.recording_markers
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "recording markers update own" on public.recording_markers
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "recording markers delete own" on public.recording_markers
for delete to authenticated
using ((select auth.uid()) = user_id);
