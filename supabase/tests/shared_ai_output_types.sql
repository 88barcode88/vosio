-- Disposable database only, after the complete chain including 20260922210000.
-- Rollback-only pgTAP artifact, not an executed runtime receipt.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
  and p.proowner = (select proowner from pg_proc where oid = 'public.can_read_recording(uuid)'::regprocedure),
  'Stable definer uses fixed empty path and the trusted T1 authority owner')
from pg_proc p where p.oid = 'public.get_accessible_ai_output_types_v1(uuid[])'::regprocedure;
select is(p.proargnames, array['p_output_ids','output_id','processing_type'], 'Only input IDs and two safe result fields')
from pg_proc p where p.oid = 'public.get_accessible_ai_output_types_v1(uuid[])'::regprocedure;
select is(p.proallargtypes, array['uuid[]'::regtype::oid,'uuid'::regtype::oid,'public.ai_processing_type'::regtype::oid],
  'Exact input and output types are preserved')
from pg_proc p where p.oid = 'public.get_accessible_ai_output_types_v1(uuid[])'::regprocedure;
select ok(has_function_privilege('authenticated','public.get_accessible_ai_output_types_v1(uuid[])','EXECUTE'), 'Authenticated may execute');
select ok(not has_function_privilege(role_name,'public.get_accessible_ai_output_types_v1(uuid[])','EXECUTE'), role_name || ' cannot execute')
from unnest(array['anon','service_role']) role_name;
select ok(not exists (
  select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
  where p.oid = 'public.get_accessible_ai_output_types_v1(uuid[])'::regprocedure and a.grantee = 0
), 'PUBLIC has no default execution privilege');

-- Fixture-only pure ID constructor; it cannot read application data.
create function pg_temp.output_ids(numbers integer[]) returns uuid[]
language sql immutable as $$
  select coalesce(array_agg(('72000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid order by n),'{}'::uuid[])
  from unnest(numbers) n;
$$;

set local role service_role;
insert into auth.users(id,email) values
 ('12000000-0000-4000-8000-000000000001','founder@output-types.test'),
 ('12000000-0000-4000-8000-000000000002','author@output-types.test'),
 ('12000000-0000-4000-8000-000000000003','member@output-types.test'),
 ('12000000-0000-4000-8000-000000000004','selected@output-types.test'),
 ('12000000-0000-4000-8000-000000000005','revoked@output-types.test'),
 ('12000000-0000-4000-8000-000000000006','outsider@output-types.test');
insert into public.recording_projects(id,user_id,name) values
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Output type fixture');
insert into public.recording_project_members(project_id,user_id,role,revoked_at) values
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','editor',null),
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000003','reader',null),
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000005','reader',now());
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status) values
 ('32000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Private','realtime',null,'private','completed'),
 ('32000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Project','realtime','22000000-0000-4000-8000-000000000001','project','completed'),
 ('32000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Selected','realtime','22000000-0000-4000-8000-000000000001','selected','completed'),
 ('32000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Standalone selected','realtime',null,'selected','completed'),
 ('32000000-0000-4000-8000-000000000005','12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Private Trash','realtime',null,'private','completed'),
 ('32000000-0000-4000-8000-000000000006','12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Project Trash','realtime','22000000-0000-4000-8000-000000000001','project','completed');
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id,revoked_at) values
 ('32000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000002','editor','22000000-0000-4000-8000-000000000001',null),
 ('32000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000004','reader','22000000-0000-4000-8000-000000000001',null),
 ('32000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000005','reader','22000000-0000-4000-8000-000000000001',now()),
 ('32000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000004','reader',null,null);
insert into public.transcripts(id,recording_id,user_id,raw_text)
select replace(r.id::text,'32000000','42000000')::uuid,r.id,r.user_id,'Fixture transcript'
from public.recordings r where r.id::text like '32000000-0000-4000-8000-%';
-- The existing snapshot trigger resolves each system prompt; no provider is called.
-- Saved historical outputs precede today's manager-only admission; restore the guard before assertions.
reset role;
alter table public.ai_processing_jobs disable trigger ai_processing_jobs_guard_personal_admission;
set local role service_role;
insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id,status)
select replace(t.id::text,'42000000','62000000')::uuid,t.id,t.user_id,'fixture-model',p.processing_type,p.id,'done'
from public.transcripts t join public.prompt_templates p on p.is_system and p.processing_type = 'summary'
where t.id::text like '42000000-0000-4000-8000-%';
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_json)
select replace(j.id::text,'62000000','72000000')::uuid,j.id,j.transcript_id,j.user_id,'{"processing_type":"action_items"}'::jsonb
from public.ai_processing_jobs j where j.id::text like '62000000-0000-4000-8000-%';
-- Separate FKs allow same-owner cross-transcript lineage. The RPC must fail closed.
insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id,status)
select '62000000-0000-4000-8000-000000000099','42000000-0000-4000-8000-000000000001',
 '12000000-0000-4000-8000-000000000002','fixture-private-model',processing_type,id,'done'
from public.prompt_templates where is_system and processing_type='summary' limit 1;
-- Corrupt historical lineage predates the output fence; current read assertions must still reject it.
reset role;
alter table public.ai_outputs disable trigger ai_outputs_checklist_parent_lock;
set local role service_role;
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text) values
 ('72000000-0000-4000-8000-000000000099','62000000-0000-4000-8000-000000000099','42000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','Inconsistent lineage');
reset role;
alter table public.ai_outputs enable trigger ai_outputs_checklist_parent_lock;
set local role service_role;
-- Real lifecycle triggers supply the immutable Trash snapshot.
update public.recordings set status='deleted'
where id in ('32000000-0000-4000-8000-000000000005','32000000-0000-4000-8000-000000000006');
reset role;
alter table public.ai_processing_jobs enable trigger ai_processing_jobs_guard_personal_admission;
set local role authenticated;

