-- Additive recovery: provider verification is service-only; stopping rechecks the current manager under capture locks.
do $owner$ begin
 if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
  where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
   and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
  raise exception 'apply as trusted capture owner' using errcode='42501'; end if;
end; $owner$;
-- Reserve cancellation before external side effects; all other operation mutators share the fenced lock.
create table public.recording_transcription_stop_reservations (
 operation_id uuid primary key references public.recording_transcription_operations(id),
 actor_id uuid not null, request_id uuid not null, snapshot_hash text not null,
 active_until timestamptz not null, unique(actor_id,request_id)
);
alter table public.recording_transcription_stop_reservations enable row level security;
alter table public.recording_transcription_stop_reservations force row level security;
revoke all on public.recording_transcription_stop_reservations from public,anon,authenticated,service_role;

-- Preserve canonical custody locking privately for the narrowly authorized recovery functions.
create function public.lock_recording_transcription_operation_unfenced_v1(p_operation_id uuid)
returns public.recording_transcription_operations language plpgsql volatile security definer set search_path = '' as $operation_lock$
declare v_op public.recording_transcription_operations; v_record public.recordings;
begin
  perform public.recording_sharing_lock_v1();
  select * into v_op from public.recording_transcription_operations where id=p_operation_id;
  if not found then raise exception 'operation unavailable' using errcode='42501'; end if;
  v_record:=public.lock_recording_capture_v1(v_op.recording_id);
  perform 1 from public.transcription_jobs j join public.recording_transcription_work w on w.job_id=j.id
    where w.operation_id=v_op.id order by j.id for update of j;
  select * into v_op from public.recording_transcription_operations where id=p_operation_id for update;
  perform 1 from public.recording_transcription_work w where w.operation_id=v_op.id order by w.job_id for update;
  if v_record.user_id<>v_op.technical_owner_id or v_record.created_by<>v_op.capture_author_id
    or v_record.project_id is distinct from v_op.project_id or v_record.status='deleted' or v_record.purge_claim_id is not null
    or exists(select 1 from public.recording_transcription_work w left join public.transcription_jobs j on j.id=w.job_id
      left join public.recording_job_custody c on c.job_id=w.job_id
      where w.operation_id=v_op.id and (j.id is null or j.recording_id<>v_record.id or j.user_id<>v_record.user_id
        or j.provider<>'soniox' or j.mode<>'async' or j.provider_job_id is distinct from w.provider_job_id
        or (w.provider_job_id is not null and (c.job_id is null or c.recording_id is distinct from v_record.id
          or c.project_id is distinct from v_op.project_id or c.capture_author is distinct from v_op.capture_author_id
          or c.provider_job_id is distinct from w.provider_job_id)))) then
    raise exception 'operation custody mismatch' using errcode='42501'; end if;
  return v_op;
end;
$operation_lock$;

-- Fence every submit, poll, heartbeat, bind and finalization while cancellation is reserved.
create or replace function public.lock_recording_transcription_operation_v1(p_operation_id uuid)
returns public.recording_transcription_operations language plpgsql volatile security definer set search_path='' as $fence$
declare v_op public.recording_transcription_operations;
begin
 v_op:=public.lock_recording_transcription_operation_unfenced_v1(p_operation_id);
 if exists(select 1 from public.recording_transcription_stop_reservations where operation_id=v_op.id) then
  raise exception 'stop reserved' using errcode='55000';
 end if;
 return v_op;
end;
$fence$;

-- Skip reserved operations in both scoped dispatch and the existing scheduled discovery API.
create or replace function public.claim_recording_transcription_work_v2(p_limit integer default 5,p_operation_id uuid default null)
returns table(operation_id uuid,job_id uuid,claim_id uuid,work_kind text,storage_path text,client_reference_id text,
  region text,model text,provider_job_id text,manifest jsonb)
