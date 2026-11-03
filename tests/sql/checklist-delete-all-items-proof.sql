\set ON_ERROR_STOP on
-- Rehearsal only: fresh disposable clone with every migration through 20261103120100 applied, never any real-user target.
-- psql -X -v approved_disposable=1 -f tests/sql/checklist-delete-all-items-proof.sql <explicit approved loopback connection>
\if :{?approved_disposable}
\else
  \echo 'BLOCKED: explicit approved_disposable variable required'
  \quit 2
\endif
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $$ begin
  if current_database() not like '%_vosio_checklist_test' then
    raise exception 'REFUSED: disposable database suffix required'; end if;
end $$;
\ir ../../supabase/migrations/20261103140000_checklist_delete_all_items.sql

-- Every fixture is new, synthetic, content-free, and removed by unconditional rollback.
do $proof$
#variable_conflict use_variable
declare owner_id uuid:=gen_random_uuid(); editor_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid();
  project_id uuid:=gen_random_uuid(); recording_id uuid:=gen_random_uuid(); transcript_id uuid:=gen_random_uuid();
  job_id uuid:=gen_random_uuid(); second_job uuid:=gen_random_uuid(); output_id uuid:=gen_random_uuid(); second_output uuid:=gen_random_uuid();
  task_a uuid:=gen_random_uuid(); decision_a uuid:=gen_random_uuid(); decision_b uuid:=gen_random_uuid();
  risk_a uuid:=gen_random_uuid(); extra_decision uuid:=gen_random_uuid(); extra_risk uuid:=gen_random_uuid();
  fresh_job uuid:=gen_random_uuid(); fresh_output uuid:=gen_random_uuid(); fresh_decision uuid:=gen_random_uuid(); fresh_risk uuid:=gen_random_uuid();
  other_transcript uuid:=gen_random_uuid(); other_recording uuid:=gen_random_uuid(); other_decision uuid:=gen_random_uuid();
  review jsonb; full_review jsonb; changed jsonb; receipt jsonb; actor uuid; n integer;
