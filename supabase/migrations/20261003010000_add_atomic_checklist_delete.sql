-- Additive contract. Reversal: revoke the two entry points before removing functions/triggers.
-- Never restore deleted tasks from raw outputs automatically.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_manage_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted sharing owner' using errcode='42501'; end if;
end; $owner$;

-- Preserved raw sources must not restore their working checklist via a late/manual projection insert.
create table public.transcript_checklist_suppressions (
  ai_output_id uuid primary key references public.ai_outputs(id) on delete cascade,
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.transcript_checklist_suppressions enable row level security;
revoke all on public.transcript_checklist_suppressions from public,anon,authenticated,service_role;

-- Fence projection/output insertion behind the same transcript lock used by whole-checklist review/delete.
create function public.lock_checklist_parent_v1() returns trigger
language plpgsql security definer set search_path = '' as $fence$
begin
  -- Also lock the old parent for any future authorized move, in deterministic UUID order.
  if tg_op='UPDATE' then
    perform t.id from public.transcripts t where t.id in (old.transcript_id,new.transcript_id) order by t.id for update;
  else
    perform t.id from public.transcripts t where t.id=new.transcript_id for update;
  end if;
  if tg_table_name='transcript_tasks' then
    if not exists(select 1 from public.ai_outputs o where o.id=new.ai_output_id
      and o.transcript_id=new.transcript_id and o.user_id=new.user_id and o.processing_job_id=new.processing_job_id) then
      raise exception 'projection scope unavailable' using errcode='42501'; end if;
    if exists(select 1 from public.transcript_checklist_suppressions s where s.ai_output_id=new.ai_output_id) then
      if tg_op='UPDATE' then raise exception 'checklist source suppressed' using errcode='40001'; end if;
      return null; end if;
  else
    if not exists(select 1 from public.ai_processing_jobs j where j.id=new.processing_job_id
      and j.transcript_id=new.transcript_id and j.user_id=new.user_id) then
      raise exception 'output scope unavailable' using errcode='42501'; end if;
  end if;
  return new;
end;
$fence$;
revoke all on function public.lock_checklist_parent_v1() from public,anon,authenticated,service_role;
create trigger ai_outputs_checklist_parent_lock before insert or update of transcript_id,processing_job_id,user_id on public.ai_outputs
  for each row execute function public.lock_checklist_parent_v1();
create trigger transcript_tasks_checklist_parent_lock before insert or update of transcript_id,ai_output_id,processing_job_id,user_id on public.transcript_tasks
  for each row execute function public.lock_checklist_parent_v1();

-- Private shared snapshot builder: every authorization decision follows canonical sharing/parent locks.
create function public.managed_transcript_checklist_snapshot_v1(p_transcript_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $snapshot$
declare v_recording_id uuid; v_record public.recordings; v_transcript public.transcripts;
  v_transcript_version text; v_tasks jsonb; v_outputs jsonb; v_logical jsonb;
begin
  if p_transcript_id is null then raise exception 'invalid transcript' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  select recording_id into v_recording_id from public.transcripts where id=p_transcript_id;
  if not found then raise exception 'recording unavailable' using errcode='42501'; end if;
  v_record:=public.lock_managed_trash_recording_v1(v_recording_id);
  if v_record.status='deleted' or v_record.purge_claim_id is not null then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  select t.* into v_transcript from public.transcripts t
    where t.id=p_transcript_id and t.recording_id=v_record.id for update;
  if not found or not public.can_manage_recording(v_record.id) then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  select xmin::text into v_transcript_version from public.transcripts where id=p_transcript_id;
  -- Bound before locking/aggregating: never silently trim a partial page into a whole checklist.
  if (select count(*) from (select 1 from public.transcript_tasks where transcript_id=p_transcript_id limit 1001) x)>1000
    or (select count(*) from (select 1 from public.ai_outputs where transcript_id=p_transcript_id limit 1001) x)>1000 then
    raise exception 'checklist too large' using errcode='54000'; end if;
  perform o.id from public.ai_outputs o where o.transcript_id=p_transcript_id order by o.id for update;
  perform x.id from public.transcript_tasks x where x.transcript_id=p_transcript_id order by x.id for update;
  -- Never delete an inconsistent or foreign-scope projection hidden from normal RLS reads.
  if exists(select 1 from public.ai_outputs o left join public.ai_processing_jobs j on j.id=o.processing_job_id
    and j.transcript_id=o.transcript_id and j.user_id=o.user_id
    where o.transcript_id=p_transcript_id and (o.user_id<>v_transcript.user_id or j.id is null))
    or exists(select 1 from public.transcript_tasks x left join public.ai_outputs o on o.id=x.ai_output_id
      and o.transcript_id=x.transcript_id and o.processing_job_id=x.processing_job_id and o.user_id=x.user_id
      where x.transcript_id=p_transcript_id and (x.user_id<>v_transcript.user_id or o.id is null)) then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.transcript_tasks x join public.ai_outputs o on o.id=x.ai_output_id
    where o.transcript_id=p_transcript_id and x.transcript_id<>p_transcript_id) then
    raise exception 'recording unavailable' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'version',o.xmin::text) order by o.id),'[]'::jsonb)
    into v_outputs from public.ai_outputs o where o.transcript_id=p_transcript_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.xmin::text,'updatedAt',x.updated_at,'status',x.status) order by x.id),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('title',x.title,'owner_category',x.owner_category,
      'deadline',x.deadline,'deadline_normalized',x.deadline_normalized) order by x.id),'[]'::jsonb)
    into v_tasks,v_logical from public.transcript_tasks x where x.transcript_id=p_transcript_id;
  return jsonb_build_object('snapshot',jsonb_build_object('transcriptId',p_transcript_id,
    'generation',v_transcript.completion_generation_key,'transcriptVersion',v_transcript_version,
    'outputs',v_outputs,'tasks',v_tasks),'logicalTasks',v_logical);
