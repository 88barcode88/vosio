\set ON_ERROR_STOP on
-- Rehearsal only: fresh disposable clone through 20261002070000, never any real-user target.
-- psql -X -v approved_disposable=1 -f tests/sql/checklist-delete-proof.sql <explicit approved loopback connection>
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
\ir ../../supabase/migrations/20261003010000_add_atomic_checklist_delete.sql

-- Every fixture is new, synthetic, content-free, and removed by unconditional rollback.
do $proof$
#variable_conflict use_variable
declare owner_id uuid:=gen_random_uuid(); editor_id uuid:=gen_random_uuid(); reader_id uuid:=gen_random_uuid();
  project_id uuid:=gen_random_uuid(); recording_id uuid:=gen_random_uuid(); transcript_id uuid:=gen_random_uuid();
  job_id uuid:=gen_random_uuid(); second_job uuid:=gen_random_uuid(); output_id uuid:=gen_random_uuid(); second_output uuid:=gen_random_uuid();
  task_a uuid:=gen_random_uuid(); task_b uuid:=gen_random_uuid(); extra_task uuid:=gen_random_uuid();
  fresh_job uuid:=gen_random_uuid(); fresh_output uuid:=gen_random_uuid(); fresh_task uuid:=gen_random_uuid();
  review jsonb; changed jsonb; receipt jsonb; actor uuid; n integer;
