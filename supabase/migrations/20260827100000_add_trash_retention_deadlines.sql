-- Snapshot one validated automatic-retention deadline whenever a recording enters Trash.
alter table public.recordings
  add column trash_retention_hours smallint,
  add column purge_after timestamptz,
  add column purge_attempt_count smallint not null default 0;

-- Preserve the historical deletion time while giving legacy Trash rows the safest policy.
alter table public.recordings disable trigger recordings_set_updated_at;

update public.recordings as recordings
set
  trash_retention_hours = 720,
  purge_after = recordings.deleted_at + interval '30 days',
  purge_attempt_count = 0
where recordings.status = 'deleted'::public.recording_status;

alter table public.recordings enable trigger recordings_set_updated_at;

alter table public.recordings
  drop constraint recordings_trash_metadata_consistent_check,
  add constraint recordings_trash_retention_hours_check
    check (
      trash_retention_hours is null
      or trash_retention_hours in (24, 168, 720)
    ),
  add constraint recordings_purge_attempt_count_check
    check (purge_attempt_count between 0 and 5),
  add constraint recordings_trash_metadata_consistent_check
    check (
      (
        status = 'deleted'::public.recording_status
        and deleted_from_status is not null
        and deleted_at is not null
        and trash_retention_hours in (24, 168, 720)
        and purge_after = deleted_at + make_interval(hours => trash_retention_hours)
      )
      or (
        status <> 'deleted'::public.recording_status
        and deleted_from_status is null
        and deleted_at is null
        and trash_retention_hours is null
        and purge_after is null
        and purge_attempt_count = 0
      )
    );

-- recordings_manage_trash_metadata owns immutable retention and purge lease snapshots.
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
    new.deleted_at := statement_timestamp();
    if new.trash_retention_hours is null
      or new.trash_retention_hours not in (24, 168, 720) then
      new.trash_retention_hours := 720;
    end if;
    new.purge_after := new.deleted_at + make_interval(hours => new.trash_retention_hours);
    new.purge_attempt_count := 0;
    new.purge_started_at := null;
    new.purge_claim_id := null;
  elsif old.status = 'deleted'::public.recording_status
    and new.status = 'deleted'::public.recording_status then
    new.deleted_from_status := old.deleted_from_status;
    new.deleted_at := old.deleted_at;
    new.trash_retention_hours := old.trash_retention_hours;
    new.purge_after := old.purge_after;

    if current_user = 'service_role' then
      new.purge_started_at := new.purge_started_at;
      new.purge_claim_id := new.purge_claim_id;
      new.purge_attempt_count := new.purge_attempt_count;
    else
      new.purge_started_at := old.purge_started_at;
      new.purge_claim_id := old.purge_claim_id;
      new.purge_attempt_count := old.purge_attempt_count;
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
    new.trash_retention_hours := null;
    new.purge_after := null;
    new.purge_attempt_count := 0;
    new.purge_started_at := null;
    new.purge_claim_id := null;
  else
    new.deleted_from_status := null;
    new.deleted_at := null;
    new.trash_retention_hours := null;
    new.purge_after := null;
    new.purge_attempt_count := 0;
    new.purge_started_at := null;
    new.purge_claim_id := null;
  end if;

  return new;
end;
$$;

-- Direct invocation is service-only; PostgreSQL still fires this installed trigger on row updates.
revoke all on function public.recordings_manage_trash_metadata() from public, anon, authenticated;
grant execute on function public.recordings_manage_trash_metadata() to service_role;

create index recordings_due_purge_idx
on public.recordings (purge_after, id)
where status = 'deleted';

-- claim_due_recording_purges_v1 atomically leases a stable bounded due batch.
create or replace function public.claim_due_recording_purges_v1(
  p_limit integer default 20
)
returns table (
  id uuid,
  user_id uuid,
  storage_path text,
  purge_claim_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select recordings.id
    from public.recordings as recordings
    where recordings.status = 'deleted'::public.recording_status
      and recordings.purge_after <= statement_timestamp()
      and recordings.deleted_at <= statement_timestamp() - interval '24 hours'
      and recordings.purge_attempt_count < 5
      and (
        recordings.purge_started_at is null
        or recordings.purge_started_at <= statement_timestamp() - interval '15 minutes'
      )
    order by recordings.purge_after, recordings.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 0), 20)
  )
  update public.recordings as recordings
  set
    purge_claim_id = gen_random_uuid(),
    purge_started_at = statement_timestamp(),
    purge_attempt_count = recordings.purge_attempt_count + 1
  from candidates
  where recordings.id = candidates.id
  returning
    recordings.id,
    recordings.user_id,
    recordings.storage_path,
    recordings.purge_claim_id;
end;
$$;

-- refresh_recording_purge_claim_v1 renews only the caller's exact lease token.
create or replace function public.refresh_recording_purge_claim_v1(
  p_recording_id uuid,
  p_claim_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owns_claim boolean;
begin
  with refreshed as (
    update public.recordings as recordings
    set purge_started_at = statement_timestamp()
    where recordings.id = p_recording_id
      and recordings.status = 'deleted'::public.recording_status
      and recordings.purge_claim_id = p_claim_id
    returning 1
  )
  select exists(select 1 from refreshed) into owns_claim;

  return owns_claim;
end;
$$;

-- finalize_recording_purge_v1 deletes only a still-due row owned by this exact lease.
create or replace function public.finalize_recording_purge_v1(
  p_recording_id uuid,
  p_claim_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owns_claim boolean;
begin
  with finalized as (
    delete from public.recordings as recordings
    where recordings.id = p_recording_id
      and recordings.status = 'deleted'::public.recording_status
      and recordings.purge_claim_id = p_claim_id
      and recordings.purge_after <= statement_timestamp()
      and recordings.deleted_at <= statement_timestamp() - interval '24 hours'
    returning 1
  )
  select exists(select 1 from finalized) into owns_claim;

  return owns_claim;
end;
$$;

-- release_recording_purge_claim_v1 releases only the caller's exact retryable lease.
create or replace function public.release_recording_purge_claim_v1(
  p_recording_id uuid,
  p_claim_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owns_claim boolean;
begin
  with released as (
    update public.recordings as recordings
    set
      purge_claim_id = null,
      purge_started_at = null
    where recordings.id = p_recording_id
      and recordings.status = 'deleted'::public.recording_status
      and recordings.purge_claim_id = p_claim_id
    returning 1
  )
  select exists(select 1 from released) into owns_claim;

  return owns_claim;
end;
$$;

revoke all on function public.claim_due_recording_purges_v1(integer) from public, anon, authenticated;
revoke all on function public.refresh_recording_purge_claim_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_recording_purge_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_recording_purge_claim_v1(uuid, uuid) from public, anon, authenticated;

grant execute on function public.claim_due_recording_purges_v1(integer) to service_role;
grant execute on function public.refresh_recording_purge_claim_v1(uuid, uuid) to service_role;
grant execute on function public.finalize_recording_purge_v1(uuid, uuid) to service_role;
grant execute on function public.release_recording_purge_claim_v1(uuid, uuid) to service_role;
