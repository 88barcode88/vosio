-- Run only against a disposable database after applying the complete migration chain.
-- Final-chain compatibility: includes the 20260922200000 read-path forward.
-- Later-forward assertions below replace the legacy JSON permission expectations;
-- this artifact is not the unchanged standalone T1 checkpoint or a runtime receipt.
-- Actual role-switched pgTAP assertions; service_role is used only for fixture seeds.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
set local role service_role;
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001', 'founder@sharing.test'),
 ('10000000-0000-4000-8000-000000000002', 'editor@sharing.test'),
 ('10000000-0000-4000-8000-000000000003', 'reader@sharing.test'),
 ('10000000-0000-4000-8000-000000000004', 'selected@sharing.test'),
 ('10000000-0000-4000-8000-000000000005', 'outsider@sharing.test');
insert into public.recording_projects(id,user_id,name) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Clientless');
insert into public.recording_clients(id,user_id,name) values
 ('21000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Private client');
insert into public.recording_projects(id,user_id,client_id,name) values
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Other project');
insert into public.recording_project_members(project_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','editor'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','reader');
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status,storage_path) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Private assigned','realtime','20000000-0000-4000-8000-000000000001','private','completed',null),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Project shared','upload','20000000-0000-4000-8000-000000000001','project','completed','10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Exact selected','realtime','20000000-0000-4000-8000-000000000001','selected','completed',null),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Standalone selected','realtime',null,'selected','completed',null);
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status) values
 ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Other project content','realtime','20000000-0000-4000-8000-000000000002','project','completed');
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id) values
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','reader','20000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','editor','20000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','reader',null);
insert into public.transcripts(id,recording_id,user_id,raw_text,speakers) values
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Shared transcript','[{"id":"1","name":null,"role":"unknown"},{"id":"2","name":null,"role":"unknown"}]');
update auth.users set email_confirmed_at=now() where email like '%@sharing.test';
insert into storage.objects(bucket_id,name) values
 ('recordings','10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3'),
 ('recordings','10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000001/private.mp3');
insert into public.recording_invitations(id,token_hash,email,role,scope,project_id,expires_at,created_by) values
 ('50000000-0000-4000-8000-000000000001',repeat('a',64),'editor@sharing.test','editor','project','20000000-0000-4000-8000-000000000001',now()+interval '1 day','10000000-0000-4000-8000-000000000001');
insert into public.transcription_jobs(id,recording_id,user_id,mode,status,provider_job_id) values
 ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','async','running','fixture-accepted-job');
insert into public.recording_job_custody(job_id,recording_id,project_id,capture_author,provider_job_id) values
 ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','fixture-accepted-job');
-- Historical artifacts remain readable after custody transfer; seed them before exercising current admission.
reset role;
alter table public.ai_processing_jobs disable trigger ai_processing_jobs_guard_personal_admission;
set local role service_role;
insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id)
 select '61000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002','fixture-model','summary',id
 from public.prompt_templates where is_system and processing_type='summary' limit 1;
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text) values
 ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Saved output');
insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title) values
 ('63000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',1,'Saved task');
insert into public.transcript_chat_threads(id,user_id,recording_id,transcript_id) values
 ('64000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001');
insert into public.transcript_chat_turns(id,client_turn_id,thread_id,transcript_id,recording_id,user_id,question,provider,model,system_prompt_id,prompt_text_snapshot)
 select '65000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
 'Personal question','openai','fixture-model',id,'Private prompt'
 from public.prompt_templates where is_system limit 1;
reset role;
alter table public.ai_processing_jobs enable trigger ai_processing_jobs_guard_personal_admission;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.recordings where id='30000000-0000-4000-8000-000000000001'),0::bigint,'Founder cannot select/count assigned private recording');
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000002'),'Founder reads project content');
select is(public.recording_capabilities_v1('30000000-0000-4000-8000-000000000002')->>'runPersonalAi','false','Founder cannot run personal AI on a foreign-author recording');
select is(public.recording_capabilities_v1('30000000-0000-4000-8000-000000000005')->>'runPersonalAi','true','Founder can run personal AI on own recording');
select is((select count(*) from public.transcript_chat_threads),0::bigint,'Founder never receives author personal chat');
select is((select count(*) from public.transcript_chat_turns),0::bigint,'Founder never receives author personal turns');
select throws_ok($$select public.get_personal_recording_metadata_v1('30000000-0000-4000-8000-000000000002')$$,'42501',null,'Later forward denies founder legacy JSON metadata');
select ok((select client_id is null and folder_id is null and tag_ids is null from public.get_accessible_recording_v1('30000000-0000-4000-8000-000000000002')),'Founder safe detail masks foreign personal metadata');
select is((select count(*) from public.transcripts),1::bigint,'Founder reads shared transcript');
select is((select count(*) from storage.objects where bucket_id='recordings'),1::bigint,'Founder reads only exact shared audio object');
select throws_ok($$select * from public.recording_invitations$$,'42501',null,'Even founder cannot read stored token hashes');
select throws_ok($$delete from public.recording_projects where id='20000000-0000-4000-8000-000000000001'$$,'23503',null,'Project deletion cannot destroy shared custody');
select throws_ok($$delete from public.recording_clients where id='21000000-0000-4000-8000-000000000001'$$,'23503',null,'Client deletion cannot destroy shared project content');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(public.can_edit_recording('30000000-0000-4000-8000-000000000002'),'Editor can edit project recording');
select is(public.recording_capabilities_v1('30000000-0000-4000-8000-000000000002')->>'runPersonalAi','false','Editor cannot run AI');
select is(public.recording_capabilities_v1('30000000-0000-4000-8000-000000000002')->>'usePrivateChat','false','Editor cannot invoke private chat');
select throws_ok($$select public.get_personal_recording_metadata_v1('30000000-0000-4000-8000-000000000001')$$,'42501',null,'Later forward denies owner legacy JSON metadata');
select ok((select id='30000000-0000-4000-8000-000000000001' and tag_ids='{}'::uuid[] from public.get_accessible_recording_v1('30000000-0000-4000-8000-000000000001')),'Private owner retains safe detail and owner tag projection');
select is((select count(*) from public.transcript_chat_threads),1::bigint,'Author may read existing personal thread while recording access remains');
select is((select count(*) from public.transcript_chat_turns),1::bigint,'Author may read existing personal turns while recording access remains');
select throws_ok($$select storage_path from public.recordings where id='30000000-0000-4000-8000-000000000002'$$,'42501',null,'E cannot directly read protected storage column');
select throws_ok($$select error_message from public.recordings where id='30000000-0000-4000-8000-000000000002'$$,'42501',null,'E cannot directly read raw provider errors');
select throws_ok($$select client_id,folder_id from public.recordings where id='30000000-0000-4000-8000-000000000002'$$,'42501',null,'E cannot directly read private organization columns');
select throws_ok($$select capture_request_fingerprint,purge_claim_id from public.recordings where id='30000000-0000-4000-8000-000000000002'$$,'42501',null,'E cannot directly read fingerprints/purge metadata');
select throws_ok(format('select %I from public.recordings where id=%L',column_name,'30000000-0000-4000-8000-000000000002'),'42501',null,'E protected column: '||column_name)
 from unnest(array['user_id','storage_path','error_message','client_id','folder_id','retention_policy','deleted_at','deleted_from_status','trash_retention_hours','purge_after','purge_claim_id','purge_started_at','purge_attempt_count','capture_request_id','capture_request_fingerprint']) column_name;
