-- Run with psql -v ON_ERROR_STOP=1 against an isolated full-schema empty database.
begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
insert into auth.users(id,email) values
 ('b1000000-0000-4000-8000-000000000001','owner@example.invalid'),
 ('b1000000-0000-4000-8000-000000000002','reader@example.invalid'),
 ('b1000000-0000-4000-8000-000000000003','editor@example.invalid'),
 ('b1000000-0000-4000-8000-000000000004','foreign@example.invalid');
insert into vosio_team_private.installation_administrators(user_id) values ('b1000000-0000-4000-8000-000000000001');
insert into public.recording_clients(id,user_id,name) values ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Fixture client');
insert into public.recording_folders(id,user_id,name) values ('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Fixture folder');
insert into public.recording_projects(id,user_id,name,client_id) values
 ('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Fixture project','b2000000-0000-4000-8000-000000000001'),
 ('b4000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000004','Foreign project',null),
 ('b4000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001','Second project',null);
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility) values
 ('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Selected fixture','upload','completed','selected'),
 ('b5000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Private fixture','upload','completed','private');
insert into public.recording_access_grants(id,recording_id,user_id,role) values
 ('b6000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','reader'),
 ('b6000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','editor');
insert into vosio_team_private.scope_grants(grantor_id,user_id,scope_kind,client_id,role) values
 ('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','client','b2000000-0000-4000-8000-000000000001','editor');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
-- RED on baseline: selected assignment is rejected by v1.
do $$ declare p jsonb; r jsonb; begin
 p:=public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','{}');
 perform pg_temp.assert_true(jsonb_array_length(p->'exactRecipients')=2,'exact recipients retained in preview');
 perform pg_temp.assert_true(jsonb_array_length(p->'addedPaths')=1,'dynamic client path preview');
 r:=public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','{}',p->>'fingerprint');
 perform pg_temp.assert_true(r->>'visibility'='selected' and r->>'project_id'='b4000000-0000-4000-8000-000000000001','selected assignment preserves visibility');
 p:=public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}');
 perform pg_temp.assert_true(p->'addedPaths'='[]','private never gains dynamic paths');
 r:=public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}',p->>'fingerprint');
 perform pg_temp.assert_true(r->>'visibility'='private','private stays private');
 begin
  perform public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001',null,'b4000000-0000-4000-8000-000000000002',null,'{}');
  raise exception 'FAIL foreign founder allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.assign_recording_organization_v1('b5000000-0000-4000-8000-000000000001',null,null,null,'{}');
  raise exception 'FAIL legacy shared bypass';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
select pg_temp.assert_true((select count(*)=2 and bool_and(scope_project_id='b4000000-0000-4000-8000-000000000001' and revoked_at is null) from public.recording_access_grants),'exact scopes atomically rebound');
-- Both direct reader/editor RPC attempts must fail independently of app capabilities.
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
 perform pg_temp.assert_true(public.can_read_recording('b5000000-0000-4000-8000-000000000001'),'reader still reads selected after move');
 begin perform public.recording_organization_context_v1('b5000000-0000-4000-8000-000000000001'); raise exception 'FAIL reader authority'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
 begin perform public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001',null,null,null,'{}'); raise exception 'FAIL editor authority'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
 begin perform public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000001',null,null,null,'{}','invalid'); raise exception 'FAIL no authority'; exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
-- Revoke after preview makes confirmation stale; neither path nor recipient is resurrected.
do $$ declare p jsonb; begin
 p:=public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}');
 perform public.revoke_recording_grant_v1('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002');
 begin
  perform public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}',p->>'fingerprint');
  raise exception 'FAIL stale accepted';
 exception when serialization_failure then null; end;
 perform pg_temp.assert_true((select folder_id='b3000000-0000-4000-8000-000000000001' from public.recordings where id='b5000000-0000-4000-8000-000000000001'),'stale save rolled back');
end; $$;
insert into public.recording_invitations(id,token_hash,email,role,scope,recording_item_count,project_id,expires_at,created_by) values
 ('b7000000-0000-4000-8000-000000000001',repeat('a',64),'pending@example.invalid','reader','recordings',1,'b4000000-0000-4000-8000-000000000001',now()+interval '1 day','b1000000-0000-4000-8000-000000000001');
insert into public.recording_invitation_items(invitation_id,recording_id) values ('b7000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001');
do $$ begin
 begin perform public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001',null,'b4000000-0000-4000-8000-000000000003',null,'{}'); raise exception 'FAIL pending invite'; exception when object_not_in_prerequisite_state then
  perform pg_temp.assert_true(sqlerrm='organization pending invitation','specific pending invite reason'); end;
