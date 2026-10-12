-- SOURCE ONLY: coordinated T3 app/Storage worker adoption required; apply transactionally after 20260922210000.
-- Durable opaque receipts survive recording deletion to support exact completion retries.
create table public.recording_purge_operations (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null,
  actor_id uuid not null,
  request_id uuid not null,
  storage_owner_id uuid,
  deleted_at timestamptz,
  claim_id uuid not null unique default gen_random_uuid(),
  phase text not null check (phase in ('prepared','started','released','superseded','completed')),
  created_at timestamptz not null default statement_timestamp(),
  worker_claimed_at timestamptz,
  work_attempt_count smallint not null default 0 check (work_attempt_count between 0 and 5),
  completed_at timestamptz,
  check (phase='completed' or (storage_owner_id is not null and deleted_at is not null)),
  unique(actor_id,request_id)
);
create unique index recording_purge_operations_active_idx on public.recording_purge_operations(recording_id)
  where phase in ('prepared','started');
create index recording_purge_operations_worker_idx on public.recording_purge_operations(worker_claimed_at,created_at,id)
  where phase='started' and work_attempt_count<5;
alter table public.recording_purge_operations enable row level security;
alter table public.recording_purge_operations force row level security;
revoke all on public.recording_purge_operations from public,anon,authenticated,service_role;

-- Output lineage probes and existing FK cascades must not scan every tenant's projection table.
create index if not exists transcript_tasks_output_transcript_idx on public.transcript_tasks(ai_output_id,transcript_id);
create index if not exists transcript_chapters_output_transcript_idx on public.transcript_chapters(ai_output_id,transcript_id);
create index if not exists transcript_decisions_output_transcript_idx on public.transcript_decisions(ai_output_id,transcript_id);
create index if not exists transcript_risks_output_transcript_idx on public.transcript_risks(ai_output_id,transcript_id);

-- Private lock+authority gate: permission reads occur after the canonical sharing lock and exact row lock.
create function public.lock_managed_trash_recording_v1(p_recording_id uuid)
returns public.recordings language plpgsql volatile security definer set search_path = '' as $gate$
declare v_record public.recordings;
begin
  perform public.recording_sharing_lock_v1();
  if auth.uid() is null then raise exception 'recording unavailable' using errcode='42501'; end if;
  select * into v_record from public.recordings where id=p_recording_id for update;
  if not found or not public.can_manage_recording(p_recording_id) then
    raise exception 'recording unavailable' using errcode='42501';
  end if;
  return v_record;
end;
$gate$;

-- Bounded enrichment of an already paginated Trash set; never supplies additional list rows or private worker fields.
create function public.get_managed_recording_trash_v1(p_recording_ids uuid[])
returns table(recording_id uuid,deleted_at timestamptz,trash_retention_hours smallint,purge_after timestamptz,purge_phase text)
language plpgsql stable security definer set search_path = '' as $metadata$
begin
  if auth.uid() is null then return; end if;
  if coalesce(cardinality(p_recording_ids),0)>100 then raise exception 'too many recording IDs' using errcode='22023'; end if;
  return query select r.id,r.deleted_at,r.trash_retention_hours,r.purge_after,
    case when o.phase is not null then o.phase when r.purge_claim_id is not null then 'started' else 'none' end
    from public.recordings r left join public.recording_purge_operations o
      on o.recording_id=r.id and o.phase in ('prepared','started')
    where r.id=any(p_recording_ids) and r.status='deleted' and public.can_manage_recording(r.id)
    order by r.id;
end;
$metadata$;

-- Atomically move currently managed content to Trash without changing custody or retention snapshots on retry.
create function public.trash_recording_v1(
  p_recording_id uuid,p_expected_updated_at timestamptz,p_retention_hours integer default 720
) returns jsonb language plpgsql volatile security definer set search_path = '' as $trash$
declare v_record public.recordings;
begin
  v_record := public.lock_managed_trash_recording_v1(p_recording_id);
  if p_expected_updated_at is null or p_retention_hours is null or p_retention_hours not in (24,168,720) then
    raise exception 'invalid trash request' using errcode='22023'; end if;
  if v_record.status='deleted' then
    return jsonb_build_object('recordingId',v_record.id,'status',v_record.status,'changed',false);
  end if;
  if v_record.updated_at<>p_expected_updated_at then raise exception 'recording changed' using errcode='40001'; end if;
  update public.recordings set status='deleted',trash_retention_hours=p_retention_hours where id=v_record.id;
  return jsonb_build_object('recordingId',v_record.id,'status','deleted','changed',true);
