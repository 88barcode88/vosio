-- Disposable database only, after the full migration chain including 20261103120100_access_list_member_email.
-- Real caller-claim checks; not a runtime pass receipt for any live database.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,email) values
 ('61000000-0000-4000-8000-000000000001','founder@access-email.test'),('61000000-0000-4000-8000-000000000002','member@access-email.test'),
 ('61000000-0000-4000-8000-000000000003','grantee@access-email.test'),('61000000-0000-4000-8000-000000000004','outsider@access-email.test'),
 ('61000000-0000-4000-8000-000000000005',null);
insert into public.recording_projects(id,user_id,name) values ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','emailproject');
insert into public.recording_project_members(project_id,user_id,role) values
 ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','editor'),
 ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','reader');
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status) values
 ('63000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','selected in project','upload','62000000-0000-4000-8000-000000000001','selected','completed'),
 ('63000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','standalone selected','upload',null,'selected','completed');
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id) values
 ('63000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','reader','62000000-0000-4000-8000-000000000001'),
 ('63000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000003','editor',null);

select ok(p.prosecdef and p.proconfig=array['search_path=""'] and has_function_privilege('authenticated',p.oid,'execute')
  and not has_function_privilege('anon',p.oid,'execute'),'RPC stays definer, empty path, authenticated-only')
from pg_proc p where p.oid='public.list_recording_access_v1(uuid,uuid)'::regprocedure;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select is((select jsonb_agg(m->'email' order by m->>'userId') from jsonb_array_elements(public.list_recording_access_v1('62000000-0000-4000-8000-000000000001',null)->'members') m),
  '["member@access-email.test", null]'::jsonb,'Founder sees member e-mail, null for a user without e-mail');
select is((select jsonb_agg(m) from jsonb_array_elements(public.list_recording_access_v1('62000000-0000-4000-8000-000000000001',null)->'members') m where m->>'userId'='61000000-0000-4000-8000-000000000002'),
  '[{"role":"editor","email":"member@access-email.test","userId":"61000000-0000-4000-8000-000000000002"}]'::jsonb,'Member row has exactly userId, email and role');
select is((select jsonb_agg(g->'email') from jsonb_array_elements(public.list_recording_access_v1('62000000-0000-4000-8000-000000000001',null)->'grants') g),
  '["grantee@access-email.test"]'::jsonb,'Founder sees grant e-mail for the project scope only');
select is((select jsonb_agg(g->'email') from jsonb_array_elements(public.list_recording_access_v1(null,'63000000-0000-4000-8000-000000000002')->'grants') g),
  '["grantee@access-email.test"]'::jsonb,'Recording manager sees grant e-mail');
select is((select array_agg(k order by k) from jsonb_object_keys((public.list_recording_access_v1(null,'63000000-0000-4000-8000-000000000002')->'grants')->0) k),
  array['email','recordingId','role','userId'],'Grant row keys are exact');

-- Users who are not the founder/manager still cannot list anything or read e-mails.
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.list_recording_access_v1('62000000-0000-4000-8000-000000000001',null)$$,'42501',null,'Outsider cannot list project access');
select throws_ok($$select public.list_recording_access_v1(null,'63000000-0000-4000-8000-000000000002')$$,'42501',null,'Outsider cannot list recording access');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.list_recording_access_v1('62000000-0000-4000-8000-000000000001',null)$$,'42501',null,'A project member (not founder) cannot list project access');
reset role;
select finish();
rollback;
