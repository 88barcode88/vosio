-- Disposable full migration-chain database only; executable pgTAP artifact, NOT a runtime pass receipt.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Isolated fixture identity helpers.
create function pg_temp.uid(p_group integer,p_number integer) returns uuid language sql immutable
as $$select (lpad(p_group::text,8,'0')||'-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid$$;
create function pg_temp.actor(p_number integer) returns text language sql
as $$select set_config('request.jwt.claims',json_build_object('sub',pg_temp.uid(15000000,p_number),'role','authenticated')::text,true)$$;
set local role service_role;
insert into auth.users(id,email) select pg_temp.uid(15000000,n),'usage-audio-'||n||'@fixture.test' from generate_series(1,9)n;
insert into public.recording_projects(id,user_id,name) values(pg_temp.uid(25000000,1),pg_temp.uid(15000000,1),'Usage audio project');
insert into public.recording_project_members(project_id,user_id,role,revoked_at) values
(pg_temp.uid(25000000,1),pg_temp.uid(15000000,2),'editor',null),
(pg_temp.uid(25000000,1),pg_temp.uid(15000000,3),'editor',null),
(pg_temp.uid(25000000,1),pg_temp.uid(15000000,4),'reader',null),
(pg_temp.uid(25000000,1),pg_temp.uid(15000000,6),'reader',now());
-- 1/4/5/7/8/13/14/15 project rows; 6 standalone selected; 3 private Trash; 9/10 outside period.
-- Deliberately corrupt historical locators test fail-closed reads; today's write guard stays active for assertions.
reset role;
alter table public.recordings disable trigger recordings_guard_object_binding;
set local role service_role;
insert into public.recordings(id,user_id,created_by,title,source_type,visibility,project_id,status,created_at,duration_seconds,file_size_bytes,storage_path)
select pg_temp.uid(35000000,n),pg_temp.uid(15000000,2),pg_temp.uid(15000000,2),'Usage fixture '||n,'realtime',
case when n in(5,6) then 'selected' when n in(1,4,7,8,13,14,15) then 'project' else 'private' end,
case when n in(1,4,5,7,8,13,14,15) then pg_temp.uid(25000000,1) end,'completed',
case when n=9 then '2026-10-01'::timestamptz when n=10 then '2026-08-31 23:59:59+00'::timestamptz else '2026-09-01'::timestamptz end,
case when n=1 then 60 when n=3 then 0 when n=4 then 120 when n=6 then 30 when n in(9,10) then 999 end,
case when n=1 then 100 when n=3 then 0 when n=4 then 200 when n=5 then 300 when n in(9,10) then 999 end,
case when n in(4,5,6,7,8,13,14,15) then pg_temp.uid(15000000,2)::text||'/'||pg_temp.uid(35000000,n)::text||'/'||
  case when n in(4,6) then 'original.webm' when n=5 then 'live/' when n=7 then 'bad'||chr(92)||'file'
    when n=8 then 'double//file' when n=13 then '' when n=14 then 'nested/live/' else '.' end end
from generate_series(1,15)n where n not in(11,12);
reset role;
set constraints all immediate;
alter table public.recordings enable trigger recordings_guard_object_binding;
set local role service_role;
insert into public.recordings(id,user_id,created_by,title,source_type,status,created_at,duration_seconds,file_size_bytes) values
(pg_temp.uid(35000000,11),pg_temp.uid(15000000,8),pg_temp.uid(15000000,8),'Known zeros','realtime','completed','2026-09-01',0,0),
(pg_temp.uid(35000000,12),pg_temp.uid(15000000,9),pg_temp.uid(15000000,9),'Unknown metadata','realtime','completed','2026-09-01',null,null);
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id) values
(pg_temp.uid(35000000,5),pg_temp.uid(15000000,5),'reader',pg_temp.uid(25000000,1)),
(pg_temp.uid(35000000,6),pg_temp.uid(15000000,5),'reader',null);
update public.recordings set status='deleted' where id=any(array[
pg_temp.uid(35000000,3),pg_temp.uid(35000000,4),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6),
pg_temp.uid(35000000,7),pg_temp.uid(35000000,8),pg_temp.uid(35000000,13),pg_temp.uid(35000000,14),pg_temp.uid(35000000,15)]);
reset role;
select ok(p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']
 and p.proowner=(select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure),
'Stable fixed-path trusted owner: '||p.proname)
from pg_proc p where p.oid=any(array[
'public.get_owned_recording_usage_summary_v1(timestamptz,timestamptz)'::regprocedure,
'public.get_owned_recording_durations_v1(uuid[])'::regprocedure,
'public.get_managed_recording_trash_v2(uuid[])'::regprocedure]);
select ok(has_function_privilege('authenticated',signature,'execute') and not has_function_privilege('anon',signature,'execute')
 and not has_function_privilege('service_role',signature,'execute'),'Session-only function ACL: '||signature)