set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(array(select output_id from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1,2,3,4,5,6,99])) order by output_id),
 pg_temp.output_ids(array[1,2,3,4,5]), 'Owner reads private, selected and member-visible outputs; project Trash is founder-only');
select is((select processing_type::text from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1]))),
 'summary', 'Authoritative job type wins over misleading output JSON');
select is((select count(*) from public.ai_processing_jobs where id='62000000-0000-4000-8000-000000000001'),1::bigint,'Owner retains private job read');

set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(array(select output_id from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1,2,3,4,5,6,99])) order by output_id),
 pg_temp.output_ids(array[2,3,6]), 'Founder reads project and selected outputs plus project Trash, never another private output');
select is((select count(*) from public.ai_processing_jobs where id::text like '62000000-0000-4000-8000-%'),0::bigint,'Founder cannot read private jobs');

set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(array(select output_id from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1,2,3,4,5,6,99])) order by output_id),
 pg_temp.output_ids(array[2]), 'Member reads project output only; cannot infer private job via inconsistent output lineage');
select is((select count(*) from public.ai_outputs where id='72000000-0000-4000-8000-000000000002'),1::bigint,'Member still reads actual output separately through RLS');
select is((select count(*) from public.ai_processing_jobs where id::text like '62000000-0000-4000-8000-%'),0::bigint,'Member gets no general job access');

set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(array(select output_id from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1,2,3,4,5,6,99])) order by output_id),
 pg_temp.output_ids(array[3,4]), 'Selected recipient reads only exact project and standalone grants');
select is((select count(*) from public.ai_processing_jobs where id::text like '62000000-0000-4000-8000-%'),0::bigint,'Selected recipient gets no general job access');
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[3,3,4,4]))),2::bigint,'Duplicate input emits each accessible output once');
select is((select count(*) from public.get_accessible_ai_output_types_v1(array[null::uuid,'72000000-0000-4000-8000-000000000003'])),1::bigint,'NULL element is ignored');
select is((select count(*) from public.get_accessible_ai_output_types_v1(null)),0::bigint,'NULL array returns empty');
select is((select count(*) from public.get_accessible_ai_output_types_v1('{}'::uuid[])),0::bigint,'Empty array returns empty');
select is((select count(*) from public.get_accessible_ai_output_types_v1(array[null::uuid])),0::bigint,'All-NULL array returns empty');
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1]))),0::bigint,'Foreign output returns no existence marker');
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[999]))),0::bigint,'Missing output has the same empty result as foreign output');
select is((select count(*) from public.get_accessible_ai_output_types_v1(array_fill('72000000-0000-4000-8000-000000000003'::uuid,array[1000]))),1::bigint,'1000 raw IDs accepted and deduplicated');
select throws_ok($$select * from public.get_accessible_ai_output_types_v1(array_fill('72000000-0000-4000-8000-000000000003'::uuid,array[1001]))$$,
 '22023','output IDs must be a one-dimensional array of at most 1000 elements','1001 repeated known IDs rejected before lookup');
select throws_ok($$select * from public.get_accessible_ai_output_types_v1(array_fill('72000000-0000-4000-8000-000000000999'::uuid,array[1001]))$$,
 '22023','output IDs must be a one-dimensional array of at most 1000 elements','Missing oversized IDs receive identical validation error');
select throws_ok($$select * from public.get_accessible_ai_output_types_v1(array[[null::uuid],[null::uuid]])$$,
 '22023','output IDs must be a one-dimensional array of at most 1000 elements','Multidimensional arrays rejected');

set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1,2,3,4,5,6,99]))),0::bigint,'Revoked membership and grant expose no output types');
set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1,2,3,4,5,6,99]))),0::bigint,'Outsider sees no output existence');

-- Commit visibility semantics: a later statement must see this transaction's revokes.
reset role;
set local role service_role;
update public.recording_project_members set revoked_at=now()
where project_id='22000000-0000-4000-8000-000000000001' and user_id in ('12000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000003');
update public.recording_access_grants set revoked_at=now()
where recording_id='32000000-0000-4000-8000-000000000003' and user_id='12000000-0000-4000-8000-000000000004';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[2]))),0::bigint,'Member loses type projection on the next statement after revoke');
select is((select count(*) from public.ai_outputs where id='72000000-0000-4000-8000-000000000002'),0::bigint,'Member also loses output RLS read');
set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[2]))),0::bigint,'Technical author loses shared project type after membership loss');
select is((select count(*) from public.ai_processing_jobs where id='62000000-0000-4000-8000-000000000002'),0::bigint,'Owner plus current-read job policy is unchanged');
set local request.jwt.claims = '{"sub":"12000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(array(select output_id from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[3,4])) order by output_id),
 pg_temp.output_ids(array[4]),'Revoking one exact grant retains unrelated standalone access');

-- Removed outputs are absent even if the session still reads their recording/job.
reset role;
set local role service_role;
delete from public.ai_outputs where id='72000000-0000-4000-8000-000000000004';
reset role;
set local role authenticated;
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[4]))),0::bigint,'Deleted output produces no type from the surviving job');
set local request.jwt.claims = '{"role":"authenticated"}';
select is((select count(*) from public.get_accessible_ai_output_types_v1(pg_temp.output_ids(array[1,2,3,4,5,6]))),0::bigint,'Authenticated role without user identity returns empty');
reset role;
set local role anon;
select throws_ok($$select * from public.get_accessible_ai_output_types_v1('{}'::uuid[])$$,'42501',null,'Anonymous execution denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.get_accessible_ai_output_types_v1('{}'::uuid[])$$,'42501',null,'Direct service-role execution denied');
reset role;
select * from finish();
rollback;
