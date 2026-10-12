-- Full-chain disposable pgTAP artifact only; NOT an executed runtime receipt.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Fixture-only opaque IDs, session claims and stored RPC responses.
create function pg_temp.uid(p_group integer,p_number integer) returns uuid language sql immutable
as $$select (lpad(p_group::text,8,'0')||'-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid$$;
create function pg_temp.actor(p_number integer) returns text language sql
as $$select set_config('request.jwt.claims',json_build_object('sub',pg_temp.uid(18000000,p_number),'role','authenticated')::text,true)$$;
create temporary table handles(key text primary key,payload jsonb);
grant select,insert,update on handles to authenticated,service_role;
create function pg_temp.h(p_key text,p_field text) returns uuid language sql
as $$select (payload->>p_field)::uuid from pg_temp.handles where key=p_key$$;
set local role service_role;
insert into auth.users(id,email) select pg_temp.uid(18000000,n),'capture-'||n||'@fixture.test' from generate_series(1,7)n;
insert into public.recording_projects(id,user_id,name) values(pg_temp.uid(28000000,1),pg_temp.uid(18000000,1),'Capture project');
insert into public.recording_project_members(project_id,user_id,role) values
(pg_temp.uid(28000000,1),pg_temp.uid(18000000,2),'editor'),(pg_temp.uid(28000000,1),pg_temp.uid(18000000,3),'reader');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,project_id,storage_path,mime_type,file_size_bytes)
select pg_temp.uid(38000000,n),pg_temp.uid(18000000,case when n=9 then 7 when n=13 then 6 else 2 end),
pg_temp.uid(18000000,case when n=9 then 7 when n=13 then 6 else 2 end),'Capture fixture '||n,
(case when n=7 then 'realtime' when n in(5,6,8,15,16,17,18) then 'in_app_recording' else 'upload' end)::public.recording_source_type,
(case when n=7 then 'created' when n in(4,8) then 'failed' when n in(5,6,12,15,16,17,18) then 'uploading' when n=20 then 'completed' else 'uploaded' end)::public.recording_status,
case when n in(1,2,4,5,8,11,18) then 'project' else 'private' end,
case when n in(1,2,4,5,8,11,18) then pg_temp.uid(28000000,1) end,
case when n not in(5,7,16,17,18) then pg_temp.uid(18000000,case when n=9 then 7 when n=13 then 6 else 2 end)::text||'/'||pg_temp.uid(38000000,n)::text||'/'||
case when n in(8,11) then 'live/' else 'audio.webm' end end,'audio/webm',123
from generate_series(1,20)n;
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',storage_path,'{"size":123,"mimetype":"audio/webm"}'::jsonb from public.recordings
where id in(select pg_temp.uid(38000000,n) from unnest(array[1,2,3,4,9,10,12,13,14,15,19,20])n);
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/part1.webm','{"size":123,"mimetype":"audio/webm"}'::jsonb from unnest(array[8,11])n;
insert into storage.objects(bucket_id,name,metadata) values
('recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,11)::text||'/live/part2.webm','{"size":456,"mimetype":"audio/webm"}');
insert into public.transcription_jobs(id,recording_id,user_id,mode,status,provider_job_id)
values(pg_temp.uid(58000000,10),pg_temp.uid(38000000,10),pg_temp.uid(18000000,2),'async','running','legacy-uncertain');
insert into public.transcripts(id,recording_id,user_id,raw_text) values
(pg_temp.uid(48000000,1),pg_temp.uid(38000000,1),pg_temp.uid(18000000,2),'Historical transcript');
-- Historical output predates the personal-admission guard; restore that guard before all assertions.
reset role;
alter table public.ai_processing_jobs disable trigger ai_processing_jobs_guard_personal_admission;
set local role service_role;
insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id,status)
select pg_temp.uid(68000000,1),pg_temp.uid(48000000,1),pg_temp.uid(18000000,2),'fixture','summary',id,'done'
from public.prompt_templates where is_system and processing_type='summary' limit 1;
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
values(pg_temp.uid(78000000,1),pg_temp.uid(68000000,1),pg_temp.uid(48000000,1),pg_temp.uid(18000000,2),'Historical saved output');
reset role;
alter table public.ai_processing_jobs enable trigger ai_processing_jobs_guard_personal_admission;
select ok(p.prosecdef and p.proconfig=array['search_path=""'] and p.proowner=(select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure),
'Trusted fixed-path definer '||p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
('apply_recording_capture_transition_v1','prepare_recording_transcription_v1','start_recording_transcription_v1','claim_recording_transcription_work_v1','accept_recording_provider_job_v1','settle_recording_provider_job_v1','finalize_recording_transcription_v1','resolve_uncertain_recording_job_v1');
select ok(relrowsecurity and relforcerowsecurity,'Forced RLS '||relname) from pg_class where oid in
('public.recording_capture_receipts'::regclass,'public.recording_transcription_operations'::regclass,'public.recording_transcription_work'::regclass,'public.recording_transcription_resolutions'::regclass,'public.recording_capture_binding_permits'::regclass,'public.recording_transcription_models_v1'::regclass);
select ok(not has_table_privilege(role_name,table_name,'select,insert,update,delete'),'No direct internals: '||role_name||'/'||table_name)
from unnest(array['authenticated','anon','service_role'])role_name cross join unnest(array['public.recording_capture_receipts','public.recording_transcription_operations','public.recording_transcription_work','public.recording_transcription_resolutions','public.recording_capture_binding_permits','public.recording_transcription_models_v1'])table_name;
-- Complete exact-signature ACL matrix; PUBLIC default EXECUTE must be absent independently of named role grants.
create temporary table capture_api_acl(signature text primary key,allowed_role text);
insert into capture_api_acl values
('get_recording_capture_state_v1(uuid)','authenticated'),
('apply_recording_capture_transition_v1(uuid,uuid,bigint,text,integer,text,bigint,text,jsonb,jsonb)','authenticated'),
('prepare_recording_transcription_v1(uuid,uuid,bigint,text,text,text)','authenticated'),
('start_recording_transcription_v1(uuid)','authenticated'),('release_recording_transcription_v1(uuid)','authenticated'),
('get_managed_recording_transcription_v1(uuid[])','authenticated'),
('claim_recording_transcription_work_v1(integer)','service_role'),('refresh_recording_transcription_claim_v1(uuid,uuid,uuid)','service_role'),
('accept_recording_provider_job_v1(uuid,uuid,uuid,text)','service_role'),('settle_recording_provider_job_v1(uuid,uuid,uuid,text,bigint)','service_role'),
('finalize_recording_transcription_v1(uuid,uuid,text,jsonb,jsonb,integer)','service_role'),('mark_recording_submission_uncertain_v1(uuid,uuid,uuid)','service_role'),
('resolve_uncertain_recording_job_v1(uuid,uuid,text,text,text)','service_role'),('expire_prepared_recording_transcriptions_v1(integer)','service_role'),
('lock_recording_capture_v1(uuid)',null),('has_recording_capture_authority_v1(uuid)',null),('is_canonical_capture_path_v1(uuid,uuid,text)',null),
('get_recording_live_manifest_v1(uuid,uuid)',null),('validate_capture_transcript_v1(text,jsonb,jsonb)',null),('guard_recording_object_binding_v1()',null),
('lock_recording_transcription_operation_v1(uuid)',null),('refresh_recording_transcription_phase_v1(uuid)',null),
('lock_recording_transcription_mutation_v1()',null),('guard_recording_transcription_delete_v1()',null);
select is(has_function_privilege(role_name,('public.'||signature)::regprocedure,'execute'),coalesce(role_name=allowed_role,false),
  'Exact EXECUTE matrix '||role_name||'/'||signature) from capture_api_acl cross join unnest(array['anon','authenticated','service_role'])role_name;
select ok(not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee=0 and a.privilege_type='EXECUTE'),
  'PUBLIC execute absent '||signature) from capture_api_acl join pg_proc p on p.oid=('public.'||signature)::regprocedure;