language plpgsql volatile security definer set search_path = '' as $claim$
declare v_id uuid; v_op public.recording_transcription_operations; v_work public.recording_transcription_work;
begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'invalid work limit' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  for v_id in select o.id from public.recording_transcription_operations o
    where (p_operation_id is null or o.id=p_operation_id) and not exists(select 1 from public.recording_transcription_stop_reservations s where s.operation_id=o.id) and o.phase in ('started','accepted','uncertain') and o.started_at>clock_timestamp()-interval '7 days'
      and (exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id
        and ((w.phase='ready' and o.phase<>'uncertain') or (w.phase='submitting' and w.claimed_at<=clock_timestamp()-interval '15 minutes')
          or (w.phase='accepted' and w.poll_attempt_count<5 and coalesce(w.next_poll_at,'-infinity'::timestamptz)<=clock_timestamp()
            and (w.claimed_at is null or w.claimed_at<=clock_timestamp()-interval '15 minutes'))))
        or (not exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id and w.phase<>'done')
          and o.finalize_attempt_count<5 and (o.finalize_claimed_at is null or o.finalize_claimed_at<=clock_timestamp()-interval '15 minutes')))
    order by o.last_claimed_at nulls first,o.created_at,o.id limit p_limit loop
    v_op:=public.lock_recording_transcription_operation_v1(v_id);
    update public.recording_transcription_work w set phase='uncertain' where w.operation_id=v_id and w.phase='submitting'
      and w.claimed_at<=clock_timestamp()-interval '15 minutes';
    perform public.refresh_recording_transcription_phase_v1(v_id);
    select w.* into v_work from public.recording_transcription_work w where w.operation_id=v_id
      and ((w.phase='ready' and not exists(select 1 from public.recording_transcription_work u where u.operation_id=v_id and u.phase='uncertain'))
        or (w.phase='accepted' and w.poll_attempt_count<5 and coalesce(w.next_poll_at,'-infinity'::timestamptz)<=clock_timestamp()
        and (w.claimed_at is null or w.claimed_at<=clock_timestamp()-interval '15 minutes')))
      order by case when w.phase='ready' then 0 else 1 end,w.position for update skip locked limit 1;
    operation_id:=v_id; region:=v_op.region; model:=v_op.model; manifest:=null;
    if found then
      claim_id:=gen_random_uuid(); job_id:=v_work.job_id; provider_job_id:=v_work.provider_job_id;
      work_kind:=case when v_work.phase='ready' then 'submit' else 'poll' end;
      storage_path:=case when work_kind='submit' then v_work.storage_path else null end;
      client_reference_id:=v_work.job_id::text;
      update public.recording_transcription_work w set claim_id=claim_recording_transcription_work_v2.claim_id,
        submission_claim_id=case when w.phase='ready' then claim_recording_transcription_work_v2.claim_id else w.submission_claim_id end,
        claimed_at=clock_timestamp(),poll_attempt_count=case when w.phase='accepted' then w.poll_attempt_count+1 else w.poll_attempt_count end,
        phase=case when w.phase='ready' then 'submitting' else w.phase end where w.job_id=v_work.job_id;
      update public.recording_transcription_operations set last_claimed_at=clock_timestamp() where id=v_id;
      return next;
    elsif not exists(select 1 from public.recording_transcription_work w where w.operation_id=v_id and w.phase<>'done')
      and v_op.finalize_attempt_count<5 and (v_op.finalize_claimed_at is null or v_op.finalize_claimed_at<=clock_timestamp()-interval '15 minutes') then
      claim_id:=gen_random_uuid(); job_id:=null; work_kind:='finalize'; storage_path:=null; client_reference_id:=v_op.id::text; provider_job_id:=null;
      select jsonb_agg(jsonb_build_object('jobId',w.job_id,'providerJobId',w.provider_job_id,'position',w.position,'audioDurationMs',w.audio_duration_ms) order by w.position)
        into manifest from public.recording_transcription_work w where w.operation_id=v_id;
      update public.recording_transcription_operations o set finalize_claim_id=claim_recording_transcription_work_v2.claim_id,
        finalize_claimed_at=clock_timestamp(),finalize_attempt_count=finalize_attempt_count+1,last_claimed_at=clock_timestamp() where o.id=v_id;
      return next;
    end if;
  end loop;
end;
$claim$;

