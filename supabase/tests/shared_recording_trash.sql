-- Disposable full migration-chain database only. Prepared artifact, NOT a runtime pass receipt.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Deterministic fixture identifiers, not production data.
create function pg_temp.tid(p_group integer,p_id integer) returns uuid language sql immutable
as $$select (lpad(p_group::text,8,'0')||'-0000-4000-8000-'||lpad(p_id::text,12,'0'))::uuid$$;
create function pg_temp.actor(p_id integer) returns text language sql
as $$select set_config('request.jwt.claims',json_build_object('sub',pg_temp.tid(13000000,p_id),'role','authenticated')::text,true)$$;
set local role service_role;
insert into auth.users(id,email) select pg_temp.tid(13000000,n),'trash-'||n||'@fixture.test' from generate_series(1,6)n;
insert into public.recording_projects(id,user_id,name) values(pg_temp.tid(23000000,1),pg_temp.tid(13000000,1),'Trash fixture');
insert into public.recording_project_members(project_id,user_id,role,revoked_at) values
(pg_temp.tid(23000000,1),pg_temp.tid(13000000,2),'editor',null),
(pg_temp.tid(23000000,1),pg_temp.tid(13000000,3),'reader',null),
(pg_temp.tid(23000000,1),pg_temp.tid(13000000,6),'reader',now());
-- 1 project, 2 private, 3 standalone selected, 4 project-selected.
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status)
select pg_temp.tid(33000000,n),pg_temp.tid(13000000,2),pg_temp.tid(13000000,2),'Trash fixture '||n,'realtime',
case when n in(1,4) then pg_temp.tid(23000000,1) end,
case when n=1 then 'project' when n in(3,4) then 'selected' else 'private' end,
'completed' from generate_series(1,4)n;
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id) values
(pg_temp.tid(33000000,3),pg_temp.tid(13000000,4),'reader',null),
(pg_temp.tid(33000000,4),pg_temp.tid(13000000,4),'reader',pg_temp.tid(23000000,1));
-- Insert consistent historical Trash snapshots (the lifecycle trigger is UPDATE-only).
-- 5 manual already due, 6 manual 24h-eligible but not due; 7 automatic due; 8 auto exhausted.
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status,deleted_from_status,deleted_at,trash_retention_hours,purge_after,purge_attempt_count)
select pg_temp.tid(33000000,n),pg_temp.tid(13000000,2),pg_temp.tid(13000000,2),'Old Trash '||n,'realtime',
pg_temp.tid(23000000,1),'project','deleted','completed',
now()-case when n=6 then interval '2 days' else interval '31 days' end,720,
now()-case when n=6 then interval '2 days' else interval '31 days' end+interval '30 days',
case when n=8 then 5 else 0 end from generate_series(5,8)n;
insert into public.transcripts(id,recording_id,user_id,raw_text)
select pg_temp.tid(43000000,n),pg_temp.tid(33000000,n),pg_temp.tid(13000000,2),'Fixture transcript' from generate_series(1,6)n;
-- Historical jobs predate current custody/Trash admission, which is restored before every assertion.
reset role;
alter table public.ai_processing_jobs disable trigger ai_processing_jobs_guard_personal_admission;
set local role service_role;
insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id,status)
select pg_temp.tid(63000000,n),pg_temp.tid(43000000,n),pg_temp.tid(13000000,2),'fixture','summary',p.id,'done'
from generate_series(1,6)n cross join lateral(select id from public.prompt_templates where is_system and processing_type='summary' limit 1)p;
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
select pg_temp.tid(73000000,n),pg_temp.tid(63000000,n),pg_temp.tid(43000000,n),pg_temp.tid(13000000,2),'Fixture output' from generate_series(1,6)n;
insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
select pg_temp.tid(83000000,n),pg_temp.tid(73000000,n),pg_temp.tid(63000000,n),pg_temp.tid(43000000,n),pg_temp.tid(13000000,2),1,'Fixture task' from generate_series(1,6)n;
insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values(pg_temp.tid(83000000,11),pg_temp.tid(73000000,1),pg_temp.tid(63000000,1),pg_temp.tid(43000000,1),pg_temp.tid(13000000,2),2,'Existing protected task');
-- Same logical task in another transcript/projection of the SAME recording.
insert into public.transcripts(id,recording_id,user_id,raw_text)
values(pg_temp.tid(43000000,12),pg_temp.tid(33000000,1),pg_temp.tid(13000000,2),'Another transcript');
insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id,status)
select pg_temp.tid(63000000,12),pg_temp.tid(43000000,12),pg_temp.tid(13000000,2),'fixture','summary',id,'done'
from public.prompt_templates where is_system and processing_type='summary' limit 1;
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
values(pg_temp.tid(73000000,12),pg_temp.tid(63000000,12),pg_temp.tid(43000000,12),pg_temp.tid(13000000,2),'Duplicate projection');
insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values(pg_temp.tid(83000000,12),pg_temp.tid(73000000,12),pg_temp.tid(63000000,12),pg_temp.tid(43000000,12),pg_temp.tid(13000000,2),1,'Fixture task');
-- Corrupt legacy lineage: each output belongs to project recording 1, but its child names private recording 2's job.
-- Separate composite owner FKs allow this same-user cross-recording job reference; transcript IDs still match the output.
insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id,status)
select pg_temp.tid(63000000,n),pg_temp.tid(43000000,1),pg_temp.tid(13000000,2),'fixture','summary',p.id,'done'
from generate_series(21,24)n cross join lateral(select id from public.prompt_templates where is_system and processing_type='summary' limit 1)p;
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
select pg_temp.tid(73000000,n),pg_temp.tid(63000000,n),pg_temp.tid(43000000,1),pg_temp.tid(13000000,2),'Cross-job fixture' from generate_series(21,24)n;
-- Deliberately legacy corruption is admitted only while seeding; current writes remain fenced.
reset role;
alter table public.transcript_tasks disable trigger transcript_tasks_checklist_parent_lock;
set local role service_role;
insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values(pg_temp.tid(83000000,21),pg_temp.tid(73000000,21),pg_temp.tid(63000000,2),pg_temp.tid(43000000,1),pg_temp.tid(13000000,2),1,'Cross-recording job child');
reset role;
alter table public.transcript_tasks enable trigger transcript_tasks_checklist_parent_lock;
set local role service_role;
insert into public.transcript_chapters(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values(pg_temp.tid(83000000,22),pg_temp.tid(73000000,22),pg_temp.tid(63000000,2),pg_temp.tid(43000000,1),pg_temp.tid(13000000,2),1,'Cross-recording job child');
insert into public.transcript_decisions(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values(pg_temp.tid(83000000,23),pg_temp.tid(73000000,23),pg_temp.tid(63000000,2),pg_temp.tid(43000000,1),pg_temp.tid(13000000,2),1,'Cross-recording job child');
insert into public.transcript_risks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values(pg_temp.tid(83000000,24),pg_temp.tid(73000000,24),pg_temp.tid(63000000,2),pg_temp.tid(43000000,1),pg_temp.tid(13000000,2),1,'Cross-recording job child');
reset role;
alter table public.ai_processing_jobs enable trigger ai_processing_jobs_guard_personal_admission;
select is((select count(*) from public.ai_outputs where id between pg_temp.tid(73000000,1) and pg_temp.tid(73000000,6)),6::bigint,'Fixture system prompt creates all output lineages');
-- Catalog/ACL proofs execute against the actual installed definitions.
select ok(exists(
  select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_am am on am.oid=c.relam
  where n.nspname='public' and c.relname=table_name||'_output_transcript_idx'
    and i.indrelid=to_regclass('public.'||table_name) and i.indisvalid and i.indisready and am.amname='btree'
    and i.indpred is null and i.indexprs is null
    and pg_get_indexdef(i.indexrelid,1,true)='ai_output_id' and pg_get_indexdef(i.indexrelid,2,true)='transcript_id'
),'Valid output-prefix lineage/cascade index: '||table_name)
from unnest(array['transcript_tasks','transcript_chapters','transcript_decisions','transcript_risks']) table_name;
select ok(p.prosecdef and p.provolatile=case when p.proname='get_managed_recording_trash_v1' then 's'::"char" else 'v'::"char" end
and p.proconfig=array['search_path=""'] and p.proowner=(select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure),
'Trusted definer and empty path: '||p.proname) from pg_proc p where p.oid=any(array[
'public.trash_recording_v1(uuid,timestamptz,integer)'::regprocedure,
'public.restore_shared_recording_v1(uuid,timestamptz)'::regprocedure,
'public.prepare_recording_purge_v1(uuid,uuid,timestamptz)'::regprocedure,
'public.start_recording_purge_v1(uuid)'::regprocedure,
'public.release_recording_purge_v1(uuid)'::regprocedure,
'public.acquire_recording_purge_work_v1(uuid,uuid)'::regprocedure,
'public.finalize_recording_purge_work_v1(uuid,uuid)'::regprocedure,
'public.claim_started_recording_purge_work_v1(integer)'::regprocedure,
'public.delete_managed_transcript_task_group_v1(uuid,timestamptz,uuid[])'::regprocedure,
'public.delete_managed_ai_output_v1(uuid)'::regprocedure,
'public.get_managed_recording_trash_v1(uuid[])'::regprocedure]);
select ok(not has_function_privilege('authenticated','public.lock_managed_trash_recording_v1(uuid)','execute'),'Private full row helper denied');
select ok(not has_function_privilege('authenticated','public.acquire_recording_purge_work_v1(uuid,uuid)','execute'),'Worker fetch denied to session');
select ok(not has_function_privilege('authenticated','public.claim_started_recording_purge_work_v1(integer)','execute'),'Worker recovery denied to session');
select ok(not has_function_privilege('service_role','public.prepare_recording_purge_v1(uuid,uuid,timestamptz)','execute'),'Service cannot invent session acceptance');
select ok(not has_table_privilege('authenticated','public.recording_purge_operations','select'),'Receipt table private');
select ok(not has_function_privilege('anon','public.trash_recording_v1(uuid,timestamptz,integer)','execute'),'Anon cannot mutate Trash');
select ok(not has_column_privilege('authenticated','public.recordings','purge_claim_id','select'),'No session claim token grant');
select ok(not has_column_privilege('authenticated','public.recordings','storage_path','select'),'No session storage path grant');
set local role authenticated;
set local request.jwt.claims='{}';
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,1),now(),720)$$,'42501',null,'Missing session identity fails closed');
select is((select count(*) from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,5)])),0::bigint,'Missing identity has no enrichment');
-- Founder manages another technical owner's shared project, never their private row.
select pg_temp.actor(1);
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,2),now(),720)$$,'42501',null,'Founder cannot manage private foreign');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,2),now(),array[pg_temp.tid(83000000,2)])$$,'42501',null,'Founder cannot delete private foreign child');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,2))$$,'42501',null,'Founder cannot delete private foreign output');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,21))$$,'42501',null,'transcript_tasks: cross-recording job descendant blocks output delete');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,22))$$,'42501',null,'transcript_chapters: cross-recording job descendant blocks output delete');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,23))$$,'42501',null,'transcript_decisions: cross-recording job descendant blocks output delete');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,24))$$,'42501',null,'transcript_risks: cross-recording job descendant blocks output delete');
select is((select count(*) from public.ai_outputs where id between pg_temp.tid(73000000,21) and pg_temp.tid(73000000,24)),4::bigint,'Every rejected cross-job output remains');
select is((select count(*) from public.transcript_tasks where id=pg_temp.tid(83000000,21)),1::bigint,'transcript_tasks: corrupt child preserved, no cascade');
select is((select count(*) from public.transcript_chapters where id=pg_temp.tid(83000000,22)),1::bigint,'transcript_chapters: corrupt child preserved, no cascade');
select is((select count(*) from public.transcript_decisions where id=pg_temp.tid(83000000,23)),1::bigint,'transcript_decisions: corrupt child preserved, no cascade');
select is((select count(*) from public.transcript_risks where id=pg_temp.tid(83000000,24)),1::bigint,'transcript_risks: corrupt child preserved, no cascade');
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,1),'2000-01-01',720)$$,'40001',null,'Stale active version rejected');
select is(public.trash_recording_v1(pg_temp.tid(33000000,1),(select updated_at from public.recordings where id=pg_temp.tid(33000000,1)),168)->>'changed','true','Founder deletes project');
select is(public.trash_recording_v1(pg_temp.tid(33000000,1),'2000-01-01',168)->>'changed','false','Repeat delete matched idempotent');
select is((select trash_retention_hours from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,1)])),168::smallint,'Safe manager enrichment');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,1),pg_temp.tid(93000000,1),(select updated_at from public.recordings where id=pg_temp.tid(33000000,1)))$$,'55000',null,'Manual purge blocked before 24h, regardless retention');
select is(public.restore_shared_recording_v1(pg_temp.tid(33000000,1),(select updated_at from public.recordings where id=pg_temp.tid(33000000,1)))->>'status','completed','Restore exact prior status');
select is(public.restore_shared_recording_v1(pg_temp.tid(33000000,1),'2000-01-01')->>'changed','false','Repeat restore explicit unchanged');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),'2000-01-01',array[pg_temp.tid(83000000,1)])$$,'40001',null,'Task stale version rejected');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array_fill(pg_temp.tid(83000000,1),array[1001]))$$,'22023',null,'Raw bound rejects repeated IDs before dedup');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array[[pg_temp.tid(83000000,1)]])$$,'22023',null,'Multidimensional input rejected');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),'{}'::uuid[])$$,'22023',null,'Empty group rejected');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array[pg_temp.tid(83000000,1),null])$$,'22023',null,'Null ID rejected');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array[pg_temp.tid(83000000,12)])$$,'22023',null,'Target must belong to group');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array[pg_temp.tid(83000000,1),pg_temp.tid(83000000,2)])$$,'42501',null,'Mixed recording group denied without partial delete');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array[pg_temp.tid(83000000,1),pg_temp.tid(83000000,4)])$$,'42501',null,'Cross-recording group denied even when manager controls both');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array[pg_temp.tid(83000000,1),pg_temp.tid(83000000,999)])$$,'42501',null,'Missing group member denied without enumeration');
select is((select count(*) from public.transcript_tasks where id in(pg_temp.tid(83000000,1),pg_temp.tid(83000000,12))),2::bigint,'Every rejected group leaves both valid tasks intact');
select is(public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),(select updated_at from public.transcript_tasks where id=pg_temp.tid(83000000,1)),array[pg_temp.tid(83000000,12),pg_temp.tid(83000000,1),pg_temp.tid(83000000,12)])->>'deletedCount','2','Founder deletes logical group across transcripts of same recording');
select is((select count(*) from public.transcript_tasks where id in(pg_temp.tid(83000000,1),pg_temp.tid(83000000,12))),0::bigint,'Logical task copies cannot resurface');
select is((select count(*) from public.transcript_tasks where id=pg_temp.tid(83000000,11)),1::bigint,'Unrequested task of same recording remains');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,1),now(),array[pg_temp.tid(83000000,1)])$$,'42501',null,'Repeated task delete is not silent success');