select ok(p.prosecdef and p.proconfig=array['search_path=""'] and p.proowner=(select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure),
  'Exact function trusted owner/definer/path '||signature) from capture_api_acl join pg_proc p on p.oid=('public.'||signature)::regprocedure;
select ok(not has_function_privilege('service_role','public.accept_recording_job_custody_v1(uuid,uuid)','execute')
and not has_function_privilege('service_role','public.finalize_recording_job_v1(uuid,uuid,text,text,jsonb,jsonb,integer)','execute'),'Legacy service custody entry points disabled');
select ok(not has_function_privilege('anon',p.oid,'execute'),'Anonymous execution denied: '||p.proname)
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
('apply_recording_capture_transition_v1','prepare_recording_transcription_v1','start_recording_transcription_v1','release_recording_transcription_v1','claim_recording_transcription_work_v1','finalize_recording_transcription_v1');
select ok(not has_column_privilege('authenticated','public.recordings','capture_revision','select')
  and not has_column_privilege('authenticated','public.recordings','capture_transcript_id','select'),'New capture internals have no direct column grants');
select ok(to_regclass('public.recording_transcription_operations_recording_idx') is not null,'Bounded manager lookup has recording-leading index');
set local role authenticated;
select pg_temp.actor(3);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,5),pg_temp.uid(98000000,1),0,'live_draft',1,null,null,'Reader injected','[]','[]')$$,'42501',null,'Reader cannot capture');
select throws_ok($$select * from public.claim_recording_transcription_work_v1(1)$$,'42501',null,'Session cannot acquire provider work');
select pg_temp.actor(1);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,5),pg_temp.uid(98000000,1),0,'live_draft',1,null,null,'Founder injected','[]','[]')$$,'42501',null,'Founder cannot impersonate foreign capture author');
select pg_temp.actor(2);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,5),pg_temp.uid(98000000,500),0,'live_draft',1,null,null,'No write','[]',jsonb_build_array(jsonb_build_object('nested',jsonb_build_object('text',repeat('x',33554433)))))$$,'22023',null,'One huge nested speaker element rejected before receipt hash');
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,1),pg_temp.uid(98000000,501),0,'eu','arbitrary-costly-model')$$,'22023',null,'Regex-valid unapproved provider model denied');
reset role;
select is((select capture_revision from public.recordings where id=pg_temp.uid(38000000,5)),0::bigint,'Oversized speakers leave capture revision unchanged');
select is((select count(*) from public.recording_capture_receipts where request_id=pg_temp.uid(98000000,500)),0::bigint,'Oversized speakers create no receipt');
select is((select count(*) from public.recording_transcription_operations where request_id=pg_temp.uid(98000000,501)),0::bigint,'Unknown model creates no operation');
select is((select count(*) from public.recording_transcription_models_v1 where active and model='stt-async-v5' and config_version=1),1::bigint,'Source-supported async model explicitly seeded');
set local role authenticated;
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/nested/part.webm','{"size":7,"mimetype":"audio/webm"}'::jsonb from unnest(array[8,11])n;
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,11),pg_temp.uid(98000000,610),0,'eu','stt-async-v5')$$,'55000',null,'Complete live manifest rejects member 1');
select pg_temp.actor(1);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,8),pg_temp.uid(98000000,620),0,'recover')$$,'55000',null,'Recovery rejects member 1 without partial audio');
reset role;
select is((select count(*) from public.recording_transcription_operations where recording_id=pg_temp.uid(38000000,11)),0::bigint,'Invalid manifest creates no partial operation 1');
select is((select capture_revision from public.recordings where id=pg_temp.uid(38000000,8)),0::bigint,'Invalid recovery is atomic 1');
delete from storage.objects where bucket_id='recordings' and name in(select pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/nested/part.webm' from unnest(array[8,11])n);
set local role authenticated;
select pg_temp.actor(2);
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/UPPER.WEBM','{"size":7,"mimetype":"audio/webm"}'::jsonb from unnest(array[8,11])n;
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,11),pg_temp.uid(98000000,611),0,'eu','stt-async-v5')$$,'55000',null,'Complete live manifest rejects member 2');
select pg_temp.actor(1);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,8),pg_temp.uid(98000000,621),0,'recover')$$,'55000',null,'Recovery rejects member 2 without partial audio');
reset role;
select is((select count(*) from public.recording_transcription_operations where recording_id=pg_temp.uid(38000000,11)),0::bigint,'Invalid manifest creates no partial operation 2');
select is((select capture_revision from public.recordings where id=pg_temp.uid(38000000,8)),0::bigint,'Invalid recovery is atomic 2');
delete from storage.objects where bucket_id='recordings' and name in(select pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/UPPER.WEBM' from unnest(array[8,11])n);
set local role authenticated;
select pg_temp.actor(2);
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/part.txt','{"size":7,"mimetype":"audio/webm"}'::jsonb from unnest(array[8,11])n;
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,11),pg_temp.uid(98000000,612),0,'eu','stt-async-v5')$$,'55000',null,'Complete live manifest rejects member 3');
select pg_temp.actor(1);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,8),pg_temp.uid(98000000,622),0,'recover')$$,'55000',null,'Recovery rejects member 3 without partial audio');
reset role;
select is((select count(*) from public.recording_transcription_operations where recording_id=pg_temp.uid(38000000,11)),0::bigint,'Invalid manifest creates no partial operation 3');
select is((select capture_revision from public.recordings where id=pg_temp.uid(38000000,8)),0::bigint,'Invalid recovery is atomic 3');
delete from storage.objects where bucket_id='recordings' and name in(select pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/part.txt' from unnest(array[8,11])n);
set local role authenticated;
select pg_temp.actor(2);
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/','{"size":7,"mimetype":"audio/webm"}'::jsonb from unnest(array[8,11])n;
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,11),pg_temp.uid(98000000,613),0,'eu','stt-async-v5')$$,'55000',null,'Complete live manifest rejects member 4');
select pg_temp.actor(1);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,8),pg_temp.uid(98000000,623),0,'recover')$$,'55000',null,'Recovery rejects member 4 without partial audio');
reset role;
select is((select count(*) from public.recording_transcription_operations where recording_id=pg_temp.uid(38000000,11)),0::bigint,'Invalid manifest creates no partial operation 4');
select is((select capture_revision from public.recordings where id=pg_temp.uid(38000000,8)),0::bigint,'Invalid recovery is atomic 4');
delete from storage.objects where bucket_id='recordings' and name in(select pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/live/' from unnest(array[8,11])n);
set local role authenticated;
select pg_temp.actor(2);
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,11)::text||'/live/bound_'||n||'.webm','{"size":7,"mimetype":"audio/webm"}'::jsonb from generate_series(1,1000)n;
set local role authenticated;
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,11),pg_temp.uid(98000000,630),0,'eu','stt-async-v5')$$,'55000',null,'More than 1000 raw live members rejected before work allocation');
reset role;
delete from storage.objects where bucket_id='recordings' and name like pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,11)::text||'/live/bound_%';
set local role authenticated;
insert into handles values('upload',public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,12),pg_temp.uid(98000000,12),0,'upload_complete',10,'audio/webm',123));
select is((select payload->>'status' from handles where key='upload'),'uploaded','Uploaded completion requires exact canonical object');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,12),pg_temp.uid(98000000,112),0,'upload_complete',10,'audio/webm',123)$$,'40001',null,'Stale capture revision conflicts');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,12),pg_temp.uid(98000000,12),0,'upload_complete',10,'audio/webm',123),(select payload from handles where key='upload'),'Capture retry exact safe receipt');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,12),pg_temp.uid(98000000,12),0,'upload_complete',11,'audio/webm',123)$$,'42501',null,'Capture request collision denied');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,6),pg_temp.uid(98000000,6),0,'text_only',10)->>'status','uploaded','Empty canonical prefix permits text-only clear');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,15),pg_temp.uid(98000000,15),0,'text_only',10)$$,'55000',null,'Any existing audio prevents destructive text-only clear');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,17),pg_temp.uid(98000000,17),0,'capture_failed')->>'status','failed','Capture failure preserves draft');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,5),pg_temp.uid(98000000,5),0,'live_draft',5,null,null,'Partial saved','[]','[]')->>'captureRevision','1','Live draft revision increments');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,5),pg_temp.uid(98000000,105),1,'live_final',10,null,null,'Final live','[]','[]')->>'status','completed','Live final atomic job/transcript/status');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,7),pg_temp.uid(98000000,7),0,'import_final',null,null,null,'Imported text','[]','[]')->>'status','completed','Import atomic completion');
select pg_temp.actor(1);
reset role;
update storage.objects set metadata='{}' where bucket_id='recordings' and name=pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,8)::text||'/live/part1.webm';
set local role authenticated;
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,8),pg_temp.uid(98000000,8),0,'recover')$$,'55000',null,'Malformed audio metadata cannot produce partial recovery');
reset role;
update storage.objects set metadata='{"size":123,"mimetype":"audio/webm"}' where bucket_id='recordings' and name=pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,8)::text||'/live/part1.webm';
set local role authenticated;
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,8),pg_temp.uid(98000000,8),0,'recover')->>'status','uploaded','Founder recovery preserves stored legacy segments');
select pg_temp.actor(2);
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,10),pg_temp.uid(98000000,10),0,'eu','stt-async-v5')$$,'55000',null,'Legacy in-flight job fails closed');
insert into handles values('before_revoke',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,2),pg_temp.uid(98000000,2),0,'eu','stt-async-v5'));
select pg_temp.actor(1);
select public.revoke_project_member_v1(pg_temp.uid(28000000,1),pg_temp.uid(18000000,2));
select pg_temp.actor(2);
select is(public.prepare_recording_transcription_v1(pg_temp.uid(38000000,2),pg_temp.uid(98000000,2),0,'eu','stt-async-v5'),(select payload from handles where key='before_revoke'),'Prepare response loss recovers own receipt after revoke');
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,2),pg_temp.uid(98000000,2),0,'global','stt-async-v5')$$,'42501',null,'Prepare same request different payload denied after revoke');
select pg_temp.actor(3);
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,2),pg_temp.uid(98000000,2),0,'eu','stt-async-v5')$$,'42501',null,'Another actor cannot recover an opaque operation using the request UUID');
select pg_temp.actor(2);
select throws_ok($$select public.start_recording_transcription_v1(pg_temp.h('before_revoke','operationId'))$$,'42501',null,'Revoke before start denies');
select is(public.release_recording_transcription_v1(pg_temp.h('before_revoke','operationId'))->>'phase','released','Revoked actor can release prepared reservation');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,18),pg_temp.uid(98000000,18),0,'live_final',1,null,null,'Revoked injected','[]','[]')$$,'42501',null,'Realtime final after revoke denied');
reset role;
select ok((select storage_path is null and source_type='realtime' and file_size_bytes=0 from public.recordings where id=pg_temp.uid(38000000,6)),'Text-only permit changed only intended binding');
select ok((select storage_path is not null from public.recordings where id=pg_temp.uid(38000000,15)),'Audio exists path retained on fallback rejection');
select throws_ok($$update public.recordings set storage_path=null where id=pg_temp.uid(38000000,15)$$,'23514',null,'Even trusted direct write cannot borrow text-only permit');
select throws_ok($$update public.recordings set storage_path=pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,16)::text||'/' where id=pg_temp.uid(38000000,16)$$,'23514',null,'Empty relative canonical path denied');
select is((select count(*) from public.transcription_jobs where recording_id=pg_temp.uid(38000000,5) and mode='realtime' and provider_job_id is null),1::bigint,'Realtime job is not async receipt');
select is((select count(*) from public.recording_capture_binding_permits),0::bigint,'All single-use binding permits consumed');
update public.recording_project_members set revoked_at=null where project_id=pg_temp.uid(28000000,1) and user_id=pg_temp.uid(18000000,2);
set local role authenticated;
select pg_temp.actor(2);
insert into handles values('async',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,1),pg_temp.uid(98000000,1),0,'eu','stt-async-v5'));
select is(public.start_recording_transcription_v1(pg_temp.h('async','operationId'))->>'phase','started','Editor starts own project capture');
select throws_ok($$select public.release_recording_transcription_v1(pg_temp.h('async','operationId'))$$,'55000',null,'Started receipt cannot release');
set local role service_role;
insert into handles select 'submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is((select payload->>'work_kind' from handles where key='submit'),'submit','Started work durably discoverable');
select is((select count(*) from public.claim_recording_transcription_work_v1(1)),0::bigint,'Second worker cannot acquire submitted unit');
set local role authenticated;
select pg_temp.actor(1);
select public.revoke_project_member_v1(pg_temp.uid(28000000,1),pg_temp.uid(18000000,2));
select throws_ok($$select public.trash_recording_v1(pg_temp.uid(38000000,1),(select updated_at from public.recordings where id=pg_temp.uid(38000000,1)),720)$$,'55000',null,'Started async blocks founder Trash');
select pg_temp.actor(2);
select throws_ok($$select public.start_recording_transcription_v1(pg_temp.h('async','operationId'))$$,'42501',null,'Revoked actor cannot use start as polling authority');
set local role service_role;
select is(public.accept_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('submit','job_id'),pg_temp.h('submit','claim_id'),'real-provider-1')->>'phase','accepted','Exact started provider ID can bind after revoke');
select is(public.accept_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('submit','job_id'),pg_temp.h('submit','claim_id'),'real-provider-1')->>'phase','accepted','Acceptance response loss idempotent');
select throws_ok($$select public.accept_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('submit','job_id'),gen_random_uuid(),'fake-id')$$,'42501',null,'Wrong claim cannot bind arbitrary provider ID');
select throws_ok($$select public.refresh_recording_transcription_claim_v1(pg_temp.h('async','operationId'),pg_temp.h('submit','job_id'),pg_temp.h('submit','claim_id'))$$,'42501',null,'Accepted submit token cannot heartbeat');
select throws_ok($$select public.settle_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('submit','job_id'),pg_temp.h('submit','claim_id'),'done',12000)$$,'42501',null,'Accepted submit token cannot settle provider work');
reset role;
update public.recording_transcription_work set next_poll_at=null where operation_id=pg_temp.h('async','operationId');
update public.recording_job_custody set provider_job_id='wrong-custody-provider' where job_id=pg_temp.h('submit','job_id');
set local role service_role;
select throws_ok($$select * from public.claim_recording_transcription_work_v1(1)$$,'42501',null,'Mismatched accepted custody fails before provider continuation');
reset role;
update public.recording_job_custody set provider_job_id='real-provider-1' where job_id=pg_temp.h('submit','job_id');
set local role service_role;
insert into handles select 'poll',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is(public.settle_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('poll','job_id'),pg_temp.h('poll','claim_id'),'running')->>'phase','accepted','Observed running status consumes poll token');
select throws_ok($$select public.refresh_recording_transcription_claim_v1(pg_temp.h('async','operationId'),pg_temp.h('poll','job_id'),pg_temp.h('poll','claim_id'))$$,'42501',null,'Used poll token cannot heartbeat');
select throws_ok($$select public.settle_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('poll','job_id'),pg_temp.h('poll','claim_id'),'running')$$,'42501',null,'Used token cannot replay nonterminal observation');
select throws_ok($$select public.settle_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('poll','job_id'),pg_temp.h('poll','claim_id'),'done',12000)$$,'42501',null,'Used token cannot change observation');
reset role;
update public.recording_transcription_work set next_poll_at=null where operation_id=pg_temp.h('async','operationId');
set local role service_role;
insert into handles select 'poll_done',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is(public.settle_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('poll_done','job_id'),pg_temp.h('poll_done','claim_id'),'done',12000)->>'phase','done','New lease can settle accepted work after revoke');
select throws_ok($$select public.settle_recording_provider_job_v1(pg_temp.h('async','operationId'),pg_temp.h('poll_done','job_id'),pg_temp.h('poll_done','claim_id'),'done',12000)$$,'42501',null,'Terminal poll token also consumed');
select throws_ok($$select public.refresh_recording_transcription_claim_v1(pg_temp.h('async','operationId'),pg_temp.h('poll_done','job_id'),pg_temp.h('poll_done','claim_id'))$$,'42501',null,'Terminal token cannot heartbeat');
insert into handles select 'finalize',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
insert into handles values('completed',public.finalize_recording_transcription_v1(pg_temp.h('async','operationId'),pg_temp.h('finalize','claim_id'),'Exact provider text','[]','[]',12));
select is(public.finalize_recording_transcription_v1(pg_temp.h('async','operationId'),pg_temp.h('finalize','claim_id'),'Exact provider text','[]','[]',12),(select payload from handles where key='completed'),'Completion response loss exact idempotent');
select throws_ok($$select public.finalize_recording_transcription_v1(pg_temp.h('async','operationId'),pg_temp.h('finalize','claim_id'),'Changed text','[]','[]',12)$$,'42501',null,'Completion payload collision denied');
reset role;
select is((select count(*) from public.transcripts where recording_id=pg_temp.uid(38000000,1)),2::bigint,'Exactly one new transcript generation plus retained history');
select is((select raw_text from public.transcripts where id=pg_temp.uid(48000000,1)),'Historical transcript','Historical transcript untouched');
select is((select count(*) from public.ai_outputs where id=pg_temp.uid(78000000,1)),1::bigint,'Saved historical AI output retained');
select is((select count(*) from public.automatic_timeline_intents where transcript_id=pg_temp.h('completed','transcriptId')),0::bigint,'Settlement never schedules personal AI');
select is((select id from public.transcripts where recording_id=pg_temp.uid(38000000,1) order by created_at desc,id desc limit 1),pg_temp.h('completed','transcriptId'),'Latest transcript selection deterministically chooses new completion');
set local role authenticated;
select pg_temp.actor(1);
select throws_ok($$select * from public.get_managed_recording_transcription_v1(array_fill(pg_temp.uid(38000000,1),array[101]))$$,'22023',null,'Manager read bounds raw IDs before deduplication');
select throws_ok($$select * from public.get_managed_recording_transcription_v1(array[[pg_temp.uid(38000000,1)]])$$,'22023',null,'Manager read rejects multidimensional input');
select is(public.prepare_recording_transcription_v1(pg_temp.uid(38000000,4),pg_temp.uid(98000000,4),0,'global','stt-async-v5','retry')->>'phase','prepared','Founder may explicitly retry terminal failed foreign-author capture');
select is((select count(*) from public.get_managed_recording_transcription_v1(array[pg_temp.uid(38000000,1),pg_temp.uid(38000000,9)])),1::bigint,'Manager projection omits foreign IDs');
select pg_temp.actor(3);
select is((select count(*) from public.get_managed_recording_transcription_v1(array[pg_temp.uid(38000000,1)])),0::bigint,'Reader has no manager operation projection');
select pg_temp.actor(2);
insert into handles values('uncertain',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,3),pg_temp.uid(98000000,3),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('uncertain','operationId'));
set local role service_role;
insert into handles select 'unknown_submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.mark_recording_submission_uncertain_v1(pg_temp.h('uncertain','operationId'),pg_temp.h('unknown_submit','job_id'),pg_temp.h('unknown_submit','claim_id'));
select is((select count(*) from public.claim_recording_transcription_work_v1(5)),0::bigint,'Unknown POST never automatically resubmits');
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select public.release_recording_transcription_v1(pg_temp.h('uncertain','operationId'))$$,'55000',null,'Actor cannot cancel uncertain external work');
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,3),pg_temp.uid(98000000,103),1,'eu','stt-async-v5','retry')$$,'55000',null,'Uncertain work cannot be replaced by a new request');
set local role service_role;
select public.resolve_uncertain_recording_job_v1(pg_temp.h('uncertain','operationId'),pg_temp.h('unknown_submit','job_id'),'not_submitted',repeat('a',64));
select public.resolve_uncertain_recording_job_v1(pg_temp.h('uncertain','operationId'),pg_temp.h('unknown_submit','job_id'),'not_submitted',repeat('a',64));
reset role;
select is((select status::text from public.recordings where id=pg_temp.uid(38000000,3)),'failed','Externally verified no-submit becomes retryable failure');
select is((select count(*) from public.recording_transcription_resolutions where operation_id=pg_temp.h('uncertain','operationId')),1::bigint,'Manual resolution response loss does not duplicate audit');
-- Submission crash recovery never repeats the POST; operator may bind the externally verified original job.
set local role authenticated;
select pg_temp.actor(2);
insert into handles values('stale',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,14),pg_temp.uid(98000000,14),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('stale','operationId'));
set local role service_role;
insert into handles select 'stale_submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_work set claimed_at=clock_timestamp()-interval '16 minutes' where operation_id=pg_temp.h('stale','operationId');
set local role service_role;
select is((select count(*) from public.claim_recording_transcription_work_v1(1)),0::bigint,'Crash after submission claim becomes uncertain instead of resubmit');
select public.resolve_uncertain_recording_job_v1(pg_temp.h('stale','operationId'),pg_temp.h('stale_submit','job_id'),'bind_verified',repeat('b',64),'verified-original-14');
reset role;
update public.recording_transcription_work set next_poll_at=null where operation_id=pg_temp.h('stale','operationId');
set local role service_role;
insert into handles select 'poll_attempt_1',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_work set claimed_at=clock_timestamp()-interval '16 minutes' where operation_id=pg_temp.h('stale','operationId');
set local role service_role;
insert into handles select 'poll_attempt_2',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_work set claimed_at=clock_timestamp()-interval '16 minutes' where operation_id=pg_temp.h('stale','operationId');
set local role service_role;
insert into handles select 'poll_attempt_3',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_work set claimed_at=clock_timestamp()-interval '16 minutes' where operation_id=pg_temp.h('stale','operationId');
set local role service_role;
insert into handles select 'poll_attempt_4',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_work set claimed_at=clock_timestamp()-interval '16 minutes' where operation_id=pg_temp.h('stale','operationId');
set local role service_role;
insert into handles select 'poll_attempt_5',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select throws_ok($$select public.settle_recording_provider_job_v1(pg_temp.h('stale','operationId'),pg_temp.h('poll_attempt_1','job_id'),pg_temp.h('poll_attempt_1','claim_id'),'done',1000)$$,'42501',null,'Stale poll token cannot finalize after takeover');
reset role;
update public.recording_transcription_work set claimed_at=clock_timestamp()-interval '16 minutes' where operation_id=pg_temp.h('stale','operationId');
set local role service_role;
select is((select count(*) from public.claim_recording_transcription_work_v1(1)),0::bigint,'Five lost poll leases dead-letter without deleting or resubmitting');
select public.resolve_uncertain_recording_job_v1(pg_temp.h('stale','operationId'),pg_temp.h('stale_submit','job_id'),'resume_poll',repeat('c',64));
insert into handles select 'resumed_poll',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is(public.settle_recording_provider_job_v1(pg_temp.h('stale','operationId'),pg_temp.h('resumed_poll','job_id'),pg_temp.h('resumed_poll','claim_id'),'failed')->>'phase','failed','Exact accepted provider failure settles atomically');
reset role;
select is((select status::text from public.recordings where id=pg_temp.uid(38000000,14)),'failed','Failed recording remains present and retryable');
select is((select count(*) from public.transcripts where recording_id=pg_temp.uid(38000000,14)),0::bigint,'Failure never creates a transcript');
-- Private-account and exact job deletion cannot erase irreversible work either.
set local role authenticated;
select pg_temp.actor(6);
insert into handles values('private_guard',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,13),pg_temp.uid(98000000,13),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('private_guard','operationId'));
reset role;
select throws_ok($$delete from auth.users where id=pg_temp.uid(18000000,6)$$,'55000',null,'Private account deletion also blocked while async irreversible');
select throws_ok($$delete from public.recordings where id=pg_temp.uid(38000000,13)$$,'55000',null,'Direct recording purge blocked');
select throws_ok($$delete from public.transcription_jobs where recording_id=pg_temp.uid(38000000,13)$$,'55000',null,'Exact job deletion cannot strand receipt');
set local role service_role;
insert into handles select 'private_submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.resolve_uncertain_recording_job_v1(pg_temp.h('private_guard','operationId'),pg_temp.h('private_submit','job_id'),'not_submitted',repeat('d',64));
-- Prepared expiry and account deletion are safe because provider work never began.
set local role authenticated;
select pg_temp.actor(2);
insert into handles values('expiry',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,19),pg_temp.uid(98000000,19),0,'eu','stt-async-v5'));
reset role;
update public.recording_transcription_operations set created_at=clock_timestamp()-interval '25 hours' where id=pg_temp.h('expiry','operationId');
set local role service_role;
select is(public.expire_prepared_recording_transcriptions_v1(5),1,'Only expired prepared reservation released');
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select public.start_recording_transcription_v1(pg_temp.h('expiry','operationId'))$$,'55000',null,'Expired prepared receipt cannot be restarted');
reset role;
-- Re-enable the editor only for a new, separate segmented capture operation.
update public.recording_project_members set revoked_at=null where project_id=pg_temp.uid(28000000,1) and user_id=pg_temp.uid(18000000,2);
set local role authenticated;
select pg_temp.actor(2);
insert into handles values('segments',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,11),pg_temp.uid(98000000,11),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('segments','operationId'));
set local role service_role;
insert into handles select 'segment_submit_1',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.accept_recording_provider_job_v1(pg_temp.h('segments','operationId'),pg_temp.h('segment_submit_1','job_id'),pg_temp.h('segment_submit_1','claim_id'),'segment-provider-1');
insert into handles select 'segment_submit_2',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.accept_recording_provider_job_v1(pg_temp.h('segments','operationId'),pg_temp.h('segment_submit_2','job_id'),pg_temp.h('segment_submit_2','claim_id'),'segment-provider-2');
reset role;
update public.recording_transcription_work set next_poll_at=null where operation_id=pg_temp.h('segments','operationId');
set local role service_role;
insert into handles select 'segment_poll_1',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.settle_recording_provider_job_v1(pg_temp.h('segments','operationId'),pg_temp.h('segment_poll_1','job_id'),pg_temp.h('segment_poll_1','claim_id'),'done',1000);
insert into handles select 'segment_poll_2',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.settle_recording_provider_job_v1(pg_temp.h('segments','operationId'),pg_temp.h('segment_poll_2','job_id'),pg_temp.h('segment_poll_2','claim_id'),'done',2000);
insert into handles select 'segment_finalize',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is(jsonb_array_length((select payload->'manifest' from handles where key='segment_finalize')),2,'Finalizer receives exact ordered two-part manifest');
select public.finalize_recording_transcription_v1(pg_temp.h('segments','operationId'),pg_temp.h('segment_finalize','claim_id'),'Part 1 Part 2','[{"start_ms":0,"end_ms":1000},{"start_ms":1000,"end_ms":3000}]','[]',3);
reset role;
select is((select count(*) from public.transcripts where recording_id=pg_temp.uid(38000000,11)),1::bigint,'Segment batch creates one combined transcript, not per-part duplicates');
select is((select count(*) from public.recording_job_custody where recording_id=pg_temp.uid(38000000,11) and finalized_at is not null),2::bigint,'Both exact custody receipts settle to combined generation');
-- Additional isolated fixtures for prepared DELETE, two-operation fairness, horizon and parent cascades.
insert into public.recording_clients(id,user_id,name) values(pg_temp.uid(88000000,2),pg_temp.uid(18000000,6),'Capture cascade client');
insert into public.recording_projects(id,user_id,client_id,name) values(pg_temp.uid(28000000,2),pg_temp.uid(18000000,6),pg_temp.uid(88000000,2),'Private capture cascade');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,project_id,client_id,storage_path,mime_type)
select pg_temp.uid(38000000,n),pg_temp.uid(18000000,case when n=25 then 6 else 2 end),pg_temp.uid(18000000,case when n=25 then 6 else 2 end),
  'Round one fixture '||n,'upload'::public.recording_source_type,'uploaded'::public.recording_status,'private',case when n=25 then pg_temp.uid(28000000,2) end,case when n=25 then pg_temp.uid(88000000,2) end,
  pg_temp.uid(18000000,case when n=25 then 6 else 2 end)::text||'/'||pg_temp.uid(38000000,n)::text||'/'||case when n in(22,23) then 'live/' else 'audio.webm' end,'audio/webm'