begin
  insert into auth.users(id,aud,role,email,created_at,updated_at)
    select x,'authenticated','authenticated',x::text||'@example.invalid',now(),now()
    from unnest(array[owner_id,editor_id,reader_id]) x;
  insert into public.recording_projects(id,user_id,name) values(project_id,owner_id,'checklist-all-synthetic');
  insert into public.recording_project_members(project_id,user_id,role) values
    (project_id,editor_id,'editor'),(project_id,reader_id,'reader');
  insert into public.recordings(id,user_id,created_by,title,source_type,status,project_id,visibility)
    values(recording_id,owner_id,owner_id,'checklist-all-synthetic','upload','completed',project_id,'project'),
      (other_recording,owner_id,owner_id,'checklist-other-synthetic','upload','completed',project_id,'project');
  insert into public.transcripts(id,recording_id,user_id,raw_text,completion_generation_key)
    values(transcript_id,recording_id,owner_id,'synthetic-preserved-text','proof:checklist-generation'),
      (other_transcript,other_recording,owner_id,'other-synthetic-text','proof:other-generation');
  insert into public.ai_processing_jobs(id,transcript_id,user_id,provider,model,processing_type,status,
    prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact)
    values(job_id,transcript_id,owner_id,'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true),
      (second_job,transcript_id,owner_id,'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true);
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text) values
    (output_id,job_id,transcript_id,owner_id,'synthetic-preserved-output');
  insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title,owner_category) values
    (task_a,output_id,job_id,transcript_id,owner_id,1,'Synthetic task','Moje práce');
  insert into public.transcript_decisions(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title) values
    (decision_a,output_id,job_id,transcript_id,owner_id,1,'Synthetic decision A'),
    (decision_b,output_id,job_id,transcript_id,owner_id,2,'Synthetic decision B');
  insert into public.transcript_risks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title) values
    (risk_a,output_id,job_id,transcript_id,owner_id,1,'Synthetic risk');
  insert into public.transcript_chapters(ai_output_id,processing_job_id,transcript_id,user_id,position,title) values
    (output_id,job_id,transcript_id,owner_id,1,'Synthetic chapter');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);

  -- Whole review: all three kinds, logical rows for counting, no raw text in the snapshot.
  full_review:=public.get_managed_transcript_checklist_v2(transcript_id);
  review:=full_review->'snapshot';
  if jsonb_array_length(review->'tasks')<>1 or jsonb_array_length(review->'decisions')<>2
    or jsonb_array_length(review->'risks')<>1 or jsonb_array_length(review->'outputs')<>1 then
    raise exception 'whole review failed'; end if;
  if jsonb_array_length(full_review->'logicalTasks')<>1 or jsonb_array_length(full_review->'logicalDecisions')<>2
    or jsonb_array_length(full_review->'logicalRisks')<>1 then raise exception 'logical rows mismatch'; end if;
  if review::text like '%Synthetic%' then raise exception 'snapshot leaked item text'; end if;

  -- Authority.
  foreach actor in array array[editor_id,reader_id] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    begin perform public.delete_managed_transcript_checklist_v2(transcript_id,review);
      raise exception 'unauthorized actor accepted'; exception when insufficient_privilege then null; end;
  end loop;
  update public.recording_project_members m set revoked_at=now() where m.user_id=editor_id and m.project_id=project_id;
  perform set_config('request.jwt.claim.sub',editor_id::text,true);
  begin perform public.get_managed_transcript_checklist_v2(transcript_id);
    raise exception 'revoked review accepted'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin perform public.get_managed_transcript_checklist_v2(gen_random_uuid());
    raise exception 'missing transcript accepted'; exception when insufficient_privilege then null; end;

  -- Malformed and drifted snapshots never delete anything.
  begin perform public.delete_managed_transcript_checklist_v2(transcript_id,review-'decisions');
    raise exception 'v1-shaped snapshot accepted'; exception when invalid_parameter_value then null; end;
  changed:=jsonb_set(review,'{transcriptId}',to_jsonb(gen_random_uuid()));
  begin perform public.delete_managed_transcript_checklist_v2(transcript_id,changed);
    raise exception 'mixed scope accepted'; exception when serialization_failure then null; end;
  -- xmin version drift of an edited decision/risk cannot be observed inside this single transaction (one xid);
  -- it is proven across separate transactions by the committed-fixture rehearsal, set drift is proven here.
  insert into public.transcript_decisions(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(extra_decision,output_id,job_id,transcript_id,owner_id,3,'Synthetic new decision');
  begin perform public.delete_managed_transcript_checklist_v2(transcript_id,review);
    raise exception 'new decision accepted'; exception when serialization_failure then null; end;
  review:=public.get_managed_transcript_checklist_v2(transcript_id)->'snapshot';
  insert into public.transcript_risks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(extra_risk,output_id,job_id,transcript_id,owner_id,2,'Synthetic new risk');
  begin perform public.delete_managed_transcript_checklist_v2(transcript_id,review);
    raise exception 'new risk accepted'; exception when serialization_failure then null; end;
  review:=public.get_managed_transcript_checklist_v2(transcript_id)->'snapshot';
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
    values(second_output,second_job,transcript_id,owner_id,'second preserved output');
  begin perform public.delete_managed_transcript_checklist_v2(transcript_id,review);
    raise exception 'new output accepted'; exception when serialization_failure then null; end;
  review:=public.get_managed_transcript_checklist_v2(transcript_id)->'snapshot';
  update public.transcripts set completion_generation_key='proof:changed-generation' where id=transcript_id;
  begin perform public.delete_managed_transcript_checklist_v2(transcript_id,review);
    raise exception 'generation drift accepted'; exception when serialization_failure then null; end;
  select (select count(*) from public.transcript_tasks x where x.transcript_id=transcript_id)
    +(select count(*) from public.transcript_decisions x where x.transcript_id=transcript_id)
    +(select count(*) from public.transcript_risks x where x.transcript_id=transcript_id) into n;
  if n<>6 then raise exception 'failed request partially deleted'; end if;

  -- A row of another transcript is never part of this snapshot or this delete.
  insert into public.ai_processing_jobs(id,transcript_id,user_id,provider,model,processing_type,status,
    prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact)
    values(fresh_job,other_transcript,owner_id,'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true);
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
    values(fresh_output,fresh_job,other_transcript,owner_id,'other transcript output');
  insert into public.transcript_decisions(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(other_decision,fresh_output,fresh_job,other_transcript,owner_id,1,'Other transcript decision');

  -- Successful delete removes every kind and preserves outputs, jobs, chapters, transcript.
  review:=public.get_managed_transcript_checklist_v2(transcript_id)->'snapshot';
  receipt:=public.delete_managed_transcript_checklist_v2(transcript_id,review);
  if (receipt->>'deletedCount')::integer<>6 or jsonb_array_length(receipt->'tasks')<>1
    or jsonb_array_length(receipt->'decisions')<>3 or jsonb_array_length(receipt->'risks')<>2 then
    raise exception 'receipt mismatch'; end if;
  if exists(select 1 from public.transcript_tasks x where x.transcript_id=transcript_id)
    or exists(select 1 from public.transcript_decisions x where x.transcript_id=transcript_id)
    or exists(select 1 from public.transcript_risks x where x.transcript_id=transcript_id)
    or (select count(*) from public.ai_outputs o where o.transcript_id=transcript_id)<>2
    or not exists(select 1 from public.transcript_decisions where id=other_decision)
    or not exists(select 1 from public.transcript_chapters where transcript_id=transcript_id)
    or not exists(select 1 from public.ai_processing_jobs where id=job_id and status='done')
    or not exists(select 1 from public.transcripts where id=transcript_id and raw_text='synthetic-preserved-text') then
    raise exception 'preservation failed'; end if;

  -- Second delete of the now-empty checklist succeeds with zero rows.
  review:=public.get_managed_transcript_checklist_v2(transcript_id)->'snapshot';
  receipt:=public.delete_managed_transcript_checklist_v2(transcript_id,review);
  if (receipt->>'deletedCount')::integer<>0 then raise exception 'empty delete receipt mismatch'; end if;

  -- Late projection inserts for suppressed old sources are skipped for every kind.
  insert into public.transcript_decisions(ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(output_id,job_id,transcript_id,owner_id,1,'Late decision must be suppressed');
  insert into public.transcript_risks(ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(output_id,job_id,transcript_id,owner_id,1,'Late risk must be suppressed');
  if exists(select 1 from public.transcript_decisions x where x.transcript_id=transcript_id)
    or exists(select 1 from public.transcript_risks x where x.transcript_id=transcript_id) then
    raise exception 'late projection resurrected checklist'; end if;

  -- A genuinely new source is allowed; retargeting it to a suppressed source and scope mismatches are refused.
  insert into public.ai_processing_jobs(id,transcript_id,user_id,provider,model,processing_type,status,
    prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact)
    values(gen_random_uuid(),transcript_id,owner_id,'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true)
    returning id into fresh_job;
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
    values(gen_random_uuid(),fresh_job,transcript_id,owner_id,'new unsuppressed output') returning id into fresh_output;
  insert into public.transcript_decisions(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(fresh_decision,fresh_output,fresh_job,transcript_id,owner_id,1,'New generation decision');
  insert into public.transcript_risks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(fresh_risk,fresh_output,fresh_job,transcript_id,owner_id,1,'New generation risk');
  if (select count(*) from public.transcript_decisions x where x.transcript_id=transcript_id)<>1
    or (select count(*) from public.transcript_risks x where x.transcript_id=transcript_id)<>1 then
    raise exception 'new generation rows were suppressed'; end if;
  begin
    update public.transcript_decisions set ai_output_id=output_id,processing_job_id=job_id where id=fresh_decision;
    raise exception 'suppressed decision retarget accepted'; exception when serialization_failure then null;
  end;
  begin
    update public.transcript_risks set ai_output_id=output_id,processing_job_id=job_id where id=fresh_risk;
    raise exception 'suppressed risk retarget accepted'; exception when serialization_failure then null;
  end;
  begin
    update public.transcript_decisions set processing_job_id=job_id where id=fresh_decision;
    raise exception 'decision job-only scope mismatch accepted'; exception when insufficient_privilege then null;
  end;
  begin
    update public.transcript_risks set processing_job_id=job_id where id=fresh_risk;
    raise exception 'risk job-only scope mismatch accepted'; exception when insufficient_privilege then null;
  end;
  update public.transcript_decisions set status='done' where id=fresh_decision;
  if not exists(select 1 from public.transcript_decisions x where x.id=fresh_decision and x.status='done') then
    raise exception 'status-only edit swallowed'; end if;

  -- Grants: v2 public entry points are authenticated-only; private builder/trigger functions are not callable.
  if has_function_privilege('anon','public.get_managed_transcript_checklist_v2(uuid)','execute')
    or has_function_privilege('anon','public.delete_managed_transcript_checklist_v2(uuid,jsonb)','execute')
    or has_function_privilege('service_role','public.delete_managed_transcript_checklist_v2(uuid,jsonb)','execute')
    or not has_function_privilege('authenticated','public.get_managed_transcript_checklist_v2(uuid)','execute')
    or not has_function_privilege('authenticated','public.delete_managed_transcript_checklist_v2(uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.managed_transcript_checklist_snapshot_v2(uuid)','execute')
    or has_function_privilege('authenticated','public.lock_checklist_item_parent_v2()','execute')
    or not has_function_privilege('authenticated','public.delete_managed_transcript_checklist_v1(uuid,jsonb)','execute') then
    raise exception 'RPC ACL mismatch'; end if;
  raise notice 'checklist all-items role/drift/preservation/suppression rehearsal passed';
end;
$proof$;
rollback;
