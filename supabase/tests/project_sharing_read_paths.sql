-- Disposable database only, after the full migration chain including read paths.
-- Real pgTAP/role-switched checks. This artifact is not a runtime pass receipt.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- Catalog assertions run in the disposable DB; source matching is not a substitute.
select ok(to_regprocedure(signature) is not null,'Exact RPC/helper signature exists: '||signature)
from unnest(array[
 'public.accessible_recording_rows_v1(uuid,uuid,uuid,uuid[],uuid,public.recording_status,boolean,timestamptz,uuid,integer)',
 'public.accessible_recording_search_winners_v1(text,uuid,uuid,uuid,uuid[],public.recording_status)',
 'public.list_accessible_recordings_v1(uuid,uuid,uuid,uuid[],public.recording_status,timestamptz,uuid,integer)',
 'public.get_accessible_recording_v1(uuid)',
 'public.search_accessible_recordings_v1(text,uuid,uuid,uuid,uuid[],public.recording_status,integer,integer)',
 'public.count_accessible_recording_statuses_v1(text,uuid,uuid,uuid,uuid[])'
]) signature;
select ok(p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""']
  and p.proowner=(select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure),
  'Stable definer, fixed empty path and trusted T1 owner: '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname=any(array[
 'accessible_recording_rows_v1','accessible_recording_search_winners_v1',
 'list_accessible_recordings_v1','get_accessible_recording_v1',
 'search_accessible_recordings_v1','count_accessible_recording_statuses_v1'
]);
select ok(not exists(select 1 from pg_attribute a join pg_type t on t.typrelid=a.attrelid
  where t.oid='public.accessible_recording_row_v1'::regtype and a.attname='created_by' and not a.attisdropped),
  'Public composite contains no personal author UUID');
select ok(not ('created_by'=any(p.proargnames)),'Search OUT columns contain no personal author UUID')
from pg_proc p where p.oid='public.search_accessible_recordings_v1(text,uuid,uuid,uuid,uuid[],public.recording_status,integer,integer)'::regprocedure;
set local role service_role;
insert into auth.users(id,email) values
 ('11000000-0000-4000-8000-000000000001','founder@read-paths.test'),
 ('11000000-0000-4000-8000-000000000002','editor@read-paths.test'),
 ('11000000-0000-4000-8000-000000000003','reader@read-paths.test'),
 ('11000000-0000-4000-8000-000000000004','selected@read-paths.test'),
 ('11000000-0000-4000-8000-000000000005','outsider@read-paths.test'),
 ('11000000-0000-4000-8000-000000000006','revoked@read-paths.test');
insert into public.recording_clients(id,user_id,name) values ('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','secretclient');
insert into public.recording_folders(id,user_id,name) values ('23000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','secretfolder');
insert into public.recording_tags(id,user_id,name) values
 ('24000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','secrettag'),('24000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','secondtag');
insert into public.recording_projects(id,user_id,name) values ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','projectneedle');
insert into public.recording_project_members(project_id,user_id,role,revoked_at) values
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','editor',null),('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','reader',null),
 ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000006','reader',now());
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status,created_at,client_id,folder_id) values
 ('31000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title1','realtime',null,'private','completed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title2','realtime','21000000-0000-4000-8000-000000000001','private','completed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title3','realtime','21000000-0000-4000-8000-000000000001','project','completed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title4','realtime','21000000-0000-4000-8000-000000000001','selected','completed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000005','11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','common title5','realtime',null,'selected','completed','2026-09-01T00:00:00Z',null,null),
 ('31000000-0000-4000-8000-000000000006','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title6','realtime','21000000-0000-4000-8000-000000000001','project','failed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000007','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title7','realtime',null,'private','completed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000008','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title8','realtime','21000000-0000-4000-8000-000000000001','project','completed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001'),
 ('31000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','common title9','realtime','21000000-0000-4000-8000-000000000001','selected','completed','2026-09-01T00:00:00Z','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001');