select pg_temp.actor(2);
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,1),now(),720)$$,'42501',null,'Actor 2 denied project delete');
select throws_ok($$select public.restore_shared_recording_v1(pg_temp.tid(33000000,5),now())$$,'42501',null,'Actor 2 denied restore');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,20),now())$$,'42501',null,'Actor 2 denied purge');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,11),now(),array[pg_temp.tid(83000000,11)])$$,'42501',null,'Actor 2 denied child task');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,1))$$,'42501',null,'Actor 2 denied child output');
select is((select count(*) from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,5),pg_temp.tid(33000000,999)])),0::bigint,'Actor 2 no shared Trash metadata');

select pg_temp.actor(3);
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,1),now(),720)$$,'42501',null,'Actor 3 denied project delete');
select throws_ok($$select public.restore_shared_recording_v1(pg_temp.tid(33000000,5),now())$$,'42501',null,'Actor 3 denied restore');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,20),now())$$,'42501',null,'Actor 3 denied purge');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,11),now(),array[pg_temp.tid(83000000,11)])$$,'42501',null,'Actor 3 denied child task');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,1))$$,'42501',null,'Actor 3 denied child output');
select is((select count(*) from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,5),pg_temp.tid(33000000,999)])),0::bigint,'Actor 3 no shared Trash metadata');