select lives_ok($$insert into public.recordings(id,user_id,title,source_type) values ('30000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002','Legacy capture','realtime')$$,'Legacy private INSERT remains private');
select is((select visibility from public.recordings where id='30000000-0000-4000-8000-000000000010'),'private','Legacy visibility default');
select is(public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000001','Atomic draft','realtime','20000000-0000-4000-8000-000000000001','project'),
 public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000001','Atomic draft','realtime','20000000-0000-4000-8000-000000000001','project'),'Capture request replay returns same UUID');
select set_config('sharing.capture_id',public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000001','Atomic draft','realtime','20000000-0000-4000-8000-000000000001','project')::text,true);
select lives_ok($$select public.prepare_recording_upload_v1(current_setting('sharing.capture_id')::uuid,'audio.mp3','audio/mpeg',100)$$,'Capture author registers exact TUS object');
select lives_ok($$insert into storage.objects(bucket_id,name) values ('recordings','10000000-0000-4000-8000-000000000002/'||current_setting('sharing.capture_id')||'/audio.mp3')$$,'Capture author may write exact planned object');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('recordings','10000000-0000-4000-8000-000000000002/'||current_setting('sharing.capture_id')||'/unplanned.mp3')$$,'42501',null,'Capture author cannot write unplanned object');
select throws_ok($$select public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000001','Changed payload','realtime','20000000-0000-4000-8000-000000000001','project')$$,'22023',null,'Idempotency key cannot change payload');
select throws_ok($$select public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000002','No partial draft','realtime',null,'selected','[{"userId":"10000000-0000-4000-8000-000000000099","role":"reader"}]')$$,'22023',null,'Invalid grant rejects whole draft');
select is((select count(*) from public.recordings where title='No partial draft'),0::bigint,'Rejected create leaves no draft');
select throws_ok($$select public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000003','Unauthorized selected draft','realtime','20000000-0000-4000-8000-000000000001','selected','[{"userId":"10000000-0000-4000-8000-000000000005","role":"editor"}]')$$,'42501',null,'E cannot create arbitrary selected grant for X');
select throws_ok($$select public.share_recording_v1('30000000-0000-4000-8000-000000000001','selected','[{"userId":"10000000-0000-4000-8000-000000000005","role":"editor"}]')$$,'42501',null,'E cannot share assigned private content with arbitrary X');
select throws_ok($$select public.authorize_selected_recording_capture_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003','[{"userId":"10000000-0000-4000-8000-000000000005","role":"editor"}]',now()+interval '1 hour')$$,'42501',null,'E cannot self-authorize selected recipients');
reset role;
select is((select count(*) from public.recordings where capture_request_id='70000000-0000-4000-8000-000000000003'),0::bigint,'Failed E to X create leaves no hidden draft');
select is((select count(*) from public.recording_access_grants where user_id='10000000-0000-4000-8000-000000000005'),0::bigint,'Failed E to X operations leave no grant');
select is((select visibility from public.recordings where id='30000000-0000-4000-8000-000000000001'),'private','Failed E share leaves private visibility unchanged');
set local role authenticated;
select throws_ok($$select public.share_recording_v1('30000000-0000-4000-8000-000000000002','private')$$,'42501',null,'Author cannot privatize project-owned recording');
select throws_ok($$select public.assign_recording_organization_v1('30000000-0000-4000-8000-000000000002',null,null,null)$$,'42501',null,'Author cannot detach project custody');
delete from storage.objects where name='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3';
select is((select count(*) from storage.objects where name='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3'),1::bigint,'Editor cannot delete shared audio');
select lives_ok($$select public.edit_recording_title_v1('30000000-0000-4000-8000-000000000002','Edited')$$,'Editor title RPC');
select lives_ok($$select public.edit_recording_task_status_v1('63000000-0000-4000-8000-000000000001','done')$$,'Editor may update task status');
select is((select status from public.transcript_tasks where id='63000000-0000-4000-8000-000000000001'),'done','Task RPC persists exact allowed field');
select throws_ok($$update public.transcript_tasks set title='Forged task' where id='63000000-0000-4000-8000-000000000001'$$,'42501',null,'Editor cannot edit raw task content');
select throws_ok($$update public.recordings set visibility='private' where id='30000000-0000-4000-8000-000000000002'$$,'42501',null,'General UPDATE cannot privatize project content');
delete from public.recordings where id='30000000-0000-4000-8000-000000000002';
select is((select count(*) from public.recordings where id='30000000-0000-4000-8000-000000000002'),1::bigint,'Editor DELETE denied');
select is(public.patch_transcript_speaker_v1('40000000-0000-4000-8000-000000000001','1',0,'Jana','unknown')->>'outcome','saved','Speaker slot one saved');
select is(public.patch_transcript_speaker_v1('40000000-0000-4000-8000-000000000001','2',0,'Petr','unknown')->>'outcome','saved','Different speaker does not lose earlier edit');
select is(public.patch_transcript_speaker_v1('40000000-0000-4000-8000-000000000001','1',0,'Stale','unknown')->>'outcome','conflict','Same stale speaker returns conflict');
select is((select speakers->0->>'name' from public.transcripts where id='40000000-0000-4000-8000-000000000001'),'Jana','Conflict preserves fresh value');
select throws_ok($$select public.replace_transcript_search_chunks_v2('40000000-0000-4000-8000-000000000001','[]',0)$$,'42501',null,'Authenticated cannot write search chunks');
select throws_ok($$select public.finalize_recording_job_v1('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','fixture-completion-key','Forged','[]','[]',1)$$,'42501',null,'Browser cannot impersonate accepted worker');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000002'),'Reader reads project');
select is((select count(*) from public.recording_clients),0::bigint,'Project access does not expose founder clients');
select throws_ok($$select client_id from public.recording_projects where id='20000000-0000-4000-8000-000000000001'$$,'42501',null,'Project projection does not expose founder client ID');
select is(public.get_personal_recording_project_v1('20000000-0000-4000-8000-000000000001'),null::jsonb,'Reader cannot retrieve founder personal project metadata');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000005'),'Project membership does not expose another project');
select is((select count(*) from public.ai_outputs),1::bigint,'Reader reads saved output');
select is((select count(*) from public.transcript_tasks),1::bigint,'Reader reads saved task');
select is((select count(*) from public.ai_processing_jobs),0::bigint,'Reader cannot read private prompt/provider snapshots');
select throws_ok($$select storage_path,error_message from public.recordings where id='30000000-0000-4000-8000-000000000002'$$,'42501',null,'R cannot read protected path/error columns');
select throws_ok($$select client_id,folder_id,capture_request_fingerprint,purge_claim_id from public.recordings where id='30000000-0000-4000-8000-000000000002'$$,'42501',null,'R cannot read private metadata');
select throws_ok($$select public.get_personal_recording_metadata_v1('30000000-0000-4000-8000-000000000002')$$,'42501',null,'Later forward denies reader legacy JSON metadata');
select ok((select client_id is null and folder_id is null and tag_ids is null from public.get_accessible_recording_v1('30000000-0000-4000-8000-000000000002')),'Reader safe detail masks owner metadata');
select is((select count(*) from public.transcript_chat_turns),0::bigint,'R cannot read private chat');
select throws_ok(format('select %I from public.recordings where id=%L',column_name,'30000000-0000-4000-8000-000000000002'),'42501',null,'R protected column: '||column_name)
 from unnest(array['user_id','storage_path','error_message','client_id','folder_id','retention_policy','deleted_at','deleted_from_status','trash_retention_hours','purge_after','purge_claim_id','purge_started_at','purge_attempt_count','capture_request_id','capture_request_fingerprint']) column_name;
select throws_ok($$select public.edit_recording_task_status_v1('63000000-0000-4000-8000-000000000001','new')$$,'42501',null,'Reader cannot change task status');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000003'),'Reader membership does not expand selected');
select throws_ok($$select public.edit_recording_title_v1('30000000-0000-4000-8000-000000000002','Forbidden')$$,'42501',null,'Reader cannot edit');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*) from public.recordings),1::bigint,'Selected recipient sees only exact recording');
select throws_ok($$select storage_path,error_message,client_id,folder_id,capture_request_fingerprint,purge_claim_id from public.recordings where id='30000000-0000-4000-8000-000000000003'$$,'42501',null,'S cannot read any protected shared columns');
select throws_ok($$select * from public.recordings where id='30000000-0000-4000-8000-000000000003'$$,'42501',null,'S cannot bypass projection with SELECT star');
select throws_ok(format('select %I from public.recordings where id=%L',column_name,'30000000-0000-4000-8000-000000000003'),'42501',null,'S protected column: '||column_name)
 from unnest(array['user_id','storage_path','error_message','client_id','folder_id','retention_policy','deleted_at','deleted_from_status','trash_retention_hours','purge_after','purge_claim_id','purge_started_at','purge_attempt_count','capture_request_id','capture_request_fingerprint']) column_name;
select throws_ok($$select public.edit_recording_title_v1('30000000-0000-4000-8000-000000000003','S forbidden')$$,'42501',null,'Selected reader cannot mutate content');
select throws_ok($$select public.revoke_recording_grant_v1('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002')$$,'42501',null,'S cannot manage another grant');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_recording_invitation_v1(repeat('c',64),'selected@sharing.test','reader','project','20000000-0000-4000-8000-000000000001','{}',now()+interval '1 day')$$,'Founder creates project invitation');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(public.accept_recording_invitation_v1(repeat('c',64)),public.accept_recording_invitation_v1(repeat('c',64)),'Verified email accepts invite idempotently');
select set_config('sharing.accepted_project_invite',public.accept_recording_invitation_v1(repeat('c',64))::text,true);
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.revoke_recording_invitation_v1(current_setting('sharing.accepted_project_invite')::uuid)$$,'55000','invitation already accepted','Accept-first project invitation cannot report a successful revoke');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok(exists(select 1 from public.recording_project_members where project_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000004' and revoked_at is null),'Invitation revoke rejection leaves accepted project membership active');
select ok(public.can_read_recording(current_setting('sharing.capture_id')::uuid),'Project invitation opens project-visible content');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000001'),'Invitation never opens legacy private content');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*) from public.recordings),0::bigint,'Outsider sees nothing');
select is((select count(*) from public.transcript_search_chunks),0::bigint,'Outsider cannot search shared text');
select throws_ok($$select public.edit_recording_title_v1('30000000-0000-4000-8000-000000000002','X forbidden')$$,'42501',null,'X cannot mutate shared content');
select throws_ok($$select public.share_recording_v1('30000000-0000-4000-8000-000000000004','private')$$,'42501',null,'X cannot manage standalone access');
select throws_ok($$insert into public.recordings(user_id,title,source_type,visibility,project_id) values ('10000000-0000-4000-8000-000000000005','Forged','realtime','project','20000000-0000-4000-8000-000000000001')$$,'42501',null,'Direct shared INSERT denied');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.authorize_selected_recording_capture_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000004','[{"userId":"10000000-0000-4000-8000-000000000002","role":"editor"},{"userId":"10000000-0000-4000-8000-000000000004","role":"reader"}]',now()+interval '1 hour')$$,'Founder preauthorizes one exact editor capture');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000004','Authorized selected draft','realtime','20000000-0000-4000-8000-000000000001','selected','[{"userId":"10000000-0000-4000-8000-000000000002","role":"editor"},{"userId":"10000000-0000-4000-8000-000000000005","role":"reader"}]')$$,'42501',null,'Editor cannot substitute outsider into founder selected authorization');
select is(public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000004','Authorized selected draft','realtime','20000000-0000-4000-8000-000000000001','selected','[{"userId":"10000000-0000-4000-8000-000000000004","role":"reader"},{"userId":"10000000-0000-4000-8000-000000000002","role":"editor"}]'),
 public.create_recording_with_access_v1('70000000-0000-4000-8000-000000000004','Authorized selected draft','realtime','20000000-0000-4000-8000-000000000001','selected','[{"userId":"10000000-0000-4000-8000-000000000002","role":"editor"},{"userId":"10000000-0000-4000-8000-000000000004","role":"reader"}]'),'Recipient reordering preserves founder authorization and idempotency');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.revoke_project_member_v1('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')$$,'Founder revokes editor');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000002'),'Revoked author cannot read project recording');