begin
  insert into auth.users(id,aud,role,email,created_at,updated_at)
    select x,'authenticated','authenticated',x::text||'@example.invalid',now(),now()
    from unnest(array[owner_id,editor_id,reader_id]) x;
  insert into public.recording_projects(id,user_id,name) values(project_id,owner_id,'checklist-synthetic');
  insert into public.recording_project_members(project_id,user_id,role) values
    (project_id,editor_id,'editor'),(project_id,reader_id,'reader');
  insert into public.recordings(id,user_id,created_by,title,source_type,status,project_id,visibility)
    values(recording_id,owner_id,owner_id,'checklist-synthetic','upload','completed',project_id,'project');
  insert into public.transcripts(id,recording_id,user_id,raw_text,completion_generation_key)
    values(transcript_id,recording_id,owner_id,'synthetic-preserved-text','proof:checklist-generation');
  insert into public.ai_processing_jobs(id,transcript_id,user_id,provider,model,processing_type,status,
    prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact)
    values(job_id,transcript_id,owner_id,'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true),
      (second_job,transcript_id,owner_id,'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true);
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text) values
    (output_id,job_id,transcript_id,owner_id,'synthetic-preserved-output');
  insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title,owner_category) values
    (task_a,output_id,job_id,transcript_id,owner_id,1,'Synthetic A','Moje práce'),
    (task_b,output_id,job_id,transcript_id,owner_id,2,'Synthetic B','Klient');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  review:=public.get_managed_transcript_checklist_v1(transcript_id)->'snapshot';
  if jsonb_array_length(review->'tasks')<>2 then raise exception 'whole review failed'; end if;
  foreach actor in array array[editor_id,reader_id] loop
    perform set_config('request.jwt.claim.sub',actor::text,true);
    begin perform public.delete_managed_transcript_checklist_v1(transcript_id,review);
      raise exception 'unauthorized actor accepted'; exception when insufficient_privilege then null; end;
  end loop;
  update public.recording_project_members m set revoked_at=now() where m.user_id=editor_id and m.project_id=project_id;
  perform set_config('request.jwt.claim.sub',editor_id::text,true);
  begin perform public.get_managed_transcript_checklist_v1(transcript_id);
    raise exception 'revoked review accepted'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin perform public.get_managed_transcript_checklist_v1(gen_random_uuid());
    raise exception 'missing transcript accepted'; exception when insufficient_privilege then null; end;
  changed:=jsonb_set(review,'{transcriptId}',to_jsonb(gen_random_uuid()));
  begin perform public.delete_managed_transcript_checklist_v1(transcript_id,changed);
    raise exception 'mixed scope accepted'; exception when serialization_failure then null; end;
  update public.transcript_tasks set status='done' where id=task_a;
  begin perform public.delete_managed_transcript_checklist_v1(transcript_id,review);
    raise exception 'status drift accepted'; exception when serialization_failure then null; end;
  review:=public.get_managed_transcript_checklist_v1(transcript_id)->'snapshot';
  insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(extra_task,output_id,job_id,transcript_id,owner_id,3,'Synthetic new');
  begin perform public.delete_managed_transcript_checklist_v1(transcript_id,review);
    raise exception 'new task accepted'; exception when serialization_failure then null; end;
  review:=public.get_managed_transcript_checklist_v1(transcript_id)->'snapshot';
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
    values(second_output,second_job,transcript_id,owner_id,'second preserved output');
  begin perform public.delete_managed_transcript_checklist_v1(transcript_id,review);
    raise exception 'new output accepted'; exception when serialization_failure then null; end;
  review:=public.get_managed_transcript_checklist_v1(transcript_id)->'snapshot';
  update public.transcripts set completion_generation_key='proof:changed-generation' where id=transcript_id;
  begin perform public.delete_managed_transcript_checklist_v1(transcript_id,review);
    raise exception 'generation drift accepted'; exception when serialization_failure then null; end;
  select count(*) into n from public.transcript_tasks x where x.transcript_id=transcript_id;
  if n<>3 then raise exception 'failed request partially deleted'; end if;
  review:=public.get_managed_transcript_checklist_v1(transcript_id)->'snapshot';
  receipt:=public.delete_managed_transcript_checklist_v1(transcript_id,review);
  if (receipt->>'deletedCount')::integer<>3 then raise exception 'receipt mismatch'; end if;
  if exists(select 1 from public.transcript_tasks x where x.transcript_id=transcript_id)
    or (select count(*) from public.ai_outputs o where o.transcript_id=transcript_id)<>2
    or not exists(select 1 from public.ai_processing_jobs where id=job_id and status='done')
    or not exists(select 1 from public.transcripts where id=transcript_id and raw_text='synthetic-preserved-text') then
    raise exception 'preservation failed'; end if;
  insert into public.transcript_tasks(ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(output_id,job_id,transcript_id,owner_id,1,'Late projection must be suppressed');
  if exists(select 1 from public.transcript_tasks x where x.transcript_id=transcript_id) then
    raise exception 'late projection resurrected checklist'; end if;
  -- A genuinely new source is allowed. A privileged writer cannot retarget it to a suppressed old source.
  insert into public.ai_processing_jobs(id,transcript_id,user_id,provider,model,processing_type,status,
    prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact)
    values(fresh_job,transcript_id,owner_id,'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true);
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
    values(fresh_output,fresh_job,transcript_id,owner_id,'new unsuppressed output');
  insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title)
    values(fresh_task,fresh_output,fresh_job,transcript_id,owner_id,1,'New generation task');
  begin
    update public.transcript_tasks set ai_output_id=output_id,processing_job_id=job_id where id=fresh_task;
    raise exception 'suppressed source retarget accepted'; exception when serialization_failure then null;
  end;
  if not exists(select 1 from public.transcript_tasks x where x.id=fresh_task and x.ai_output_id=fresh_output) then
    raise exception 'failed source move altered task'; end if;
  begin
    update public.transcript_tasks set processing_job_id=job_id where id=fresh_task;
    raise exception 'task job-only scope mismatch accepted'; exception when insufficient_privilege then null;
  end;
  begin
    update public.ai_outputs set processing_job_id=gen_random_uuid() where id=fresh_output;
    raise exception 'output job-only scope mismatch accepted'; exception when insufficient_privilege then null;
  end;
  update public.transcript_tasks set status='done' where id=fresh_task;
  if not exists(select 1 from public.transcript_tasks x where x.id=fresh_task and x.status='done') then
    raise exception 'status-only edit swallowed'; end if;
  if has_function_privilege('anon','public.delete_managed_transcript_checklist_v1(uuid,jsonb)','execute')
    or not has_function_privilege('authenticated','public.delete_managed_transcript_checklist_v1(uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.managed_transcript_checklist_snapshot_v1(uuid)','execute') then
    raise exception 'RPC ACL mismatch'; end if;
  raise notice 'checklist role/drift/preservation/suppression rehearsal passed';
end;
$proof$;
rollback;
