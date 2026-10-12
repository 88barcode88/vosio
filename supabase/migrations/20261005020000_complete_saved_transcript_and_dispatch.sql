begin;
-- Forward-only, additive session contract and scoped worker; no recording or audio backfill.
-- Backout: revoke the new session/scoped dispatch grants; retain confirmed receipts and all content.
do $owner$ begin
 if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
  where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
   and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
  raise exception 'apply as trusted capture owner' using errcode='42501'; end if;
end; $owner$;

-- Keep existing lease, fairness, expiry and no-resubmit rules, with an optional exact operation scope.
create function public.claim_recording_transcription_work_v2(p_limit integer default 5,p_operation_id uuid default null)
returns table(operation_id uuid,job_id uuid,claim_id uuid,work_kind text,storage_path text,client_reference_id text,
  region text,model text,provider_job_id text,manifest jsonb)
language plpgsql volatile security definer set search_path = '' as $claim$
declare v_id uuid; v_op public.recording_transcription_operations; v_work public.recording_transcription_work;
begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'invalid work limit' using errcode='22023'; end if;
  perform public.recording_sharing_lock_v1();
  for v_id in select o.id from public.recording_transcription_operations o
    where (p_operation_id is null or o.id=p_operation_id) and o.phase in ('started','accepted','uncertain') and o.started_at>clock_timestamp()-interval '7 days'
      and (exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id
        and ((w.phase='ready' and o.phase<>'uncertain') or (w.phase='submitting' and w.claimed_at<=clock_timestamp()-interval '15 minutes')
          or (w.phase='accepted' and w.poll_attempt_count<5 and coalesce(w.next_poll_at,'-infinity'::timestamptz)<=clock_timestamp()
            and (w.claimed_at is null or w.claimed_at<=clock_timestamp()-interval '15 minutes'))))
        or (not exists(select 1 from public.recording_transcription_work w where w.operation_id=o.id and w.phase<>'done')
          and o.finalize_attempt_count<5 and (o.finalize_claimed_at is null or o.finalize_claimed_at<=clock_timestamp()-interval '15 minutes')))
    order by o.last_claimed_at nulls first,o.created_at,o.id limit p_limit loop
    v_op:=public.lock_recording_transcription_operation_v1(v_id);
    update public.recording_transcription_work w set phase='uncertain' where w.operation_id=v_id and w.phase='submitting'
      and w.claimed_at<=clock_timestamp()-interval '15 minutes';
    perform public.refresh_recording_transcription_phase_v1(v_id);
    select w.* into v_work from public.recording_transcription_work w where w.operation_id=v_id
      and ((w.phase='ready' and not exists(select 1 from public.recording_transcription_work u where u.operation_id=v_id and u.phase='uncertain'))
        or (w.phase='accepted' and w.poll_attempt_count<5 and coalesce(w.next_poll_at,'-infinity'::timestamptz)<=clock_timestamp()
        and (w.claimed_at is null or w.claimed_at<=clock_timestamp()-interval '15 minutes')))
      order by case when w.phase='ready' then 0 else 1 end,w.position for update skip locked limit 1;
    operation_id:=v_id; region:=v_op.region; model:=v_op.model; manifest:=null;
    if found then
      claim_id:=gen_random_uuid(); job_id:=v_work.job_id; provider_job_id:=v_work.provider_job_id;
      work_kind:=case when v_work.phase='ready' then 'submit' else 'poll' end;
      storage_path:=case when work_kind='submit' then v_work.storage_path else null end;
      client_reference_id:=v_work.job_id::text;
      update public.recording_transcription_work w set claim_id=claim_recording_transcription_work_v2.claim_id,
        submission_claim_id=case when w.phase='ready' then claim_recording_transcription_work_v2.claim_id else w.submission_claim_id end,
        claimed_at=clock_timestamp(),poll_attempt_count=case when w.phase='accepted' then w.poll_attempt_count+1 else w.poll_attempt_count end,
        phase=case when w.phase='ready' then 'submitting' else w.phase end where w.job_id=v_work.job_id;
      update public.recording_transcription_operations set last_claimed_at=clock_timestamp() where id=v_id;
      return next;
    elsif not exists(select 1 from public.recording_transcription_work w where w.operation_id=v_id and w.phase<>'done')
      and v_op.finalize_attempt_count<5 and (v_op.finalize_claimed_at is null or v_op.finalize_claimed_at<=clock_timestamp()-interval '15 minutes') then
      claim_id:=gen_random_uuid(); job_id:=null; work_kind:='finalize'; storage_path:=null; client_reference_id:=v_op.id::text; provider_job_id:=null;
      select jsonb_agg(jsonb_build_object('jobId',w.job_id,'providerJobId',w.provider_job_id,'position',w.position,'audioDurationMs',w.audio_duration_ms) order by w.position)
        into manifest from public.recording_transcription_work w where w.operation_id=v_id;
      update public.recording_transcription_operations o set finalize_claim_id=claim_recording_transcription_work_v2.claim_id,
        finalize_claimed_at=clock_timestamp(),finalize_attempt_count=finalize_attempt_count+1,last_claimed_at=clock_timestamp() where o.id=v_id;
      return next;
    end if;
  end loop;