from generate_series(22,26)n;
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',r.storage_path||case when n in(22,23) then 'part1.webm' else '' end,'{"size":123,"mimetype":"audio/webm"}'::jsonb
from generate_series(22,26)n join public.recordings r on r.id=pg_temp.uid(38000000,n);
insert into storage.objects(bucket_id,name,metadata)
select 'recordings',r.storage_path||'part2.webm','{"size":123,"mimetype":"audio/webm"}'::jsonb from public.recordings r where id in(pg_temp.uid(38000000,22),pg_temp.uid(38000000,23));
set local role authenticated;
select pg_temp.actor(2);
insert into handles values('delete_prepared',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,22),pg_temp.uid(98000000,22),0,'eu','stt-async-v5'));
reset role;
update public.recording_transcription_models_v1 set active=false where model='stt-async-v5';
set local role authenticated;
select throws_ok($$select public.start_recording_transcription_v1(pg_temp.h('delete_prepared','operationId'))$$,'22023',null,'Disabled approved model cannot start prepared work');
select throws_ok($$select public.prepare_recording_transcription_v1(pg_temp.uid(38000000,23),pg_temp.uid(98000000,523),0,'eu','stt-async-v5')$$,'22023',null,'Disabled model cannot create a new operation');
select is(public.prepare_recording_transcription_v1(pg_temp.uid(38000000,22),pg_temp.uid(98000000,22),0,'eu','stt-async-v5'),(select payload from handles where key='delete_prepared'),'Disabled model does not prevent historical own receipt recovery');
reset role;
update public.recording_transcription_models_v1 set active=true where model='stt-async-v5';
select lives_ok($$delete from public.transcription_jobs where id=(select job_id from public.recording_transcription_work where operation_id=pg_temp.h('delete_prepared','operationId') order by position limit 1)$$,'Deleting prepared exact job does not update its own pending DELETE tuple');
select is((select phase from public.recording_transcription_operations where id=pg_temp.h('delete_prepared','operationId')),'released','Prepared exact job deletion releases operation');
select is((select count(*) from public.recording_transcription_work where operation_id=pg_temp.h('delete_prepared','operationId') and phase='cancelled'),2::bigint,'Prepared DELETE cancels both exact work rows');
select is((select count(*) from public.transcription_jobs where recording_id=pg_temp.uid(38000000,22) and status='cancelled'),1::bigint,'Prepared DELETE cancels sibling without updating deleted job');
set local role authenticated;
insert into handles values('fair_old',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,23),pg_temp.uid(98000000,23),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('fair_old','operationId'));
insert into handles values('fair_new',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,24),pg_temp.uid(98000000,24),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('fair_new','operationId'));
reset role;
update public.recording_transcription_operations set created_at=clock_timestamp()-interval '1 minute' where id=pg_temp.h('fair_old','operationId');
set local role service_role;
insert into handles select 'fair_claim_1',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.mark_recording_submission_uncertain_v1(pg_temp.h('fair_old','operationId'),pg_temp.h('fair_claim_1','job_id'),pg_temp.h('fair_claim_1','claim_id'));
insert into handles select 'fair_claim_2',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is((select count(*) from public.claim_recording_transcription_work_v1(1)),0::bigint,'Uncertain old sibling fences ready segment without starving newer operation');
select public.resolve_uncertain_recording_job_v1(pg_temp.h('fair_old','operationId'),pg_temp.h('fair_claim_1','job_id'),'bind_verified',repeat('e',64),'fair-old-provider-23');
insert into handles select 'fair_claim_3',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is(pg_temp.h('fair_claim_1','operation_id'),pg_temp.h('fair_old','operationId'),'Old unclaimed operation gets first unit');
select is(pg_temp.h('fair_claim_2','operation_id'),pg_temp.h('fair_new','operationId'),'New operation gets work before old operation second segment');
select is(pg_temp.h('fair_claim_3','operation_id'),pg_temp.h('fair_old','operationId'),'Round robin returns to old remaining segment');
reset role;
update public.recording_transcription_work set next_poll_at=null where operation_id=pg_temp.h('fair_old','operationId') and phase='accepted';
set local role service_role;
insert into handles select 'fair_poll',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.settle_recording_provider_job_v1(pg_temp.h('fair_old','operationId'),pg_temp.h('fair_poll','job_id'),pg_temp.h('fair_poll','claim_id'),'failed');
select public.resolve_uncertain_recording_job_v1(pg_temp.h('fair_new','operationId'),pg_temp.h('fair_claim_2','job_id'),'not_submitted',repeat('e',64));
select public.resolve_uncertain_recording_job_v1(pg_temp.h('fair_old','operationId'),pg_temp.h('fair_claim_3','job_id'),'not_submitted',repeat('e',64));
set local role authenticated;
select pg_temp.actor(6);
insert into handles values('cascade',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,25),pg_temp.uid(98000000,25),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('cascade','operationId'));
reset role;
select throws_ok($$delete from public.recording_projects where id=pg_temp.uid(28000000,2)$$,'55000',null,'Private project deletion cannot strand started operation');
select throws_ok($$delete from public.recording_clients where id=pg_temp.uid(88000000,2)$$,'55000',null,'Client deletion cannot strand private project operation');
select is((select count(*) from public.recording_projects where id=pg_temp.uid(28000000,2)),1::bigint,'Rejected cascades preserve parent rows');
set local role service_role;
insert into handles select 'cascade_submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.resolve_uncertain_recording_job_v1(pg_temp.h('cascade','operationId'),pg_temp.h('cascade_submit','job_id'),'not_submitted',repeat('f',64));
set local role authenticated;
select pg_temp.actor(2);
insert into handles values('horizon',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,26),pg_temp.uid(98000000,26),0,'eu','stt-async-v5'));
select public.start_recording_transcription_v1(pg_temp.h('horizon','operationId'));
reset role;
update public.recording_transcription_operations set started_at=clock_timestamp()-interval '8 days' where id=pg_temp.h('horizon','operationId');
set local role service_role;
select is((select count(*) from public.claim_recording_transcription_work_v1(5)),0::bigint,'Actual over-seven-day operation excluded from automatic claim');
set local role authenticated;
select is((select phase from public.get_managed_recording_transcription_v1(array[pg_temp.uid(38000000,26)])),'manual_required','Expired horizon manager projection is safe manual-required');
reset role;
select throws_ok($$delete from public.recordings where id=pg_temp.uid(38000000,26)$$,'55000',null,'Over-horizon work remains destructive-blocking');
update public.recording_transcription_operations set started_at=clock_timestamp()-interval '6 days' where id=pg_temp.h('horizon','operationId');
set local role service_role;
insert into handles select 'horizon_submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select is(pg_temp.h('horizon_submit','operation_id'),pg_temp.h('horizon','operationId'),'Same operation inside horizon is eligible');
select public.resolve_uncertain_recording_job_v1(pg_temp.h('horizon','operationId'),pg_temp.h('horizon_submit','job_id'),'not_submitted',repeat('a',64));
-- Five actual finalizer acquisitions exhaust discovery without releasing accepted work.
set local role authenticated;
insert into handles values('final_budget',public.prepare_recording_transcription_v1(pg_temp.uid(38000000,20),pg_temp.uid(98000000,20),0,'eu','stt-async-v5','retranscribe'));
select public.start_recording_transcription_v1(pg_temp.h('final_budget','operationId'));
set local role service_role;
insert into handles select 'budget_submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.accept_recording_provider_job_v1(pg_temp.h('final_budget','operationId'),pg_temp.h('budget_submit','job_id'),pg_temp.h('budget_submit','claim_id'),'budget-provider-20');
reset role;
update public.recording_transcription_work set next_poll_at=null where operation_id=pg_temp.h('final_budget','operationId');
set local role service_role;
insert into handles select 'budget_poll',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select public.settle_recording_provider_job_v1(pg_temp.h('final_budget','operationId'),pg_temp.h('budget_poll','job_id'),pg_temp.h('budget_poll','claim_id'),'done',1000);
insert into handles select 'budget_final_1',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_operations set finalize_claimed_at=clock_timestamp()-interval '16 minutes' where id=pg_temp.h('final_budget','operationId');
set local role service_role;
insert into handles select 'budget_final_2',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_operations set finalize_claimed_at=clock_timestamp()-interval '16 minutes' where id=pg_temp.h('final_budget','operationId');
set local role service_role;
insert into handles select 'budget_final_3',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_operations set finalize_claimed_at=clock_timestamp()-interval '16 minutes' where id=pg_temp.h('final_budget','operationId');
set local role service_role;
insert into handles select 'budget_final_4',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_operations set finalize_claimed_at=clock_timestamp()-interval '16 minutes' where id=pg_temp.h('final_budget','operationId');
set local role service_role;
insert into handles select 'budget_final_5',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
reset role;
update public.recording_transcription_operations set finalize_claimed_at=clock_timestamp()-interval '16 minutes' where id=pg_temp.h('final_budget','operationId');
select is((select finalize_attempt_count from public.recording_transcription_operations where id=pg_temp.h('final_budget','operationId')),5,'Exactly five real finalizer acquisitions recorded');
select is((select phase from public.recording_transcription_operations where id=pg_temp.h('final_budget','operationId')),'accepted','Exhausted finalizer remains accepted, never released');
select throws_ok($$delete from public.recordings where id=pg_temp.uid(38000000,20)$$,'55000',null,'Exhausted finalizer blocks destructive cleanup');
set local role service_role;
select is((select count(*) from public.claim_recording_transcription_work_v1(5)),0::bigint,'No sixth automatic finalizer claim');
select throws_ok($$select public.finalize_recording_transcription_v1(pg_temp.h('final_budget','operationId'),pg_temp.h('budget_final_1','claim_id'),'Budget text','[]','[]',1)$$,'42501',null,'Old finalizer token fenced out');
select public.resolve_uncertain_recording_job_v1(pg_temp.h('final_budget','operationId'),pg_temp.h('budget_submit','job_id'),'resume_finalize',repeat('b',64));
insert into handles select 'budget_final_resumed',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w;
select throws_ok($$select public.finalize_recording_transcription_v1(pg_temp.h('final_budget','operationId'),pg_temp.h('budget_final_5','claim_id'),'Budget text','[]','[]',1)$$,'42501',null,'Operator renewal also fences previous fifth claim');
select is(public.finalize_recording_transcription_v1(pg_temp.h('final_budget','operationId'),pg_temp.h('budget_final_resumed','claim_id'),'Budget text','[]','[]',1)->>'phase','completed','Explicit audited renewal completes with new exact claim');
reset role;
-- A text-only live draft remains created; manager recovery after crash/revoke must use its durable evidence as-is.
insert into public.recording_project_members(project_id,user_id,role) values(pg_temp.uid(28000000,1),pg_temp.uid(18000000,4),'editor');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,project_id,storage_path)
select pg_temp.uid(38000000,n),pg_temp.uid(18000000,2),pg_temp.uid(18000000,2),'Created recovery '||n,
  (case when n in(27,28,32) then 'realtime' else 'in_app_recording' end)::public.recording_source_type,'created','project',pg_temp.uid(28000000,1),
  case when n in(29,30,31) then pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,n)::text||'/'||case when n=30 then 'audio.webm' else 'live/' end end
