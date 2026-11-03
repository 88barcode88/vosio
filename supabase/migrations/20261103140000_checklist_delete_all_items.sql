-- Additive v2 contract: whole-checklist review/delete now covers tasks, decisions and risks/blockers.
-- v1 functions stay untouched so an older deployment keeps working until the app switches to v2.
-- Reversal: revoke the two v2 entry points before removing functions/triggers. Never restore deleted rows automatically.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_manage_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted sharing owner' using errcode='42501'; end if;
  if to_regprocedure('public.managed_transcript_checklist_snapshot_v1(uuid)') is null then
    raise exception 'checklist v1 contract required' using errcode='42883'; end if;
end; $owner$;

-- Fence decision/risk insertion behind the same transcript lock and output suppression used for tasks in v1.
create function public.lock_checklist_item_parent_v2() returns trigger
language plpgsql security definer set search_path = '' as $fence$
begin
  if tg_op='UPDATE' then
    perform t.id from public.transcripts t where t.id in (old.transcript_id,new.transcript_id) order by t.id for update;
  else
    perform t.id from public.transcripts t where t.id=new.transcript_id for update;
  end if;
  if not exists(select 1 from public.ai_outputs o where o.id=new.ai_output_id
    and o.transcript_id=new.transcript_id and o.user_id=new.user_id and o.processing_job_id=new.processing_job_id) then
    raise exception 'projection scope unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.transcript_checklist_suppressions s where s.ai_output_id=new.ai_output_id) then
    if tg_op='UPDATE' then raise exception 'checklist source suppressed' using errcode='40001'; end if;
    return null; end if;
  return new;
end;
$fence$;
revoke all on function public.lock_checklist_item_parent_v2() from public,anon,authenticated,service_role;
create trigger transcript_decisions_checklist_parent_lock before insert or update of transcript_id,ai_output_id,processing_job_id,user_id on public.transcript_decisions
  for each row execute function public.lock_checklist_item_parent_v2();
create trigger transcript_risks_checklist_parent_lock before insert or update of transcript_id,ai_output_id,processing_job_id,user_id on public.transcript_risks
  for each row execute function public.lock_checklist_item_parent_v2();

-- Private v2 snapshot: v1 authority/locks/task scope checks first, then the decision/risk sets under the same locks.
create function public.managed_transcript_checklist_snapshot_v2(p_transcript_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $snapshot$
declare v_base jsonb; v_owner uuid; v_decisions jsonb; v_risks jsonb; v_logical_decisions jsonb; v_logical_risks jsonb;
begin
  v_base:=public.managed_transcript_checklist_snapshot_v1(p_transcript_id);
  select t.user_id into v_owner from public.transcripts t where t.id=p_transcript_id;
  -- Bound before locking/aggregating: never silently trim a partial page into a whole checklist.
  if (select count(*) from (select 1 from public.transcript_decisions where transcript_id=p_transcript_id limit 1001) x)>1000
    or (select count(*) from (select 1 from public.transcript_risks where transcript_id=p_transcript_id limit 1001) x)>1000 then
    raise exception 'checklist too large' using errcode='54000'; end if;
  perform x.id from public.transcript_decisions x where x.transcript_id=p_transcript_id order by x.id for update;
  perform x.id from public.transcript_risks x where x.transcript_id=p_transcript_id order by x.id for update;
  -- Never delete an inconsistent or foreign-scope projection hidden from normal RLS reads.
  if exists(select 1 from public.transcript_decisions x left join public.ai_outputs o on o.id=x.ai_output_id
      and o.transcript_id=x.transcript_id and o.processing_job_id=x.processing_job_id and o.user_id=x.user_id
      where x.transcript_id=p_transcript_id and (x.user_id<>v_owner or o.id is null))
    or exists(select 1 from public.transcript_risks x left join public.ai_outputs o on o.id=x.ai_output_id
      and o.transcript_id=x.transcript_id and o.processing_job_id=x.processing_job_id and o.user_id=x.user_id
      where x.transcript_id=p_transcript_id and (x.user_id<>v_owner or o.id is null))
    or exists(select 1 from public.transcript_decisions x join public.ai_outputs o on o.id=x.ai_output_id
      where o.transcript_id=p_transcript_id and x.transcript_id<>p_transcript_id)
    or exists(select 1 from public.transcript_risks x join public.ai_outputs o on o.id=x.ai_output_id
      where o.transcript_id=p_transcript_id and x.transcript_id<>p_transcript_id) then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.xmin::text) order by x.id),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('title',x.title,'status',x.status,'owner_category',x.owner_category) order by x.id),'[]'::jsonb)
    into v_decisions,v_logical_decisions from public.transcript_decisions x where x.transcript_id=p_transcript_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.xmin::text) order by x.id),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('title',x.title,'impact',x.impact) order by x.id),'[]'::jsonb)
    into v_risks,v_logical_risks from public.transcript_risks x where x.transcript_id=p_transcript_id;
  return jsonb_build_object(
    'snapshot',(v_base->'snapshot')||jsonb_build_object('decisions',v_decisions,'risks',v_risks),
    'logicalTasks',v_base->'logicalTasks','logicalDecisions',v_logical_decisions,'logicalRisks',v_logical_risks);
