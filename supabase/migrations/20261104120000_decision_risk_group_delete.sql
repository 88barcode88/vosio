-- Additive contract: delete one logical decision or risk/blocker group, mirroring delete_managed_transcript_task_group_v1.
-- Existing task, output and whole-checklist functions stay untouched.
-- Reversal: revoke both entry points from authenticated, then drop them. Never restore deleted rows automatically.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_manage_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted sharing owner' using errcode='42501'; end if;
  if to_regprocedure('public.lock_managed_trash_recording_v1(uuid)') is null
    or to_regprocedure('public.recording_sharing_lock_v1()') is null then
    raise exception 'shared recording trash contract required' using errcode='42883'; end if;
end; $owner$;

-- Delete the caller's bounded logical-decision group atomically, under one active recording's current custody.
create function public.delete_managed_transcript_decision_group_v1(p_decision_id uuid,p_expected_updated_at timestamptz,p_decision_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $decision$
declare v_recording_id uuid; v_record public.recordings; v_ids uuid[];
  v_updated_at timestamptz; v_matching_count integer; v_deleted integer;
begin
  -- Check RAW input before unnest/dedup: repeated IDs cannot evade the work bound.
  if p_decision_id is null or p_expected_updated_at is null or p_decision_ids is null
    or cardinality(p_decision_ids) not between 1 and 1000 or array_ndims(p_decision_ids) is distinct from 1 then
    raise exception 'invalid decision group' using errcode='22023'; end if;
  if array_position(p_decision_ids,null) is not null then raise exception 'invalid decision group' using errcode='22023'; end if;
  select array_agg(id order by id) into v_ids from (select distinct unnest(p_decision_ids) as id) requested;
  if not (p_decision_id=any(v_ids)) then raise exception 'invalid decision group' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  -- Candidate parent discovery is not an authorization decision; the gate locks then checks current authority.
  select t.recording_id into v_recording_id
    from public.transcript_decisions x join public.transcripts t on t.id=x.transcript_id and t.user_id=x.user_id
    where x.id=p_decision_id;
  if not found then raise exception 'recording unavailable' using errcode='42501'; end if;
  v_record := public.lock_managed_trash_recording_v1(v_recording_id);
  if v_record.status='deleted' then raise exception 'recording unavailable' using errcode='42501'; end if;
  perform x.id from public.transcript_decisions x where x.id=any(v_ids) order by x.id for update;
  select count(*) into v_matching_count from public.transcript_decisions x
    join public.transcripts t on t.id=x.transcript_id and t.user_id=x.user_id
    join public.ai_outputs o on o.id=x.ai_output_id and o.user_id=x.user_id and o.transcript_id=x.transcript_id
    join public.ai_processing_jobs j on j.id=x.processing_job_id and j.id=o.processing_job_id
      and j.user_id=x.user_id and j.transcript_id=x.transcript_id
    where x.id=any(v_ids) and t.recording_id=v_record.id;
  if v_matching_count<>cardinality(v_ids) or not public.can_manage_recording(v_record.id) then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  select updated_at into v_updated_at from public.transcript_decisions where id=p_decision_id;
  if v_updated_at<>p_expected_updated_at then raise exception 'decision group changed' using errcode='40001'; end if;
  delete from public.transcript_decisions where id=any(v_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted<>cardinality(v_ids) then raise exception 'recording unavailable' using errcode='42501'; end if;
  return jsonb_build_object('deletedCount',v_deleted,'recordingId',v_record.id,'ids',to_jsonb(v_ids));
end;
$decision$;

-- Delete the caller's bounded logical risk/blocker group atomically, under one active recording's current custody.
create function public.delete_managed_transcript_risk_group_v1(p_risk_id uuid,p_expected_updated_at timestamptz,p_risk_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $risk$
declare v_recording_id uuid; v_record public.recordings; v_ids uuid[];
  v_updated_at timestamptz; v_matching_count integer; v_deleted integer;
begin
  -- Check RAW input before unnest/dedup: repeated IDs cannot evade the work bound.
  if p_risk_id is null or p_expected_updated_at is null or p_risk_ids is null
    or cardinality(p_risk_ids) not between 1 and 1000 or array_ndims(p_risk_ids) is distinct from 1 then
    raise exception 'invalid risk group' using errcode='22023'; end if;
  if array_position(p_risk_ids,null) is not null then raise exception 'invalid risk group' using errcode='22023'; end if;
  select array_agg(id order by id) into v_ids from (select distinct unnest(p_risk_ids) as id) requested;
  if not (p_risk_id=any(v_ids)) then raise exception 'invalid risk group' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  -- Candidate parent discovery is not an authorization decision; the gate locks then checks current authority.
  select t.recording_id into v_recording_id
    from public.transcript_risks x join public.transcripts t on t.id=x.transcript_id and t.user_id=x.user_id
    where x.id=p_risk_id;
  if not found then raise exception 'recording unavailable' using errcode='42501'; end if;
  v_record := public.lock_managed_trash_recording_v1(v_recording_id);
  if v_record.status='deleted' then raise exception 'recording unavailable' using errcode='42501'; end if;
  perform x.id from public.transcript_risks x where x.id=any(v_ids) order by x.id for update;
  select count(*) into v_matching_count from public.transcript_risks x
    join public.transcripts t on t.id=x.transcript_id and t.user_id=x.user_id
    join public.ai_outputs o on o.id=x.ai_output_id and o.user_id=x.user_id and o.transcript_id=x.transcript_id
    join public.ai_processing_jobs j on j.id=x.processing_job_id and j.id=o.processing_job_id
      and j.user_id=x.user_id and j.transcript_id=x.transcript_id
    where x.id=any(v_ids) and t.recording_id=v_record.id;
  if v_matching_count<>cardinality(v_ids) or not public.can_manage_recording(v_record.id) then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  select updated_at into v_updated_at from public.transcript_risks where id=p_risk_id;
  if v_updated_at<>p_expected_updated_at then raise exception 'risk group changed' using errcode='40001'; end if;
  delete from public.transcript_risks where id=any(v_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted<>cardinality(v_ids) then raise exception 'recording unavailable' using errcode='42501'; end if;
  return jsonb_build_object('deletedCount',v_deleted,'recordingId',v_record.id,'ids',to_jsonb(v_ids));
end;
$risk$;

revoke all on function public.delete_managed_transcript_decision_group_v1(uuid,timestamptz,uuid[]),
  public.delete_managed_transcript_risk_group_v1(uuid,timestamptz,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.delete_managed_transcript_decision_group_v1(uuid,timestamptz,uuid[]),
  public.delete_managed_transcript_risk_group_v1(uuid,timestamptz,uuid[]) to authenticated;
