-- Disposable full-chain pgTAP fixture, prepared only: never run against user data.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('16000000-0000-4000-8000-000000000001','dev-capture@fixture.test',now(),'{}');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,capture_request_id) values
('36000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','Parts','in_app_recording','created','private','96000000-0000-4000-8000-000000000001');
select ok(not has_table_privilege('authenticated','public.recording_live_part_registrations','select'),'Part registry is private');
set local role authenticated;
set local request.jwt.claims='{"sub":"16000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,0,'audio/webm',10),
 '16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/live/part-000000.webm','Deterministic registered path');
select lives_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,0,'audio/webm',10)$$,'Exact registration retry');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,0,'audio/mp4',10)$$,'22023',null,'Retry cannot change MIME');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,0,'audio/webm',11)$$,'22023',null,'Retry cannot change size');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,1000,'audio/webm',10)$$,'22023',null,'Part count bounded');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,1,'audio/webm',5368709121)$$,'22023',null,'Oversize denied');
select ok(not public.can_write_recording_object_v1('16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/live/../escape.webm'),'Traversal denied');
select ok(not public.can_write_recording_object_v1('16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/live/part-000001.webm'),'Unregistered part denied');
select throws_ok($$select public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002',0,10)$$,'55000',null,'Missing actual object cannot finalize');
set local request.jwt.claims='{"sub":"16000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,1,'audio/webm',10)$$,'42501',null,'No current author authority cannot register');
select ok(not public.can_write_recording_object_v1('16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/live/part-000000.webm'),'Loss of authority denies even registered user upload');
reset role;
-- A failed capture with remote0/local0+1 can resume only before any transcription reservation.
update public.recordings set status='failed' where id='36000000-0000-4000-8000-000000000001';
insert into storage.objects(bucket_id,name,metadata) values('recordings',
 '16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/live/part-000000.webm','{"size":10,"mimetype":"audio/webm"}');
set local role authenticated;
set local request.jwt.claims='{"sub":"16000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',0,1,'audio/webm',11)$$,'Failed exact capture admits missing part1');
select ok(public.can_write_recording_object_v1('16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/live/part-000001.webm'),'Part1 storage admission reopened narrowly');
select throws_ok($$select public.apply_recording_capture_transition_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000003',0,'recover')$$,'55000',null,'Remote prefix0 cannot finalize missing registered part1');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',null,1,'audio/webm',11)$$,'22023',null,'NULL prepare revision denied');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',-1,1,'audio/webm',11)$$,'22023',null,'Negative prepare revision denied');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',9,1,'audio/webm',11)$$,'40001',null,'Stale prepare revision denied');
select throws_ok($$select public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000004',null,10)$$,'22023',null,'NULL complete revision denied');
select throws_ok($$select public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000004',-1,10)$$,'22023',null,'Negative complete revision denied');
select throws_ok($$select public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000004',9,10)$$,'40001',null,'Stale complete revision denied');
select lives_ok($$select public.prepare_recording_upload_v1('36000000-0000-4000-8000-000000000001','live/recording.webm','audio/webm',21)$$,'Main prepare fixes exact archive before failed transport');
reset role;
insert into storage.objects(bucket_id,name,metadata) values('recordings',
 '16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000001/live/part-000001.webm','{"size":11,"mimetype":"audio/webm"}');
set local role authenticated;
select lives_ok($$select public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000004',0,10)$$,'Absent main fallback binds exact complete parts');
select is(public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000004',0,10)->>'captureRevision','1','Exact receipt replay does not mutate again');
reset role;
update public.recordings set status='failed' where id='36000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.prepare_recording_transcription_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000005',1,'eu','stt-async-v5','retry')$$,'Failed segmented capture reserves exact retry');
select throws_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000001',1,2,'audio/webm',10)$$,'55000',null,'Reserved retry denies additional part');
select throws_ok($$select public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000006',1,10)$$,'55000',null,'Reserved retry denies completion revision change');
select throws_ok($$select public.apply_recording_capture_transition_v1('36000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000007',1,'recover')$$,'55000',null,'Reserved retry denies recovery');
reset role;
select is((select capture_revision from public.recordings where id='36000000-0000-4000-8000-000000000001'),1::bigint,'Rejected mutations preserve retry CAS');
select is((select count(*) from public.recording_capture_receipts where request_id='96000000-0000-4000-8000-000000000006'),0::bigint,'Rejected completion creates no receipt');
-- Both exact prepared-main routes: existing archive is immutable; absent archive can recover all parts.
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,capture_request_id) values
('36000000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','Existing main','in_app_recording','created','private','96000000-0000-4000-8000-000000000012'),
('36000000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','Absent main','in_app_recording','created','private','96000000-0000-4000-8000-000000000013');
set local role authenticated;
select lives_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000002',0,0,'audio/webm',10)$$,'Existing main scenario registers exact part');
select lives_ok($$select public.prepare_recording_live_part_v1('36000000-0000-4000-8000-000000000003',0,0,'audio/webm',10)$$,'Absent main scenario registers exact part');
select lives_ok($$select public.prepare_recording_upload_v1('36000000-0000-4000-8000-000000000002','live/recording.webm','audio/webm',10)$$,'Prepare existing archive');
select lives_ok($$select public.prepare_recording_upload_v1('36000000-0000-4000-8000-000000000003','live/recording.webm','audio/webm',10)$$,'Prepare absent archive');
reset role;
insert into storage.objects(bucket_id,name,metadata) values
('recordings','16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000002/live/part-000000.webm','{"size":10,"mimetype":"audio/webm"}'),
('recordings','16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000002/live/recording.webm','{"size":10,"mimetype":"audio/webm"}'),
('recordings','16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000003/live/part-000000.webm','{"size":10,"mimetype":"audio/webm"}');
set local role authenticated;
select throws_ok($$select public.complete_recording_live_parts_v1('36000000-0000-4000-8000-000000000002','96000000-0000-4000-8000-000000000014',0,10)$$,'22023',null,'Existing exact archive cannot retarget');
select lives_ok($$select public.apply_recording_capture_transition_v1('36000000-0000-4000-8000-000000000003','96000000-0000-4000-8000-000000000015',0,'recover')$$,'Recovery retargets only absent exact main to verified parts');
reset role;
select is((select storage_path from public.recordings where id='36000000-0000-4000-8000-000000000003'),
 '16000000-0000-4000-8000-000000000001/36000000-0000-4000-8000-000000000003/live/','Recovered exact parts binding retained');
select * from finish();
rollback;
