-- Disposable database only, after the full migration chain including 20261103120000_db_performance_authz_paths.
-- Compares the optimized functions with verbatim copies of the previous implementations for every access path.
-- Not a runtime pass receipt for any live database.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Previous implementations, copied verbatim and renamed, live only inside this transaction.
create schema old_impl;
create function old_impl.can_read_recording_object(p_name text) returns boolean
language sql stable security definer set search_path = '' as $f$
  select exists(select 1 from public.recordings r where public.can_read_recording(r.id) and (
    p_name=r.storage_path or exists(select 1 from public.recording_live_part_registrations p
      where p.recording_id=r.id and p.storage_path=p_name and p.capture_request_id=r.capture_request_id)
    or (r.storage_path=r.user_id::text||'/'||r.id::text||'/live/'
      and left(p_name,length(r.storage_path))=r.storage_path
      and substring(p_name from length(r.storage_path)+1) ~ '^[A-Za-z0-9_-]+\.(webm|ogg|mp3|m4a|wav|mp4|flac)$')));
$f$;
create function old_impl.capabilities(p_recording_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $f$
  select jsonb_build_object('read',public.can_read_recording(r.id),
    'editTitle',public.can_edit_recording(r.id),'editSpeakers',public.can_edit_recording(r.id),
    'editTaskStatus',public.can_edit_recording(r.id),
    'manageAccess',public.can_manage_recording(r.id) and r.status<>'deleted',
    'delete',public.can_manage_recording(r.id) and r.status<>'deleted',
    'restore',public.can_manage_recording(r.id) and r.status='deleted',
    'purge',public.can_manage_recording(r.id) and r.status='deleted',
    'runPersonalAi',public.can_manage_recording(r.id) and r.user_id=auth.uid() and r.status<>'deleted',
    'usePrivateChat',public.can_manage_recording(r.id) and r.user_id=auth.uid() and r.status<>'deleted')
  from public.recordings r where r.id=p_recording_id and public.can_read_recording(r.id);
$f$;
create function old_impl.rows(p_client_id uuid, p_project_id uuid, p_folder_id uuid, p_tag_ids uuid[], p_recording_id uuid, p_status public.recording_status, p_include_deleted boolean, p_before_created_at timestamptz, p_before_id uuid, p_limit integer)
returns setof public.accessible_recording_row_v1
language sql stable security definer set search_path = '' as $f$
with actor as (
  select auth.uid() as id
), tag_filter as (
  select coalesce(array_agg(distinct tag_id order by tag_id)
    filter (where tag_id is not null), '{}'::uuid[]) as ids
  from unnest(coalesce(p_tag_ids,'{}'::uuid[])) as requested(tag_id)
), allowed as (
  select r.id, r.user_id, r.title, r.source_type, r.mime_type, r.duration_seconds,
    r.file_size_bytes, r.status, r.created_at, r.updated_at,
    r.client_id, r.project_id, r.folder_id, r.visibility,
    a.id as actor_id,
    (public.can_read_recording_project(r.project_id) or r.visibility='selected') as project_allowed
  from public.recordings r cross join actor a
  where a.id is not null and public.can_read_recording(r.id)
    and (p_recording_id is null or r.id=p_recording_id)
    and (p_status is null or r.status=p_status)
    and (p_include_deleted or r.status<>'deleted')
    and ((p_before_created_at is null and p_before_id is null)
      or (p_before_created_at is not null and p_before_id is not null
        and (r.created_at,r.id)<(p_before_created_at,p_before_id)))
    and (r.status<>'deleted' or public.can_manage_recording(r.id))
)
select r.id, r.title, r.source_type, r.mime_type, r.duration_seconds,
  r.file_size_bytes, r.status, r.created_at, r.updated_at,
  case when r.user_id=r.actor_id then r.client_id end,
  case when r.project_allowed then r.project_id end,
  case when r.user_id=r.actor_id then r.folder_id end,
  r.visibility, p.name,
  case when r.user_id=r.actor_id then array(
    select rtl.tag_id from public.recording_tag_links rtl
    where rtl.recording_id=r.id and rtl.user_id=r.actor_id order by rtl.tag_id
  ) end
from allowed r cross join tag_filter tf
left join public.recording_projects p on p.id=r.project_id and r.project_allowed
where (p_client_id is null or (r.user_id=r.actor_id and r.client_id=p_client_id))
  and (p_folder_id is null or (r.user_id=r.actor_id and r.folder_id=p_folder_id))
  and (p_project_id is null or (r.project_allowed and r.project_id=p_project_id))
  and (cardinality(tf.ids)=0 or (r.user_id=r.actor_id and (
    select count(distinct rtl.tag_id) from public.recording_tag_links rtl
    where rtl.recording_id=r.id and rtl.user_id=r.actor_id and rtl.tag_id=any(tf.ids)
  )=cardinality(tf.ids)))
order by r.created_at desc,r.id desc
limit p_limit;
$f$;

-- Symmetric difference size between old and new row sets for one argument combination.
create function old_impl.rows_diff(p_client_id uuid, p_project_id uuid, p_folder_id uuid, p_tag_ids uuid[], p_recording_id uuid, p_status public.recording_status, p_include_deleted boolean, p_before_created_at timestamptz, p_before_id uuid, p_limit integer)
returns bigint language sql stable as $f$
  select count(*) from (
    (select * from public.accessible_recording_rows_v1(p_client_id,p_project_id,p_folder_id,p_tag_ids,p_recording_id,p_status,p_include_deleted,p_before_created_at,p_before_id,p_limit)
     except select * from old_impl.rows(p_client_id,p_project_id,p_folder_id,p_tag_ids,p_recording_id,p_status,p_include_deleted,p_before_created_at,p_before_id,p_limit))
    union all
    (select * from old_impl.rows(p_client_id,p_project_id,p_folder_id,p_tag_ids,p_recording_id,p_status,p_include_deleted,p_before_created_at,p_before_id,p_limit)
     except select * from public.accessible_recording_rows_v1(p_client_id,p_project_id,p_folder_id,p_tag_ids,p_recording_id,p_status,p_include_deleted,p_before_created_at,p_before_id,p_limit))
  ) d;
$f$;

-- Switches the JWT subject (transaction-local) and reports every observable difference for that actor.
create function old_impl.mismatches(p_user uuid) returns text[] language plpgsql as $f$
declare
  v_out text[] := '{}'; v_id uuid; v_name text; v_n bigint; v_has_old boolean; v_has_new boolean;
  v_new_batch jsonb; v_ids uuid[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  -- Row sets for all filter combinations the app uses.
  for v_n in select old_impl.rows_diff(null,null,null,'{}',null,null,true,null,null,1000) loop if v_n<>0 then v_out:=array_append(v_out,('rows all')::text); end if; end loop;
  for v_n in select old_impl.rows_diff(null,null,null,'{}',null,null,false,null,null,null) loop if v_n<>0 then v_out:=array_append(v_out,('rows active nolimit')::text); end if; end loop;
  for v_n in select old_impl.rows_diff(null,null,null,'{}',null,'completed',false,null,null,100) loop if v_n<>0 then v_out:=array_append(v_out,('rows completed')::text); end if; end loop;
  for v_n in select old_impl.rows_diff(null,null,null,'{}',null,'deleted',true,null,null,100) loop if v_n<>0 then v_out:=array_append(v_out,('rows deleted')::text); end if; end loop;
  for v_n in select old_impl.rows_diff(null,'52000000-0000-4000-8000-000000000001',null,'{}',null,null,true,null,null,100) loop if v_n<>0 then v_out:=array_append(v_out,('rows project')::text); end if; end loop;
  for v_n in select old_impl.rows_diff('53000000-0000-4000-8000-000000000001',null,'54000000-0000-4000-8000-000000000001','{}',null,null,true,null,null,100) loop if v_n<>0 then v_out:=array_append(v_out,('rows client folder')::text); end if; end loop;
  for v_n in select old_impl.rows_diff(null,null,null,array['55000000-0000-4000-8000-000000000001']::uuid[],null,null,true,null,null,100) loop if v_n<>0 then v_out:=array_append(v_out,('rows tag')::text); end if; end loop;
  for v_n in select old_impl.rows_diff(null,null,null,'{}',null,null,true,'2026-09-01T07:00:00Z','56000000-0000-4000-8000-000000000008',100) loop if v_n<>0 then v_out:=array_append(v_out,('rows page')::text); end if; end loop;
  for v_id in select id from public.recordings union all select '56000000-0000-4000-8000-0000000000ff' loop
    for v_n in select old_impl.rows_diff(null,null,null,'{}',v_id,null,true,null,null,1) loop if v_n<>0 then v_out:=array_append(v_out,(('rows id '||v_id))::text); end if; end loop;
    -- Capabilities: identical JSON or both absent.
    v_has_old := old_impl.capabilities(v_id) is not null; v_has_new := public.recording_capabilities_v1(v_id) is not null;
    if v_has_old<>v_has_new or old_impl.capabilities(v_id) is distinct from public.recording_capabilities_v1(v_id) then v_out:=array_append(v_out,(('caps '||v_id))::text); end if;
  end loop;
  -- Batch equals the old per-id results (including absent rows) and does not invent rows.
  select array_agg(id) into v_ids from (select id from public.recordings union all select '56000000-0000-4000-8000-0000000000ff') x;
  if (select count(*) from (
        (select recording_id, capabilities from public.recording_capabilities_batch_v1(v_ids)
         except select i, old_impl.capabilities(i) from unnest(v_ids) i where old_impl.capabilities(i) is not null)
        union all
        (select i, old_impl.capabilities(i) from unnest(v_ids) i where old_impl.capabilities(i) is not null
         except select recording_id, capabilities from public.recording_capabilities_batch_v1(v_ids))) d)<>0 then
    v_out:=array_append(v_out,('caps batch')::text);
  end if;
  -- Storage object names: every known path, shape variants and garbage that must not raise.
  for v_name in select n from (
      select storage_path n from public.recordings where storage_path is not null
      union select storage_path from public.recording_live_part_registrations
      union select r.user_id||'/'||r.id||'/live/part-000099.webm' from public.recordings r
      union select r.user_id||'/'||r.id||'/live/part-000000.exe' from public.recordings r
      union select r.user_id||'/'||r.id||'/live/nested/part.webm' from public.recordings r
      union select r.user_id||'/'||r.id||'/audio.webm' from public.recordings r
      union select r.user_id||'/'||upper(r.id::text)||'/live/part-000000.webm' from public.recordings r
      union select r.user_id||'/'||r.id from public.recordings r
      union select unnest(array['','a','a/b','a/not-a-uuid/x','/','//','a/56000000-0000-4000-8000-0000000000ff/x',
        'a/56000000-0000-4000-8000-00000000000z/live/part-000000.webm'])
    ) names where n is not null loop
    if old_impl.can_read_recording_object(v_name) is distinct from public.can_read_recording_object_v1(v_name) then
      v_out:=array_append(v_out,(('object '||v_name))::text);
    end if;
  end loop;
  return v_out;
end;
$f$;

-- Fixture: users, project, org objects, recordings for every access path, grants, team scope, live parts.
insert into auth.users(id,email) values
 ('51000000-0000-4000-8000-000000000001','founder@perf.test'),('51000000-0000-4000-8000-000000000002','editor@perf.test'),
 ('51000000-0000-4000-8000-000000000003','reader@perf.test'),('51000000-0000-4000-8000-000000000004','selected@perf.test'),
 ('51000000-0000-4000-8000-000000000005','outsider@perf.test'),('51000000-0000-4000-8000-000000000006','revoked@perf.test'),
 ('51000000-0000-4000-8000-000000000007','teamclient@perf.test'),('51000000-0000-4000-8000-000000000008','teamfolder@perf.test'),
 ('51000000-0000-4000-8000-000000000009','teamproject@perf.test'),('51000000-0000-4000-8000-000000000010','teamfolderproject@perf.test');
insert into public.recording_projects(id,user_id,name) values ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','perfproject');
insert into public.recording_clients(id,user_id,name) values ('53000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','perfclient');
insert into public.recording_folders(id,user_id,name) values ('54000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','perffolder');
insert into public.recording_tags(id,user_id,name) values ('55000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','perftag');
insert into public.recording_project_members(project_id,user_id,role,revoked_at) values
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','editor',null),
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003','reader',null),
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000006','reader',now());
insert into vosio_team_private.installation_administrators(user_id) values ('51000000-0000-4000-8000-000000000001');
insert into vosio_team_private.scope_grants(grantor_id,user_id,scope_kind,client_id,folder_id,project_id,role) values
 ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000007','client','53000000-0000-4000-8000-000000000001',null,null,'reader'),
 ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000008','folder',null,'54000000-0000-4000-8000-000000000001',null,'editor'),
 ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000009','client','53000000-0000-4000-8000-000000000001',null,'52000000-0000-4000-8000-000000000001','reader'),
 ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000010','folder',null,'54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','editor');
-- A revoked team grant must grant nothing (outsider U5 gets client and folder grants that are already revoked).
insert into vosio_team_private.scope_grants(grantor_id,user_id,scope_kind,client_id,folder_id,project_id,role,revoked_at) values
 ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000005','client','53000000-0000-4000-8000-000000000001',null,null,'reader',now()),
 ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000005','folder',null,'54000000-0000-4000-8000-000000000001',null,'reader',now());
insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status,created_at,client_id,folder_id,storage_path,capture_request_id) values
 ('56000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','R1 private standalone','upload',null,'private','completed','2026-09-01T00:00:00Z',null,null,null,null),
 ('56000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','R2 project','upload','52000000-0000-4000-8000-000000000001','project','completed','2026-09-01T01:00:00Z',null,null,null,null),
 ('56000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','R3 selected in project','upload','52000000-0000-4000-8000-000000000001','selected','completed','2026-09-01T02:00:00Z',null,null,null,null),
 ('56000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R4 selected standalone','upload',null,'selected','completed','2026-09-01T03:00:00Z',null,null,null,null),
 ('56000000-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','R5 private in project','upload','52000000-0000-4000-8000-000000000001','private','completed','2026-09-01T04:00:00Z',null,null,null,null),
 ('56000000-0000-4000-8000-000000000006','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','R6 project trash','upload','52000000-0000-4000-8000-000000000001','project','completed','2026-09-01T05:00:00Z',null,null,null,null),
 ('56000000-0000-4000-8000-000000000007','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R7 team client standalone','upload',null,'selected','completed','2026-09-01T06:00:00Z','53000000-0000-4000-8000-000000000001',null,null,null),
 ('56000000-0000-4000-8000-000000000008','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R8 team folder in project','upload','52000000-0000-4000-8000-000000000001','project','completed','2026-09-01T07:00:00Z',null,'54000000-0000-4000-8000-000000000001',null,null),
 ('56000000-0000-4000-8000-000000000009','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R9 team client in project','upload','52000000-0000-4000-8000-000000000001','project','completed','2026-09-01T08:00:00Z','53000000-0000-4000-8000-000000000001',null,null,null),
 ('56000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R10 private with client','upload',null,'private','completed','2026-09-01T09:00:00Z','53000000-0000-4000-8000-000000000001',null,null,null),
 ('56000000-0000-4000-8000-000000000011','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R11 live private','in_app_recording','52000000-0000-4000-8000-000000000001','private','created','2026-09-01T10:00:00Z',null,null,'51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000011/live/','57000000-0000-4000-8000-000000000011'),
 ('56000000-0000-4000-8000-000000000012','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R12 live shared main','in_app_recording','52000000-0000-4000-8000-000000000001','project','completed','2026-09-01T11:00:00Z',null,null,'51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000012/main.webm','57000000-0000-4000-8000-000000000012'),
 ('56000000-0000-4000-8000-000000000013','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','R13 private with main','upload',null,'private','completed','2026-09-01T12:00:00Z',null,null,'51000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000013/audio.webm',null),
 ('56000000-0000-4000-8000-000000000014','51000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','R14 shared live prefix','in_app_recording','52000000-0000-4000-8000-000000000001','project','created','2026-09-01T13:00:00Z',null,null,'51000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000014/live/','57000000-0000-4000-8000-000000000014'),
 ('56000000-0000-4000-8000-000000000015','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R15 deleted with client and folder','upload','52000000-0000-4000-8000-000000000001','project','completed','2026-09-01T14:00:00Z','53000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',null,null),
 ('56000000-0000-4000-8000-000000000016','51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','R16 private with client and folder','upload',null,'private','completed','2026-09-01T15:00:00Z','53000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',null,null);
update public.recordings set status='deleted' where id in ('56000000-0000-4000-8000-000000000006','56000000-0000-4000-8000-000000000015');
insert into public.recording_tag_links(recording_id,user_id,tag_id) values
 ('56000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000001');
insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id,revoked_at) values
 ('56000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','reader','52000000-0000-4000-8000-000000000001',null),
 ('56000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000006','reader','52000000-0000-4000-8000-000000000001',now()),
 ('56000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000004','editor',null,null);
