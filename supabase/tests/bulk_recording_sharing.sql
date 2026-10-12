-- Disposable full migration-chain database only. Executable pgTAP artifact; NOT a runtime pass receipt.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Isolated IDs and session identities.
create function pg_temp.uid(p_group integer,p_number integer) returns uuid language sql immutable
as $$select (lpad(p_group::text,8,'0')||'-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid$$;
create function pg_temp.actor(p_number integer) returns text language sql
as $$select set_config('request.jwt.claims',json_build_object('sub',pg_temp.uid(16000000,p_number),'role','authenticated')::text,true)$$;
-- Client-like JSON construction: no security-definer helper under test.
create function pg_temp.recipients() returns jsonb language sql
as $$select jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,5),'role','reader'))$$;
set local role service_role;
insert into auth.users(id,email) select pg_temp.uid(16000000,n),'bulk-'||n||'@fixture.test' from generate_series(1,100)n;
insert into public.recording_projects(id,user_id,name) select pg_temp.uid(26000000,n),pg_temp.uid(16000000,1),'Bulk project '||n from generate_series(1,2)n;
insert into public.recording_project_members(project_id,user_id,role,revoked_at) select pg_temp.uid(26000000,1),pg_temp.uid(16000000,n),
case when n in(2,3) then 'editor' else 'reader' end,case when n=6 then now() end from unnest(array[2,3,4,6])n;
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,project_id)
select pg_temp.uid(36000000,n),pg_temp.uid(16000000,case when n in(10,11) then 1 when n in(5,12) then 7 else 2 end),
pg_temp.uid(16000000,case when n in(10,11) then 1 when n in(5,12) then 7 else 2 end),'Bulk fixture '||n,'realtime','completed',
case when n in(3,11) then 'project' when n in(4,9) then 'selected' else 'private' end,
case when n in(3,4,7,8,10,12,16) then pg_temp.uid(26000000,1) when n=11 then pg_temp.uid(26000000,2) end
from generate_series(1,16)n;
update public.recordings set status='deleted' where id=pg_temp.uid(36000000,6);
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id) values
(pg_temp.uid(36000000,4),pg_temp.uid(16000000,5),'reader',pg_temp.uid(26000000,1)),
(pg_temp.uid(36000000,9),pg_temp.uid(16000000,5),'reader',null);
insert into public.recording_invitations(id,token_hash,email,role,scope,recording_item_count,expires_at,created_by)
values(pg_temp.uid(56000000,1),repeat('b',64),'not-a-user@fixture.test','reader','recordings',2,now()+interval '1 day',pg_temp.uid(16000000,2));
insert into public.recording_invitation_items(invitation_id,recording_id)
select pg_temp.uid(56000000,1),pg_temp.uid(36000000,n) from generate_series(1,2)n;
reset role;
create temporary table bulk_before as select id,to_jsonb(r)-'visibility'-'updated_at' as fields
from public.recordings r where id=any(array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)]);
select ok(p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=""']
 and p.proowner=(select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure),'Trusted volatile fixed-path definer')
from pg_proc p where p.oid='public.bulk_share_recordings_v1(uuid,uuid[],text,jsonb)'::regprocedure;
select ok(has_function_privilege('authenticated','public.bulk_share_recordings_v1(uuid,uuid[],text,jsonb)','execute')
 and not has_function_privilege('anon','public.bulk_share_recordings_v1(uuid,uuid[],text,jsonb)','execute')
 and not has_function_privilege('service_role','public.bulk_share_recordings_v1(uuid,uuid[],text,jsonb)','execute'),'Only authenticated execution');
