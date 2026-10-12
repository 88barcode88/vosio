begin;
-- New SECURITY DEFINER contracts must retain the reviewed privileged, non-API owner.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;
-- An explicit cancellation tombstones an absent own request under the same global lock as prepare.
create table public.released_absent_purge_requests(actor_id uuid not null,request_id uuid not null,recording_id uuid not null,primary key(actor_id,request_id));
alter table public.released_absent_purge_requests enable row level security;
alter table public.released_absent_purge_requests force row level security;
revoke all on table public.released_absent_purge_requests from public,anon,authenticated,service_role;
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
create function public.release_recording_purge_request_v1(p_recording_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_op public.recording_purge_operations;
begin
  if auth.uid() is null or p_recording_id is null or p_request_id is null then raise exception 'purge unavailable' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_purge_operations where actor_id=auth.uid() and request_id=p_request_id for update;
  if found then
    if v_op.recording_id is distinct from p_recording_id then raise exception 'request reused' using errcode='22023'; end if;
    return public.release_recording_purge_v1(v_op.id);
  end if;
  insert into public.released_absent_purge_requests values(auth.uid(),p_request_id,p_recording_id) on conflict do nothing;
  if not exists(select 1 from public.released_absent_purge_requests where actor_id=auth.uid() and request_id=p_request_id and recording_id=p_recording_id) then
    raise exception 'request reused' using errcode='22023'; end if;
  return jsonb_build_object('operationId',p_request_id,'phase','released');
end;
$$;
revoke all on function public.release_recording_purge_request_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.release_recording_purge_request_v1(uuid,uuid) to authenticated;
commit;
