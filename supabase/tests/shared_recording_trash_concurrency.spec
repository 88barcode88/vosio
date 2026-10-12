# PostgreSQL isolationtester input; disposable full-schema DB only.
# NOT executed here. Run with the PostgreSQL source test/isolation/isolationtester.
# Expected outcomes are stated per permutation; capture/compare actual output at runtime.
setup
{
  set timezone='UTC';
  insert into auth.users(id,email) values
    ('14000000-0000-4000-8000-000000000001','race-founder@fixture.test'),
    ('14000000-0000-4000-8000-000000000002','race-author@fixture.test'),
    ('14000000-0000-4000-8000-000000000003','race-next@fixture.test');
  insert into public.recording_projects(id,user_id,name)
    values('24000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','Race');
  insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status,deleted_from_status,deleted_at,trash_retention_hours,purge_after)
    values('34000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000002','Race','realtime','24000000-0000-4000-8000-000000000001','project','deleted','completed',now()-interval '2 days',720,now()+interval '28 days');
  insert into public.recordings(id,user_id,created_by,title,source_type,project_id,visibility,status)
    values('34000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000002','Child race','realtime','24000000-0000-4000-8000-000000000001','project','completed');
  insert into public.transcripts(id,recording_id,user_id,raw_text)
    values('44000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000002','Fixture');
  -- Historical shared-author output predates manager-only admission; restore it before every race.
  alter table public.ai_processing_jobs disable trigger ai_processing_jobs_guard_personal_admission;
  insert into public.ai_processing_jobs(id,transcript_id,user_id,model,processing_type,prompt_id,status)
    select '64000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000002','fixture','summary',id,'done'
    from public.prompt_templates where is_system and processing_type='summary' limit 1;
  alter table public.ai_processing_jobs enable trigger ai_processing_jobs_guard_personal_admission;
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
    values('74000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000002','Fixture');
  insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title,updated_at)
    select ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'74000000-0000-4000-8000-000000000002',
      '64000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002',
      '14000000-0000-4000-8000-000000000002',n,'Group fixture','2000-01-01' from generate_series(2,3)n;
}
teardown
{
  delete from public.recording_purge_operations where recording_id='34000000-0000-4000-8000-000000000001';
  delete from public.recordings where id in('34000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000002');
  delete from public.recording_projects where id='24000000-0000-4000-8000-000000000001';
  delete from auth.users where id in('14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000003');
}
session "actor"
setup
{
  set role authenticated;
  set request.jwt.claims='{"sub":"14000000-0000-4000-8000-000000000001","role":"authenticated"}';
}
step "prepare"
{
  select set_config('test.race_operation',public.prepare_recording_purge_v1(
    '34000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',
    (select updated_at from public.recordings where id='34000000-0000-4000-8000-000000000001'))->>'operationId',false) is not null as prepared;
}
step "actor_begin" { begin; }
step "lose_prepare_response" { select set_config('test.race_operation','',false) = '' as handle_lost; }
step "recover_operation"
{
  select set_config('test.race_operation',public.prepare_recording_purge_v1(
    '34000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','2000-01-01')->>'operationId',false) is not null as recovered;
}
step "release_recovered" { select public.release_recording_purge_v1(current_setting('test.race_operation')::uuid)->>'phase' as phase; }
step "start" { select public.start_recording_purge_v1(current_setting('test.race_operation')::uuid)->>'phase' as phase; }
step "child_delete" { select public.delete_managed_ai_output_v1('74000000-0000-4000-8000-000000000002')->>'deletedId' as deleted; }
step "task_group_delete"
{
  select public.delete_managed_transcript_task_group_v1('84000000-0000-4000-8000-000000000002','2000-01-01',
    array['84000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000002']::uuid[])->>'deletedCount' as deleted;
}
step "actor_commit" { commit; }
step "worker_a_begin" { reset role; set role service_role; begin; }
step "worker_a_claim" { select count(*) as worker_a from public.claim_started_recording_purge_work_v1(5); }
step "worker_a_commit" { commit; }
step "worker_a_acquire" { select count(*) from public.acquire_recording_purge_work_v1(current_setting('test.race_operation')::uuid); }
step "actor_again" { reset role; set role authenticated; }
step "replace_started"
{
  select public.prepare_recording_purge_v1('34000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',
    (select updated_at from public.recordings where id='34000000-0000-4000-8000-000000000001'))->>'phase' as phase;
}
session "authority"
# Trusted fixture mutation models actual manager authority loss. Product member revocation alone cannot revoke a founder.
step "revoke_begin" { begin; select public.recording_sharing_lock_v1(); }
step "revoke"
{
  update public.recording_projects set user_id='14000000-0000-4000-8000-000000000003'
    where id='24000000-0000-4000-8000-000000000001';
}
step "revoke_commit" { commit; }
step "verify_recovery_release"
{
  select count(*) as one_original_receipt, min(phase) as released from public.recording_purge_operations
    where recording_id='34000000-0000-4000-8000-000000000001';
  select purge_claim_id is null as claim_released from public.recordings where id='34000000-0000-4000-8000-000000000001';
}
step "worker_b_begin" { set role service_role; begin; }
step "worker_b_claim" { select count(*) as worker_b from public.claim_started_recording_purge_work_v1(5); }
step "worker_b_commit" { commit; }
step "expire_lease"
{
  reset role; begin; select public.recording_sharing_lock_v1();
  update public.recording_purge_operations set worker_claimed_at=statement_timestamp()-interval '16 minutes'
    where recording_id='34000000-0000-4000-8000-000000000001' and phase='started';
  update public.recordings set purge_started_at=statement_timestamp()-interval '16 minutes'
    where id='34000000-0000-4000-8000-000000000001';
  commit;
}
step "verify_budget"
{
  reset role;
  select work_attempt_count as cumulative_attempts from public.recording_purge_operations
    where recording_id='34000000-0000-4000-8000-000000000001' and phase='started';
}
step "verify_accepted"
{
  reset role;
  select set_config('test.accepted_operation',id::text,false)
    from public.recording_purge_operations where recording_id='34000000-0000-4000-8000-000000000001' and phase='started';
  set role service_role;
  select set_config('test.accepted_claim',claim_id::text,false) is not null as recovered
    from public.claim_started_recording_purge_work_v1(5) where operation_id=current_setting('test.accepted_operation')::uuid;
  select public.finalize_recording_purge_work_v1(current_setting('test.accepted_operation')::uuid,current_setting('test.accepted_claim')::uuid) as completed;
}
# revoke wins => start waits, then 42501; no Storage authorization.
permutation "prepare" "revoke_begin" "revoke" "actor_begin" "start" "revoke_commit" "actor_commit"
# Lost prepare response: revoke commits while recovery waits; recovery is allowed, start denied, own prepared release succeeds.
permutation "prepare" "lose_prepare_response" "revoke_begin" "revoke" "recover_operation" "revoke_commit" "start" "release_recovered" "verify_recovery_release"
# start wins => revoke waits; accepted receipt still completes after revoke.
permutation "prepare" "actor_begin" "start" "revoke_begin" "actor_commit" "revoke" "revoke_commit" "verify_accepted"
# child delete wins => revoke waits until committed exact deletion.
permutation "actor_begin" "child_delete" "revoke_begin" "actor_commit" "revoke" "revoke_commit"
# revoke wins => child delete waits, then 42501 without deleting.
permutation "revoke_begin" "revoke" "actor_begin" "child_delete" "revoke_commit" "actor_commit"
# The task group is all-or-nothing under the same authority interleavings: 2 or 42501.
permutation "actor_begin" "task_group_delete" "revoke_begin" "actor_commit" "revoke" "revoke_commit"
permutation "revoke_begin" "revoke" "actor_begin" "task_group_delete" "revoke_commit" "actor_commit"
# Each discovery winner returns 1; the blocked second worker returns 0 after commit.
permutation "prepare" "start" "worker_a_begin" "worker_a_claim" "worker_b_begin" "worker_b_claim" "worker_a_commit" "worker_b_commit"
permutation "prepare" "start" "worker_b_begin" "worker_b_claim" "worker_a_begin" "worker_a_claim" "worker_b_commit" "worker_a_commit"
# Replacement wins or worker wins: final cumulative count MUST be 2, never reset to 1.
permutation "prepare" "start" "worker_a_begin" "worker_a_acquire" "worker_a_commit" "expire_lease" "actor_again" "actor_begin" "replace_started" "worker_b_begin" "worker_b_claim" "actor_commit" "worker_b_commit" "verify_budget"
permutation "prepare" "start" "worker_a_begin" "worker_a_acquire" "worker_a_commit" "expire_lease" "actor_again" "worker_b_begin" "worker_b_claim" "actor_begin" "replace_started" "worker_b_commit" "actor_commit" "verify_budget"
