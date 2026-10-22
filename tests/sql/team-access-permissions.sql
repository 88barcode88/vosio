-- Synthetic data ONLY. Run after all team forwards on an owned disposable database, never a live target.
begin;
create function pg_temp.team_assert(p_ok boolean,p_label text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'team proof failed: %',p_label; end if; end;
$$;

insert into auth.users(id,email,email_confirmed_at) select ('a0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'team-'||n||'@proof.invalid',now() from generate_series(1,6) n;
insert into auth.sessions(id,user_id) select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('a0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
insert into vosio_team_private.installation_administrators(user_id) values('a0000000-0000-4000-8000-000000000001');
insert into public.recording_clients(id,user_id,name) values
 ('c0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000001','Admin client'),
 ('c0000000-0000-4000-8000-000000000022','a0000000-0000-4000-8000-000000000002','Founder A client'),
 ('c0000000-0000-4000-8000-000000000023','a0000000-0000-4000-8000-000000000003','Founder B client');
insert into public.recording_folders(id,user_id,name) values
 ('c0000000-0000-4000-8000-000000000031','a0000000-0000-4000-8000-000000000001','Admin folder'),
 ('c0000000-0000-4000-8000-000000000032','a0000000-0000-4000-8000-000000000002','Founder A folder');
insert into public.recording_projects(id,user_id,client_id,name) values
 ('c0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000021','Admin project'),
 ('c0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000022','Founder A project'),
 ('c0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000023','Founder B project');
insert into public.recording_project_members(project_id,user_id,role) values
 ('c0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000005','reader'),
 ('c0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000004','reader');
insert into vosio_team_private.contacts(owner_id,user_id) values('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000005');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,client_id,project_id,folder_id) values
 ('d0000000-0000-4000-8000-000000000041','a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Private must stay private','upload','completed','private','c0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031'),
 ('d0000000-0000-4000-8000-000000000042','a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Current selected','upload','completed','selected','c0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031'),
 ('d0000000-0000-4000-8000-000000000043','a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Project and exact','upload','completed','project','c0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000011',null),
 ('d0000000-0000-4000-8000-000000000044','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','Founder A selected','upload','completed','selected','c0000000-0000-4000-8000-000000000022','c0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000032'),
 ('d0000000-0000-4000-8000-000000000045','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000003','Founder B selected','upload','completed','selected','c0000000-0000-4000-8000-000000000023','c0000000-0000-4000-8000-000000000013',null);

-- Content stays owned by its author; the recipient must reach it through installed RLS, not owner equality.
update public.recordings set storage_path=user_id::text||'/'||id::text||'/audio.webm'
  where id in ('d0000000-0000-4000-8000-000000000041','d0000000-0000-4000-8000-000000000042');
insert into public.transcripts(id,recording_id,user_id,raw_text,completion_generation_key) values
 ('e0000000-0000-4000-8000-000000000041','d0000000-0000-4000-8000-000000000041','a0000000-0000-4000-8000-000000000001','Synthetic private transcript','proof:team-private'),
 ('e0000000-0000-4000-8000-000000000042','d0000000-0000-4000-8000-000000000042','a0000000-0000-4000-8000-000000000001','Synthetic scoped transcript','proof:team-scoped');
insert into public.ai_processing_jobs(id,transcript_id,user_id,provider,model,processing_type,status,prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact) values
 ('f0000000-0000-4000-8000-000000000041','e0000000-0000-4000-8000-000000000041','a0000000-0000-4000-8000-000000000001','openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true),
 ('f0000000-0000-4000-8000-000000000042','e0000000-0000-4000-8000-000000000042','a0000000-0000-4000-8000-000000000001','openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true);
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text) values
 ('f1000000-0000-4000-8000-000000000041','f0000000-0000-4000-8000-000000000041','e0000000-0000-4000-8000-000000000041','a0000000-0000-4000-8000-000000000001','Synthetic private AI output'),
 ('f1000000-0000-4000-8000-000000000042','f0000000-0000-4000-8000-000000000042','e0000000-0000-4000-8000-000000000042','a0000000-0000-4000-8000-000000000001','Synthetic scoped AI output');
insert into storage.objects(bucket_id,name,owner,metadata) values
 ('recordings','a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000041/audio.webm','a0000000-0000-4000-8000-000000000001','{"size":10,"mimetype":"audio/webm"}'),
 ('recordings','a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000042/audio.webm','a0000000-0000-4000-8000-000000000001','{"size":10,"mimetype":"audio/webm"}'),
 ('recordings','a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000042/unbound.webm','a0000000-0000-4000-8000-000000000001','{"size":10,"mimetype":"audio/webm"}');

set role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"b0000000-0000-4000-8000-000000000001"}',true);
select pg_temp.team_assert(public.team_authority_v1()='installation_admin','explicit admin registry');
select pg_temp.team_assert(not public.can_read_recording('d0000000-0000-4000-8000-000000000045'),'admin has no foreign content bypass');
select pg_temp.team_assert(not exists(select 1 from jsonb_array_elements(public.team_workspace_v1()->'people') p where p->>'userId'='a0000000-0000-4000-8000-000000000006'),'not an Auth directory');
select public.set_team_access_v1('client','c0000000-0000-4000-8000-000000000021',null,'a0000000-0000-4000-8000-000000000005','reader');
select public.set_team_access_v1('folder','c0000000-0000-4000-8000-000000000031',null,'a0000000-0000-4000-8000-000000000005','editor');
select public.set_team_access_v1('recording','d0000000-0000-4000-8000-000000000043','c0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000005','editor');
reset role;
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,client_id) values('d0000000-0000-4000-8000-000000000046','a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Future matching','upload','completed','selected','c0000000-0000-4000-8000-000000000021');

set role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000005","session_id":"b0000000-0000-4000-8000-000000000005"}',true);
select pg_temp.team_assert(public.can_read_recording('d0000000-0000-4000-8000-000000000042'),'current client scope');
select pg_temp.team_assert(public.can_edit_recording('d0000000-0000-4000-8000-000000000042'),'stronger folder editor');
select pg_temp.team_assert(public.can_read_recording('d0000000-0000-4000-8000-000000000046'),'future client scope');
select pg_temp.team_assert(not public.can_read_recording('d0000000-0000-4000-8000-000000000041'),'all private excluded');
select pg_temp.team_assert(not public.can_manage_recording('d0000000-0000-4000-8000-000000000042'),'scope editor cannot manage');
select pg_temp.team_assert((select count(*)=0 from public.recordings where id='d0000000-0000-4000-8000-000000000041'),'private RLS actual role');
select pg_temp.team_assert((select count(*)=1 from public.recordings where id='d0000000-0000-4000-8000-000000000042'),'current scope RLS actual role');
select pg_temp.team_assert((select count(*)=1 from public.transcripts where id='e0000000-0000-4000-8000-000000000042'),'scope transcript RLS actual recipient');
select pg_temp.team_assert((select count(*)=0 from public.transcripts where id='e0000000-0000-4000-8000-000000000041'),'private transcript RLS excluded');
select pg_temp.team_assert((select count(*)=1 from public.ai_outputs where id='f1000000-0000-4000-8000-000000000042'),'scope AI output RLS actual recipient');
select pg_temp.team_assert((select count(*)=0 from public.ai_outputs where id='f1000000-0000-4000-8000-000000000041'),'private AI output RLS excluded');
select pg_temp.team_assert((select count(*)=0 from public.ai_processing_jobs where id='f0000000-0000-4000-8000-000000000042'),'shared output does not expose personal provider job');
select pg_temp.team_assert((select count(*)=1 from storage.objects where bucket_id='recordings' and name='a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000042/audio.webm'),'scope exact storage object RLS actual recipient');
select pg_temp.team_assert((select count(*)=0 from storage.objects where bucket_id='recordings' and name='a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000041/audio.webm'),'private storage object RLS excluded');
select pg_temp.team_assert((select count(*)=0 from storage.objects where bucket_id='recordings' and name='a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000042/unbound.webm'),'same-prefix unbound storage sibling excluded');
do $$ begin perform public.team_workspace_v1(); raise exception 'ordinary recipient unexpectedly listed team'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.set_team_access_v1('client','c0000000-0000-4000-8000-000000000021',null,'a0000000-0000-4000-8000-000000000006','editor'); raise exception 'ordinary recipient unexpectedly changed team'; exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000002","session_id":"b0000000-0000-4000-8000-000000000002"}',true);
select pg_temp.team_assert(public.team_authority_v1()='project_founder','founder without admin');
select pg_temp.team_assert(not exists(select 1 from jsonb_array_elements(public.team_workspace_v1()->'scopes') s where s->>'projectId'='c0000000-0000-4000-8000-000000000013'),'founder A cannot list B');
do $$ begin perform public.set_team_access_v1('project','c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000005','editor'); raise exception 'foreign project unexpectedly changed'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.set_team_access_v1('client','c0000000-0000-4000-8000-000000000022',null,'a0000000-0000-4000-8000-000000000005','editor'); raise exception 'founder unexpectedly granted unbounded client'; exception when insufficient_privilege then null; end $$;
select public.set_team_access_v1('client','c0000000-0000-4000-8000-000000000022','c0000000-0000-4000-8000-000000000012','a0000000-0000-4000-8000-000000000005','reader');

-- Scope invitation uses the same existing token protocol; pending is never an access grant.
select public.create_team_scope_invitation_v1(repeat('a',64),'team-6@proof.invalid','reader','folder','c0000000-0000-4000-8000-000000000012','{}',now()+interval '1 day','c0000000-0000-4000-8000-000000000032');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000006',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000006","session_id":"b0000000-0000-4000-8000-000000000006"}',true);
select pg_temp.team_assert(not public.can_read_recording('d0000000-0000-4000-8000-000000000044'),'pending invite grants no content');
select public.accept_recording_invitation_v1(repeat('a',64));
select pg_temp.team_assert(public.can_read_recording('d0000000-0000-4000-8000-000000000044'),'accepted folder grants content');