end; $$;
update public.recording_invitations set revoked_at=now() where id='b7000000-0000-4000-8000-000000000001';
insert into public.recording_transcription_operations(actor_id,request_id,recording_id,technical_owner_id,capture_author_id,project_id,payload_fingerprint,expected_capture_revision,purpose,phase,region,model,model_config_version) values
 ('b1000000-0000-4000-8000-000000000001',gen_random_uuid(),'b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','fixture',0,'capture','started','eu','stt-async-v5',1);
do $$ begin
 begin perform public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001',null,'b4000000-0000-4000-8000-000000000003',null,'{}'); raise exception 'FAIL active transcription'; exception when object_not_in_prerequisite_state then
  perform pg_temp.assert_true(sqlerrm='organization active transcription','specific active operation reason'); end;
end; $$;
select pg_temp.assert_true(not has_function_privilege('anon','public.assign_recording_organization_v2(uuid,uuid,uuid,uuid,uuid[],text)','EXECUTE'),'anon denied');
select pg_temp.assert_true(not has_function_privilege('service_role','public.assign_recording_organization_v2(uuid,uuid,uuid,uuid,uuid[],text)','EXECUTE'),'service role denied');
-- A founder manages the project without reading or replacing the foreign author's personal taxonomy.
insert into public.recording_clients(id,user_id,name) values ('b2000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000004','Foreign personal client');
insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,client_id,project_id) values
 ('b5000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000004','Foreign author fixture','upload','completed','project','b2000000-0000-4000-8000-000000000004','b4000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$ declare p jsonb; r jsonb; begin
 r:=public.recording_organization_context_v1('b5000000-0000-4000-8000-000000000004');
 perform pg_temp.assert_true(r->'client_id'='null' and r->'folder_id'='null' and r->'tag_ids'='[]' and r#>>'{organization_policy,personalEditable}'='false','foreign personal taxonomy redacted');
 begin perform public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000004',null,null,null,'{}'); raise exception 'FAIL silent custody reversion'; exception when insufficient_privilege then null; end;
 p:=public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000004',null,'b4000000-0000-4000-8000-000000000003',null,'{}');
 r:=public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000004',null,'b4000000-0000-4000-8000-000000000003',null,'{}',p->>'fingerprint');
 perform pg_temp.assert_true(r->>'project_id'='b4000000-0000-4000-8000-000000000003','same founder foreign author project move');
end; $$;
reset role;
select pg_temp.assert_true((select client_id='b2000000-0000-4000-8000-000000000004' from public.recordings where id='b5000000-0000-4000-8000-000000000004'),'foreign taxonomy preserved');
-- A scope grant revocation changes the preview even if the same person has another exact path.
do $$ declare p jsonb; begin
 p:=public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}');
 update vosio_team_private.scope_grants set revoked_at=now();
 begin perform public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}',p->>'fingerprint'); raise exception 'FAIL stale scope revoke'; exception when serialization_failure then null; end;
end; $$;
-- Pending scope recipients are shown separately, and acceptance/revocation both invalidate review.
insert into public.recording_invitations(id,token_hash,email,role,scope,recording_item_count,team_client_id,expires_at,created_by) values
 ('b7000000-0000-4000-8000-000000000002',repeat('b',64),'reader@example.invalid','reader','client',0,'b2000000-0000-4000-8000-000000000001',now()+interval '1 day','b1000000-0000-4000-8000-000000000001');
update auth.users set email_confirmed_at=now() where id='b1000000-0000-4000-8000-000000000002';
insert into auth.sessions(id,user_id) values ('b8000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002');
do $$ declare p jsonb; begin
 p:=public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}');
 perform pg_temp.assert_true(jsonb_array_length(p->'pendingInvitations')=1 and p#>>'{pendingInvitations,0,label}'='reader@example.invalid','pending recipient separate from active paths');
 perform public.revoke_recording_invitation_v1('b7000000-0000-4000-8000-000000000002');
 begin perform public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}',p->>'fingerprint'); raise exception 'FAIL stale pending revoke'; exception when serialization_failure then null; end;
 update public.recording_invitations set revoked_at=null where id='b7000000-0000-4000-8000-000000000002';
 p:=public.preview_recording_organization_v1('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}');
 perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"session_id":"b8000000-0000-4000-8000-000000000002"}',true);
 perform public.accept_recording_invitation_v1(repeat('b',64));
 perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
 begin perform public.assign_recording_organization_v2('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',null,'{}',p->>'fingerprint'); raise exception 'FAIL stale pending accept'; exception when serialization_failure then null; end;
end; $$;
rollback;