select ok(relrowsecurity and relforcerowsecurity,'Receipt ledger forced RLS') from pg_class where oid='public.recording_bulk_share_receipts'::regclass;
select ok(not has_table_privilege(role_name,'public.recording_bulk_share_receipts','select,insert,update,delete'),'No receipt table rights: '||role_name)
from unnest(array['anon','authenticated','service_role'])role_name;
set local role authenticated;
set local request.jwt.claims='{}';
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'private')$$,'42501',null,'Missing session denied');
select pg_temp.actor(2);
select throws_ok($$select * from public.bulk_share_recordings_v1(null,array[pg_temp.uid(36000000,1)],'private')$$,'22023',null,'NULL request rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),null,'private','[]'::jsonb)$$,'22023',null,'NULL IDs rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),'{}'::uuid[],'private','[]'::jsonb)$$,'22023',null,'Empty IDs rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array_fill(pg_temp.uid(36000000,1),array[101]),'private','[]'::jsonb)$$,'22023',null,'101 raw IDs before dedup rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[[pg_temp.uid(36000000,1)]],'private','[]'::jsonb)$$,'22023',null,'Multidimensional IDs rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1),null],'private','[]'::jsonb)$$,'22023',null,'NULL item rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],null,'[]'::jsonb)$$,'22023',null,'NULL visibility rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'selected','{}'::jsonb)$$,'22023',null,'Recipient nonarray rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'selected','[]'::jsonb)$$,'22023',null,'Empty selected recipients rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'private',pg_temp.recipients())$$,'22023',null,'Private with recipients rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'selected',(select jsonb_agg(pg_temp.recipients()->0) from generate_series(1,101)))$$,'22023',null,'101 raw recipients rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'selected',pg_temp.recipients()||pg_temp.recipients())$$,'22023',null,'Duplicate recipient rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'selected',jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,999),'role','reader')))$$,'22023',null,'Nonexistent recipient rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'selected',jsonb_build_array((pg_temp.recipients()->0)||'{"extra":true}'::jsonb))$$,'22023',null,'Unknown recipient key rejected');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,5)],'selected',pg_temp.recipients())$$,'42501',null,'One foreign row rejects entire group');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,6)],'selected',pg_temp.recipients())$$,'42501',null,'One deleted row rejects entire group');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,999)],'selected',pg_temp.recipients())$$,'42501',null,'One missing row rejects entire group');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,3)],'selected',pg_temp.recipients())$$,'42501',null,'One technical author without custody row rejects entire group');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,7),pg_temp.uid(36000000,1)],'project')$$,'22023',null,'Standalone project transition rejects entire group');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,7)],'selected',pg_temp.recipients())$$,'42501',null,'Project selected requires founder even for private owner editor');
reset role;
select is((select count(*) from public.recording_sharing_audit where actor_id=pg_temp.uid(16000000,2)),0::bigint,'Rejected groups leave no audit');
select is((select count(*) from public.recording_bulk_share_receipts where actor_id=pg_temp.uid(16000000,2)),0::bigint,'Rejected groups leave no receipt');
select is((select count(*) from public.recordings where id=any(array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,7)]) and visibility='private'),2::bigint,'Earlier authorized row remains private');
select ok((select revoked_at is null from public.recording_invitations where id=pg_temp.uid(56000000,1)),'Rejected groups leave pending invitation untouched');
set local role authenticated;
select pg_temp.actor(2);
select is(array(select recording_id from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),
array[pg_temp.uid(36000000,2),pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)],'selected',pg_temp.recipients())),
array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)],'Two standalone legacy private rows share atomically; duplicates unique and sorted');
select is(array(select visibility from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),
array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)],'selected',pg_temp.recipients())),array['selected','selected'],'Reordered deduped request retry returns exact receipt');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1)],'selected',pg_temp.recipients())$$,'42501',null,'Request collision denied');
reset role;
select is((select count(*) from public.recording_sharing_audit where actor_id=pg_temp.uid(16000000,2)),2::bigint,'Exactly one audit per unique recording, no retry audit');
select is((select count(*) from public.recording_access_grants where recording_id=any(array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)]) and revoked_at is null and scope_project_id is null),2::bigint,'No duplicate grants and exact standalone scope');
select ok((select revoked_at is not null from public.recording_invitations where id=pg_temp.uid(56000000,1)),'Pending invite bundle revoked, never converted to a grant');
select is((select count(*) from public.recordings where id=any(array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)]) and user_id=pg_temp.uid(16000000,2) and created_by=pg_temp.uid(16000000,2)),2::bigint,'Technical ownership/authorship preserved');
select ok(not exists(select 1 from public.recordings r join bulk_before b on b.id=r.id
where to_jsonb(r)-'visibility'-'updated_at' is distinct from b.fields),'Every non-sharing recording field preserved byte-for-byte');
set local role authenticated;
select pg_temp.actor(1);
select is((select count(*) from public.bulk_share_recordings_v1(pg_temp.uid(96000000,2),
array[pg_temp.uid(36000000,11),pg_temp.uid(36000000,4),pg_temp.uid(36000000,3)],'selected',
pg_temp.recipients()||jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,3),'role','editor')))),3::bigint,'Founder manages project and selected rows across projects');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,3),array[pg_temp.uid(36000000,10),pg_temp.uid(36000000,3)],'private')$$,'22023',null,'Shared project custody cannot revert private');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,3),array[pg_temp.uid(36000000,12)],'project')$$,'42501',null,'Founder cannot publish foreign private-in-project');
reset role;
select is((select count(*) from public.recording_access_grants g join public.recordings r on r.id=g.recording_id
where r.id=any(array[pg_temp.uid(36000000,3),pg_temp.uid(36000000,4),pg_temp.uid(36000000,11)]) and g.revoked_at is null
and g.scope_project_id=r.project_id and g.user_id=any(array[pg_temp.uid(16000000,3),pg_temp.uid(16000000,5)])),6::bigint,'Exact recipients and selected scope for every project row');
select is((select count(*) from public.recording_access_grants where recording_id=pg_temp.uid(36000000,4) and revoked_at is not null),1::bigint,'Old grant revoked rather than duplicated active');
set local role authenticated;
select pg_temp.actor(2);
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,2),array[pg_temp.uid(36000000,3),pg_temp.uid(36000000,4),pg_temp.uid(36000000,11)],'selected',pg_temp.recipients()||jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,3),'role','editor')))$$,'42501',null,'technical author cannot recover another actor receipt or share project custody');
select pg_temp.actor(3);
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,2),array[pg_temp.uid(36000000,3),pg_temp.uid(36000000,4),pg_temp.uid(36000000,11)],'selected',pg_temp.recipients()||jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,3),'role','editor')))$$,'42501',null,'editor cannot recover another actor receipt or share project custody');
select pg_temp.actor(4);
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,2),array[pg_temp.uid(36000000,3),pg_temp.uid(36000000,4),pg_temp.uid(36000000,11)],'selected',pg_temp.recipients()||jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,3),'role','editor')))$$,'42501',null,'reader cannot recover another actor receipt or share project custody');
select pg_temp.actor(5);
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,2),array[pg_temp.uid(36000000,3),pg_temp.uid(36000000,4),pg_temp.uid(36000000,11)],'selected',pg_temp.recipients()||jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,3),'role','editor')))$$,'42501',null,'selected recipient cannot recover another actor receipt or share project custody');
select pg_temp.actor(6);
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,2),array[pg_temp.uid(36000000,3),pg_temp.uid(36000000,4),pg_temp.uid(36000000,11)],'selected',pg_temp.recipients()||jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,3),'role','editor')))$$,'42501',null,'revoked cannot recover another actor receipt or share project custody');
select pg_temp.actor(7);
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,2),array[pg_temp.uid(36000000,3),pg_temp.uid(36000000,4),pg_temp.uid(36000000,11)],'selected',pg_temp.recipients()||jsonb_build_array(jsonb_build_object('userId',pg_temp.uid(16000000,3),'role','editor')))$$,'42501',null,'outsider cannot recover another actor receipt or share project custody');
select pg_temp.actor(2);
select is((select count(*) from public.bulk_share_recordings_v1(pg_temp.uid(96000000,4),array[pg_temp.uid(36000000,7),pg_temp.uid(36000000,8)],'project')),2::bigint,'Active editor publishes own private-in-project group');
select pg_temp.actor(1);
select public.revoke_project_member_v1(pg_temp.uid(26000000,1),pg_temp.uid(16000000,2));
select pg_temp.actor(2);
select is(array(select recording_id from public.bulk_share_recordings_v1(pg_temp.uid(96000000,4),array[pg_temp.uid(36000000,8),pg_temp.uid(36000000,7)],'project')),
array[pg_temp.uid(36000000,7),pg_temp.uid(36000000,8)],'Lost response replay after revoke returns historical receipt');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,5),array[pg_temp.uid(36000000,7),pg_temp.uid(36000000,8)],'project')$$,'42501',null,'New request after revoke cannot repeat mutation');
select throws_ok($$select * from public.bulk_share_recordings_v1(pg_temp.uid(96000000,5),array[pg_temp.uid(36000000,16)],'project')$$,'42501',null,'Private owner without current project capture authority cannot publish');
select is((select count(*) from public.bulk_share_recordings_v1(pg_temp.uid(96000000,6),array[pg_temp.uid(36000000,9)],'private')),1::bigint,'Standalone selected owner may revert private');
select is((select count(*) from public.bulk_share_recordings_v1(pg_temp.uid(96000000,7),array_fill(pg_temp.uid(36000000,13),array[100]),'private')),1::bigint,'100 raw duplicate IDs accepted and canonicalized');
select is((select count(*) from public.bulk_share_recordings_v1(pg_temp.uid(96000000,8),array[pg_temp.uid(36000000,14)],'selected',
(select jsonb_agg(jsonb_build_object('userId',pg_temp.uid(16000000,n),'role','reader') order by n desc) from generate_series(1,100)n))),1::bigint,'100 raw distinct recipients accepted');
select is((select count(*) from public.bulk_share_recordings_v1(pg_temp.uid(96000000,8),array[pg_temp.uid(36000000,14)],'selected',
(select jsonb_agg(jsonb_build_object('role','reader','userId',pg_temp.uid(16000000,n)) order by n) from generate_series(1,100)n))),1::bigint,'Recipient/key order canonicalization gives exact retry');
select throws_ok($$select * from public.recording_bulk_share_receipts$$,'42501',null,'Actor cannot enumerate receipt ledger');
reset role;
-- Simulated later purge/account removal: completed result contains no live FK and never restores data/grants.
delete from public.recordings where id=any(array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)]);
delete from auth.users where id=pg_temp.uid(16000000,5);
set local role authenticated;
select pg_temp.actor(2);
select is(array(select recording_id from public.bulk_share_recordings_v1(pg_temp.uid(96000000,1),array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)],'selected',pg_temp.recipients())),
array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)],'Historical replay survives recording purge and recipient account deletion');
reset role;
select is((select count(*) from public.recordings where id=any(array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)])),0::bigint,'Replay never recreates purged recordings');
select is((select count(*) from public.recording_sharing_audit where actor_id=pg_temp.uid(16000000,2) and recording_id=any(array[pg_temp.uid(36000000,1),pg_temp.uid(36000000,2)])),2::bigint,'Historical replay never adds audit');
select * from finish();
rollback;