select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"b0000000-0000-4000-8000-000000000001"}',true);
select public.create_recording_invitation_v1(repeat('b',64),'team-6@proof.invalid','reader','recordings','c0000000-0000-4000-8000-000000000011',array['d0000000-0000-4000-8000-000000000043'::uuid],now()+interval '1 day');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000006',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000006","session_id":"b0000000-0000-4000-8000-000000000006"}',true);
select public.preview_recording_invitation_v1(repeat('b',64));
select public.accept_recording_invitation_v1(repeat('b',64));
select pg_temp.team_assert(public.can_read_recording('d0000000-0000-4000-8000-000000000043'),'exact invitation to project-visible recording');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000004","session_id":"b0000000-0000-4000-8000-000000000004"}',true);
select pg_temp.team_assert(public.can_read_recording('d0000000-0000-4000-8000-000000000043'),'exact invitation preserves existing project members');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"b0000000-0000-4000-8000-000000000001"}',true);
select public.revoke_team_access_v1('recording','d0000000-0000-4000-8000-000000000043','c0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000006');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000006',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000006","session_id":"b0000000-0000-4000-8000-000000000006"}',true);
select public.accept_recording_invitation_v1(repeat('b',64));
select pg_temp.team_assert(not public.can_read_recording('d0000000-0000-4000-8000-000000000043'),'accepted-token replay never reinstates revoked exact grant');