-- Use the real lifecycle trigger to populate immutable Trash snapshot constraints.
update public.recordings set status='deleted' where id in ('31000000-0000-4000-8000-000000000007','31000000-0000-4000-8000-000000000008');
insert into public.recording_tag_links(recording_id,user_id,tag_id) values
 ('31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001'),('31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000002'),
 ('31000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001');
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id,revoked_at) values
 ('31000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000001','reader','21000000-0000-4000-8000-000000000001',null),
 ('31000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000002','editor','21000000-0000-4000-8000-000000000001',null),
 ('31000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000004','reader','21000000-0000-4000-8000-000000000001',null),
 ('31000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000006','reader','21000000-0000-4000-8000-000000000001',now()),
 ('31000000-0000-4000-8000-000000000005','11000000-0000-4000-8000-000000000004','reader',null,null),
 ('31000000-0000-4000-8000-000000000009','11000000-0000-4000-8000-000000000004','reader','21000000-0000-4000-8000-000000000001',null);
insert into public.transcripts(id,recording_id,user_id,raw_text,created_at) values
 ('41000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','obsoleteword','2026-09-01'),
 ('41000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','transcriptneedle common','2026-09-02');
delete from public.transcript_search_chunks where transcript_id='41000000-0000-4000-8000-000000000002';
insert into public.transcript_search_chunks(transcript_id,recording_id,user_id,position,start_ms,end_ms,text) values
 ('41000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002',1,100,150,'transcriptneedle common'),
 ('41000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002',2,200,250,'transcriptneedle common');
