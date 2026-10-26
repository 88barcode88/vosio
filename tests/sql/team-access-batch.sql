-- Synthetic rollback-only fixture. Run on an owned disposable Team verification database.
begin;
create function pg_temp.batch_assert(p_ok boolean,p_label text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'batch proof failed: %',p_label; end if; end;
$$;
insert into auth.users(id,email,email_confirmed_at) select ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'batch-'||n||'@proof.invalid',now() from generate_series(1,3) n;
insert into auth.sessions(id,user_id) select ('b1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into vosio_team_private.installation_administrators(user_id) values('a1000000-0000-4000-8000-000000000001');
insert into vosio_team_private.contacts(owner_id,user_id) values('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002');
insert into public.recording_clients(id,user_id,name) values
 ('c1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Client'),
 ('c1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003','Foreign');
insert into public.recording_projects(id,user_id,client_id,name) values
 ('d1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Empty project');
insert into public.recording_folders(id,user_id,name) values
 ('f1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Folder');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,client_id,project_id,folder_id) values
 ('e1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Private selected explicitly','upload','completed','private','c1000000-0000-4000-8000-000000000001',null,'f1000000-0000-4000-8000-000000000001'),
 ('e1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Private stays private','upload','completed','private','c1000000-0000-4000-8000-000000000001',null,null);

set role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","session_id":"b1000000-0000-4000-8000-000000000001"}',true);
select pg_temp.batch_assert(exists(
 select 1 from jsonb_array_elements(public.team_workspace_v2()->'scopes') s
 where s->>'scopeId'='e1000000-0000-4000-8000-000000000001'
 and s->>'visibility'='private' and s->>'clientId'='c1000000-0000-4000-8000-000000000001'
 and s->>'folderId'='f1000000-0000-4000-8000-000000000001'),'accurate private organization metadata');
select pg_temp.batch_assert(not exists(select 1 from jsonb_array_elements(public.team_workspace_v2()->'scopes') s
 where s->>'scopeId'='c1000000-0000-4000-8000-000000000003'),'no foreign taxonomy');
select pg_temp.batch_assert(exists(select 1 from jsonb_array_elements(public.team_workspace_v2()->'scopes') s
 where s->>'scopeId'='d1000000-0000-4000-8000-000000000001' and s->>'clientId'='c1000000-0000-4000-8000-000000000001'),'empty project retained');

-- A foreign second scope rejects the entire command before the valid first scope can mutate.
do $$ begin
 perform public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','reader',
 '[{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null},{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000003","projectId":null}]');
 raise exception 'accepted foreign scope';
exception when insufficient_privilege then null; end $$;
reset role;
select pg_temp.batch_assert(not exists(select 1 from vosio_team_private.scope_grants where grantor_id='a1000000-0000-4000-8000-000000000001'),'atomic authorization');
select pg_temp.batch_assert(not exists(select 1 from vosio_team_private.access_batch_receipts where actor_id='a1000000-0000-4000-8000-000000000001'),'no rejected receipt');
set role authenticated;
do $$ begin
 perform public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','reader',
 '[{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null}]');
 raise exception 'accepted unknown recipient';
exception when insufficient_privilege then null; end $$;
do $$ begin
 perform public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','reader','[]');
 raise exception 'accepted empty batch';
exception when invalid_parameter_value then null; end $$;
do $$ begin
 perform public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','reader',
 '[{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null},{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null}]');
 raise exception 'accepted duplicate batch';
exception when invalid_parameter_value then null; end $$;

select pg_temp.batch_assert(public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','reader',
 '[{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null},{"scopeKind":"recording","scopeId":"e1000000-0000-4000-8000-000000000001","projectId":null}]')
 = '{"saved":true,"count":2}'::jsonb,'batch saved exact count');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","session_id":"b1000000-0000-4000-8000-000000000002"}',true);
select pg_temp.batch_assert(public.can_read_recording('e1000000-0000-4000-8000-000000000001'),'explicit private shared');
select pg_temp.batch_assert(not public.can_read_recording('e1000000-0000-4000-8000-000000000002'),'other private excluded');
do $$ begin perform public.team_workspace_v2(); raise exception 'member got manager metadata'; exception when insufficient_privilege then null; end $$;
do $$ begin
 perform public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000001','reader',
 '[{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null}]');
 raise exception 'member changed access'; exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","session_id":"b1000000-0000-4000-8000-000000000001"}',true);
select public.revoke_team_access_v1('recording','e1000000-0000-4000-8000-000000000001',null,'a1000000-0000-4000-8000-000000000002');
select public.revoke_team_access_v1('client','c1000000-0000-4000-8000-000000000001',null,'a1000000-0000-4000-8000-000000000002');
select pg_temp.batch_assert(public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','reader',
 '[{"scopeKind":"recording","scopeId":"e1000000-0000-4000-8000-000000000001","projectId":null},{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null}]')
 = '{"saved":true,"count":2}'::jsonb,'canonical replay remains historical');
do $$ begin
 perform public.set_team_access_batch_v1('91000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','editor',
 '[{"scopeKind":"client","scopeId":"c1000000-0000-4000-8000-000000000001","projectId":null},{"scopeKind":"recording","scopeId":"e1000000-0000-4000-8000-000000000001","projectId":null}]');
 raise exception 'accepted request conflict'; exception when invalid_parameter_value then null; end $$;
reset role;
select pg_temp.batch_assert(not exists(select 1 from public.recording_access_grants where recording_id='e1000000-0000-4000-8000-000000000001' and revoked_at is null),'replay does not restore revoked exact grant');
select pg_temp.batch_assert(not exists(select 1 from vosio_team_private.scope_grants where grantor_id='a1000000-0000-4000-8000-000000000001' and revoked_at is null),'replay does not restore revoked scope');
select pg_temp.batch_assert((select count(*)=1 from vosio_team_private.access_batch_receipts where actor_id='a1000000-0000-4000-8000-000000000001'),'one immutable receipt');
select pg_temp.batch_assert(not has_function_privilege('anon','public.team_workspace_v2()','EXECUTE'),'anon denied metadata');
select pg_temp.batch_assert(not has_function_privilege('service_role','public.set_team_access_batch_v1(uuid,uuid,text,jsonb)','EXECUTE'),'service denied batch');
select pg_temp.batch_assert(not has_schema_privilege('authenticated','vosio_team_private','USAGE'),'private receipt schema');
select pg_temp.batch_assert(not has_table_privilege('authenticated','vosio_team_private.access_batch_receipts','SELECT'),'private receipt table');
select pg_temp.batch_assert((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='vosio_team_private.access_batch_receipts'::regclass),'forced receipt RLS');
rollback;
select 'PASS team_access_batch (synthetic rollback fixture)' as result;