select is((select count(*) from public.transcript_chat_threads),0::bigint,'Revoked technical author loses personal thread read');
select is((select count(*) from public.transcript_chat_turns),0::bigint,'Revoked technical author loses personal turn read');
select throws_ok($$select public.get_personal_recording_metadata_v1('30000000-0000-4000-8000-000000000002')$$,'42501',null,'Later forward denies revoked author legacy JSON metadata');
select is((select count(*) from public.get_accessible_recording_v1('30000000-0000-4000-8000-000000000002')),0::bigint,'Revoked author has no safe detail row');
select is(public.recording_capabilities_v1('30000000-0000-4000-8000-000000000002'),null::jsonb,'Revoked author receives no personal AI capability');
select throws_ok($$update public.recordings set storage_path='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3' where id='30000000-0000-4000-8000-000000000001'$$,'42501',null,'Revoked author cannot alias shared object from private row');
select ok(not public.can_read_recording_object_v1('10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3'),'Alias attempt cannot restore audio read');
select throws_ok($$select public.prepare_recording_upload_v1('30000000-0000-4000-8000-000000000001','../30000000-0000-4000-8000-000000000002/audio.mp3','audio/mpeg',100)$$,'22023',null,'Upload preparation rejects path traversal alias');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000003'),'Revocation removes project-scoped selected grants');
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000001'),'Private authored content survives revoke');
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000004'),'Standalone selected grant survives revoke');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('a',64))$$,'42501',null,'Revoke cancels pending project invitation');
select throws_ok($$select public.edit_recording_title_v1('30000000-0000-4000-8000-000000000002','Revoked edit')$$,'42501',null,'Revoked editor cannot mutate');
select is((select count(*) from storage.objects where name='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3'),0::bigint,'Revoked author loses exact shared audio');
select ok(not public.can_write_recording_capture_v1(current_setting('sharing.capture_id')::uuid),'Revoked author cannot resume project capture');
select throws_ok($$select public.prepare_recording_upload_v1(current_setting('sharing.capture_id')::uuid,'audio.mp3','audio/mpeg',100)$$,'42501',null,'Revoked author cannot register another upload');
update storage.objects set metadata='{"forged":true}' where bucket_id='recordings' and name='10000000-0000-4000-8000-000000000002/'||current_setting('sharing.capture_id')||'/audio.mp3';
reset role;
select throws_ok($$update public.recordings set storage_path='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000002/audio.mp3' where id='30000000-0000-4000-8000-000000000001'$$,'23514',null,'Authoritative object binding rejects alias even from trusted SQL');
select ok((select metadata is distinct from '{"forged":true}'::jsonb from storage.objects where bucket_id='recordings' and name='10000000-0000-4000-8000-000000000002/'||current_setting('sharing.capture_id')||'/audio.mp3'),'Revoked author Storage UPDATE changes no row');
select throws_ok($$delete from auth.users where id='10000000-0000-4000-8000-000000000002'$$,'23503',null,'Auth cascade cannot destroy retained author content');
select throws_ok($$delete from auth.users where id='10000000-0000-4000-8000-000000000001'$$,'23503',null,'Auth cascade cannot destroy founder project');
select ok(not public.replace_transcript_search_chunks_v2('40000000-0000-4000-8000-000000000001','[]',0),'Stale search version cannot replace newer speaker index');
select is(public.finalize_recording_job_v1('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','fixture-completion-key','Final after revoke','[]','[]',1),
 public.finalize_recording_job_v1('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','fixture-completion-key','Ignored replay','[]','[]',1),'Accepted exact job settles idempotently after revoke');
