-- psql --set ON_ERROR_STOP=1 --file supabase/tests/project_sharing_upgrade_rollback.sql
-- DISPOSABLE DB ONLY. Start from the complete chain through 20260828131010, without sharing.
-- No reset/drop of any existing database is part of this rehearsal.
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local role service_role;
insert into auth.users(id,email) values('90000000-0000-4000-8000-000000000001','upgrade@sharing.test');
insert into public.recording_clients(id,user_id,name) values
 ('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','Legacy client');
insert into public.recording_projects(id,user_id,client_id,name) values
 ('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','Legacy project');
insert into public.recordings(id,user_id,title,source_type,project_id,client_id,storage_path) values
 ('90000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000001','Legacy recording','upload','90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000004/audio.mp3');
update public.recordings set status='deleted' where id='90000000-0000-4000-8000-000000000004';
reset role;
-- Drain seed FK events before the migration's ALTER TABLE, just as committed legacy data does.
set constraints all immediate;
create temporary table sharing_upgrade_snapshot as select to_jsonb(r) as payload from public.recordings r where id='90000000-0000-4000-8000-000000000004';
savepoint before_sharing_migration;
\ir ../migrations/20260922190000_add_project_sharing.sql
select is((select visibility from public.recordings where id='90000000-0000-4000-8000-000000000004'),'private','Upgrade keeps legacy project recordings private');
select is((select to_jsonb(r)-'visibility'-'created_by'-'capture_request_id'-'capture_request_fingerprint' from public.recordings r where id='90000000-0000-4000-8000-000000000004'),
 (select payload from sharing_upgrade_snapshot),'Upgrade preserves all legacy fields including Trash and timestamps');
select is((select count(*) from public.recording_access_grants),0::bigint,'Upgrade creates no retrospective access');
select * from finish();
rollback to savepoint before_sharing_migration;
-- These plain assertions survive the pgTAP bookkeeping rollback and fail psql on mismatch.
do $$
begin
  if to_regclass('public.recording_access_grants') is not null
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='recordings' and column_name='visibility')
    or (select to_jsonb(r) from public.recordings r where id='90000000-0000-4000-8000-000000000004') is distinct from (select payload from sharing_upgrade_snapshot) then
    raise exception 'sharing migration rollback did not restore baseline';
  end if;
end;
$$;
rollback;
