-- Prepared full-chain disposable DB fixture. Not runtime evidence until executed locally.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('19000000-0000-4000-8000-000000000001','owner@fixture.test',now(),'{"vosio_settings":{"autoTimelineAfterTranscription":true,"defaultOpenaiModel":"gpt-6-astra"}}'),
('19000000-0000-4000-8000-000000000002','editor@fixture.test',now(),'{}');
insert into public.recording_projects(id,user_id,name) values('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','Repairs');
insert into public.recording_project_members(project_id,user_id,role) values('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002','editor');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,project_id,capture_request_id) values
('39000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','Founder own','realtime','uploading','project','29000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001'),
('39000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002','Other author','realtime','completed','project','29000000-0000-4000-8000-000000000001',null);
insert into public.transcripts(id,recording_id,user_id,raw_text,segments,speakers) values
('49000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','saved','[{"speaker":1,"text":"saved","start_ms":0,"end_ms":10}]','[]'),
('49000000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002','other','[{"tokens":[{"speaker":"2","text":"other"}]}]','[{"id":"1","name":"Preserved","label":"Mluvčí 1","role":"unknown","source":"manual"}]');
update public.transcripts set completion_generation_key='capture:99000000-0000-4000-8000-000000000001' where id='49000000-0000-4000-8000-000000000001';
update public.recordings set status='completed' where id='39000000-0000-4000-8000-000000000001';
select ok(not has_table_privilege('authenticated','public.capture_timeline_snapshots','select'),'Private model/prompt snapshot not directly readable');
select ok(not has_function_privilege('authenticated','public.claim_pending_capture_indexes_v1(integer)','execute'),'Index recovery is service only');
select is((select count(*) from public.capture_timeline_snapshots where transcript_id='49000000-0000-4000-8000-000000000001'),1::bigint,'Eligible new completion snapshot captured');
select is((select count(*) from public.automatic_timeline_intents where transcript_id='49000000-0000-4000-8000-000000000001'),0::bigint,'Completion alone cannot authorize a personal job');
set local role authenticated;
set local request.jwt.claims='{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$select public.patch_transcript_speaker_v1('49000000-0000-4000-8000-000000000001','1',0,'Renamed','unknown')$$,'Editor materializes ID proved by stored tokens');
select throws_ok($$select public.patch_transcript_speaker_v1('49000000-0000-4000-8000-000000000001','unproved',0,'Forged','unknown')$$,'22023',null,'Unproved arbitrary ID denied');
select throws_ok($$select public.schedule_capture_timeline_intent_v1('49000000-0000-4000-8000-000000000001')$$,'42501',null,'Editor cannot schedule owner snapshot');
set local request.jwt.claims='{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.patch_transcript_speaker_v1('49000000-0000-4000-8000-000000000002','2',0,'Second','unknown')$$,'Partial speakers materialize nested proved ID');
select ok(public.schedule_capture_timeline_intent_v1('49000000-0000-4000-8000-000000000001'),'Current personal founder-owner schedules stored snapshot');
select throws_ok($$select public.share_recording_v1('39000000-0000-4000-8000-000000000002','private','[]')$$,'22023',null,'Other author custody cannot return to private');
select lives_ok($$select public.share_recording_v1('39000000-0000-4000-8000-000000000001','private','[]')$$,'Founder own recording returns to private');
select is(public.release_recording_purge_request_v1('39000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002')->>'phase','released','Explicit absent purge release succeeds');
select is(public.prepare_recording_purge_v1('39000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002',now())->>'phase','released','Late prepare replays cancellation instead of creating work');
reset role;
select is((select speakers->0->>'name' from public.transcripts where id='49000000-0000-4000-8000-000000000002'),'Preserved','Other legacy slot remains unchanged');
select is((select snapshot->'outputs'->0->>'model' from public.capture_timeline_snapshots where transcript_id='49000000-0000-4000-8000-000000000001'),'gpt-6-astra','Model snapshot fixed at completion');
insert into public.transcription_jobs(id,recording_id,user_id,mode,status,provider) values
('59000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002','async','done','soniox');
update public.recording_project_members set revoked_at=now() where user_id='19000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims='{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.transcription_jobs where id='59000000-0000-4000-8000-000000000001'),0::bigint,'Revoked author loses content-gated job row');
select is(jsonb_array_length(public.get_owned_job_usage_v1(now()-interval '1 day',now()+interval '1 day')->'soniox'),1,'Revoked author retains cost-only owned accounting');
reset role;
select * from finish();
rollback;
