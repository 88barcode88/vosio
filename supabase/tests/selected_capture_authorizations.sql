-- Disposable full-chain DB only. Prepared executable evidence; not a runtime pass.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
('18000000-0000-4000-8000-000000000001','capture-founder@fixture.test'),
('18000000-0000-4000-8000-000000000002','capture-editor@fixture.test'),
('18000000-0000-4000-8000-000000000003','capture-reader@fixture.test');
insert into public.recording_projects(id,user_id,name) values('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000001','Capture reservations');
insert into public.recording_project_members(project_id,user_id,role) values
('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000002','editor'),
('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000003','reader');
select ok(not has_function_privilege('anon','public.list_selected_recording_capture_authorizations_v1(uuid)','execute'),'Anon cannot list reservations');
select ok(not has_function_privilege('service_role','public.list_selected_recording_capture_authorizations_v1(uuid)','execute'),'Service cannot list session reservations');
set local role authenticated;
set local request.jwt.claims='{"sub":"18000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.authorize_selected_recording_capture_v1('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000001','[{"userId":"18000000-0000-4000-8000-000000000002","role":"editor"}]',now()+interval '1 hour');
select is((select count(*) from public.list_selected_recording_capture_authorizations_v1('28000000-0000-4000-8000-000000000001')),0::bigint,'Founder cannot read another author reservation');
set local request.jwt.claims='{"sub":"18000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.list_selected_recording_capture_authorizations_v1('28000000-0000-4000-8000-000000000001')),1::bigint,'Active editor sees exact own reservation');
select is((select request_id from public.list_selected_recording_capture_authorizations_v1('28000000-0000-4000-8000-000000000001')),'98000000-0000-4000-8000-000000000001'::uuid,'Exact request ID preserved');
set local request.jwt.claims='{"sub":"18000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.list_selected_recording_capture_authorizations_v1('28000000-0000-4000-8000-000000000001')),0::bigint,'Reader sees no editor reservation');
reset role;
update public.recording_selected_capture_authorizations set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour';
set local role authenticated;
set local request.jwt.claims='{"sub":"18000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.list_selected_recording_capture_authorizations_v1('28000000-0000-4000-8000-000000000001')),0::bigint,'Expired reservation disappears');
reset role;
update public.recording_selected_capture_authorizations set expires_at=now()+interval '1 hour';
set local role authenticated;
set local request.jwt.claims='{"sub":"18000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.revoke_project_member_v1('28000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000002');
set local request.jwt.claims='{"sub":"18000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.list_selected_recording_capture_authorizations_v1('28000000-0000-4000-8000-000000000001')),0::bigint,'Revoked editor sees no reservation');
reset role;
select * from finish();
rollback;
