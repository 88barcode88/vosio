# PostgreSQL isolationtester, disposable full migration-chain database only. NOT executed here.
# Fixture observation table is test-only and is dropped by teardown.
setup
{
  create table public.capture_race_handles(key text primary key,payload jsonb);
  grant select,insert,update on public.capture_race_handles to authenticated,service_role;
  insert into auth.users(id,email) values('19000000-0000-4000-8000-000000000001','capture-race-founder@fixture.test'),('19000000-0000-4000-8000-000000000002','capture-race-author@fixture.test');
  insert into public.recording_projects(id,user_id,name) values('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','Capture race');
  insert into public.recording_project_members(project_id,user_id,role) values('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002','editor');
  insert into public.recordings(id,user_id,created_by,title,source_type,status,project_id,visibility,storage_path,mime_type,file_size_bytes)
    values('39000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002',
    'Capture race','upload','uploaded','29000000-0000-4000-8000-000000000001','project',
    '19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000001/audio.webm','audio/webm',123);
  insert into storage.objects(bucket_id,name,metadata) values('recordings','19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000001/audio.webm','{"size":123,"mimetype":"audio/webm"}');
  insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,project_id)
    values('39000000-0000-4000-8000-000000000004','19000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002',
      'Created text draft','realtime','created','project','29000000-0000-4000-8000-000000000001');
  insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,storage_path,mime_type)
    values('39000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002','Fair old','upload','uploaded','private',
      '19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000002/live/','audio/webm'),
    ('39000000-0000-4000-8000-000000000003','19000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000002','Fair new','upload','uploaded','private',
      '19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000003/audio.webm','audio/webm');
  insert into storage.objects(bucket_id,name,metadata) values
    ('recordings','19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000002/live/part1.webm','{"size":123,"mimetype":"audio/webm"}'),
    ('recordings','19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000002/live/part2.webm','{"size":123,"mimetype":"audio/webm"}'),
    ('recordings','19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000003/audio.webm','{"size":123,"mimetype":"audio/webm"}');
  set role authenticated;
  set request.jwt.claims='{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}';
  insert into public.capture_race_handles values('op',public.prepare_recording_transcription_v1('39000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001',0,'eu','stt-async-v5'));
  reset role;
}
teardown
{
  delete from public.recording_capture_receipts where recording_id='39000000-0000-4000-8000-000000000004';
  delete from public.recordings where id='39000000-0000-4000-8000-000000000004';
  delete from public.recording_transcription_work where operation_id in(select id from public.recording_transcription_operations where recording_id in('39000000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000003'));
  delete from public.recording_transcription_operations where recording_id in('39000000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000003');
  delete from public.recordings where id in('39000000-0000-4000-8000-000000000002','39000000-0000-4000-8000-000000000003');
  delete from storage.objects where bucket_id='recordings' and name in(
    '19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000002/live/part1.webm',
    '19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000002/live/part2.webm',
    '19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000003/audio.webm');
  delete from public.recording_transcription_resolutions where operation_id in(select id from public.recording_transcription_operations where recording_id='39000000-0000-4000-8000-000000000001');
  delete from public.recording_transcription_work where operation_id in(select id from public.recording_transcription_operations where recording_id='39000000-0000-4000-8000-000000000001');
  delete from public.recording_transcription_operations where recording_id='39000000-0000-4000-8000-000000000001';
  delete from public.recordings where id='39000000-0000-4000-8000-000000000001';
  delete from storage.objects where bucket_id='recordings' and name='19000000-0000-4000-8000-000000000002/39000000-0000-4000-8000-000000000001/audio.webm';
  delete from public.recording_projects where id='29000000-0000-4000-8000-000000000001';
  delete from public.recording_sharing_audit where actor_id in('19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002');
  delete from auth.users where id in('19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002');
  drop table public.capture_race_handles;
}
session "author"
step "author_begin" { begin; set local role authenticated; set local request.jwt.claims='{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}'; }
step "start" { select public.start_recording_transcription_v1((select (payload->>'operationId')::uuid from public.capture_race_handles where key='op')); }
step "live_draft_created"
{
  insert into public.capture_race_handles values('created_draft',public.apply_recording_capture_transition_v1('39000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000004',0,'live_draft',3,null,null,'Durable created draft','[]','[]'));
}
step "live_draft_created_denied"
{
  do $$ begin
    begin
      perform public.apply_recording_capture_transition_v1('39000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000004',0,'live_draft',3,null,null,'Revoked draft','[]','[]');
      raise exception 'expected revoked draft denial';
    exception when insufficient_privilege then null; end;
  end $$;
}
step "start_fair"
{
  insert into public.capture_race_handles values('fair_old',public.prepare_recording_transcription_v1('39000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000002',0,'eu','stt-async-v5'));
  select public.start_recording_transcription_v1((select (payload->>'operationId')::uuid from public.capture_race_handles where key='fair_old'));
  insert into public.capture_race_handles values('fair_new',public.prepare_recording_transcription_v1('39000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000003',0,'eu','stt-async-v5'));
  select public.start_recording_transcription_v1((select (payload->>'operationId')::uuid from public.capture_race_handles where key='fair_new'));
}
step "start_denied"
{
  do $$ begin
    begin
      perform public.start_recording_transcription_v1((select (payload->>'operationId')::uuid from public.capture_race_handles where key='op'));
      raise exception 'expected revoked start denial';
    exception when insufficient_privilege then null; end;
  end $$;
}
step "author_commit" { commit; }
session "founder"
step "founder_begin" { begin; set local role authenticated; set local request.jwt.claims='{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}'; }
step "revoke" { select public.revoke_project_member_v1('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002'); }
step "recover_created"
{
  select public.apply_recording_capture_transition_v1('39000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000104',1,'recover');
}
step "recover_empty_created_denied"
{
  do $$ begin
    begin
      perform public.apply_recording_capture_transition_v1('39000000-0000-4000-8000-000000000004','99000000-0000-4000-8000-000000000104',0,'recover');
      raise exception 'expected empty created recovery denial';
    exception when object_not_in_prerequisite_state then
      if sqlerrm<>'nothing to recover' then raise; end if;
    end;
  end $$;
}
step "trash" { select public.trash_recording_v1('39000000-0000-4000-8000-000000000001',(select updated_at from public.recordings where id='39000000-0000-4000-8000-000000000001'),720); }
step "trash_denied"
{
  do $$ begin
    begin
      perform public.trash_recording_v1('39000000-0000-4000-8000-000000000001',(select updated_at from public.recordings where id='39000000-0000-4000-8000-000000000001'),720);
      raise exception 'expected irreversible Trash denial';
    exception when object_not_in_prerequisite_state then null; end;
  end $$;
}
step "founder_commit" { commit; }
session "worker"
step "worker_begin" { begin; set local role service_role; }
step "claim_submit" { insert into public.capture_race_handles select 'submit',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w; }
step "fair_claim_old" { insert into public.capture_race_handles select 'fair_first',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w; }
step "fair_claim_remaining" { insert into public.capture_race_handles select 'fair_third',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w; }
step "accept"
{
  select public.accept_recording_provider_job_v1((select (payload->>'operation_id')::uuid from public.capture_race_handles where key='submit'),
    (select (payload->>'job_id')::uuid from public.capture_race_handles where key='submit'),
    (select (payload->>'claim_id')::uuid from public.capture_race_handles where key='submit'),'race-provider-accepted');
}
step "claim_poll" { insert into public.capture_race_handles select 'poll',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w; }
step "settle"
{
  select public.settle_recording_provider_job_v1((select (payload->>'operation_id')::uuid from public.capture_race_handles where key='poll'),
    (select (payload->>'job_id')::uuid from public.capture_race_handles where key='poll'),
    (select (payload->>'claim_id')::uuid from public.capture_race_handles where key='poll'),'done',1000);
}
step "settle_failure"
{
  select public.settle_recording_provider_job_v1((select (payload->>'operation_id')::uuid from public.capture_race_handles where key='poll'),
    (select (payload->>'job_id')::uuid from public.capture_race_handles where key='poll'),
    (select (payload->>'claim_id')::uuid from public.capture_race_handles where key='poll'),'failed');
}
step "claim_final" { insert into public.capture_race_handles select 'final',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w; }
step "finalize"
{
  select public.finalize_recording_transcription_v1((select (payload->>'operation_id')::uuid from public.capture_race_handles where key='final'),
    (select (payload->>'claim_id')::uuid from public.capture_race_handles where key='final'),'Accepted race text','[]','[]',1);
}
step "worker_commit" { commit; }
step "worker_poll_begin" { begin; set local role service_role; }
step "worker_poll_commit" { commit; }
session "worker_two"
step "worker_two_begin" { begin; set local role service_role; }
step "second_claim" { insert into public.capture_race_handles select 'second_count',jsonb_build_object('count',count(*)) from public.claim_recording_transcription_work_v1(1); }
step "fair_claim_new" { insert into public.capture_race_handles select 'fair_second',to_jsonb(w) from public.claim_recording_transcription_work_v1(1)w; }
step "worker_two_commit" { commit; }
session "observer"
step "assert_created_recovered"
{
  do $$ begin
    if not exists(select 1 from public.recordings where id='39000000-0000-4000-8000-000000000004' and status='completed' and capture_revision=2)
      or (select count(*) from public.transcripts where recording_id='39000000-0000-4000-8000-000000000004')<>1
      or not exists(select 1 from public.transcripts where id=(select (payload->>'transcriptId')::uuid from public.capture_race_handles where key='created_draft') and raw_text='Durable created draft')
      or not exists(select 1 from public.recording_project_members where project_id='29000000-0000-4000-8000-000000000001' and user_id='19000000-0000-4000-8000-000000000002' and revoked_at is not null)
    then raise exception 'draft-first must preserve exactly one durable transcript through revoke and founder recovery'; end if;
  end $$;
}
step "assert_created_empty"
{
  do $$ begin
    if not exists(select 1 from public.recordings where id='39000000-0000-4000-8000-000000000004' and status='created' and capture_revision=0)
      or exists(select 1 from public.transcripts where recording_id='39000000-0000-4000-8000-000000000004')
      or exists(select 1 from public.recording_capture_receipts where recording_id='39000000-0000-4000-8000-000000000004')
    then raise exception 'revoke-first must deny draft and leave empty created recovery unchanged'; end if;
  end $$;
}
step "order_fair" { update public.recording_transcription_operations set created_at=clock_timestamp()-interval '1 minute' where id=(select (payload->>'operationId')::uuid from public.capture_race_handles where key='fair_old'); }
step "poll_ready" { update public.recording_transcription_work set next_poll_at=null where operation_id=(select (payload->>'operationId')::uuid from public.capture_race_handles where key='op'); }
step "assert_fair"
{
  do $$ begin
    if (select payload->>'operation_id' from public.capture_race_handles where key='fair_first') is distinct from (select payload->>'operationId' from public.capture_race_handles where key='fair_old')
      or (select payload->>'operation_id' from public.capture_race_handles where key='fair_second') is distinct from (select payload->>'operationId' from public.capture_race_handles where key='fair_new')
      or (select payload->>'operation_id' from public.capture_race_handles where key='fair_third') is distinct from (select payload->>'operationId' from public.capture_race_handles where key='fair_old')
    then raise exception 'new operation must run before old second segment even across concurrent workers'; end if;
  end $$;
}
step "assert_no_start"
{
  do $$ begin
    if not exists(select 1 from public.recording_transcription_operations where recording_id='39000000-0000-4000-8000-000000000001' and phase='prepared')
      or exists(select 1 from public.recording_transcription_work where operation_id=(select (payload->>'operationId')::uuid from public.capture_race_handles where key='op') and phase<>'prepared')
    then raise exception 'revoke-first must not start any provider unit'; end if;
  end $$;
}
step "assert_one_claim"
{
  do $$ begin
    if (select (payload->>'count')::integer from public.capture_race_handles where key='second_count')<>0
      or (select count(*) from public.recording_transcription_work where operation_id=(select (payload->>'operationId')::uuid from public.capture_race_handles where key='op') and phase='submitting')<>1
    then raise exception 'two workers must not submit the same provider unit'; end if;
  end $$;
}
step "assert_completed"
{
  do $$ begin
    if (select count(*) from public.transcripts where recording_id='39000000-0000-4000-8000-000000000001')<>1
      or not exists(select 1 from public.recordings where id='39000000-0000-4000-8000-000000000001' and status='completed')
      or not exists(select 1 from public.recording_transcription_operations where recording_id='39000000-0000-4000-8000-000000000001' and phase='completed')
    then raise exception 'accepted work must complete exactly once after revoke'; end if;
  end $$;
}
step "assert_failed"
{
  do $$ begin
    if exists(select 1 from public.transcripts where recording_id='39000000-0000-4000-8000-000000000001')
      or not exists(select 1 from public.recordings where id='39000000-0000-4000-8000-000000000001' and status='failed')
    then raise exception 'accepted failure must retain retryable recording without transcript'; end if;
  end $$;
}
step "assert_trashed"
{
  do $$ begin
    if not exists(select 1 from public.recordings where id='39000000-0000-4000-8000-000000000001' and status='deleted')
      or not exists(select 1 from public.recording_transcription_operations where recording_id='39000000-0000-4000-8000-000000000001' and phase='released')
    then raise exception 'Trash before start must safely cancel prepared work'; end if;
  end $$;
}
permutation "founder_begin" "revoke" "author_begin" "start_denied" "founder_commit" "author_commit" "assert_no_start"
permutation "author_begin" "start" "founder_begin" "revoke" "author_commit" "founder_commit" "worker_begin" "claim_submit" "accept" "worker_commit" "poll_ready" "worker_poll_begin" "claim_poll" "settle" "claim_final" "finalize" "worker_poll_commit" "assert_completed"
permutation "author_begin" "start" "author_commit" "worker_begin" "claim_submit" "worker_two_begin" "second_claim" "worker_commit" "worker_two_commit" "assert_one_claim"
permutation "author_begin" "start" "founder_begin" "trash_denied" "author_commit" "founder_commit"
permutation "founder_begin" "trash" "author_begin" "start_denied" "founder_commit" "author_commit" "assert_trashed"
permutation "author_begin" "start" "author_commit" "founder_begin" "revoke" "founder_commit" "worker_begin" "claim_submit" "accept" "worker_commit" "poll_ready" "worker_poll_begin" "claim_poll" "settle_failure" "worker_poll_commit" "assert_failed"
permutation "author_begin" "start_fair" "author_commit" "order_fair" "worker_begin" "fair_claim_old" "worker_two_begin" "fair_claim_new" "worker_commit" "worker_two_commit" "worker_poll_begin" "fair_claim_remaining" "worker_poll_commit" "assert_fair"
permutation "author_begin" "live_draft_created" "founder_begin" "revoke" "author_commit" "recover_created" "founder_commit" "assert_created_recovered"
permutation "founder_begin" "revoke" "author_begin" "live_draft_created_denied" "recover_empty_created_denied" "founder_commit" "author_commit" "assert_created_empty"