from generate_series(27,32)n;
insert into storage.objects(bucket_id,name,metadata) values
('recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,29)::text||'/live/INVALID.WEBM','{"size":123,"mimetype":"audio/webm"}'),
('recordings',pg_temp.uid(18000000,2)::text||'/'||pg_temp.uid(38000000,31)::text||'/live/part.webm','{"size":123,"mimetype":"audio/webm"}');
set local role authenticated;
select pg_temp.actor(2);
insert into handles values('created_draft',public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,27),0,'live_draft',4,null,null,'Created durable text','[]','[]'));
select is((select payload->>'status' from handles where key='created_draft'),'created','Text-only live draft preserves created status');
select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,29),pg_temp.uid(98000000,29),0,'live_draft',4,null,null,'Text cannot mask invalid audio','[]','[]');
select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,30),pg_temp.uid(98000000,30),0,'live_draft',4,null,null,'Created empty fixed path','[]','[]');
select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,32),pg_temp.uid(98000000,32),0,'live_draft',4,null,null,'Current author recovery remains allowed','[]','[]');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,32),pg_temp.uid(98000000,932),1,'recover')->>'status','completed','Current authorized capture author retains recovery authority');
select pg_temp.actor(3);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,927),1,'recover')$$,'42501',null,'Reader cannot recover created draft');
select pg_temp.actor(4);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,927),1,'recover')$$,'42501',null,'Unrelated editor is neither capture author nor manager');
select pg_temp.actor(1);
select public.revoke_project_member_v1(pg_temp.uid(28000000,1),pg_temp.uid(18000000,2));
select pg_temp.actor(2);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,927),1,'recover')$$,'42501',null,'Revoked author cannot recover created draft');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,827),1,'live_draft',5,null,null,'Revoked overwrite','[]','[]')$$,'42501',null,'Revoked author cannot append another draft');
select pg_temp.actor(1);
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,727),0,'recover')$$,'40001',null,'Created manager recovery still requires exact revision');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,627),1,'recover',null,null,null,'Injected','[]','[]')$$,'22023',null,'Created recovery never accepts browser transcript payload');
insert into handles values('created_recovered',public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,927),1,'recover'));
select is((select payload->>'status' from handles where key='created_recovered'),'completed','Founder recovers created durable draft after author revoke');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,927),1,'recover'),(select payload from handles where key='created_recovered'),'Created recovery request retry is exact idempotent');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,27),pg_temp.uid(98000000,927),2,'recover')$$,'42501',null,'Same created-recovery request with changed payload conflicts');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,28),pg_temp.uid(98000000,928),0,'recover')$$,'55000','nothing to recover','Empty created row is not fabricated into completed');
select throws_ok($$select public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,29),pg_temp.uid(98000000,929),1,'recover')$$,'55000','invalid live manifest','Created text plus malformed audio fails closed');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,30),pg_temp.uid(98000000,930),1,'recover')->>'status','completed','Created recovery can clear an empty fixed path through existing exact permit');
select is(public.apply_recording_capture_transition_v1(pg_temp.uid(38000000,31),pg_temp.uid(98000000,931),0,'recover')->>'status','uploaded','Created canonical audio-only recovery remains truthful uploaded');
reset role;
select is((select count(*) from public.transcripts where recording_id=pg_temp.uid(38000000,27)),1::bigint,'Manager recovery does not duplicate created transcript');
select is((select capture_transcript_id from public.recordings where id=pg_temp.uid(38000000,27)),pg_temp.h('created_draft','transcriptId'),'Created recovery keeps the exact durable transcript');
select is((select raw_text from public.transcripts where id=pg_temp.h('created_draft','transcriptId')),'Created durable text','Created durable content unchanged');
select is((select capture_revision from public.recordings where id=pg_temp.uid(38000000,27)),2::bigint,'Idempotent recovery increments revision exactly once');
select ok((select status='created' and capture_revision=0 from public.recordings where id=pg_temp.uid(38000000,28)),'Empty created recovery has no status/revision write');
select is((select count(*) from public.recording_capture_receipts where recording_id=pg_temp.uid(38000000,28)),0::bigint,'Empty created recovery has no receipt');
select ok((select status='created' and capture_revision=1 from public.recordings where id=pg_temp.uid(38000000,29)),'Malformed created recovery has no status/revision write');
select ok((select storage_path is null from public.recordings where id=pg_temp.uid(38000000,30)),'Created path-clear permit is narrowly consumed');
select ok((select revoked_at is not null from public.recording_project_members where project_id=pg_temp.uid(28000000,1) and user_id=pg_temp.uid(18000000,2)),'Recovery does not restore author membership');
set local role authenticated;
select pg_temp.actor(2);
select is(public.can_read_recording(pg_temp.uid(38000000,27)),false,'Former author still cannot read recovered project recording');
reset role;
select * from finish();
rollback;
