-- Preserve the exact pre-trash recording state so restore is lossless.
alter table public.recordings
  add column deleted_from_status public.recording_status,
  add column deleted_at timestamptz,
  add column purge_started_at timestamptz,
  add column purge_claim_id uuid;

-- Legacy Trash rows did not capture their prior state, so backfill deterministically.
-- Keep the historical updated_at value intact while copying it to deleted_at.
alter table public.recordings disable trigger recordings_set_updated_at;

update public.recordings as recordings
set
  deleted_from_status = case
    when exists (
      select 1
      from public.transcripts
      where transcripts.recording_id = recordings.id
        and transcripts.user_id = recordings.user_id
    ) then 'completed'::public.recording_status
    when recordings.storage_path is not null then 'uploaded'::public.recording_status
    else 'failed'::public.recording_status
  end,
  deleted_at = recordings.updated_at
where recordings.status = 'deleted'::public.recording_status;

alter table public.recordings enable trigger recordings_set_updated_at;

alter table public.recordings
  add constraint recordings_deleted_from_status_not_deleted_check
    check (
      deleted_from_status is null
      or deleted_from_status <> 'deleted'::public.recording_status
    ),
  add constraint recordings_trash_metadata_consistent_check
    check (
      (
        status = 'deleted'::public.recording_status
        and deleted_from_status is not null
        and deleted_at is not null
      )
      or (
        status <> 'deleted'::public.recording_status
        and deleted_from_status is null
        and deleted_at is null
      )
    ),
  add constraint recordings_purge_claim_deleted_check
    check (
      status = 'deleted'::public.recording_status
      or (purge_started_at is null and purge_claim_id is null)
    ),
  add constraint recordings_purge_claim_consistent_check
    check (
      (purge_started_at is null and purge_claim_id is null)
      or (purge_started_at is not null and purge_claim_id is not null)
    );

-- recordings_manage_trash_metadata captures and restores status inside the row update.
create or replace function public.recordings_manage_trash_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'deleted'::public.recording_status
    and new.status = 'deleted'::public.recording_status then
    new.deleted_from_status := old.status;
    new.deleted_at := now();
    new.purge_started_at := null;
    new.purge_claim_id := null;
  elsif old.status = 'deleted'::public.recording_status
    and new.status = 'deleted'::public.recording_status then
    new.deleted_from_status := old.deleted_from_status;
    new.deleted_at := old.deleted_at;

    if current_user = 'service_role' then
      new.purge_started_at := new.purge_started_at;
      new.purge_claim_id := new.purge_claim_id;
    else
      new.purge_started_at := old.purge_started_at;
      new.purge_claim_id := old.purge_claim_id;
    end if;
  elsif old.status = 'deleted'::public.recording_status
    and new.status <> 'deleted'::public.recording_status then
    if old.purge_started_at is not null or old.purge_claim_id is not null then
      raise exception 'recording purge is already in progress'
        using errcode = '55000';
    end if;

    new.status := old.deleted_from_status;
    new.deleted_from_status := null;
    new.deleted_at := null;
    new.purge_started_at := null;
    new.purge_claim_id := null;
  else
    new.deleted_from_status := null;
    new.deleted_at := null;
    new.purge_started_at := null;
    new.purge_claim_id := null;
  end if;

  return new;
end;
$$;

create trigger recordings_manage_trash_metadata
before update on public.recordings
for each row
execute function public.recordings_manage_trash_metadata();

-- Authenticated TUS writes must still target an active, unclaimed owned recording.
drop policy if exists "recordings storage insert own folder" on storage.objects;
create policy "recordings storage insert own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.recordings as recordings
    where (storage.foldername(name))[2] = recordings.id::text
      and recordings.user_id = (select auth.uid())
      and recordings.status <> 'deleted'::public.recording_status
      and recordings.purge_started_at is null
      and recordings.purge_claim_id is null
  )
);

drop policy if exists "recordings storage update own folder" on storage.objects;
create policy "recordings storage update own folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.recordings as recordings
    where (storage.foldername(name))[2] = recordings.id::text
      and recordings.user_id = (select auth.uid())
      and recordings.status <> 'deleted'::public.recording_status
      and recordings.purge_started_at is null
      and recordings.purge_claim_id is null
  )
)
with check (
  bucket_id = 'recordings'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.recordings as recordings
    where (storage.foldername(name))[2] = recordings.id::text
      and recordings.user_id = (select auth.uid())
      and recordings.status <> 'deleted'::public.recording_status
      and recordings.purge_started_at is null
      and recordings.purge_claim_id is null
  )
);