select pg_temp.actor(4);
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,4),now(),array[pg_temp.tid(83000000,4)])$$,'42501',null,'Exact selected reader cannot delete readable task');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,4))$$,'42501',null,'Exact selected reader cannot delete readable output');
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,1),now(),720)$$,'42501',null,'Actor 4 denied project delete');
select throws_ok($$select public.restore_shared_recording_v1(pg_temp.tid(33000000,5),now())$$,'42501',null,'Actor 4 denied restore');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,20),now())$$,'42501',null,'Actor 4 denied purge');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,11),now(),array[pg_temp.tid(83000000,11)])$$,'42501',null,'Actor 4 denied child task');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,1))$$,'42501',null,'Actor 4 denied child output');
select is((select count(*) from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,5),pg_temp.tid(33000000,999)])),0::bigint,'Actor 4 no shared Trash metadata');

select pg_temp.actor(5);
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,1),now(),720)$$,'42501',null,'Actor 5 denied project delete');
select throws_ok($$select public.restore_shared_recording_v1(pg_temp.tid(33000000,5),now())$$,'42501',null,'Actor 5 denied restore');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,20),now())$$,'42501',null,'Actor 5 denied purge');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,11),now(),array[pg_temp.tid(83000000,11)])$$,'42501',null,'Actor 5 denied child task');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,1))$$,'42501',null,'Actor 5 denied child output');
select is((select count(*) from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,5),pg_temp.tid(33000000,999)])),0::bigint,'Actor 5 no shared Trash metadata');