from unnest(array['public.get_owned_recording_usage_summary_v1(timestamptz,timestamptz)',
'public.get_owned_recording_durations_v1(uuid[])','public.get_managed_recording_trash_v2(uuid[])']) signature;
select ok(not exists(select 1 from pg_proc p cross join lateral unnest(p.proargnames) arg
 where p.oid='public.get_managed_recording_trash_v2(uuid[])'::regprocedure
 and arg in('storage_path','user_id','claim_id','actor_id')),'Trash OUT shape has no protected fields');
set local role authenticated;
set local request.jwt.claims='{}';
select throws_ok($$select * from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')$$,'42501',null,'Summary missing session fails closed');
select is((select count(*) from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1)])),0::bigint,'Duration missing session empty');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4)])),0::bigint,'Trash missing session empty');
select pg_temp.actor(2);
select ok(public.can_read_recording(pg_temp.uid(35000000,1)),'Technical author initially has project read access');
select is((select to_jsonb(s) from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')s),
'{"count":11,"deleted_count":9,"total_duration_seconds":210,"total_file_size_bytes":600,"with_duration_count":4,"with_file_size_count":4}'::jsonb,'Owner aggregate exact including deleted rows and null/zero semantics');
select pg_temp.actor(1);
select is((select count from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')),0::bigint,'Founder shared content does not inflate own usage');
select public.revoke_project_member_v1(pg_temp.uid(25000000,1),pg_temp.uid(15000000,2));
select pg_temp.actor(2);
select ok(not public.can_read_recording(pg_temp.uid(35000000,1)),'Revoked technical owner lost content read');
select is((select to_jsonb(s) from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')s),
'{"count":11,"deleted_count":9,"total_duration_seconds":210,"total_file_size_bytes":600,"with_duration_count":4,"with_file_size_count":4}'::jsonb,'Owner usage survives project revoke unchanged');
select is(array(select recording_id from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,9),pg_temp.uid(35000000,1),pg_temp.uid(35000000,11),pg_temp.uid(35000000,999),null])),
array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,9)],'Owner duration IDs dedup; foreign/missing/null omitted; job lookup independent of recording month');
select is((select duration_seconds from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1)])),60,'Revoked owner job duration available');
select is((select pg_typeof(total_duration_seconds)::text||'/'||pg_typeof(total_file_size_bytes)::text from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')),'bigint/numeric','Aggregate numeric types are explicit');
select is((select count(*) from public.get_owned_recording_durations_v1(null)),0::bigint,'NULL duration array safe');
select is((select count(*) from public.get_owned_recording_durations_v1('{}'::uuid[])),0::bigint,'Empty duration array safe');
select is((select count(*) from public.get_owned_recording_durations_v1(array_fill(pg_temp.uid(35000000,1),array[1000]))),1::bigint,'1000 raw duplicates return one duration');
select throws_ok($$select * from public.get_owned_recording_durations_v1(array_fill(pg_temp.uid(35000000,1),array[1001]))$$,'22023',null,'1001 raw IDs rejected before dedup');
select throws_ok($$select * from public.get_owned_recording_durations_v1(array[[pg_temp.uid(35000000,1)]])$$,'22023',null,'Multidimensional duration IDs rejected');
select throws_ok($$select * from public.get_owned_recording_usage_summary_v1(null,'2026-10-01')$$,'22023',null,'Null summary bound rejected');
select throws_ok($$select * from public.get_owned_recording_usage_summary_v1('2026-10-01','2026-09-01')$$,'22023',null,'Reversed interval rejected');
select throws_ok($$select * from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-09-01')$$,'22023',null,'Empty interval rejected');
select throws_ok($$select * from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-04')$$,'22023',null,'More than 32 days rejected');
select throws_ok($$select * from public.get_owned_recording_usage_summary_v1('-infinity','infinity')$$,'22023',null,'Infinite interval rejected');
select is((select count from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-03')),12::bigint,'32-day boundary accepted and includes October row');
select is(array(select recording_id from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,3),pg_temp.uid(35000000,4),pg_temp.uid(35000000,6)])),
array[pg_temp.uid(35000000,3),pg_temp.uid(35000000,6)],'Private/standalone owner gets only managed Trash after project revoke');
select is((select audio_availability from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,3)])),'none','Null storage locator reports none');
select is((select audio_availability from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,6)])),'single','Standalone owner valid single file');
select pg_temp.actor(1);
select is((select audio_availability from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4)])),'single','Founder valid single locator');
select is((select audio_availability from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,5)])),'segmented','Founder selected exact canonical live prefix');
select is((select count(*) from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,4)])),0::bigint,'Shared-only founder cannot obtain foreign duration lookup');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,7),pg_temp.uid(35000000,8),pg_temp.uid(35000000,13),pg_temp.uid(35000000,14),pg_temp.uid(35000000,15)]) where audio_availability='none'),5::bigint,'Backslash, empty component/root, noncanonical live folder and dot fail closed');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,3),pg_temp.uid(35000000,4),pg_temp.uid(35000000,4),pg_temp.uid(35000000,999),null])),1::bigint,'Trash dedup excludes active/private foreign/missing IDs');
select is((select count(*) from public.get_managed_recording_trash_v2(null)),0::bigint,'NULL Trash IDs safe');
select is((select count(*) from public.get_managed_recording_trash_v2('{}'::uuid[])),0::bigint,'Empty Trash IDs safe');
select is((select count(*) from public.get_managed_recording_trash_v2(array_fill(pg_temp.uid(35000000,4),array[100]))),1::bigint,'100 raw Trash IDs accepted and deduped');
select throws_ok($$select * from public.get_managed_recording_trash_v2(array_fill(pg_temp.uid(35000000,4),array[101]))$$,'22023',null,'101 raw Trash IDs rejected');
select throws_ok($$select * from public.get_managed_recording_trash_v2(array[[pg_temp.uid(35000000,4)]])$$,'22023',null,'Multidimensional Trash IDs rejected');
select is((select to_jsonb(v2)-'audio_availability' from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4)])v2),
(select to_jsonb(v1) from public.get_managed_recording_trash_v1(array[pg_temp.uid(35000000,4)])v1),'V2 preserves the reviewed safe v1 fields');
select pg_temp.actor(3);
select is((select count from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')),0::bigint,'Actor 3: shared/foreign usage excluded');
select is((select count(*) from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 3: no foreign duration metadata');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 3: no read-only/shared/revoked Trash metadata');
select pg_temp.actor(4);
select is((select count from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')),0::bigint,'Actor 4: shared/foreign usage excluded');
select is((select count(*) from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 4: no foreign duration metadata');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 4: no read-only/shared/revoked Trash metadata');
select pg_temp.actor(5);
select is((select count from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')),0::bigint,'Actor 5: shared/foreign usage excluded');
select is((select count(*) from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 5: no foreign duration metadata');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 5: no read-only/shared/revoked Trash metadata');
select pg_temp.actor(6);
select is((select count from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')),0::bigint,'Actor 6: shared/foreign usage excluded');
select is((select count(*) from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 6: no foreign duration metadata');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 6: no read-only/shared/revoked Trash metadata');
select pg_temp.actor(7);
select is((select count from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')),0::bigint,'Actor 7: shared/foreign usage excluded');
select is((select count(*) from public.get_owned_recording_durations_v1(array[pg_temp.uid(35000000,1),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 7: no foreign duration metadata');
select is((select count(*) from public.get_managed_recording_trash_v2(array[pg_temp.uid(35000000,4),pg_temp.uid(35000000,5),pg_temp.uid(35000000,6)])),0::bigint,'Actor 7: no read-only/shared/revoked Trash metadata');
select pg_temp.actor(8);
select is((select to_jsonb(s) from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')s),
'{"count":1,"deleted_count":0,"total_duration_seconds":0,"total_file_size_bytes":0,"with_duration_count":1,"with_file_size_count":1}'::jsonb,'Known zero differs from unknown');
select pg_temp.actor(9);
select is((select to_jsonb(s) from public.get_owned_recording_usage_summary_v1('2026-09-01','2026-10-01')s),
'{"count":1,"deleted_count":0,"total_duration_seconds":null,"total_file_size_bytes":null,"with_duration_count":0,"with_file_size_count":0}'::jsonb,'All-null row preserves nullable sums');
select is((select to_jsonb(s) from public.get_owned_recording_usage_summary_v1('2026-07-01','2026-08-01')s),
'{"count":0,"deleted_count":0,"total_duration_seconds":null,"total_file_size_bytes":null,"with_duration_count":0,"with_file_size_count":0}'::jsonb,'Empty month returns one zero-count row with nullable sums');
select throws_ok($$select storage_path from public.recordings limit 1$$,'42501',null,'No direct path grant introduced');
reset role;
select * from finish();
rollback;
