-- Disposable full-chain pgTAP admission fixture. Prepared only, not live PostgreSQL proof.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('17000000-0000-4000-8000-000000000001','previous-owner@fixture.test',now()),
('17000000-0000-4000-8000-000000000002','current-founder@fixture.test',now());
insert into public.recording_projects(id,user_id,name) values
('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002','New custody');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility) values
('37000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','Exact actor','realtime','completed','private');
insert into public.transcripts(id,recording_id,user_id,raw_text,segments,speakers) values
('47000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','Saved','[]','[]');
select ok(not has_function_privilege('authenticated','public.assert_current_personal_ai_manager_v1(uuid,uuid)','execute'),'Browser cannot forge trusted actor admission');
set local role service_role;
select lives_ok($$select public.assert_current_personal_ai_manager_v1('47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001')$$,'Current exact personal owner passes admission');
select lives_ok($$insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id)
select '57000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','fixture','summary',id
from public.prompt_templates where is_system and processing_type='summary' limit 1$$,'Active admission trigger accepts current personal owner');
reset role;
-- Represents custody changing after API precheck, before the destructive RPC obtains its lock.
update public.recordings set project_id='27000000-0000-4000-8000-000000000001',visibility='project'
where id='37000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.cleanup_manual_ai_jobs_v1(array['57000000-0000-4000-8000-000000000001'::uuid],'47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001',now())$$,'42501',null,'Transferred author cannot admit destructive cleanup after stale API precheck');
select throws_ok($$select public.reconcile_manual_ai_job_v1('57000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','interrupt',now())$$,'42501',null,'Transferred author cannot admit explicit interruption');
select throws_ok($$select public.assert_current_personal_ai_manager_v1('47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000002')$$,'42501',null,'New founder cannot run another author personal job');
select throws_ok($$insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id)
select '57000000-0000-4000-8000-000000000002','47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','fixture','summary',id
from public.prompt_templates where is_system and processing_type='summary' limit 1$$,'42501',null,'Active admission trigger denies new job after custody transfer');
reset role;
select * from finish();
rollback;