select is((select count(*) from public.automatic_timeline_intents),0::bigint,'Post-revoke finalization never schedules AI');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000002'),'Worker completion cannot restore author access');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.create_recording_invitation_v1(repeat('d',64),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000004']::uuid[],now()+interval '1 day')$$,'Standalone owner invites exact recording recipient');
select set_config('sharing.pending_standalone_invite',public.create_recording_invitation_v1(repeat('e',64),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000004']::uuid[],now()+interval '1 day')::text,true);
select is(public.revoke_recording_invitation_v1(current_setting('sharing.pending_standalone_invite')::uuid),true,'Pending invitation revoke confirms one actual transition');
select is(public.revoke_recording_invitation_v1(current_setting('sharing.pending_standalone_invite')::uuid),false,'Authorized retry confirms already revoked without a new transition');
select throws_ok($$select public.revoke_recording_invitation_v1('50000000-0000-4000-8000-000000000099')$$,'42501','revoke denied','Unknown invitation exposes no state metadata');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$select public.accept_recording_invitation_v1(repeat('d',64))$$,'42501',null,'S cannot redeem invitation for another verified email');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$select public.accept_recording_invitation_v1(repeat('e',64))$$,'42501',null,'X cannot redeem revoked standalone token');
select lives_ok($$select public.accept_recording_invitation_v1(repeat('d',64))$$,'X accepts live standalone invitation');
select set_config('sharing.accepted_standalone_invite',public.accept_recording_invitation_v1(repeat('d',64))::text,true);
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000004'),'Standalone recipient gets exact access');
select throws_ok($$select public.edit_recording_title_v1('30000000-0000-4000-8000-000000000004','X reader edit')$$,'42501',null,'Standalone reader cannot edit');
select throws_ok($$select public.revoke_recording_grant_v1('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002')$$,'42501',null,'Standalone reader cannot manage access');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.revoke_recording_invitation_v1(current_setting('sharing.accepted_standalone_invite')::uuid)$$,'55000','invitation already accepted','Accept-first standalone invitation cannot report a successful revoke');
select ok(exists(select 1 from public.recording_access_grants where recording_id='30000000-0000-4000-8000-000000000004' and user_id='10000000-0000-4000-8000-000000000005' and revoked_at is null),'Invitation revoke rejection leaves accepted standalone grant active');
select lives_ok($$select public.revoke_recording_grant_v1('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005')$$,'Standalone owner revokes accepted grant');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok($$select public.accept_recording_invitation_v1(repeat('d',64))$$,'Consumed standalone token only returns prior receipt');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000004'),'Consumed invite replay never reinstates revoked grant');
select throws_ok($$select public.revoke_recording_invitation_v1(current_setting('sharing.accepted_standalone_invite')::uuid)$$,'42501','revoke denied','Unauthorized accepted invitation returns generic denial, not accepted-state error');
reset role;
select is((select count(*) from public.recording_sharing_audit where action='revoke_invite' and subject_id=current_setting('sharing.pending_standalone_invite')::uuid),1::bigint,'Idempotent revoke retry emits no duplicate mutation audit');
select is((select count(*) from public.recording_sharing_audit where action='revoke_invite' and subject_id in (current_setting('sharing.accepted_project_invite')::uuid,current_setting('sharing.accepted_standalone_invite')::uuid)),0::bigint,'Accepted-race rejection emits no misleading revoke audit');
-- Disposable legacy-authority and delivery-clock fixtures; no user changes or sleeps.
set local role service_role;
insert into public.recording_invitations(id,token_hash,email,role,scope,project_id,expires_at,created_by,delivery_attempt_count,last_delivery_attempt_at,delivery_attempt_id) values
 ('50000000-0000-4000-8000-000000000011',repeat('1',64),'outsider@sharing.test','reader','recordings',null,now()+interval '1 day','10000000-0000-4000-8000-000000000002',1,clock_timestamp()-interval '2 minutes','51000000-0000-4000-8000-000000000011'),
 ('50000000-0000-4000-8000-000000000012',repeat('2',64),'outsider@sharing.test','reader','project','20000000-0000-4000-8000-000000000001',now()+interval '1 day','10000000-0000-4000-8000-000000000002',1,clock_timestamp()-interval '2 minutes','51000000-0000-4000-8000-000000000012'),
 ('50000000-0000-4000-8000-000000000013',repeat('3',64),'outsider@sharing.test','reader','project','20000000-0000-4000-8000-000000000001',now()+interval '1 day','10000000-0000-4000-8000-000000000001',4,clock_timestamp()-interval '2 minutes','51000000-0000-4000-8000-000000000013'),
 ('50000000-0000-4000-8000-000000000014',repeat('4',64),'outsider@sharing.test','reader','recordings',null,now()+interval '1 day','10000000-0000-4000-8000-000000000001',1,clock_timestamp()-interval '2 minutes','51000000-0000-4000-8000-000000000014'),
 ('50000000-0000-4000-8000-000000000015',repeat('b',64),'outsider@sharing.test','reader','project','20000000-0000-4000-8000-000000000001',now()+interval '1 day','10000000-0000-4000-8000-000000000001',5,clock_timestamp()-interval '2 minutes','51000000-0000-4000-8000-000000000015'),
 ('50000000-0000-4000-8000-000000000016',repeat('f',64),'outsider@sharing.test','reader','recordings','20000000-0000-4000-8000-000000000001',now()+interval '1 day','10000000-0000-4000-8000-000000000002',1,clock_timestamp()-interval '2 minutes','51000000-0000-4000-8000-000000000016');