end;
$trash$;

-- Restore exactly the trigger-owned prior status, never a client-supplied status, while no cleanup claim exists.
create function public.restore_shared_recording_v1(p_recording_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $restore$
declare v_record public.recordings;
begin
  v_record := public.lock_managed_trash_recording_v1(p_recording_id);
  if p_expected_updated_at is null then raise exception 'invalid restore request' using errcode='22023'; end if;
  if v_record.status<>'deleted' then
    return jsonb_build_object('recordingId',v_record.id,'status',v_record.status,'changed',false);
  end if;
  if v_record.updated_at<>p_expected_updated_at then raise exception 'recording changed' using errcode='40001'; end if;
  if v_record.purge_claim_id is not null or v_record.purge_started_at is not null
    or exists(select 1 from public.recording_purge_operations where recording_id=v_record.id and phase in ('prepared','started')) then
    raise exception 'purge already reserved' using errcode='55000'; end if;
  update public.recordings set status=v_record.deleted_from_status where id=v_record.id;
  return jsonb_build_object('recordingId',v_record.id,'status',v_record.deleted_from_status,'changed',true);
end;
$restore$;

-- Reserve one recording generation; a stale started takeover remains irreversible and rotates the exact claim.
create function public.prepare_recording_purge_v1(
  p_recording_id uuid,p_request_id uuid,p_expected_updated_at timestamptz
) returns jsonb language plpgsql volatile security definer set search_path = '' as $prepare$
declare v_record public.recordings; v_op public.recording_purge_operations;
  v_old public.recording_purge_operations; v_phase text := 'prepared'; v_prefix text; v_attempts smallint := 0;
begin
  if p_request_id is null or p_expected_updated_at is null then
    raise exception 'invalid purge request' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  if auth.uid() is null then raise exception 'recording unavailable' using errcode='42501'; end if;
  -- Recover an own opaque receipt before current authority checks; this never creates or renews work.
  select * into v_op from public.recording_purge_operations
    where actor_id=auth.uid() and request_id=p_request_id;
  if found then
    if v_op.recording_id is distinct from p_recording_id then raise exception 'request reused' using errcode='22023'; end if;
    perform 1 from public.recordings where id=v_op.recording_id for update;
    select * into v_op from public.recording_purge_operations
      where actor_id=auth.uid() and request_id=p_request_id for update;
    if not found or v_op.recording_id is distinct from p_recording_id then
      raise exception 'purge unavailable' using errcode='42501'; end if;
    return jsonb_build_object('operationId',v_op.id,'phase',v_op.phase);
  end if;
  v_record := public.lock_managed_trash_recording_v1(p_recording_id);
  if v_record.status<>'deleted' then raise exception 'recording not in trash' using errcode='55000'; end if;
  if v_record.updated_at<>p_expected_updated_at then raise exception 'recording changed' using errcode='40001'; end if;
  if v_record.deleted_at>statement_timestamp()-interval '24 hours' then
    raise exception 'upload fence not elapsed' using errcode='55000'; end if;
  if v_record.purge_started_at>statement_timestamp()-interval '15 minutes' then
    raise exception 'purge in progress' using errcode='55000'; end if;
  v_prefix := v_record.user_id::text||'/'||v_record.id::text||'/';
  if v_record.storage_path is not null and (
    left(v_record.storage_path,length(v_prefix))<>v_prefix
    or position(chr(92) in v_record.storage_path)>0
    or v_record.storage_path ~ '(^|/)[.]{1,2}(/|$)'
  ) then raise exception 'invalid storage binding' using errcode='55000'; end if;
  select * into v_old from public.recording_purge_operations
    where recording_id=v_record.id and phase in ('prepared','started') for update;
  if found then
    if v_old.phase='started' and v_old.work_attempt_count>=5 then
      raise exception 'purge retry limit reached' using errcode='55000'; end if;
    if v_old.phase='started' then
      v_phase := 'started'; v_attempts := v_old.work_attempt_count;
    end if;
    update public.recording_purge_operations set phase='superseded' where id=v_old.id;
  end if;
  insert into public.recording_purge_operations(recording_id,actor_id,request_id,storage_owner_id,deleted_at,phase,work_attempt_count)
    values(v_record.id,auth.uid(),p_request_id,v_record.user_id,v_record.deleted_at,v_phase,v_attempts)
    returning * into v_op;
  update public.recordings set purge_claim_id=v_op.claim_id,purge_started_at=statement_timestamp() where id=v_record.id;
  return jsonb_build_object('operationId',v_op.id,'phase',v_op.phase);
end;
$prepare$;

-- Irreversible acceptance is session-authorized under the same lock; later revoke cannot strand accepted cleanup.
create function public.start_recording_purge_v1(p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $start$
declare v_op public.recording_purge_operations; v_record public.recordings;
begin
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_purge_operations where id=p_operation_id;
  if not found or auth.uid() is null or v_op.actor_id<>auth.uid() then
    raise exception 'purge unavailable' using errcode='42501'; end if;
  v_record := public.lock_managed_trash_recording_v1(v_op.recording_id);
  select * into v_op from public.recording_purge_operations where id=p_operation_id for update;
  if v_op.phase not in ('prepared','started') or v_record.status<>'deleted'
    or v_record.purge_claim_id is distinct from v_op.claim_id
    or v_record.deleted_at is distinct from v_op.deleted_at
    or v_record.user_id<>v_op.storage_owner_id
    or v_record.deleted_at>statement_timestamp()-interval '24 hours' then
    raise exception 'purge claim lost' using errcode='55000'; end if;
  update public.recording_purge_operations set phase='started' where id=v_op.id;
  update public.recordings set purge_started_at=statement_timestamp() where id=v_record.id;
  return jsonb_build_object('operationId',v_op.id,'phase','started','changed',v_op.phase='prepared');
end;
$start$;

-- The original requester may release an unstarted reservation even after losing access; no content is disclosed.
create function public.release_recording_purge_v1(p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $release$
declare v_op public.recording_purge_operations; v_record public.recordings;
begin
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_purge_operations where id=p_operation_id;
  if not found or auth.uid() is null or v_op.actor_id<>auth.uid() then
    raise exception 'purge unavailable' using errcode='42501'; end if;
  select * into v_record from public.recordings where id=v_op.recording_id for update;
  select * into v_op from public.recording_purge_operations where id=p_operation_id for update;
  if v_op.phase='released' then
    return jsonb_build_object('operationId',v_op.id,'phase','released','changed',false);
  end if;
  if v_op.phase <> 'prepared' or v_record.id is null or v_record.status<>'deleted'
    or v_record.purge_claim_id is distinct from v_op.claim_id then
    raise exception 'purge cannot be released' using errcode='55000'; end if;
  update public.recordings set purge_claim_id=null,purge_started_at=null where id=v_record.id;
  update public.recording_purge_operations set phase='released' where id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'phase','released','changed',true);
end;
$release$;

-- Private accepted-work gate checks exact receipt/generation/claim, not the former actor's current membership.
create function public.lock_accepted_recording_purge_v1(p_operation_id uuid)
returns public.recording_purge_operations language plpgsql volatile security definer set search_path = '' as $accepted$
declare v_op public.recording_purge_operations; v_record public.recordings;
begin
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_purge_operations where id=p_operation_id;
  if not found then raise exception 'purge unavailable' using errcode='42501'; end if;
  select * into v_record from public.recordings where id=v_op.recording_id for update;
  select * into v_op from public.recording_purge_operations where id=p_operation_id for update;
  if v_op.phase<>'started' or v_record.id is null or v_record.status<>'deleted'
    or v_record.purge_claim_id is distinct from v_op.claim_id
    or v_record.user_id<>v_op.storage_owner_id or v_record.deleted_at is distinct from v_op.deleted_at
    or v_record.deleted_at>statement_timestamp()-interval '24 hours' then
    raise exception 'purge claim lost' using errcode='55000'; end if;
  return v_op;
end;
$accepted$;

-- Private lease acquisition rotates on takeover; a matching token renews without spending another attempt.
create function public.lease_recording_purge_work_v1(p_operation_id uuid,p_claim_id uuid)
returns public.recording_purge_operations
language plpgsql volatile security definer set search_path = '' as $lease$
declare v_op public.recording_purge_operations;
begin
  v_op := public.lock_accepted_recording_purge_v1(p_operation_id);
  if p_claim_id is not null then
    if p_claim_id is distinct from v_op.claim_id or v_op.worker_claimed_at is null then
      raise exception 'purge lease lost' using errcode='55000'; end if;
  else
    if v_op.worker_claimed_at>statement_timestamp()-interval '15 minutes' then
      raise exception 'purge worker in progress' using errcode='55000'; end if;
    if v_op.work_attempt_count>=5 then raise exception 'purge retry limit reached' using errcode='55000'; end if;
    v_op.claim_id := gen_random_uuid();
    v_op.work_attempt_count := v_op.work_attempt_count+1;
  end if;
  update public.recording_purge_operations set claim_id=v_op.claim_id,worker_claimed_at=statement_timestamp(),work_attempt_count=v_op.work_attempt_count
    where id=v_op.id returning * into v_op;
  update public.recordings set purge_claim_id=v_op.claim_id,purge_started_at=statement_timestamp() where id=v_op.recording_id;
  return v_op;
end;
$lease$;

-- Service-only initial fetch or token-bound heartbeat of exactly one accepted operation.
create function public.acquire_recording_purge_work_v1(p_operation_id uuid,p_claim_id uuid default null)
returns table(recording_id uuid,storage_prefix text,claim_id uuid)
language plpgsql volatile security definer set search_path = '' as $acquire$
declare v_op public.recording_purge_operations;
begin
  v_op := public.lease_recording_purge_work_v1(p_operation_id,p_claim_id);
  return query select v_op.recording_id,v_op.storage_owner_id::text||'/'||v_op.recording_id::text||'/',v_op.claim_id;
end;
$acquire$;

-- Bounded recovery discovers accepted work after a crash, never prepared operations or arbitrary recordings.
create function public.claim_started_recording_purge_work_v1(p_limit integer default 5)
returns table(operation_id uuid,recording_id uuid,storage_prefix text,claim_id uuid)
language plpgsql volatile security definer set search_path = '' as $discover$
declare v_id uuid; v_op public.recording_purge_operations;
begin
  perform public.recording_sharing_lock_v1();
  for v_id in select o.id from public.recording_purge_operations o join public.recordings r on r.id=o.recording_id
    where o.phase='started' and o.work_attempt_count<5
      and (o.worker_claimed_at is null or o.worker_claimed_at<=statement_timestamp()-interval '15 minutes')
      and r.status='deleted' and r.purge_claim_id=o.claim_id and r.user_id=o.storage_owner_id and r.deleted_at=o.deleted_at
      and r.deleted_at<=statement_timestamp()-interval '24 hours'
    order by o.created_at,o.id limit least(greatest(coalesce(p_limit,5),0),5) for update of r skip locked
  loop
    v_op := public.lease_recording_purge_work_v1(v_id,null);
    return query select v_op.id,v_op.recording_id,v_op.storage_owner_id::text||'/'||v_op.recording_id::text||'/',v_op.claim_id;
  end loop;
end;
$discover$;

-- Finalization observes actual Storage metadata and cascades descendants only for the exact accepted lease.
create function public.finalize_recording_purge_work_v1(p_operation_id uuid,p_claim_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $finalize$
declare v_op public.recording_purge_operations; v_prefix text; v_deleted uuid;
begin
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_purge_operations where id=p_operation_id;
  if not found then raise exception 'purge unavailable' using errcode='42501'; end if;
  if p_claim_id is null or p_claim_id is distinct from v_op.claim_id or v_op.worker_claimed_at is null then
    raise exception 'purge lease lost' using errcode='55000'; end if;
  if v_op.phase='completed' then return true; end if;
  v_op := public.lock_accepted_recording_purge_v1(p_operation_id);
  v_prefix := v_op.storage_owner_id::text||'/'||v_op.recording_id::text||'/';
  if exists(select 1 from storage.objects where bucket_id='recordings' and left(name,length(v_prefix))=v_prefix) then
    raise exception 'storage prefix not empty' using errcode='55000'; end if;
  delete from public.recordings where id=v_op.recording_id and status='deleted' and purge_claim_id=v_op.claim_id
    returning id into v_deleted;
  if v_deleted is null then raise exception 'purge claim lost' using errcode='55000'; end if;
  update public.recording_purge_operations set phase='completed',completed_at=statement_timestamp(),storage_owner_id=null,deleted_at=null where id=v_op.id;
  return true;
end;
$finalize$;

-- Delete the caller's bounded logical-task group atomically, under one active recording's current custody.
create function public.delete_managed_transcript_task_group_v1(p_task_id uuid,p_expected_updated_at timestamptz,p_task_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $task$
declare v_recording_id uuid; v_record public.recordings; v_ids uuid[];
  v_updated_at timestamptz; v_matching_count integer; v_deleted integer;
begin
  -- Check RAW input before unnest/dedup: repeated IDs cannot evade the work bound.
  if p_task_id is null or p_expected_updated_at is null or p_task_ids is null
    or cardinality(p_task_ids) not between 1 and 1000 or array_ndims(p_task_ids) is distinct from 1 then
    raise exception 'invalid task group' using errcode='22023'; end if;
  if array_position(p_task_ids,null) is not null then raise exception 'invalid task group' using errcode='22023'; end if;
  select array_agg(id order by id) into v_ids from (select distinct unnest(p_task_ids) as id) requested;
  if not (p_task_id=any(v_ids)) then raise exception 'invalid task group' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  -- Candidate parent discovery is not an authorization decision; the gate locks then checks current authority.
  select t.recording_id into v_recording_id
    from public.transcript_tasks x join public.transcripts t on t.id=x.transcript_id and t.user_id=x.user_id
    where x.id=p_task_id;
  if not found then raise exception 'recording unavailable' using errcode='42501'; end if;
  v_record := public.lock_managed_trash_recording_v1(v_recording_id);
  if v_record.status='deleted' then raise exception 'recording unavailable' using errcode='42501'; end if;
  perform x.id from public.transcript_tasks x where x.id=any(v_ids) order by x.id for update;
  select count(*) into v_matching_count from public.transcript_tasks x
    join public.transcripts t on t.id=x.transcript_id and t.user_id=x.user_id
    join public.ai_outputs o on o.id=x.ai_output_id and o.user_id=x.user_id and o.transcript_id=x.transcript_id
    join public.ai_processing_jobs j on j.id=x.processing_job_id and j.id=o.processing_job_id
      and j.user_id=x.user_id and j.transcript_id=x.transcript_id
    where x.id=any(v_ids) and t.recording_id=v_record.id;
  if v_matching_count<>cardinality(v_ids) or not public.can_manage_recording(v_record.id) then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  select updated_at into v_updated_at from public.transcript_tasks where id=p_task_id;
  if v_updated_at<>p_expected_updated_at then raise exception 'task group changed' using errcode='40001'; end if;
  delete from public.transcript_tasks where id=any(v_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted<>cardinality(v_ids) then raise exception 'recording unavailable' using errcode='42501'; end if;
  return jsonb_build_object('deletedCount',v_deleted,'recordingId',v_record.id);
end;
$task$;

-- Saved outputs have no optimistic version column; exact child lock and current active custody are authoritative.
create function public.delete_managed_ai_output_v1(p_output_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $output$
declare v_recording_id uuid; v_transcript_id uuid; v_record public.recordings; v_output public.ai_outputs; v_id uuid;
begin
  perform public.recording_sharing_lock_v1();
  select t.recording_id,o.transcript_id into v_recording_id,v_transcript_id
    from public.ai_outputs o join public.transcripts t on t.id=o.transcript_id and t.user_id=o.user_id where o.id=p_output_id;
  if not found then raise exception 'recording unavailable' using errcode='42501'; end if;
  v_record := public.lock_managed_trash_recording_v1(v_recording_id);
  if v_record.status='deleted' then raise exception 'recording unavailable' using errcode='42501'; end if;
  select * into v_output from public.ai_outputs where id=p_output_id and transcript_id=v_transcript_id for update;
  if not found then raise exception 'recording unavailable' using errcode='42501'; end if;
  if not public.can_manage_recording(v_record.id) or not exists (
    select 1 from public.ai_processing_jobs j where j.id=v_output.processing_job_id
      and j.user_id=v_output.user_id and j.transcript_id=v_output.transcript_id
  ) or exists (
    select 1 from public.transcript_tasks x where x.ai_output_id=v_output.id and (x.transcript_id<>v_output.transcript_id or x.processing_job_id is distinct from v_output.processing_job_id)
    union all select 1 from public.transcript_chapters x where x.ai_output_id=v_output.id and (x.transcript_id<>v_output.transcript_id or x.processing_job_id is distinct from v_output.processing_job_id)
    union all select 1 from public.transcript_decisions x where x.ai_output_id=v_output.id and (x.transcript_id<>v_output.transcript_id or x.processing_job_id is distinct from v_output.processing_job_id)
    union all select 1 from public.transcript_risks x where x.ai_output_id=v_output.id and (x.transcript_id<>v_output.transcript_id or x.processing_job_id is distinct from v_output.processing_job_id)
  ) then raise exception 'recording unavailable' using errcode='42501'; end if;
  delete from public.ai_outputs where id=v_output.id and transcript_id=v_transcript_id returning id into v_id;
  if v_id is null then raise exception 'recording unavailable' using errcode='42501'; end if;
  return jsonb_build_object('deletedId',v_id,'recordingId',v_record.id);
end;
$output$;

-- Preserve immutable Trash snapshots while allowing only service workers and the exact trusted T1 definer owner to maintain claims.
create or replace function public.recordings_manage_trash_metadata()
returns trigger language plpgsql security invoker set search_path = '' as $trigger$
begin
  if old.status<>'deleted' and new.status='deleted' then
    new.deleted_from_status := old.status;
    new.deleted_at := statement_timestamp();
    if new.trash_retention_hours is null or new.trash_retention_hours not in (24,168,720) then new.trash_retention_hours := 720; end if;
    new.purge_after := new.deleted_at+make_interval(hours=>new.trash_retention_hours);
    new.purge_attempt_count := 0; new.purge_started_at := null; new.purge_claim_id := null;
  elsif old.status='deleted' and new.status='deleted' then
    new.deleted_from_status := old.deleted_from_status; new.deleted_at := old.deleted_at;
    new.trash_retention_hours := old.trash_retention_hours; new.purge_after := old.purge_after;
    if current_user<>'service_role' and current_user<>(
      select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='public.prepare_recording_purge_v1(uuid,uuid,timestamp with time zone)'::regprocedure
    ) then
      new.purge_started_at := old.purge_started_at; new.purge_claim_id := old.purge_claim_id; new.purge_attempt_count := old.purge_attempt_count;
    end if;
  elsif old.status='deleted' and new.status<>'deleted' then
    if old.purge_started_at is not null or old.purge_claim_id is not null then
      raise exception 'recording purge is already in progress' using errcode='55000'; end if;
    new.status := old.deleted_from_status; new.deleted_from_status := null; new.deleted_at := null;
    new.trash_retention_hours := null; new.purge_after := null; new.purge_attempt_count := 0;
    new.purge_started_at := null; new.purge_claim_id := null;
  else
    new.deleted_from_status := null; new.deleted_at := null; new.trash_retention_hours := null;
    new.purge_after := null; new.purge_attempt_count := 0; new.purge_started_at := null; new.purge_claim_id := null;
  end if;
  return new;
end;
$trigger$;

-- Automatic due batches keep their original deadlines/attempt limits but cannot take a manual receipt.
create or replace function public.claim_due_recording_purges_v1(p_limit integer default 20)
returns table(id uuid,user_id uuid,storage_path text,purge_claim_id uuid)
language plpgsql volatile security definer set search_path = '' as $auto$
begin
  perform public.recording_sharing_lock_v1();
  return query with candidates as (
    select r.id from public.recordings r where r.status='deleted'
      and r.purge_after <= statement_timestamp() and r.deleted_at<=statement_timestamp()-interval '24 hours'
      and r.purge_attempt_count < 5
      and (r.purge_started_at is null or r.purge_started_at<=statement_timestamp()-interval '15 minutes')
      and not exists(select 1 from public.recording_purge_operations o where o.recording_id=r.id and o.phase in ('prepared','started'))
    order by r.purge_after,r.id for update skip locked limit least(greatest(coalesce(p_limit,20),0),20)
  )
  update public.recordings r set purge_claim_id=gen_random_uuid(),purge_started_at=statement_timestamp(),purge_attempt_count=r.purge_attempt_count+1
    from candidates c where r.id=c.id returning r.id,r.user_id,r.storage_path,r.purge_claim_id;
end;
$auto$;

-- Automatic heartbeats cannot renew or borrow a session receipt claim.
create or replace function public.refresh_recording_purge_claim_v1(p_recording_id uuid,p_claim_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $auto$
declare v_id uuid;
begin
  perform public.recording_sharing_lock_v1();
  update public.recordings r set purge_started_at=statement_timestamp()
    where r.id=p_recording_id and r.status='deleted' and r.purge_claim_id=p_claim_id
      and not exists(select 1 from public.recording_purge_operations o where o.recording_id=r.id and o.phase in ('prepared','started'))
    returning r.id into v_id;
  return v_id is not null;
end;
$auto$;

-- Automatic release cannot reopen content whose irreversible manual cleanup was accepted.
create or replace function public.release_recording_purge_claim_v1(p_recording_id uuid,p_claim_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $auto$
declare v_id uuid;
begin
  perform public.recording_sharing_lock_v1();
  update public.recordings r set purge_started_at=null,purge_claim_id=null
    where r.id=p_recording_id and r.status='deleted' and r.purge_claim_id=p_claim_id
      and not exists(select 1 from public.recording_purge_operations o where o.recording_id=r.id and o.phase in ('prepared','started'))
    returning r.id into v_id;
  return v_id is not null;
end;
$auto$;

-- Automatic finalization retains due/upload fences and rejects all active session receipt claims.
create or replace function public.finalize_recording_purge_v1(p_recording_id uuid,p_claim_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $auto$
declare v_id uuid;
begin
  perform public.recording_sharing_lock_v1();
  delete from public.recordings r where r.id=p_recording_id and r.status='deleted' and r.purge_claim_id=p_claim_id
    and r.purge_after <= statement_timestamp() and r.deleted_at<=statement_timestamp()-interval '24 hours'
    and not exists(select 1 from public.recording_purge_operations o where o.recording_id=r.id and o.phase in ('prepared','started'))
    returning r.id into v_id;
  return v_id is not null;
end;
$auto$;

-- Every definer uses the existing trusted T1 authority owner; no caller-supplied identity or role is trusted.
do $owner$
declare v_owner name; v_signature text;
begin
  select r.rolname into v_owner from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and (r.rolsuper or r.rolbypassrls)
      and r.rolname not in ('anon','authenticated','service_role');
  if v_owner is null or v_owner<>current_user then raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
  for v_signature in select unnest(array[
    'lock_managed_trash_recording_v1(uuid)','trash_recording_v1(uuid,timestamptz,integer)',
    'get_managed_recording_trash_v1(uuid[])',
    'restore_shared_recording_v1(uuid,timestamptz)','prepare_recording_purge_v1(uuid,uuid,timestamptz)',
    'start_recording_purge_v1(uuid)','release_recording_purge_v1(uuid)',
    'lock_accepted_recording_purge_v1(uuid)','lease_recording_purge_work_v1(uuid,uuid)',
    'acquire_recording_purge_work_v1(uuid,uuid)','finalize_recording_purge_work_v1(uuid,uuid)',
    'claim_started_recording_purge_work_v1(integer)',
    'delete_managed_transcript_task_group_v1(uuid,timestamptz,uuid[])','delete_managed_ai_output_v1(uuid)',
    'recordings_manage_trash_metadata()','claim_due_recording_purges_v1(integer)',
    'refresh_recording_purge_claim_v1(uuid,uuid)','release_recording_purge_claim_v1(uuid,uuid)','finalize_recording_purge_v1(uuid,uuid)'
  ]) loop
    execute format('alter function public.%s owner to %I',v_signature,v_owner);
    execute format('revoke all on function public.%s from public,anon,authenticated,service_role',v_signature);
  end loop;
end;
$owner$;
grant execute on function public.trash_recording_v1(uuid,timestamptz,integer),
  public.get_managed_recording_trash_v1(uuid[]),
  public.restore_shared_recording_v1(uuid,timestamptz),public.prepare_recording_purge_v1(uuid,uuid,timestamptz),
  public.start_recording_purge_v1(uuid),public.release_recording_purge_v1(uuid) to authenticated;
grant execute on function public.delete_managed_transcript_task_group_v1(uuid,timestamptz,uuid[]),public.delete_managed_ai_output_v1(uuid)
  to authenticated;
grant execute on function public.acquire_recording_purge_work_v1(uuid,uuid),public.finalize_recording_purge_work_v1(uuid,uuid),
  public.claim_started_recording_purge_work_v1(integer),
  public.claim_due_recording_purges_v1(integer),public.refresh_recording_purge_claim_v1(uuid,uuid),
  public.release_recording_purge_claim_v1(uuid,uuid),public.finalize_recording_purge_v1(uuid,uuid) to service_role;
