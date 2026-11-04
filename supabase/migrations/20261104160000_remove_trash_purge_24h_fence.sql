-- Remove the 24-hour upload fence from manual and automatic Trash purge; a trashed recording may be purged immediately.
-- Bodies equal live definitions (verified 04.11.2026) minus only the `deleted_at <= now()-24h` condition.
-- Retention (`purge_after`), manager authority, claim/fencing tokens, 15-minute stale leases, attempt limits
-- and receipt-bound prefix cleanup with bounded late-object rounds stay unchanged.
-- Reversal: re-apply the six definitions from 20260922220000/20261002040000 (adds the fence back).
begin;
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Session prepare reserves manual purge for a current manager; no minimum time in Trash is required.
create or replace function public.prepare_recording_purge_v1(
  p_recording_id uuid,p_request_id uuid,p_expected_updated_at timestamptz
) returns jsonb language plpgsql volatile security definer set search_path = '' as $prepare$
declare v_record public.recordings; v_op public.recording_purge_operations;
  v_old public.recording_purge_operations; v_phase text := 'prepared'; v_prefix text; v_attempts smallint := 0;
begin
  if p_request_id is null or p_expected_updated_at is null then
    raise exception 'invalid purge request' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  if auth.uid() is null then raise exception 'recording unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.released_absent_purge_requests where actor_id=auth.uid() and request_id=p_request_id) then
    if not exists(select 1 from public.released_absent_purge_requests where actor_id=auth.uid() and request_id=p_request_id and recording_id=p_recording_id) then raise exception 'request reused' using errcode='22023'; end if;
    return jsonb_build_object('operationId',p_request_id,'phase','released');
  end if;
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
create or replace function public.start_recording_purge_v1(p_operation_id uuid)
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
    or v_record.user_id<>v_op.storage_owner_id then
    raise exception 'purge claim lost' using errcode='55000'; end if;
  update public.recording_purge_operations set phase='started' where id=v_op.id;
  update public.recordings set purge_started_at=statement_timestamp() where id=v_record.id;
  return jsonb_build_object('operationId',v_op.id,'phase','started','changed',v_op.phase='prepared');
end;
$start$;

-- Private accepted-work gate checks exact receipt/generation/claim, not the former actor's current membership.
create or replace function public.lock_accepted_recording_purge_v1(p_operation_id uuid)
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
    or v_record.user_id<>v_op.storage_owner_id or v_record.deleted_at is distinct from v_op.deleted_at then
    raise exception 'purge claim lost' using errcode='55000'; end if;
  return v_op;
end;
$accepted$;

-- Bounded recovery discovers accepted work after a crash, never prepared operations or arbitrary recordings.
create or replace function public.claim_started_recording_purge_work_v1(p_limit integer default 5)
returns table(operation_id uuid,recording_id uuid,storage_prefix text,claim_id uuid)
language plpgsql volatile security definer set search_path = '' as $discover$
declare v_id uuid; v_op public.recording_purge_operations;
begin
  perform public.recording_sharing_lock_v1();
  for v_id in select o.id from public.recording_purge_operations o join public.recordings r on r.id=o.recording_id
    where o.phase='started' and o.work_attempt_count<5
      and (o.worker_claimed_at is null or o.worker_claimed_at<=statement_timestamp()-interval '15 minutes')
      and r.status='deleted' and r.purge_claim_id=o.claim_id and r.user_id=o.storage_owner_id and r.deleted_at=o.deleted_at
    order by o.created_at,o.id limit least(greatest(coalesce(p_limit,5),0),5) for update of r skip locked
  loop
    v_op := public.lease_recording_purge_work_v1(v_id,null);
    return query select v_op.id,v_op.recording_id,v_op.storage_owner_id::text||'/'||v_op.recording_id::text||'/',v_op.claim_id;
  end loop;
end;
$discover$;

-- Automatic due batches keep their original deadlines/attempt limits but cannot take a manual receipt.
create or replace function public.claim_due_recording_purges_v1(p_limit integer default 20)
returns table(id uuid,user_id uuid,storage_path text,purge_claim_id uuid)
language plpgsql volatile security definer set search_path = '' as $auto$
begin
  perform public.recording_sharing_lock_v1();
  return query with candidates as (
    select r.id from public.recordings r where r.status='deleted'
      and r.purge_after <= statement_timestamp()
      and r.purge_attempt_count < 5
      and (r.purge_started_at is null or r.purge_started_at<=statement_timestamp()-interval '15 minutes')
      and not exists(select 1 from public.recording_purge_operations o where o.recording_id=r.id and o.phase in ('prepared','started'))
    order by r.purge_after,r.id for update skip locked limit least(greatest(coalesce(p_limit,20),0),20)
  )
  update public.recordings r set purge_claim_id=gen_random_uuid(),purge_started_at=statement_timestamp(),purge_attempt_count=r.purge_attempt_count+1
    from candidates c where r.id=c.id returning r.id,r.user_id,r.storage_path,r.purge_claim_id;
end;
$auto$;

-- Automatic finalization retains the due deadline and rejects all active session receipt claims.
create or replace function public.finalize_recording_purge_v1(p_recording_id uuid,p_claim_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $auto$
declare v_id uuid;
begin
  perform public.recording_sharing_lock_v1();
  delete from public.recordings r where r.id=p_recording_id and r.status='deleted' and r.purge_claim_id=p_claim_id
    and r.purge_after <= statement_timestamp()
    and not exists(select 1 from public.recording_purge_operations o where o.recording_id=r.id and o.phase in ('prepared','started'))
    returning r.id into v_id;
  return v_id is not null;
end;
$auto$;

-- Re-state the reviewed ACL exactly: create or replace keeps owner/ACL, this guards against drift.
revoke all on function public.prepare_recording_purge_v1(uuid,uuid,timestamptz),public.start_recording_purge_v1(uuid),
  public.lock_accepted_recording_purge_v1(uuid),public.claim_started_recording_purge_work_v1(integer),
  public.claim_due_recording_purges_v1(integer),public.finalize_recording_purge_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.prepare_recording_purge_v1(uuid,uuid,timestamptz),public.start_recording_purge_v1(uuid)
  to authenticated;
grant execute on function public.claim_started_recording_purge_work_v1(integer),public.claim_due_recording_purges_v1(integer),
  public.finalize_recording_purge_v1(uuid,uuid) to service_role;
commit;