reset role;
set local role authenticated;

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.list_accessible_recordings_v1() where id='31000000-0000-4000-8000-000000000004'),1::bigint,'Founder plus exact selected grant emits one row');
select is((select count(*) from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000008')),1::bigint,'Founder reads shared project Trash detail');
select is(coalesce((select array_agg(id order by id) from public.list_accessible_recordings_v1()),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 1: exact list set, no duplicates');
select is(coalesce((select array_agg(recording_id order by recording_id) from public.search_accessible_recordings_v1('common')),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 1: search same exact set');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1() where status<>'deleted'),5::bigint,'Actor 1: active facets equal list');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('common') where status<>'deleted'),5::bigint,'Actor 1: query facets equal search');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='deleted'),1::bigint,'Actor 1: separate custody Trash count');
select is((select count(*) from public.list_accessible_recordings_v1(p_status=>'deleted')),1::bigint,'Actor 1: explicit Trash list');
select is(coalesce((select array_agg(d.id order by d.id) from unnest(array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000007'::uuid,'31000000-0000-4000-8000-000000000008'::uuid,'31000000-0000-4000-8000-000000000009'::uuid]) requested(id) cross join lateral public.get_accessible_recording_v1(requested.id) d where d.status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 1: safe detail exact same active set');
select is(coalesce((select array_agg(id order by id) from public.recordings where status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 1: detail RLS same accessible set');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000007')),1::bigint,'Private owner reads own Trash detail');
select throws_ok($$select public.get_personal_recording_metadata_v1('31000000-0000-4000-8000-000000000002')$$,'42501',null,'Current owner cannot execute legacy whole-row JSON metadata');
select ok((select client_id='22000000-0000-4000-8000-000000000001' and folder_id='23000000-0000-4000-8000-000000000001' and project_id='21000000-0000-4000-8000-000000000001' from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000002')),'Safe detail retains authorized owner taxonomy and project');
select is((select count(*) from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000008')),0::bigint,'Editor/technical author cannot read project Trash detail');
select is(coalesce((select array_agg(id order by id) from public.list_accessible_recordings_v1()),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 2: exact list set, no duplicates');
select is(coalesce((select array_agg(recording_id order by recording_id) from public.search_accessible_recordings_v1('common')),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 2: search same exact set');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1() where status<>'deleted'),5::bigint,'Actor 2: active facets equal list');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('common') where status<>'deleted'),5::bigint,'Actor 2: query facets equal search');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='deleted'),1::bigint,'Actor 2: separate custody Trash count');
select is((select count(*) from public.list_accessible_recordings_v1(p_status=>'deleted')),1::bigint,'Actor 2: explicit Trash list');
select is(coalesce((select array_agg(d.id order by d.id) from unnest(array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000007'::uuid,'31000000-0000-4000-8000-000000000008'::uuid,'31000000-0000-4000-8000-000000000009'::uuid]) requested(id) cross join lateral public.get_accessible_recording_v1(requested.id) d where d.status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 2: safe detail exact same active set');
select is(coalesce((select array_agg(id order by id) from public.recordings where status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 2: detail RLS same accessible set');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000008')),0::bigint,'Reader cannot read project Trash detail');
select is(coalesce((select array_agg(id order by id) from public.list_accessible_recordings_v1()),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 3: exact list set, no duplicates');
select is(coalesce((select array_agg(recording_id order by recording_id) from public.search_accessible_recordings_v1('common')),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 3: search same exact set');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1() where status<>'deleted'),2::bigint,'Actor 3: active facets equal list');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('common') where status<>'deleted'),2::bigint,'Actor 3: query facets equal search');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='deleted'),0::bigint,'Actor 3: separate custody Trash count');
select is((select count(*) from public.list_accessible_recordings_v1(p_status=>'deleted')),0::bigint,'Actor 3: explicit Trash list');
select is(coalesce((select array_agg(d.id order by d.id) from unnest(array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000007'::uuid,'31000000-0000-4000-8000-000000000008'::uuid,'31000000-0000-4000-8000-000000000009'::uuid]) requested(id) cross join lateral public.get_accessible_recording_v1(requested.id) d where d.status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 3: safe detail exact same active set');
select is(coalesce((select array_agg(id order by id) from public.recordings where status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000006'::uuid],'Actor 3: detail RLS same accessible set');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*) from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000008')),0::bigint,'Selected recipient cannot read project Trash detail');
select is(coalesce((select array_agg(id order by id) from public.list_accessible_recordings_v1()),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 4: exact list set, no duplicates');
select is(coalesce((select array_agg(recording_id order by recording_id) from public.search_accessible_recordings_v1('common')),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 4: search same exact set');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1() where status<>'deleted'),3::bigint,'Actor 4: active facets equal list');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('common') where status<>'deleted'),3::bigint,'Actor 4: query facets equal search');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='deleted'),0::bigint,'Actor 4: separate custody Trash count');
select is((select count(*) from public.list_accessible_recordings_v1(p_status=>'deleted')),0::bigint,'Actor 4: explicit Trash list');
select is(coalesce((select array_agg(d.id order by d.id) from unnest(array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000007'::uuid,'31000000-0000-4000-8000-000000000008'::uuid,'31000000-0000-4000-8000-000000000009'::uuid]) requested(id) cross join lateral public.get_accessible_recording_v1(requested.id) d where d.status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 4: safe detail exact same active set');
select is(coalesce((select array_agg(id order by id) from public.recordings where status<>'deleted'),'{}'::uuid[]),array['31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000009'::uuid],'Actor 4: detail RLS same accessible set');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(coalesce((select array_agg(id order by id) from public.list_accessible_recordings_v1()),'{}'::uuid[]),'{}'::uuid[],'Actor 5: exact list set, no duplicates');
select is(coalesce((select array_agg(recording_id order by recording_id) from public.search_accessible_recordings_v1('common')),'{}'::uuid[]),'{}'::uuid[],'Actor 5: search same exact set');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1() where status<>'deleted'),0::bigint,'Actor 5: active facets equal list');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('common') where status<>'deleted'),0::bigint,'Actor 5: query facets equal search');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='deleted'),0::bigint,'Actor 5: separate custody Trash count');
select is((select count(*) from public.list_accessible_recordings_v1(p_status=>'deleted')),0::bigint,'Actor 5: explicit Trash list');
select is(coalesce((select array_agg(d.id order by d.id) from unnest(array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000007'::uuid,'31000000-0000-4000-8000-000000000008'::uuid,'31000000-0000-4000-8000-000000000009'::uuid]) requested(id) cross join lateral public.get_accessible_recording_v1(requested.id) d where d.status<>'deleted'),'{}'::uuid[]),'{}'::uuid[],'Actor 5: safe detail exact same active set');
select is(coalesce((select array_agg(id order by id) from public.recordings where status<>'deleted'),'{}'::uuid[]),'{}'::uuid[],'Actor 5: detail RLS same accessible set');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000006","role":"authenticated"}';
select is(coalesce((select array_agg(id order by id) from public.list_accessible_recordings_v1()),'{}'::uuid[]),'{}'::uuid[],'Actor 6: exact list set, no duplicates');
select is(coalesce((select array_agg(recording_id order by recording_id) from public.search_accessible_recordings_v1('common')),'{}'::uuid[]),'{}'::uuid[],'Actor 6: search same exact set');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1() where status<>'deleted'),0::bigint,'Actor 6: active facets equal list');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('common') where status<>'deleted'),0::bigint,'Actor 6: query facets equal search');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='deleted'),0::bigint,'Actor 6: separate custody Trash count');
select is((select count(*) from public.list_accessible_recordings_v1(p_status=>'deleted')),0::bigint,'Actor 6: explicit Trash list');
select is(coalesce((select array_agg(d.id order by d.id) from unnest(array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid,'31000000-0000-4000-8000-000000000003'::uuid,'31000000-0000-4000-8000-000000000004'::uuid,'31000000-0000-4000-8000-000000000005'::uuid,'31000000-0000-4000-8000-000000000006'::uuid,'31000000-0000-4000-8000-000000000007'::uuid,'31000000-0000-4000-8000-000000000008'::uuid,'31000000-0000-4000-8000-000000000009'::uuid]) requested(id) cross join lateral public.get_accessible_recording_v1(requested.id) d where d.status<>'deleted'),'{}'::uuid[]),'{}'::uuid[],'Actor 6: safe detail exact same active set');
select is(coalesce((select array_agg(id order by id) from public.recordings where status<>'deleted'),'{}'::uuid[]),'{}'::uuid[],'Actor 6: detail RLS same accessible set');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.search_accessible_recordings_v1('transcriptneedle')),1::bigint,'Shared reader searches latest transcript');
select is((select match_start_ms from public.search_accessible_recordings_v1('transcriptneedle')),100::bigint,'Equal-rank chunks choose earliest exact match');
select is((select match_end_ms from public.search_accessible_recordings_v1('transcriptneedle')),150::bigint,'Winning chunk retains end timestamp');
select ok((select matched_excerpt like '%[[H]]transcriptneedle[[/H]]%' from public.search_accessible_recordings_v1('transcriptneedle')),'SQL headline preserves match marker');
select is((select count(*) from public.search_accessible_recordings_v1('title6')),1::bigint,'Title remains independently searchable');
select is((select count(*) from public.search_accessible_recordings_v1('obsoleteword')),0::bigint,'Old transcript never contributes');
select is((select count(*) from public.search_accessible_recordings_v1('projectneedle')),2::bigint,'Member searches permitted project name');
select is((select count(*) from public.list_accessible_recordings_v1(p_project_id=>'21000000-0000-4000-8000-000000000001')),2::bigint,'Project filter includes shared accessible set');
select ok((select bool_and(client_id is null and folder_id is null and tag_ids is null and project_name='projectneedle') from public.list_accessible_recordings_v1()),'Non-owner personal taxonomy is null');
select is((select count(*) from public.search_accessible_recordings_v1('secretclient OR secretfolder OR secrettag')),0::bigint,'Private taxonomy cannot produce shared match');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('secretclient') where status<>'deleted'),0::bigint,'Private taxonomy cannot produce facet existence leak');
select ok((select bool_and(matched_excerpt !~ 'secretclient|secretfolder|secrettag') from public.search_accessible_recordings_v1('common')),'Shared excerpts contain no personal taxonomy');
select is((select count(*) from public.list_accessible_recordings_v1(p_client_id=>'22000000-0000-4000-8000-000000000001')),0::bigint,'Shared client filter cannot infer metadata');
select is((select count(*) from public.list_accessible_recordings_v1(p_folder_id=>'23000000-0000-4000-8000-000000000001')),0::bigint,'Shared folder filter cannot infer metadata');
select is((select count(*) from public.list_accessible_recordings_v1(p_tag_ids=>array['24000000-0000-4000-8000-000000000001'::uuid])),0::bigint,'Shared tag filter cannot infer metadata');
select is((select id from public.list_accessible_recordings_v1(p_limit=>1)),'31000000-0000-4000-8000-000000000006'::uuid,'Stable keyset first page for equal timestamps');
select is((select id from public.list_accessible_recordings_v1(p_before_created_at=>'2026-09-01T00:00:00Z',p_before_id=>'31000000-0000-4000-8000-000000000006',p_limit=>1)),'31000000-0000-4000-8000-000000000003'::uuid,'Stable keyset next boundary');
select is((select count(*) from public.list_accessible_recordings_v1(p_before_id=>'31000000-0000-4000-8000-000000000006')),0::bigint,'Incomplete keyset fails closed');
select is((select total_count from public.search_accessible_recordings_v1('common',p_limit=>1)),2::bigint,'Search total before limit');
select isnt((select recording_id from public.search_accessible_recordings_v1('common',p_limit=>1)),(select recording_id from public.search_accessible_recordings_v1('common',p_limit=>1,p_offset=>1)),'Search page boundary unique');
select is((select count(*) from public.list_accessible_recordings_v1(p_status=>'failed')),1::bigint,'Active status selector preserved');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='completed'),1::bigint,'Facets ignore active status selection');
select is((select total_count from public.count_accessible_recording_statuses_v1() where status='created'),0::bigint,'Absent active status returns zero');
select is((select count(*) from public.search_accessible_recordings_v1('   ')),0::bigint,'Empty search does not scan; caller uses list');
select ok((select bool_and(to_jsonb(r) - array['id','title','source_type','mime_type','duration_seconds','file_size_bytes','status','created_at','updated_at','client_id','project_id','folder_id','visibility','project_name','tag_ids'] = '{}'::jsonb) from public.list_accessible_recordings_v1() r),'Safe projection never includes protected/internal columns');
select throws_ok(format('select %I from public.recordings',name),'42501',null,'Protected direct column remains denied: '||name)
from unnest(array['user_id','storage_path','error_message','client_id','folder_id','project_id','created_by','metadata_search_vector','purge_claim_id','capture_request_fingerprint']) name;
select throws_ok($$select * from public.recordings$$,'42501',null,'No SELECT star recovery bypass');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok((select bool_and(client_id is null and folder_id is null and tag_ids is null) from public.list_accessible_recordings_v1()),'Exact selected never exposes personal metadata');
select ok((select bool_and(project_id='21000000-0000-4000-8000-000000000001' and project_name='projectneedle') from public.list_accessible_recordings_v1() where id<>'31000000-0000-4000-8000-000000000005'),'Exact selected permits its recording project label');
select ok((select project_id is null and project_name is null from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000005')),'Standalone selected has no project');
select is((select count(*) from public.search_accessible_recordings_v1('projectneedle')),2::bigint,'Exact selected searches only its permitted project labels');
select is((select count(*) from public.list_accessible_recordings_v1(p_project_id=>'21000000-0000-4000-8000-000000000001')),2::bigint,'Project filter returns only exact selected grants');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1(p_project_id=>'21000000-0000-4000-8000-000000000001')),2::bigint,'Exact selected project facets expose no extra rows');
select is((select count(*) from public.recording_projects),0::bigint,'Exact selected does not open general project inventory');
select ok(not public.can_read_recording_project('21000000-0000-4000-8000-000000000001'),'Recording label does not widen project RLS predicate');
select results_eq(
 $$select recording_id from public.search_accessible_recordings_v1('projectneedle')$$,
 $$values ('31000000-0000-4000-8000-000000000009'::uuid),('31000000-0000-4000-8000-000000000004'::uuid)$$,
 'Equal project ranks and timestamps order exact selected results by ID descending');
select is((select count(*) from public.search_accessible_recordings_v1('secretclient OR secretfolder OR secrettag')),0::bigint,'Exact selected cannot search author taxonomy');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('secrettag') where status<>'deleted'),0::bigint,'Exact selected has no private-taxonomy count oracle');

set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*) from public.search_accessible_recordings_v1('secretclient')),5::bigint,'Current owner retains client search on accessible rows');
select is((select count(*) from public.search_accessible_recordings_v1('secretfolder')),5::bigint,'Owner retains folder search');
select results_eq(
 $$select recording_id,total_count from public.search_accessible_recordings_v1('common',p_status=>'failed')$$,
 $$values ('31000000-0000-4000-8000-000000000006'::uuid,1::bigint)$$,
 'Search status selection constrains exact results and pre-page total');
select is((select count(*) from public.search_accessible_recordings_v1('common',p_status=>'deleted')),0::bigint,'Search never returns Trash');
select ok((select bool_and(matched_excerpt like '%[[H]]secretclient[[/H]]%') from public.search_accessible_recordings_v1('secretclient')),'Owner retains private taxonomy headline');
select is((select count(*) from public.search_accessible_recordings_v1('secrettag')),2::bigint,'Owner retains tag search');
select is((select count(*) from public.list_accessible_recordings_v1(p_tag_ids=>array['24000000-0000-4000-8000-000000000001'::uuid,'24000000-0000-4000-8000-000000000002'::uuid,'24000000-0000-4000-8000-000000000001'::uuid,null])),1::bigint,'ALL tags, duplicate/null normalization retained');
select is((select count(*) from public.search_accessible_recordings_v1('common',p_tag_ids=>array['24000000-0000-4000-8000-000000000001'::uuid,'24000000-0000-4000-8000-000000000002'::uuid])),1::bigint,'Search ALL tags');
select is((select total_count from public.count_accessible_recording_statuses_v1('common',p_tag_ids=>array['24000000-0000-4000-8000-000000000001'::uuid,'24000000-0000-4000-8000-000000000002'::uuid]) where status='completed'),1::bigint,'Facets ALL tags');
select is((select count(*) from public.list_accessible_recordings_v1(p_client_id=>'22000000-0000-4000-8000-000000000001',p_folder_id=>'23000000-0000-4000-8000-000000000001')),5::bigint,'Owner client/folder filters retained');
select is((select tag_ids from public.list_accessible_recordings_v1() where id='31000000-0000-4000-8000-000000000003'),array['24000000-0000-4000-8000-000000000001'::uuid,'24000000-0000-4000-8000-000000000002'::uuid],'Owner gets exact tags');
select ok(not exists(select 1 from public.list_accessible_recordings_v1() where id='31000000-0000-4000-8000-000000000009'),'Authorship is no selected bypass');
select is((select total_count from public.count_accessible_recording_statuses_v1('impossiblequery') where status='deleted'),1::bigint,'Trash count independent of active search');

set local request.jwt.claims = '{"role":"authenticated"}';
select is((select count(*) from public.list_accessible_recordings_v1()),0::bigint,'Null auth list fails closed');
select is((select count(*) from public.search_accessible_recordings_v1('common')),0::bigint,'Null auth search fails closed');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1()),0::bigint,'Null auth facets zero');
select is((select count(*) from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000003')),0::bigint,'Null auth detail fails closed');
reset role;
set local role anon;
select throws_ok($$select public.list_accessible_recordings_v1()$$,'42501',null,'Anonymous direct RPC denied');
reset role;
set local role service_role;
select throws_ok($$select public.list_accessible_recordings_v1()$$,'42501',null,'Service role cannot call session API directly');
reset role;
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),'No direct EXECUTE for '||role_name||': '||signature)
from unnest(array['anon','service_role']) role_name cross join unnest(array[
 'public.list_accessible_recordings_v1(uuid,uuid,uuid,uuid[],public.recording_status,timestamptz,uuid,integer)',
 'public.search_accessible_recordings_v1(text,uuid,uuid,uuid,uuid[],public.recording_status,integer,integer)',
 'public.count_accessible_recording_statuses_v1(text,uuid,uuid,uuid,uuid[])',
 'public.get_accessible_recording_v1(uuid)']) signature;
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),'Private helper denied for '||role_name||': '||signature)
from unnest(array['anon','authenticated','service_role']) role_name cross join unnest(array[
 'public.accessible_recording_rows_v1(uuid,uuid,uuid,uuid[],uuid,public.recording_status,boolean,timestamptz,uuid,integer)',
 'public.accessible_recording_search_winners_v1(text,uuid,uuid,uuid,uuid[],public.recording_status)']) signature;
-- Immediate revoke changes all read surfaces; technical authorship must not survive it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.revoke_project_member_v1('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002')$$,'Founder revokes author membership and selected grants');
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select array_agg(id order by id) from public.list_accessible_recordings_v1()),array['31000000-0000-4000-8000-000000000001'::uuid,'31000000-0000-4000-8000-000000000002'::uuid],'Revoked author keeps only private active content');
select is((select count(*) from public.search_accessible_recordings_v1('projectneedle')),0::bigint,'Revoked private author cannot infer formerly accessible project name');
select is((select sum(total_count)::bigint from public.count_accessible_recording_statuses_v1('common') where status<>'deleted'),2::bigint,'Revoke immediately changes query facets');
select is((select count(*) from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000003')),0::bigint,'Revoked author detail returns no row');
select ok((select project_id is null and project_name is null from public.get_accessible_recording_v1('31000000-0000-4000-8000-000000000002')),'Private-in-project owner cannot read revoked project metadata');
select throws_ok($$select project_id from public.recordings where id='31000000-0000-4000-8000-000000000002'$$,'42501',null,'Direct column cannot bypass revoked project mask');
select throws_ok($$select public.get_personal_recording_metadata_v1('31000000-0000-4000-8000-000000000002')$$,'42501',null,'Legacy owner JSON cannot bypass revoked project mask');
select throws_ok($$select created_by from public.recordings where id='31000000-0000-4000-8000-000000000002'$$,'42501',null,'Direct author UUID is not a public identity path');
reset role;
select * from finish();
rollback;