select pg_temp.actor(6);
select throws_ok($$select public.trash_recording_v1(pg_temp.tid(33000000,1),now(),720)$$,'42501',null,'Actor 6 denied project delete');
select throws_ok($$select public.restore_shared_recording_v1(pg_temp.tid(33000000,5),now())$$,'42501',null,'Actor 6 denied restore');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,20),now())$$,'42501',null,'Actor 6 denied purge');
select throws_ok($$select public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,11),now(),array[pg_temp.tid(83000000,11)])$$,'42501',null,'Actor 6 denied child task');
select throws_ok($$select public.delete_managed_ai_output_v1(pg_temp.tid(73000000,1))$$,'42501',null,'Actor 6 denied child output');
select is((select count(*) from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,5),pg_temp.tid(33000000,999)])),0::bigint,'Actor 6 no shared Trash metadata');

select pg_temp.actor(2);
select is(public.delete_managed_transcript_task_group_v1(pg_temp.tid(83000000,2),(select updated_at from public.transcript_tasks where id=pg_temp.tid(83000000,2)),array_fill(pg_temp.tid(83000000,2),array[1000]))->>'deletedCount','1','Private owner deletes group at raw 1000 boundary');
select is(public.delete_managed_ai_output_v1(pg_temp.tid(73000000,3))->>'deletedId',pg_temp.tid(73000000,3)::text,'Standalone owner child delete');
select is(public.trash_recording_v1(pg_temp.tid(33000000,2),(select updated_at from public.recordings where id=pg_temp.tid(33000000,2)),24)->>'changed','true','Private owner Trash');
select is(public.trash_recording_v1(pg_temp.tid(33000000,3),(select updated_at from public.recordings where id=pg_temp.tid(33000000,3)),720)->>'changed','true','Standalone selected owner Trash');
select is((select count(*) from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,2),pg_temp.tid(33000000,3),pg_temp.tid(33000000,5)])),2::bigint,'Owner enrichment exact manager set');
select throws_ok($$select public.get_managed_recording_trash_v1(array_fill(pg_temp.tid(33000000,2),array[101]))$$,'22023',null,'Enrichment bounded before query');
select pg_temp.actor(1);
select is(public.delete_managed_ai_output_v1(pg_temp.tid(73000000,4))->>'deletedId',pg_temp.tid(73000000,4)::text,'Founder selected output delete');
select set_config('test.purge_op',(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,5),(select updated_at from public.recordings where id=pg_temp.tid(33000000,5)))->>'operationId'),true);
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,5),'2000-01-01')->>'operationId',current_setting('test.purge_op'),'Same request receipt retry');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,6),pg_temp.tid(93000000,5),now())$$,'22023',null,'Request identity cannot switch recording');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,50),(select updated_at from public.recordings where id=pg_temp.tid(33000000,5)))$$,'55000',null,'Second request cannot steal fresh lease');
select throws_ok($$select public.restore_shared_recording_v1(pg_temp.tid(33000000,5),(select updated_at from public.recordings where id=pg_temp.tid(33000000,5)))$$,'55000',null,'Prepared claim fences restore');
reset role;
select set_config('test.purge_claim',(select claim_id::text from public.recording_purge_operations where id=current_setting('test.purge_op')::uuid),true);
update public.recordings set purge_started_at=statement_timestamp()-interval '16 minutes' where id=pg_temp.tid(33000000,5);
set local role service_role;
select throws_ok($$select * from public.acquire_recording_purge_work_v1(current_setting('test.purge_op')::uuid)$$,'55000',null,'Service cannot start prepared cleanup');
select is((select count(*) from public.claim_started_recording_purge_work_v1(5)),0::bigint,'Prepared receipt is never discoverable');
select is(public.refresh_recording_purge_claim_v1(pg_temp.tid(33000000,5),current_setting('test.purge_claim')::uuid),false,'Legacy refresh cannot borrow receipt');
select is(public.release_recording_purge_claim_v1(pg_temp.tid(33000000,5),current_setting('test.purge_claim')::uuid),false,'Legacy release cannot reopen receipt');
select is(public.finalize_recording_purge_v1(pg_temp.tid(33000000,5),current_setting('test.purge_claim')::uuid),false,'Legacy finalize cannot bypass receipt');
select is(array(select id from public.claim_due_recording_purges_v1(20) where id between pg_temp.tid(33000000,5) and pg_temp.tid(33000000,8)),array[pg_temp.tid(33000000,7)],'Automatic excludes due stale manual receipt, future deadline and exhausted row');
select ok(public.refresh_recording_purge_claim_v1(pg_temp.tid(33000000,7),(select purge_claim_id from public.recordings where id=pg_temp.tid(33000000,7))),'Automatic refresh still works');
select ok(public.release_recording_purge_claim_v1(pg_temp.tid(33000000,7),(select purge_claim_id from public.recordings where id=pg_temp.tid(33000000,7))),'Automatic release still works');
select is((select count(*) from public.claim_due_recording_purges_v1(20) where id=pg_temp.tid(33000000,7)),1::bigint,'Automatic released work can be reclaimed');
select ok(public.finalize_recording_purge_v1(pg_temp.tid(33000000,7),(select purge_claim_id from public.recordings where id=pg_temp.tid(33000000,7))),'Automatic exact due finalize still works');
reset role;
-- A founder has no membership grant to revoke. Trusted fixture ownership change simulates actual manager loss;
-- this is NOT a new product transfer API. It uses the same canonical mutation lock.
select public.recording_sharing_lock_v1();
update public.recording_projects set user_id=pg_temp.tid(13000000,5) where id=pg_temp.tid(23000000,1);
set local role authenticated;
select pg_temp.actor(1);
select throws_ok($$select public.start_recording_purge_v1(current_setting('test.purge_op')::uuid)$$,'42501',null,'Authority loss BEFORE start denies cleanup');
-- Prepare committed but its response was lost: the actor retained the request UUID, not the operation handle.
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,5),'2000-01-01')->>'operationId',current_setting('test.purge_op'),'Same request recovers own prepared operation after authority loss');
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,5),'2000-01-01')->>'phase','prepared','Recovery does not start cleanup');
select pg_temp.actor(3);
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,5),now())$$,'42501',null,'Another actor cannot recover the original request');
select pg_temp.actor(1);
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,500),now())$$,'42501',null,'Former manager cannot recover with a different request or create new work');
select is(public.release_recording_purge_v1(current_setting('test.purge_op')::uuid)->>'changed','true','Original actor may safely release prepared after loss');
select is(public.release_recording_purge_v1(current_setting('test.purge_op')::uuid)->>'changed','false','Prepared release idempotence');
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,5),now())->>'phase','released','Released request recovery cannot reserve again');
reset role;
update public.recording_projects set user_id=pg_temp.tid(13000000,1) where id=pg_temp.tid(23000000,1);
set local role authenticated;
select pg_temp.actor(1);
select set_config('test.purge_op',(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,6),(select updated_at from public.recordings where id=pg_temp.tid(33000000,5)))->>'operationId'),true);
select is(public.start_recording_purge_v1(current_setting('test.purge_op')::uuid)->>'changed','true','Session accepts irreversible work');
select is(public.start_recording_purge_v1(current_setting('test.purge_op')::uuid)->>'changed','false','Start repeat matched');
select throws_ok($$select public.release_recording_purge_v1(current_setting('test.purge_op')::uuid)$$,'55000',null,'Started claim NEVER released');
reset role;
update public.recording_projects set user_id=pg_temp.tid(13000000,5) where id=pg_temp.tid(23000000,1);
set local role authenticated;
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,6),pg_temp.tid(93000000,7),now())$$,'42501',null,'Former manager cannot start new work');
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,6),now())->>'phase','started','Own started receipt is recoverable after authority loss');
set local role service_role;
-- Simulate crash immediately after start: discovery needs no client-persisted operation ID.
select set_config('test.worker_claim',(select claim_id::text from public.claim_started_recording_purge_work_v1(5) where operation_id=current_setting('test.purge_op')::uuid),true);
select is((select count(*) from public.claim_started_recording_purge_work_v1(5)),0::bigint,'Second worker cannot borrow fresh lease');
select is((select storage_prefix from public.acquire_recording_purge_work_v1(current_setting('test.purge_op')::uuid,current_setting('test.worker_claim')::uuid)),pg_temp.tid(13000000,2)::text||'/'||pg_temp.tid(33000000,5)::text||'/','Accepted service work survives later authority loss with exact prefix');
select throws_ok($$select * from public.acquire_recording_purge_work_v1(current_setting('test.purge_op')::uuid)$$,'55000',null,'Missing lease cannot borrow in-flight worker');
-- Disposable fake Storage metadata only; this fixture has NO backing uploaded object.
insert into storage.objects(bucket_id,name) values('recordings',pg_temp.tid(13000000,2)::text||'/'||pg_temp.tid(33000000,5)::text||'/fixture.webm');
select throws_ok($$select public.finalize_recording_purge_work_v1(current_setting('test.purge_op')::uuid,current_setting('test.worker_claim')::uuid)$$,'55000',null,'Nonempty canonical prefix blocks DB cascade');
-- Test-only removal of the above fake catalog row. Production MUST remove via Storage API.
delete from storage.objects where bucket_id='recordings' and name=pg_temp.tid(13000000,2)::text||'/'||pg_temp.tid(33000000,5)::text||'/fixture.webm';
select ok(public.finalize_recording_purge_work_v1(current_setting('test.purge_op')::uuid,current_setting('test.worker_claim')::uuid),'Accepted exact receipt completes AFTER authority loss');
select ok(public.finalize_recording_purge_work_v1(current_setting('test.purge_op')::uuid,current_setting('test.worker_claim')::uuid),'Completed receipt retry succeeds exactly once');
select throws_ok($$select public.finalize_recording_purge_work_v1(current_setting('test.purge_op')::uuid,pg_temp.tid(93000000,999))$$,'55000',null,'Completed tombstone rejects wrong token');
reset role;
select ok((select phase='completed' and completed_at is not null and storage_owner_id is null and deleted_at is null from public.recording_purge_operations where id=current_setting('test.purge_op')::uuid),'Minimal tombstone survives cascade without storage binding');
set local role authenticated;
select pg_temp.actor(1);
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,5),pg_temp.tid(93000000,6),now())->>'phase','completed','Completed request recovers after recording deletion without authority or content');
reset role;
select is((select count(*) from public.recordings where id=pg_temp.tid(33000000,5)),0::bigint,'Recording removed');
select is((select count(*) from public.transcripts where id=pg_temp.tid(43000000,5)),0::bigint,'Transcript cascade');
select is((select count(*) from public.transcript_search_chunks where recording_id=pg_temp.tid(33000000,5)),0::bigint,'Search index cascade');
select is((select count(*) from public.ai_processing_jobs where id=pg_temp.tid(63000000,5)),0::bigint,'Job cascade');
select is((select count(*) from public.ai_outputs where id=pg_temp.tid(73000000,5)),0::bigint,'Output cascade');
select is((select count(*) from public.transcript_tasks where id=pg_temp.tid(83000000,5)),0::bigint,'Task cascade');
select is((select count(*) from public.transcript_tasks where id in(pg_temp.tid(83000000,3),pg_temp.tid(83000000,4))),0::bigint,'Output deletion cascades tasks');
select is((select count(*) from public.ai_processing_jobs where id in(pg_temp.tid(63000000,3),pg_temp.tid(63000000,4))),2::bigint,'Granular output delete retains job idempotency');
-- Stale started takeover rotates the token but NEVER reopens release/restore.
set local role authenticated;
select pg_temp.actor(5);
select ok((select purge_after>statement_timestamp() from public.get_managed_recording_trash_v1(array[pg_temp.tid(33000000,6)])),'Manual purge may precede automatic retention after 24h fence');
select set_config('test.stale_op',public.prepare_recording_purge_v1(pg_temp.tid(33000000,6),pg_temp.tid(93000000,60),(select updated_at from public.recordings where id=pg_temp.tid(33000000,6)))->>'operationId',true);
select is(public.start_recording_purge_v1(current_setting('test.stale_op')::uuid)->>'phase','started','Second accepted cleanup');
set local role service_role;
select is((select count(*) from public.acquire_recording_purge_work_v1(current_setting('test.stale_op')::uuid)),1::bigint,'Original receipt spends first worker acquisition');
reset role;
update public.recording_purge_operations set worker_claimed_at=statement_timestamp()-interval '16 minutes' where id=current_setting('test.stale_op')::uuid;
update public.recordings set purge_started_at=statement_timestamp()-interval '16 minutes' where id=pg_temp.tid(33000000,6);
set local role service_role;
select is((select count(*) from public.claim_due_recording_purges_v1(20) where id=pg_temp.tid(33000000,6)),0::bigint,'Non-due stale manual work is not automatically claimed');
set local role authenticated;
select set_config('test.replacement_op',public.prepare_recording_purge_v1(pg_temp.tid(33000000,6),pg_temp.tid(93000000,61),(select updated_at from public.recordings where id=pg_temp.tid(33000000,6)))->>'operationId',true);
reset role;
select is((select work_attempt_count from public.recording_purge_operations where id=current_setting('test.replacement_op')::uuid),1::smallint,'Started replacement inherits cumulative acquisition count');
set local role authenticated;
select throws_ok($$select public.release_recording_purge_v1(current_setting('test.replacement_op')::uuid)$$,'55000',null,'Started takeover cannot release');
set local role service_role;
select throws_ok($$select * from public.acquire_recording_purge_work_v1(current_setting('test.stale_op')::uuid)$$,'55000',null,'Superseded worker cannot renew');
select set_config('test.old_worker_claim',(select claim_id::text from public.acquire_recording_purge_work_v1(current_setting('test.replacement_op')::uuid)),true);
reset role;
update public.recording_purge_operations set worker_claimed_at=statement_timestamp()-interval '16 minutes' where id=current_setting('test.replacement_op')::uuid;
update public.recordings set purge_started_at=statement_timestamp()-interval '16 minutes' where id=pg_temp.tid(33000000,6);
set local role service_role;
select set_config('test.new_worker_claim',(select claim_id::text from public.claim_started_recording_purge_work_v1(5) where operation_id=current_setting('test.replacement_op')::uuid),true);
select isnt(current_setting('test.old_worker_claim'),current_setting('test.new_worker_claim'),'Stale worker takeover rotates token');
select throws_ok($$select public.finalize_recording_purge_work_v1(current_setting('test.replacement_op')::uuid,current_setting('test.old_worker_claim')::uuid)$$,'55000',null,'Old worker cannot finalize rotated lease');
select throws_ok($$select * from public.acquire_recording_purge_work_v1(current_setting('test.replacement_op')::uuid,current_setting('test.old_worker_claim')::uuid)$$,'55000',null,'Old worker cannot refresh rotated lease');
reset role;
select is((select work_attempt_count from public.recording_purge_operations where id=current_setting('test.replacement_op')::uuid),3::smallint,'Original plus replacement and worker takeover accumulate');
-- Advance lease clocks only; each additional attempt is acquired by the real service RPC.
update public.recording_purge_operations set worker_claimed_at=statement_timestamp()-interval '16 minutes' where id=current_setting('test.replacement_op')::uuid;
update public.recordings set purge_started_at=statement_timestamp()-interval '16 minutes' where id=pg_temp.tid(33000000,6);
set local role service_role;
select is((select count(*) from public.claim_started_recording_purge_work_v1(5)),1::bigint,'Fourth cumulative acquisition');
reset role;
update public.recording_purge_operations set worker_claimed_at=statement_timestamp()-interval '16 minutes' where id=current_setting('test.replacement_op')::uuid;
update public.recordings set purge_started_at=statement_timestamp()-interval '16 minutes' where id=pg_temp.tid(33000000,6);
set local role service_role;
select is((select count(*) from public.claim_started_recording_purge_work_v1(5)),1::bigint,'Fifth cumulative acquisition');
reset role;
select is((select work_attempt_count from public.recording_purge_operations where id=current_setting('test.replacement_op')::uuid),5::smallint,'Five-attempt budget survives receipt replacement');
update public.recording_purge_operations set worker_claimed_at=statement_timestamp()-interval '16 minutes' where id=current_setting('test.replacement_op')::uuid;
update public.recordings set purge_started_at=statement_timestamp()-interval '16 minutes' where id=pg_temp.tid(33000000,6);
set local role service_role;
select is((select count(*) from public.claim_started_recording_purge_work_v1(5)),0::bigint,'Max five attempts excludes dead letter');
select throws_ok($$select * from public.acquire_recording_purge_work_v1(current_setting('test.replacement_op')::uuid)$$,'55000',null,'Exact initial acquire cannot bypass retry cap');
set local role authenticated;
select pg_temp.actor(5);
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,6),pg_temp.tid(93000000,61),now())->>'operationId',current_setting('test.replacement_op'),'Same request replay only returns exhausted receipt, never resets budget');
select is(public.prepare_recording_purge_v1(pg_temp.tid(33000000,6),pg_temp.tid(93000000,60),now())->>'phase','superseded','Old request recovers only superseded state, never reopens cleanup');
select throws_ok($$select public.prepare_recording_purge_v1(pg_temp.tid(33000000,6),pg_temp.tid(93000000,62),(select updated_at from public.recordings where id=pg_temp.tid(33000000,6)))$$,'55000',null,'Session new request cannot reopen exhausted cleanup');
reset role;
select ok((select phase='started' from public.recording_purge_operations where id=current_setting('test.replacement_op')::uuid),'Dead letter remains started, never released');
select is((select work_attempt_count from public.recording_purge_operations where id=current_setting('test.replacement_op')::uuid),5::smallint,'Repeated and new request IDs do not reset dead-letter budget');
select ok(exists(select 1 from public.recordings where id=pg_temp.tid(33000000,6) and status='deleted' and purge_claim_id is not null),'Dead letter preserves fenced recording');
select * from finish();
rollback;