insert into public.recording_invitation_items(invitation_id,recording_id) values
 ('50000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000004'),
 ('50000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000004'),
 ('50000000-0000-4000-8000-000000000016','30000000-0000-4000-8000-000000000003');
update public.recording_invitations i set recording_item_count=(select count(*) from public.recording_invitation_items x where x.invitation_id=i.id)
 where i.id in ('50000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000014','50000000-0000-4000-8000-000000000016');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select array_agg(k order by k) from jsonb_object_keys(public.preview_recording_invitation_v1(repeat('4',64))) k),array['expiresAt','id','recordingCount','role','scope']::text[],'Preview exposes exactly safe keys, no email/name/recording IDs/hash');
select is(public.preview_recording_invitation_v1(repeat('4',64))->>'recordingCount','1','Preview counts exact standalone items');
select is(public.preview_recording_invitation_v1(repeat('4',64))->>'id','50000000-0000-4000-8000-000000000014','Repeated preview is non-consuming');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000004'),'Preview creates no standalone grant');
select throws_ok($$select public.preview_recording_invitation_v1(repeat('1',64))$$,'42501',null,'Preview rejects former standalone owner authorization');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('1',64))$$,'42501',null,'Accept rechecks current standalone owner before grants');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('2',64))$$,'42501',null,'Accept rechecks current project founder before membership');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('f',64))$$,'42501',null,'Project-selected accept rejects former creator authority');
select throws_ok($$select public.list_recording_access_v1('20000000-0000-4000-8000-000000000001',null)$$,'42501',null,'Outsider cannot list foreign access');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.preview_recording_invitation_v1(repeat('4',64))$$,'42501',null,'Foreign email sees no invitation metadata');
select throws_ok($$select public.list_recording_access_v1(null,'30000000-0000-4000-8000-000000000004')$$,'42501',null,'Standalone recipient cannot list access');
select throws_ok($$select public.list_recording_access_v1('20000000-0000-4000-8000-000000000001',null)$$,'42501',null,'Former project member cannot list access');
select throws_ok($$select public.get_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000011')$$,'42501',null,'Historical creator cannot fetch delivery receipt');
select throws_ok($$select public.revoke_recording_invitation_v1('50000000-0000-4000-8000-000000000011')$$,'42501',null,'Historical standalone creator cannot revoke');
select throws_ok($$select public.revoke_recording_invitation_v1('50000000-0000-4000-8000-000000000012')$$,'42501',null,'Historical project creator cannot revoke');
select throws_ok($$select public.revoke_recording_invitation_v1('50000000-0000-4000-8000-000000000016')$$,'42501',null,'Project-selected author cannot revoke based on creator identity');
select throws_ok($$select public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000011',repeat('5',64),now()+interval '2 days')$$,'42501',null,'Historical standalone creator cannot resend');
select throws_ok($$select public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000012',repeat('6',64),now()+interval '2 days')$$,'42501',null,'Historical project creator cannot resend');
select throws_ok($$select public.create_recording_invitation_v1(repeat('7',64),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000004']::uuid[],now()+interval '1 day')$$,'42501',null,'Standalone recipient cannot create invitations');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(jsonb_array_length(public.list_recording_access_v1('20000000-0000-4000-8000-000000000001',null)->'members')>0,'Current founder lists active project members');
select ok(jsonb_array_length(public.list_recording_access_v1(null,'30000000-0000-4000-8000-000000000004')->'grants')>0,'Current standalone owner lists active exact grants');
select ok(not exists(select 1 from jsonb_array_elements(public.list_recording_access_v1(null,'30000000-0000-4000-8000-000000000004')->'invitations') i where i ?| array['token_hash','token','created_by','recordingIds','storage_path']),'Manager list never returns token material or content metadata');
select is(public.get_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000011')->>'authorizationCurrent','false','Current owner sees that historical authorization is stale');
select throws_ok($$select public.recording_invitation_summary_v1('50000000-0000-4000-8000-000000000011')$$,'42501',null,'Private invitation projection cannot be called directly');
select is(public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000011',repeat('5',64),now()+interval '2 days')->>'id','50000000-0000-4000-8000-000000000011','Current standalone owner resends SAME ID after former creator lost authority');
select is(public.get_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000011')->>'authorizationCurrent','true','Resend records current owner authorization');
select lives_ok($$select public.revoke_recording_invitation_v1('50000000-0000-4000-8000-000000000012')$$,'Current founder can revoke historical creator invitation');
select is(public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000013',repeat('6',64),now()+interval '2 days')->>'attemptCount','5','Founder reserves final allowed delivery attempt on same ID');
select throws_ok($$select public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000013',repeat('7',64),now()+interval '2 days')$$,'55000','invitation delivery limit reached','Sixth delivery attempt denied atomically');
select throws_ok($$select public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000015',repeat('7',64),now()+interval '2 days')$$,'55000','invitation delivery limit reached','Attempt cap remains enforced after cooldown has elapsed');
select lives_ok($$select public.revoke_recording_invitation_v1('50000000-0000-4000-8000-000000000016')$$,'Current founder revokes project-selected author invitation');
select set_config('sharing.resend_receipt',public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000014',repeat('8',64),now()+interval '2 days')::text,true);
select is(current_setting('sharing.resend_receipt')::jsonb->>'attemptCount','2','Successful resend increments bounded attempt count');
select throws_ok($$select public.get_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000014',repeat('4',64))$$,'42501',null,'Old create token cannot fetch the newer attempt receipt');
select is(public.get_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000014',repeat('8',64))->>'attemptId',current_setting('sharing.resend_receipt')::jsonb->>'attemptId','Delivery receipt is bound to expected current token hash');
select is((current_setting('sharing.resend_receipt')::jsonb->>'expiresAt')::timestamptz,now()+interval '2 days','Resend rotates expiry');
select throws_ok($$select public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000014',repeat('9',64),now()+interval '2 days')$$,'55000','invitation delivery limit reached','Immediate resend rejected within 60 seconds');
select ok(not public.settle_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000014','51000000-0000-4000-8000-000000000014',true),'Late old attempt cannot settle rotated delivery');
select ok(public.settle_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000014',(current_setting('sharing.resend_receipt')::jsonb->>'attemptId')::uuid,false),'Current exact attempt can record failed delivery');
select is(public.get_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000014')->>'deliveryState','failed','Delivery failure is visible without losing invitation or resetting budget');
select ok(not public.settle_recording_invitation_delivery_v1('50000000-0000-4000-8000-000000000014',(current_setting('sharing.resend_receipt')::jsonb->>'attemptId')::uuid,true),'Duplicate settlement cannot overwrite first receipt');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$select public.preview_recording_invitation_v1(repeat('4',64))$$,'42501',null,'Old hash preview invalid after rotation');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('4',64))$$,'42501',null,'Old application token cannot be accepted after rotation');
select is(public.preview_recording_invitation_v1(repeat('8',64))->>'id','50000000-0000-4000-8000-000000000014','New hash previews same invitation ID');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000004'),'Resend and preview never grant recording access');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000002'),'Resend never grants project membership');
select lives_ok($$select public.accept_recording_invitation_v1(repeat('5',64))$$,'Recipient accepts current owner reauthorization, not former creator authority');
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000004'),'Reauthorized invitation grants exact standalone access only on accept');
reset role;
select ok((select accepted_at is null and accepted_by is null and delivery_attempt_count=2 from public.recording_invitations where id='50000000-0000-4000-8000-000000000014'),'Preview/resend/settlement leave invitation unconsumed with exact budget');
select is((select count(*) from public.recording_invitations where id='50000000-0000-4000-8000-000000000014'),1::bigint,'Resend creates no duplicate invitation');
-- First-email standalone sharing: pending tokens must not publish private content.
set local role service_role;
insert into public.recording_projects(id,user_id,name) values
 ('20000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000002','Owner project');
insert into public.recordings(id,user_id,created_by,title,source_type,visibility,status)
 select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Private email fixture '||n,'upload','private','completed'
 from generate_series(20,26) n;
update public.recordings set storage_path='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000020/audio.mp3'
 where id='30000000-0000-4000-8000-000000000020';
insert into storage.objects(bucket_id,name) values ('recordings','10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000020/audio.mp3');
insert into public.transcripts(id,recording_id,user_id,raw_text) values
 ('40000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000002','Private email transcript');
-- The current transcript trigger already creates this search chunk; assert that real path below.
insert into public.recording_invitations(id,token_hash,email,role,scope,recording_item_count,expires_at,created_at,created_by) values
 ('50000000-0000-4000-8000-000000000022',repeat('2a',32),'outsider@sharing.test','reader','recordings',1,now()-interval '1 hour',now()-interval '1 day','10000000-0000-4000-8000-000000000002');
insert into public.recording_invitation_items(invitation_id,recording_id) values
 ('50000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000022');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_recording_invitation_v1(repeat('20',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000020']::uuid[],now()+interval '1 day')$$,'42501',null,'Foreign project founder cannot invite standalone private content');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$select public.create_recording_invitation_v1(repeat('20',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000020']::uuid[],now()+interval '1 day')$$,'42501',null,'Outsider cannot invite standalone private content');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$select public.create_recording_invitation_v1(repeat('20',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000020']::uuid[],now()+interval '1 day')$$,'Owner creates first email invitation while recording is private');
select lives_ok($$select public.create_recording_invitation_v1(repeat('26',32),'selected@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000020']::uuid[],now()+interval '1 day')$$,'Owner creates second pending recipient without user-ID grants');
select set_config('sharing.private_revoked_invite',public.create_recording_invitation_v1(repeat('21',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000021']::uuid[],now()+interval '1 day')::text,true);
select lives_ok($$select public.revoke_recording_invitation_v1(current_setting('sharing.private_revoked_invite')::uuid)$$,'Owner revokes pending private invite without publication');
select lives_ok($$select public.create_recording_invitation_v1(repeat('23',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000023']::uuid[],now()+interval '1 day')$$,'Owner invites before reassignment');
select lives_ok($$select public.create_recording_invitation_v1(repeat('24',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000024']::uuid[],now()+interval '1 day')$$,'Owner invites before project-scope change');
select lives_ok($$select public.create_recording_invitation_v1(repeat('25',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000025']::uuid[],now()+interval '1 day')$$,'Multi-item invitation reserves exact private set');
select lives_ok($$select public.create_recording_invitation_v1(repeat('28',32),'outsider@sharing.test','reader','recordings',null,array['30000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000026']::uuid[],now()+interval '1 day')$$,'Invitation snapshots original item count before privileged purge');
select lives_ok($$select public.assign_recording_organization_v1('30000000-0000-4000-8000-000000000023',null,'20000000-0000-4000-8000-000000000020',null)$$,'Private recording can still be assigned without sharing');
select lives_ok($$select public.assign_recording_organization_v1('30000000-0000-4000-8000-000000000024',null,'20000000-0000-4000-8000-000000000020',null)$$,'Owner assigns future project content');
select lives_ok($$select public.share_recording_v1('30000000-0000-4000-8000-000000000024','project')$$,'Owner changes recording to project scope through existing custody path');
update public.recordings set status='deleted' where id='30000000-0000-4000-8000-000000000025';
select throws_ok($$select public.create_recording_invitation_v1(repeat('27',32),'outsider@sharing.test','reader','recordings','20000000-0000-4000-8000-000000000020',array['30000000-0000-4000-8000-000000000023']::uuid[],now()+interval '1 day')$$,'42501',null,'First-email private transition is not generalized to project recordings');
select is((select visibility from public.recordings where id='30000000-0000-4000-8000-000000000020'),'private','All pending recipients leave standalone visibility private');
select is((select count(*) from public.recording_access_grants where recording_id='30000000-0000-4000-8000-000000000020'),0::bigint,'Pending invites create no grants');
reset role;
-- Disposable session owner simulates the existing privileged purge, not browser deletion.
delete from public.recordings where id='30000000-0000-4000-8000-000000000026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$select public.accept_recording_invitation_v1(repeat('20',32))$$,'42501',null,'Wrong verified email cannot trigger first transition');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(public.preview_recording_invitation_v1(repeat('20',32))->>'recordingCount','1','Intended recipient previews safe facts without content grant');
select is((select count(*) from public.recordings where id='30000000-0000-4000-8000-000000000020'),0::bigint,'Pending invite exposes no recording list/count row');
select is((select count(*) from public.transcripts where recording_id='30000000-0000-4000-8000-000000000020'),0::bigint,'Pending invite exposes no transcript');
select is((select count(*) from public.transcript_search_chunks where recording_id='30000000-0000-4000-8000-000000000020'),0::bigint,'Pending invite exposes no search chunks');
select is((select count(*) from storage.objects where name='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000020/audio.mp3'),0::bigint,'Pending invite exposes no audio');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('00',32))$$,'42501',null,'Wrong token cannot trigger private transition');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('21',32))$$,'42501',null,'Revoked first invite cannot publish private content');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('2a',32))$$,'42501',null,'Expired first invite cannot publish private content');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('23',32))$$,'42501',null,'Project reassignment invalidates pending standalone authority');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('24',32))$$,'42501',null,'Project scope change cannot redeem an old standalone token');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('25',32))$$,'42501',null,'Deleted second item rolls back the first item transition and grant');
select throws_ok($$select public.accept_recording_invitation_v1(repeat('28',32))$$,'42501',null,'Hard-deleted item cannot silently shrink exact invitation set');
reset role;
select is((select visibility from public.recordings where id='30000000-0000-4000-8000-000000000020'),'private','Failed multi-item accept rolls back earlier private-to-selected mutation');
select is((select count(*) from public.recording_access_grants where recording_id between '30000000-0000-4000-8000-000000000020' and '30000000-0000-4000-8000-000000000025'),0::bigint,'All rejected accepts leave no grant residue');
select is((select count(*) from public.recordings where id in ('30000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000023','30000000-0000-4000-8000-000000000025') and visibility='private'),5::bigint,'Wrong/revoked/expired/deleted/assigned cases remain private');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(public.accept_recording_invitation_v1(repeat('20',32)),public.accept_recording_invitation_v1(repeat('20',32)),'First accept and same-user retry are idempotent');
select is((select visibility from public.recordings where id='30000000-0000-4000-8000-000000000020'),'selected','Successful first accept atomically publishes selected with exact grant');
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000020'),'First verified recipient receives read access');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000020'),'First accept never grants second pending recipient');
select lives_ok($$select public.accept_recording_invitation_v1(repeat('26',32))$$,'Second pending recipient accepts already-selected standalone content');
select ok(public.can_read_recording('30000000-0000-4000-8000-000000000020'),'Second verified recipient gets only their exact grant');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.recording_access_grants where recording_id='30000000-0000-4000-8000-000000000020' and revoked_at is null),2::bigint,'Two recipients and double accept produce exactly two grants');
select throws_ok($$select public.get_personal_recording_metadata_v1('30000000-0000-4000-8000-000000000020')$$,'42501',null,'Later forward denies standalone owner legacy JSON metadata');
select ok((select project_id is null and visibility='selected' and tag_ids='{}'::uuid[] from public.get_accessible_recording_v1('30000000-0000-4000-8000-000000000020')),'First accept retains safe standalone owner projection');
-- Identity persistence is a trusted DB assertion, never a browser metadata permission.
reset role;
select ok((select project_id is null
 and user_id='10000000-0000-4000-8000-000000000002'
 and created_by='10000000-0000-4000-8000-000000000002'
 and storage_path='10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000020/audio.mp3'
 from public.recordings where id='30000000-0000-4000-8000-000000000020'),'First accept preserves owner/author/project/storage identity');
set local role authenticated;
select lives_ok($$select public.share_recording_v1('30000000-0000-4000-8000-000000000020','private')$$,'Standalone owner can return content to private through existing path');
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok($$select public.accept_recording_invitation_v1(repeat('20',32))$$,'Consumed token retry returns prior receipt only');
select ok(not public.can_read_recording('30000000-0000-4000-8000-000000000020'),'Consumed replay cannot reopen privatized standalone content');
reset role;
select is((select visibility from public.recordings where id='30000000-0000-4000-8000-000000000020'),'private','Consumed replay leaves private visibility unchanged');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.can_read_recording('30000000-0000-4000-8000-000000000002')$$,'42501',null,'Anonymous RPC denied');
select throws_ok($$select * from public.recordings$$,'42501',null,'Anonymous table SELECT denied');
select throws_ok($$select public.preview_recording_invitation_v1(repeat('8',64))$$,'42501',null,'Anonymous invitation preview denied');
select throws_ok($$select public.resend_recording_invitation_v1('50000000-0000-4000-8000-000000000014',repeat('9',64),now()+interval '2 days')$$,'42501',null,'Anonymous resend denied');
reset role;
select * from finish();
rollback;