select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"b0000000-0000-4000-8000-000000000001"}',true);
select public.revoke_team_access_v1('folder','c0000000-0000-4000-8000-000000000031',null,'a0000000-0000-4000-8000-000000000005');
reset role;
-- Deliberate operator fixture move: application organization mutation remains private-only.
update public.recordings set client_id=null where id='d0000000-0000-4000-8000-000000000046';
set role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000005","session_id":"b0000000-0000-4000-8000-000000000005"}',true);
select pg_temp.team_assert(public.can_read_recording('d0000000-0000-4000-8000-000000000042'),'revoke folder preserves client');
select pg_temp.team_assert(not public.can_edit_recording('d0000000-0000-4000-8000-000000000042'),'revoke editor leaves reader');
select pg_temp.team_assert((select count(*)=1 from public.transcripts where id='e0000000-0000-4000-8000-000000000042'),'second client path retains transcript after folder revoke');
select pg_temp.team_assert((select count(*)=1 from public.ai_outputs where id='f1000000-0000-4000-8000-000000000042'),'second client path retains AI output after folder revoke');
select pg_temp.team_assert((select count(*)=1 from storage.objects where bucket_id='recordings' and name='a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000042/audio.webm'),'second client path retains exact audio after folder revoke');
-- Revoke the last scope inside a savepoint, preserving the later independent administrator-removal proof.
savepoint team_content_revoke;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"b0000000-0000-4000-8000-000000000001"}',true);
select public.revoke_team_access_v1('client','c0000000-0000-4000-8000-000000000021',null,'a0000000-0000-4000-8000-000000000005');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000005","session_id":"b0000000-0000-4000-8000-000000000005"}',true);
select pg_temp.team_assert((select count(*)=0 from public.transcripts where id='e0000000-0000-4000-8000-000000000042'),'last scope revoke removes transcript RLS');
select pg_temp.team_assert((select count(*)=0 from public.ai_outputs where id='f1000000-0000-4000-8000-000000000042'),'last scope revoke removes AI output RLS');
select pg_temp.team_assert((select count(*)=0 from storage.objects where bucket_id='recordings' and name='a0000000-0000-4000-8000-000000000001/d0000000-0000-4000-8000-000000000042/audio.webm'),'last scope revoke removes exact audio RLS');
rollback to savepoint team_content_revoke;
release savepoint team_content_revoke;
select pg_temp.team_assert(not public.can_read_recording('d0000000-0000-4000-8000-000000000046'),'move out removes scope');
reset role;
update public.recordings set client_id='c0000000-0000-4000-8000-000000000021' where id='d0000000-0000-4000-8000-000000000046';
update vosio_team_private.installation_administrators set revoked_at=now() where user_id='a0000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.team_assert(not public.can_read_recording('d0000000-0000-4000-8000-000000000042'),'admin-role removal invalidates unbounded scope');
select pg_temp.team_assert(public.can_read_recording('d0000000-0000-4000-8000-000000000043'),'independent exact recording grant survives scope loss');
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","session_id":"b0000000-0000-4000-8000-000000000001"}',true);
select pg_temp.team_assert(public.team_authority_v1()='project_founder','removed admin retains only genuine founder role');
do $$ begin perform public.set_team_access_v1('client','c0000000-0000-4000-8000-000000000021',null,'a0000000-0000-4000-8000-000000000005','reader'); raise exception 'removed admin used unbounded scope'; exception when insufficient_privilege then null; end $$;
reset role;
select pg_temp.team_assert(not has_schema_privilege('authenticated','vosio_team_private','USAGE'),'private schema ACL');
select pg_temp.team_assert(not has_table_privilege('service_role','vosio_team_private.installation_administrators','INSERT'),'no service registry writer');
select pg_temp.team_assert(not has_function_privilege('anon','public.team_workspace_v1()','EXECUTE'),'anon cannot call team workspace');
rollback;
select 'PASS team_access_permissions (synthetic rollback fixture)' as result;