end;
$claim$;
revoke all on function public.claim_recording_transcription_work_v2(integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_recording_transcription_work_v2(integer,uuid) to service_role;

-- Preserve the existing scheduled-worker API through the same implementation.
create or replace function public.claim_recording_transcription_work_v1(p_limit integer default 5)
returns table(operation_id uuid,job_id uuid,claim_id uuid,work_kind text,storage_path text,client_reference_id text,
 region text,model text,provider_job_id text,manifest jsonb)
language sql volatile security definer set search_path='' as $$
 select * from public.claim_recording_transcription_work_v2(p_limit,null);
$$;

-- Read exact accepted custody for dispatch/webhook checks; never expose locators or private text.
create function public.get_recording_transcription_dispatch_v1(p_operation_id uuid,p_job_id uuid default null,p_provider_job_id text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_phase text;
begin
 select phase into v_phase from public.recording_transcription_operations where id=p_operation_id;
 if not found or (p_job_id is not null and not exists(select 1 from public.recording_transcription_work
  where operation_id=p_operation_id and job_id=p_job_id and provider_job_id=p_provider_job_id)) then
  raise exception 'dispatch unavailable' using errcode='42501'; end if;
 return jsonb_build_object('operationId',p_operation_id,'phase',v_phase,'pendingAcceptedWork',
  exists(select 1 from public.recording_transcription_work where operation_id=p_operation_id and phase='accepted' and poll_attempt_count<5));
end; $$;
revoke all on function public.get_recording_transcription_dispatch_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_recording_transcription_dispatch_v1(uuid,uuid,text) to service_role;

-- Confirm the already saved transcript under current authority without changing audio custody or content.
create function public.complete_saved_recording_transcript_v1(p_recording_id uuid,p_request_id uuid,p_expected_capture_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_record public.recordings; v_receipt public.recording_capture_receipts; v_hash text; v_transcript uuid; v_result jsonb;
begin
 if auth.uid() is null then raise exception 'capture denied' using errcode='42501'; end if;
 if p_request_id is null or p_expected_capture_revision is null or p_expected_capture_revision<0 then
  raise exception 'invalid completion' using errcode='22023'; end if;
 v_record:=public.lock_recording_capture_v1(p_recording_id);
 if v_record.status='deleted' or not (public.has_recording_capture_authority_v1(v_record.id) or public.can_manage_recording(v_record.id)) then
  raise exception 'capture denied' using errcode='42501'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_array(p_recording_id,p_expected_capture_revision,'complete_saved_transcript')::text,'UTF8')),'hex');
 select * into v_receipt from public.recording_capture_receipts where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if v_receipt.payload_fingerprint<>v_hash then raise exception 'capture denied' using errcode='42501'; end if;
  return v_receipt.result;
 end if;
 if v_record.capture_revision<>p_expected_capture_revision then raise exception 'capture changed' using errcode='40001'; end if;
 if v_record.source_type not in ('in_app_recording','realtime') or v_record.status not in ('created','uploading','uploaded','failed') then
  raise exception 'invalid completion state' using errcode='55000'; end if;
 if v_record.purge_claim_id is not null
  or exists(select 1 from public.recording_purge_operations where recording_id=v_record.id and phase in ('prepared','started'))
  or exists(select 1 from public.recording_transcription_operations where recording_id=v_record.id and phase in ('prepared','started','accepted','uncertain','manual_required'))
  or exists(select 1 from public.transcription_jobs where recording_id=v_record.id and status in ('queued','running')) then
  raise exception 'active work requires review' using errcode='55000'; end if;
 select id into v_transcript from public.transcripts where recording_id=v_record.id and user_id=v_record.user_id
  and btrim(raw_text)<>'' order by created_at desc,id desc limit 1 for update;
 if not found then raise exception 'saved transcript unavailable' using errcode='55000'; end if;
 update public.recordings set status='completed',capture_revision=capture_revision+1,error_message=null
  where id=v_record.id returning * into v_record;
 v_result:=jsonb_build_object('recordingId',v_record.id,'status','completed','captureRevision',v_record.capture_revision,
  'transcriptId',v_transcript,'jobId',null,'completionMode','saved_transcript','audioConfirmed',false);
 insert into public.recording_capture_receipts values(auth.uid(),p_request_id,v_record.id,v_hash,v_result,clock_timestamp());
 return v_result;
end; $$;
revoke all on function public.complete_saved_recording_transcript_v1(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.complete_saved_recording_transcript_v1(uuid,uuid,bigint) to authenticated;
commit;