-- Accept an exact manager cancellation intent only after all old worker leases have drained.
create function public.prepare_recording_transcription_stop_v1(p_operation_id uuid,p_request_id uuid,p_snapshot jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $prepare_stop$
declare v_op public.recording_transcription_operations; v_hash text; v_previous public.recording_transcription_stop_reservations;
begin
 if auth.uid() is null or p_request_id is null then raise exception 'stop denied' using errcode='42501'; end if;
 v_op:=public.lock_recording_transcription_operation_unfenced_v1(p_operation_id);
 if not public.can_manage_recording(v_op.recording_id) then raise exception 'stop denied' using errcode='42501'; end if;
 if v_op.phase not in ('started','accepted','uncertain') or exists(select 1 from public.recording_transcription_operations
   where recording_id=v_op.recording_id and (created_at,id)>(v_op.created_at,v_op.id)) then raise exception 'operation changed' using errcode='40001'; end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'array' or jsonb_array_length(p_snapshot) not between 1 and 1000 then
  raise exception 'invalid snapshot' using errcode='22023'; end if;
 if exists(select 1 from public.recording_transcription_work where operation_id=v_op.id and claim_id is not null
     and phase in ('submitting','accepted','uncertain') and claimed_at>clock_timestamp()-interval '15 minutes')
   or (v_op.finalize_claim_id is not null and v_op.finalize_claimed_at>clock_timestamp()-interval '15 minutes') then
  raise exception 'worker pending' using errcode='55000'; end if;
 select encode(sha256(convert_to(jsonb_agg(jsonb_build_array(w.job_id,w.phase,w.provider_job_id,w.claim_id,w.submission_claim_id)
   order by w.position)::text,'UTF8')),'hex') into v_hash from public.recording_transcription_work w where w.operation_id=v_op.id;
 if v_hash is distinct from encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex') then raise exception 'work changed' using errcode='40001'; end if;
 select * into v_previous from public.recording_transcription_stop_reservations where operation_id=v_op.id;
 if found and (v_previous.actor_id<>auth.uid() or v_previous.request_id<>p_request_id) and v_previous.active_until>clock_timestamp() then
  raise exception 'stop pending' using errcode='55000'; end if;
 insert into public.recording_transcription_stop_reservations(operation_id,actor_id,request_id,snapshot_hash,active_until)
   values(v_op.id,auth.uid(),p_request_id,v_hash,clock_timestamp()+interval '120 seconds')
   on conflict(operation_id) do update set actor_id=excluded.actor_id,request_id=excluded.request_id,
     snapshot_hash=excluded.snapshot_hash,active_until=excluded.active_until;
 return jsonb_build_object('operationId',v_op.id,'reserved',true);
end;
$prepare_stop$;

-- Explicit resume releases only an expired stop intent after the server verified the exact original provider units.
create function public.resume_recording_transcription_stop_v1(p_operation_id uuid,p_snapshot jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $resume_stop$
declare v_op public.recording_transcription_operations; v_hash text;
begin
 if auth.uid() is null then raise exception 'resume denied' using errcode='42501'; end if;
 v_op:=public.lock_recording_transcription_operation_unfenced_v1(p_operation_id);
 if not public.can_manage_recording(v_op.recording_id) then raise exception 'resume denied' using errcode='42501'; end if;
 if v_op.phase not in ('started','accepted','uncertain') or exists(select 1 from public.recording_transcription_operations
   where recording_id=v_op.recording_id and (created_at,id)>(v_op.created_at,v_op.id)) then raise exception 'operation changed' using errcode='40001'; end if;
 if exists(select 1 from public.recording_transcription_stop_reservations where operation_id=v_op.id and active_until>clock_timestamp()) then
  raise exception 'stop pending' using errcode='55000'; end if;
 select encode(sha256(convert_to(jsonb_agg(jsonb_build_array(w.job_id,w.phase,w.provider_job_id,w.claim_id,w.submission_claim_id)
   order by w.position)::text,'UTF8')),'hex') into v_hash from public.recording_transcription_work w where w.operation_id=v_op.id;
 if p_snapshot is null or v_hash is distinct from encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex') then
  raise exception 'work changed' using errcode='40001'; end if;
 delete from public.recording_transcription_stop_reservations where operation_id=v_op.id;
 return jsonb_build_object('operationId',v_op.id,'resumed',true);
end;
$resume_stop$;

-- A retained cancellation intent is manual recovery, so neither the dispatcher nor UI reports ongoing progress.
create or replace function public.get_recording_transcription_dispatch_v1(p_operation_id uuid,p_job_id uuid default null,p_provider_job_id text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $dispatch$
declare v_phase text;
begin
 select phase into v_phase from public.recording_transcription_operations where id=p_operation_id;
 if not found or (p_job_id is not null and not exists(select 1 from public.recording_transcription_work
  where operation_id=p_operation_id and job_id=p_job_id and provider_job_id=p_provider_job_id)) then
  raise exception 'dispatch unavailable' using errcode='42501'; end if;
 if exists(select 1 from public.recording_transcription_stop_reservations where operation_id=p_operation_id) then v_phase:='manual_required'; end if;
 return jsonb_build_object('operationId',p_operation_id,'phase',v_phase,'pendingAcceptedWork',
  exists(select 1 from public.recording_transcription_work where operation_id=p_operation_id and phase='accepted' and poll_attempt_count<5));
end;
$dispatch$;

-- Retain bounded manager enrichment while exposing reserved cancellation as a blocked state.
create or replace function public.get_managed_recording_transcription_v1(p_recording_ids uuid[])
returns table(recording_id uuid,operation_id uuid,phase text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $managed$
begin
 if auth.uid() is null or coalesce(cardinality(p_recording_ids),0)=0 then return; end if;
 if cardinality(p_recording_ids)>100 or array_ndims(p_recording_ids) is distinct from 1 then raise exception 'invalid IDs' using errcode='22023'; end if;
 return query select r.id,o.id,case when o.phase in ('started','accepted','uncertain') and (o.phase='uncertain'
  or exists(select 1 from public.recording_transcription_stop_reservations s where s.operation_id=o.id)
  or o.started_at<=statement_timestamp()-interval '7 days' or o.finalize_attempt_count>=5
  or exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id and w.phase='accepted' and w.poll_attempt_count>=5))
   then 'manual_required' else o.phase end,o.created_at from public.recordings r
  cross join lateral(select x.* from public.recording_transcription_operations x where x.recording_id=r.id order by x.created_at desc,x.id desc limit 1)o
  where r.id=any(p_recording_ids) and public.can_manage_recording(r.id) order by r.id;
end;
$managed$;

revoke all on function public.lock_recording_transcription_operation_unfenced_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.lock_recording_transcription_operation_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_recording_transcription_work_v2(integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_recording_transcription_dispatch_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_managed_recording_transcription_v1(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.claim_recording_transcription_work_v2(integer,uuid) to service_role;
grant execute on function public.get_recording_transcription_dispatch_v1(uuid,uuid,text) to service_role;
grant execute on function public.get_managed_recording_transcription_v1(uuid[]) to authenticated;
revoke all on function public.prepare_recording_transcription_stop_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.resume_recording_transcription_stop_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_recording_transcription_stop_v1(uuid,uuid,jsonb) to authenticated;
grant execute on function public.resume_recording_transcription_stop_v1(uuid,jsonb) to authenticated;



-- Settle an exact submit claim only after the worker proves no provider request was accepted.
create function public.fail_recording_submission_v1(
  p_operation_id uuid,p_job_id uuid,p_claim_id uuid,p_error_code text
) returns jsonb language plpgsql volatile security definer set search_path='' as $fail$
declare v_op public.recording_transcription_operations;
begin
  if p_error_code is null or p_error_code not in ('provider_authentication','provider_configuration','audio_unavailable','submission_rejected','rate_limited') then
    raise exception 'invalid failure' using errcode='22023';
  end if;
  v_op:=public.lock_recording_transcription_operation_v1(p_operation_id);
  if v_op.phase not in ('started','accepted','uncertain') then raise exception 'operation terminal' using errcode='55000'; end if;
  update public.recording_transcription_work set phase='failed',error_code=p_error_code,claim_id=null
    where operation_id=v_op.id and job_id=p_job_id and phase='submitting' and provider_job_id is null
      and claim_id=p_claim_id and submission_claim_id=p_claim_id and p_claim_id is not null;
  if not found then raise exception 'claim unavailable' using errcode='42501'; end if;
  update public.transcription_jobs set status='failed',error_message=p_error_code,completed_at=clock_timestamp() where id=p_job_id;
  perform public.refresh_recording_transcription_phase_v1(v_op.id);
  return jsonb_build_object('operationId',v_op.id,'jobId',p_job_id,'phase','failed');
end;
$fail$;

-- Store a fixed immutable proof only after the trusted server verified every original provider unit.
create function public.verify_recording_transcription_stop_v1(
  p_operation_id uuid,p_actor_id uuid,p_request_id uuid,p_snapshot jsonb,p_evidence_sha256 text
) returns jsonb language plpgsql volatile security definer set search_path='' as $verify$
declare v_op public.recording_transcription_operations; v_snapshot jsonb; v_hash text; v_previous public.recording_capture_receipts;
begin
  if p_actor_id is null or p_request_id is null or p_evidence_sha256 is null or p_evidence_sha256 !~ '^[a-f0-9]{64}$'
    or p_snapshot is null or jsonb_typeof(p_snapshot)<>'array' or jsonb_array_length(p_snapshot) not between 1 and 1000 then
    raise exception 'invalid verification' using errcode='22023';
  end if;
  v_op:=public.lock_recording_transcription_operation_unfenced_v1(p_operation_id);
  if v_op.phase not in ('started','accepted','uncertain') then raise exception 'operation terminal' using errcode='55000'; end if;
  if exists(select 1 from public.recording_transcription_work where operation_id=v_op.id and phase in ('submitting','uncertain')
      and claimed_at>clock_timestamp()-interval '15 minutes') then raise exception 'submission pending' using errcode='55000'; end if;
  select jsonb_agg(jsonb_build_array(w.job_id,w.phase,w.provider_job_id,w.claim_id,w.submission_claim_id) order by w.position)
    into v_snapshot from public.recording_transcription_work w where w.operation_id=v_op.id;
  if v_snapshot is distinct from p_snapshot then raise exception 'work changed' using errcode='40001'; end if;
  v_hash:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
  if not exists(select 1 from public.recording_transcription_stop_reservations where operation_id=v_op.id
    and actor_id=p_actor_id and request_id=p_request_id and snapshot_hash=v_hash and active_until>clock_timestamp()) then
    raise exception 'stop not reserved' using errcode='42501'; end if;
  select * into v_previous from public.recording_capture_receipts where actor_id=p_actor_id and request_id=p_request_id;
  if found then
    if v_previous.recording_id<>v_op.recording_id or v_previous.payload_fingerprint<>v_hash
      or v_previous.result->>'kind'<>'transcription_stop_verified' or v_previous.result->>'operationId'<>v_op.id::text then
      raise exception 'verification conflict' using errcode='40001';
    end if;
    return jsonb_build_object('operationId',v_op.id,'verified',true);
  end if;
  insert into public.recording_capture_receipts(actor_id,request_id,recording_id,payload_fingerprint,result)
    values(p_actor_id,p_request_id,v_op.recording_id,v_hash,jsonb_build_object('kind','transcription_stop_verified',
      'operationId',v_op.id,'evidenceSha256',p_evidence_sha256));
  return jsonb_build_object('operationId',v_op.id,'verified',true);
end;
$verify$;

-- Close verified work with fresh manager authority and an exact snapshot; audio and saved transcripts remain untouched.
create function public.stop_recording_transcription_v1(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $stop$
declare v_op public.recording_transcription_operations; v_receipt public.recording_capture_receipts; v_hash text;
begin
  if auth.uid() is null or p_request_id is null then raise exception 'stop denied' using errcode='42501'; end if;
  v_op:=public.lock_recording_transcription_operation_unfenced_v1(p_operation_id);
  if not public.can_manage_recording(v_op.recording_id) then raise exception 'stop denied' using errcode='42501'; end if;
  if exists(select 1 from public.recording_transcription_operations where recording_id=v_op.recording_id
      and (created_at,id)>(v_op.created_at,v_op.id)) then raise exception 'operation changed' using errcode='40001'; end if;
  select * into v_receipt from public.recording_capture_receipts where actor_id=auth.uid() and request_id=p_request_id;
  if not found or v_receipt.recording_id<>v_op.recording_id or v_receipt.result->>'kind'<>'transcription_stop_verified'
    or v_receipt.result->>'operationId'<>v_op.id::text then raise exception 'verification required' using errcode='42501'; end if;
  if v_op.phase='failed' then return jsonb_build_object('operationId',v_op.id,'status','failed','stopped',true); end if;
  if v_op.phase not in ('started','accepted','uncertain') then raise exception 'operation changed' using errcode='40001'; end if;
  select encode(sha256(convert_to(jsonb_agg(jsonb_build_array(w.job_id,w.phase,w.provider_job_id,w.claim_id,w.submission_claim_id)
    order by w.position)::text,'UTF8')),'hex') into v_hash from public.recording_transcription_work w where w.operation_id=v_op.id;
  if v_hash is distinct from v_receipt.payload_fingerprint then raise exception 'work changed' using errcode='40001'; end if;
  if not exists(select 1 from public.recording_transcription_stop_reservations where operation_id=v_op.id
    and actor_id=auth.uid() and request_id=p_request_id and snapshot_hash=v_hash) then raise exception 'stop not reserved' using errcode='42501'; end if;
  update public.transcription_jobs set status='cancelled',error_message='Stopped by user',completed_at=clock_timestamp()
    where id in(select job_id from public.recording_transcription_work where operation_id=v_op.id and phase<>'done');
  update public.recording_transcription_work set phase='failed',error_code='user_stopped',claim_id=null
    where operation_id=v_op.id and phase<>'done';
  perform public.refresh_recording_transcription_phase_v1(v_op.id);
  delete from public.recording_transcription_stop_reservations where operation_id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'status','failed','stopped',true);
end;
$stop$;

revoke all on function public.fail_recording_submission_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.verify_recording_transcription_stop_v1(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.stop_recording_transcription_v1(uuid,uuid) from public,anon,service_role;
grant execute on function public.fail_recording_submission_v1(uuid,uuid,uuid,text) to service_role;
grant execute on function public.verify_recording_transcription_stop_v1(uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.stop_recording_transcription_v1(uuid,uuid) to authenticated;