-- Registered live parts: matching capture id, plus one with a mismatching capture id.
insert into public.recording_live_part_registrations(recording_id,capture_request_id,storage_path,part_index,mime_type,file_size_bytes) values
 ('56000000-0000-4000-8000-000000000011','57000000-0000-4000-8000-000000000011','51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000011/live/part-000000.webm',0,'audio/webm',10),
 ('56000000-0000-4000-8000-000000000012','57000000-0000-4000-8000-000000000012','51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000012/live/part-000000.webm',0,'audio/webm',10),
 ('56000000-0000-4000-8000-000000000012','57000000-0000-4000-8000-0000000000ee','51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000012/live/part-000001.webm',1,'audio/webm',10),
 ('56000000-0000-4000-8000-000000000014','57000000-0000-4000-8000-000000000014','51000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000014/live/part-000000.webm',0,'audio/webm',10);

-- Catalog contract: signatures, security attributes and ACL of the touched functions.
select ok(to_regprocedure('public.recording_capabilities_batch_v1(uuid[])') is not null,'Batch capabilities RPC exists');
select ok(p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""'],'Stable definer with empty search_path: '||p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('can_read_recording_object_v1','recording_capabilities_v1','recording_capabilities_batch_v1','accessible_recording_rows_v1');
select ok(has_function_privilege('authenticated','public.recording_capabilities_batch_v1(uuid[])','execute')
  and not has_function_privilege('anon','public.recording_capabilities_batch_v1(uuid[])','execute'),'Batch RPC is authenticated-only');
select ok(not has_function_privilege('authenticated','public.accessible_recording_rows_v1(uuid,uuid,uuid,uuid[],uuid,public.recording_status,boolean,timestamptz,uuid,integer)','execute'),'Rows helper stays internal');

-- Fixture sanity: the access paths below really grant what the comparison relies on.
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000007',true);
select ok(public.can_read_recording('56000000-0000-4000-8000-000000000007') and public.can_read_recording('56000000-0000-4000-8000-000000000009')
  and not public.can_read_recording('56000000-0000-4000-8000-000000000010'),'Team client scope reads shared client recordings only');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000008',true);
select ok(public.can_read_recording('56000000-0000-4000-8000-000000000008'),'Team folder scope reads folder recording');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000010","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000010',true);
select ok(public.can_read_recording('56000000-0000-4000-8000-000000000008') and not public.can_read_recording('56000000-0000-4000-8000-000000000015')
  and not public.can_read_recording('56000000-0000-4000-8000-000000000016'),'Project-scoped team folder grant reads shared folder recording, not deleted or private ones');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000005',true);
select ok(not public.can_read_recording('56000000-0000-4000-8000-000000000007') and not public.can_read_recording('56000000-0000-4000-8000-000000000008'),'Revoked team grants read nothing');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000004',true);
select ok(public.can_read_recording('56000000-0000-4000-8000-000000000003') and public.can_read_recording('56000000-0000-4000-8000-000000000004'),'Selected grants read');

-- Equivalence for every actor (each access path plus outsider/revoked); empty array means identical behavior.
select is(old_impl.mismatches(u.id),'{}'::text[],'Old and new behavior identical for '||u.email)
from auth.users u where u.email like '%@perf.test' order by u.id;
-- Anonymous caller: nothing readable, old and new agree.
select set_config('request.jwt.claims','{"role":"anon"}',true);
select set_config('request.jwt.claim.sub','',true);
select is((select count(*) from public.accessible_recording_rows_v1(null,null,null,'{}',null,null,true,null,null,100)),0::bigint,'No rows without auth.uid()');
select is((select count(*) from public.recording_capabilities_batch_v1(array(select id from public.recordings))),0::bigint,'Batch empty without auth.uid()');

-- Behavioral contract of the new path-shape handling and batch limits.
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select is(public.can_read_recording_object_v1('not-a-path/xx/yy'),false,'Invalid path is false, not a cast error');
select is(public.can_read_recording_object_v1('a/56000000-0000-4000-8000-00000000000z/live/part-000000.webm'),false,'Malformed uuid segment is false');
select is(public.can_read_recording_object_v1(null),false,'Null name is false');
select is(public.can_read_recording_object_v1('51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000012/live/part-000001.webm'),false,'Live part with another capture_request_id is false');
select is(public.can_read_recording_object_v1('51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000012/live/part-000000.webm'),true,'Registered live part with matching capture id is readable');
select is(public.can_read_recording_object_v1('51000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000014/live/anything-1.webm'),true,'Live prefix with allowed extension is readable by a project member');
select is(public.can_read_recording_object_v1('51000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000014/live/anything-1.exe'),false,'Live prefix with disallowed extension is false');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000005',true);
select is(public.can_read_recording_object_v1('51000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000013/audio.webm'),false,'Foreign private object is not readable');
select throws_ok($$select * from public.recording_capabilities_batch_v1(array(select gen_random_uuid() from generate_series(1,1001)))$$,'22023',null,'Batch rejects more than 1000 ids');
select lives_ok($$select * from public.recording_capabilities_batch_v1(array(select gen_random_uuid() from generate_series(1,1000)))$$,'Batch accepts exactly 1000 ids');
select is((select count(*) from public.recording_capabilities_batch_v1(null)),0::bigint,'Null id array returns no rows');

-- Policy wiring: storage.objects SELECT goes through the optimized helper for a real authenticated role.
insert into storage.buckets(id,name) values ('recordings','recordings') on conflict (id) do nothing;
insert into storage.objects(bucket_id,name) values
 ('recordings','51000000-0000-4000-8000-000000000002/56000000-0000-4000-8000-000000000013/audio.webm'),
 ('recordings','51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000012/main.webm');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000003',true);
select is((select array_agg(name order by name) from storage.objects where bucket_id='recordings'),
  array['51000000-0000-4000-8000-000000000001/56000000-0000-4000-8000-000000000012/main.webm'],'Project reader sees only the shared recording object');
reset role;

-- Policies: after undoing the (select auth.uid()) wrapper the whole predicate must equal the original text (whitespace-normalized),
-- and no bare auth.uid() may remain.
with expected(policyname,qual,with_check) as (values
 ('recordings update private owner','((user_id = auth.uid()) AND ((visibility = ''private''::text) OR (project_id IS NULL)))','((user_id = auth.uid()) AND ((visibility = ''private''::text) OR (project_id IS NULL)))'),
 ('recordings insert private',null,'((user_id = auth.uid()) AND (created_by = auth.uid()) AND (visibility = ''private''::text) AND (capture_request_id IS NULL) AND (capture_request_fingerprint IS NULL) AND (project_id IS NULL) AND (storage_path IS NULL))'),
 ('transcription jobs private metadata','((user_id = auth.uid()) AND can_read_recording(recording_id))',null),
 ('ai jobs private metadata','((user_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM transcripts t WHERE ((t.id = ai_processing_jobs.transcript_id) AND can_read_recording(t.recording_id)))))',null),
 ('transcript chat threads current personal access','((user_id = auth.uid()) AND can_read_recording(recording_id))',null),
 ('transcript chat turns current personal access','((user_id = auth.uid()) AND can_read_recording(recording_id))',null),
 ('recording markers insert capture',null,'((user_id = auth.uid()) AND can_write_recording_capture_v1(recording_id))'),
 ('recording markers update private','((user_id = auth.uid()) AND can_manage_recording(recording_id))','((user_id = auth.uid()) AND can_manage_recording(recording_id))'),
 ('members read self or founder','((user_id = auth.uid()) OR is_recording_project_founder_v1(project_id))',null),
 ('grants read self or manager','((user_id = auth.uid()) OR can_manage_recording(recording_id))',null)
), norm as (
  select e.policyname,
    regexp_replace(replace(p.qual,'( SELECT auth.uid() AS uid)','auth.uid()'),'\s+',' ','g') as qual,
    regexp_replace(replace(p.with_check,'( SELECT auth.uid() AS uid)','auth.uid()'),'\s+',' ','g') as with_check,
    position('auth.uid()' in replace(coalesce(p.qual,'')||coalesce(p.with_check,''),'( SELECT auth.uid() AS uid)',''))=0 as no_bare,
    e.qual as expected_qual, e.with_check as expected_with_check
  from expected e join pg_policies p on p.schemaname='public' and p.policyname=e.policyname
)
select ok(qual is not distinct from expected_qual and with_check is not distinct from expected_with_check and no_bare,
  'Full predicate unchanged and initplan-wrapped: '||policyname) from norm;
select is((select count(*) from pg_policies where schemaname='public' and policyname in ('recordings update private owner','recordings insert private',
 'transcription jobs private metadata','ai jobs private metadata','transcript chat threads current personal access',
 'transcript chat turns current personal access','recording markers insert capture','recording markers update private',
 'members read self or founder','grants read self or manager') and roles='{authenticated}'),10::bigint,'All ten policies still target authenticated');

-- Role is resolved exactly once per recording: wrap the real role function in a counter (rolled back with the transaction).
alter function public.recording_access_role_v1(uuid) rename to recording_access_role_v1_real;
create function public.recording_access_role_v1(p_recording_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $f$
begin
  perform set_config('perf.role_calls',(coalesce(nullif(current_setting('perf.role_calls',true),''),'0')::int+1)::text,true);
  return public.recording_access_role_v1_real(p_recording_id);
end;
$f$;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
select set_config('perf.role_calls','0',true);
select count(*) as batch_rows from public.recording_capabilities_batch_v1(array(select id from public.recordings));
select is(current_setting('perf.role_calls')::int,(select count(*)::int from public.recordings),'Batch resolves the role exactly once per recording');
select set_config('perf.role_calls','0',true);
select public.recording_capabilities_v1('56000000-0000-4000-8000-000000000002');
select is(current_setting('perf.role_calls')::int,1,'Single capabilities call resolves the role exactly once');

-- Index changes: redundant ones gone, covering ones present.
select ok(to_regclass('public.transcripts_recording_idx') is null and to_regclass('public.transcripts_user_recording_created_idx') is null,'Redundant transcript indexes dropped');
select ok(to_regclass('public.transcripts_recording_user_idx') is not null and to_regclass('public.transcripts_user_recording_latest_idx') is not null,'Covering transcript indexes remain');
select ok(to_regclass(i) is not null,'Index exists: '||i) from unnest(array['transcript_tasks_transcript_user_idx','transcript_decisions_transcript_user_idx',
 'transcript_risks_transcript_user_idx','transcript_chapters_transcript_user_idx','transcript_search_chunks_transcript_owner_idx',
 'transcript_search_chunks_user_idx','recordings_client_user_idx','recordings_folder_user_idx']) i;
select finish();
rollback;