end;
$snapshot$;
revoke all on function public.managed_transcript_checklist_snapshot_v2(uuid) from public,anon,authenticated,service_role;

-- Public review reads no raw artifact, job, provider, transcript body or audio metadata.
create function public.get_managed_transcript_checklist_v2(p_transcript_id uuid) returns jsonb
language sql volatile security definer set search_path = '' as $get$
  select public.managed_transcript_checklist_snapshot_v2(p_transcript_id);
$get$;

-- All-or-none deletion of tasks, decisions and risks; snapshot drift requires a new review and confirmation.
create function public.delete_managed_transcript_checklist_v2(p_transcript_id uuid,p_snapshot jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $delete$
declare v_current jsonb; v_task_ids uuid[]; v_decision_ids uuid[]; v_risk_ids uuid[];
  v_tasks integer; v_decisions integer; v_risks integer;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or jsonb_typeof(p_snapshot->'tasks') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'decisions') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'risks') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'outputs') is distinct from 'array' then
    raise exception 'invalid snapshot' using errcode='22023'; end if;
  if jsonb_array_length(p_snapshot->'tasks')>1000 or jsonb_array_length(p_snapshot->'decisions')>1000
    or jsonb_array_length(p_snapshot->'risks')>1000 or jsonb_array_length(p_snapshot->'outputs')>1000 then
    raise exception 'checklist too large' using errcode='54000'; end if;
  v_current:=public.managed_transcript_checklist_snapshot_v2(p_transcript_id)->'snapshot';
  if v_current is distinct from p_snapshot then raise exception 'checklist changed' using errcode='40001'; end if;
  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),'{}'::uuid[]) into v_task_ids
    from jsonb_array_elements(v_current->'tasks') x;
  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),'{}'::uuid[]) into v_decision_ids
    from jsonb_array_elements(v_current->'decisions') x;
  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),'{}'::uuid[]) into v_risk_ids
    from jsonb_array_elements(v_current->'risks') x;
  insert into public.transcript_checklist_suppressions(ai_output_id,transcript_id)
    select (x->>'id')::uuid,p_transcript_id from jsonb_array_elements(v_current->'outputs') x
    on conflict(ai_output_id) do nothing;
  delete from public.transcript_tasks where transcript_id=p_transcript_id and id=any(v_task_ids);
  get diagnostics v_tasks=row_count;
  delete from public.transcript_decisions where transcript_id=p_transcript_id and id=any(v_decision_ids);
  get diagnostics v_decisions=row_count;
  delete from public.transcript_risks where transcript_id=p_transcript_id and id=any(v_risk_ids);
  get diagnostics v_risks=row_count;
  if v_tasks<>cardinality(v_task_ids) or v_decisions<>cardinality(v_decision_ids) or v_risks<>cardinality(v_risk_ids) then
    raise exception 'checklist changed' using errcode='40001'; end if;
  return jsonb_build_object('transcriptId',p_transcript_id,'tasks',to_jsonb(v_task_ids),
    'decisions',to_jsonb(v_decision_ids),'risks',to_jsonb(v_risk_ids),'deletedCount',v_tasks+v_decisions+v_risks);
end;
$delete$;
revoke all on function public.get_managed_transcript_checklist_v2(uuid),
  public.delete_managed_transcript_checklist_v2(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_managed_transcript_checklist_v2(uuid),
  public.delete_managed_transcript_checklist_v2(uuid,jsonb) to authenticated;