end;
$snapshot$;
revoke all on function public.managed_transcript_checklist_snapshot_v1(uuid) from public,anon,authenticated,service_role;

-- Public review reads no raw artifact, job, provider, transcript body or audio metadata.
create function public.get_managed_transcript_checklist_v1(p_transcript_id uuid) returns jsonb
language sql volatile security definer set search_path = '' as $get$
  select public.managed_transcript_checklist_snapshot_v1(p_transcript_id);
$get$;

-- All-or-none task-only deletion; snapshot drift requires a new review and explicit confirmation.
create function public.delete_managed_transcript_checklist_v1(p_transcript_id uuid,p_snapshot jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $delete$
declare v_current jsonb; v_ids uuid[]; v_deleted integer;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
    or jsonb_typeof(p_snapshot->'tasks') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'outputs') is distinct from 'array' then
    raise exception 'invalid snapshot' using errcode='22023'; end if;
  if jsonb_array_length(p_snapshot->'tasks')>1000 or jsonb_array_length(p_snapshot->'outputs')>1000 then
    raise exception 'checklist too large' using errcode='54000'; end if;
  v_current:=public.managed_transcript_checklist_snapshot_v1(p_transcript_id)->'snapshot';
  if v_current is distinct from p_snapshot then raise exception 'checklist changed' using errcode='40001'; end if;
  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),'{}'::uuid[]) into v_ids
    from jsonb_array_elements(v_current->'tasks') x;
  insert into public.transcript_checklist_suppressions(ai_output_id,transcript_id)
    select (x->>'id')::uuid,p_transcript_id from jsonb_array_elements(v_current->'outputs') x
    on conflict(ai_output_id) do nothing;
  delete from public.transcript_tasks where transcript_id=p_transcript_id and id=any(v_ids);
  get diagnostics v_deleted=row_count;
  if v_deleted<>cardinality(v_ids) then raise exception 'checklist changed' using errcode='40001'; end if;
  return jsonb_build_object('transcriptId',p_transcript_id,'deletedIds',to_jsonb(v_ids),'deletedCount',v_deleted);
end;
$delete$;
revoke all on function public.get_managed_transcript_checklist_v1(uuid),
  public.delete_managed_transcript_checklist_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_managed_transcript_checklist_v1(uuid),
  public.delete_managed_transcript_checklist_v1(uuid,jsonb) to authenticated;
