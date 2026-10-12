-- Read-only recovery snapshot. Rollback: revoke service EXECUTE in a new forward migration;
-- no recording, audio, transcript, operation or work data is changed by this migration.
do $owner$ begin
 if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
  where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
   and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
  raise exception 'apply as trusted capture owner' using errcode='42501'; end if;
end; $owner$;

-- Read one bounded, consistent operation manifest after the HTTP route checks the current manager.
create function public.get_recording_transcription_recovery_v1(p_operation_id uuid,p_recording_id uuid)
returns jsonb language sql stable security definer set search_path='' as $recovery_read$
 select jsonb_build_object(
  'operation',jsonb_build_object('id',o.id,'recording_id',o.recording_id,'phase',o.phase,
   'region',o.region,'model',o.model,'created_at',o.created_at,'started_at',o.started_at,
   'finalize_attempt_count',o.finalize_attempt_count),
  'work',coalesce((select jsonb_agg(jsonb_build_object('job_id',w.job_id,'phase',w.phase,
   'position',w.position,'provider_job_id',w.provider_job_id,'storage_path',w.storage_path,
   'claim_id',w.claim_id,'submission_claim_id',w.submission_claim_id,'claimed_at',w.claimed_at,
   'poll_attempt_count',w.poll_attempt_count,'error_code',w.error_code) order by w.position)
   from (select * from public.recording_transcription_work
    where operation_id=o.id order by position limit 1001) w),'[]'::jsonb))
 from public.recording_transcription_operations o where o.id=p_operation_id and o.recording_id=p_recording_id;
$recovery_read$;
revoke all on function public.get_recording_transcription_recovery_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_recording_transcription_recovery_v1(uuid,uuid) to service_role;
comment on function public.get_recording_transcription_recovery_v1(uuid,uuid) is
 'Server-only read of an exact recovery manifest; private table grants remain revoked. Never return this snapshot to the browser.';
