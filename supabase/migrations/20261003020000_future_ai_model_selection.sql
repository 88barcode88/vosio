begin;
-- SOURCE ONLY: future model selections only. Existing jobs/intents/completion snapshots are untouched.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Capture completion preserves all six private snapshots without creating jobs or changing history.
create or replace function public.mark_capture_timeline_consent_v1() returns trigger
language plpgsql security definer set search_path = '' as $snapshot$
declare v_settings jsonb; v_model text; v_effort text; v_original_model text; v_provider public.ai_provider; v_config jsonb;
  v_type text; v_prompt public.prompt_templates; v_override public.prompt_template_overrides;
  v_override_found boolean; v_outputs jsonb := '[]'::jsonb; v_transcript public.transcripts;
begin
  if new.status<>'completed' or old.status='completed'
    or not(new.capture_request_id is not null or exists(select 1 from public.transcripts t
      where t.recording_id=new.id and t.completion_generation_key like 'async:%'))
    or not(new.project_id is null or new.visibility='private' or exists(select 1 from public.recording_projects p
      where p.id=new.project_id and p.user_id=new.user_id)) then return new; end if;
  select raw_user_meta_data->'vosio_settings' into v_settings from auth.users where id=new.user_id;
  if v_settings ? 'aiTemperature' and not (case when jsonb_typeof(v_settings->'aiTemperature')='number'
    then (v_settings->>'aiTemperature')::numeric between 0 and 2 else false end) then return new; end if;
  if v_settings ? 'autoTimelineAfterTranscription' and jsonb_typeof(v_settings->'autoTimelineAfterTranscription')<>'boolean'
    then return new; end if;
  if jsonb_typeof(v_settings->'automaticOutputTypes')='array' and exists(select 1
    from jsonb_array_elements(v_settings->'automaticOutputTypes') x where jsonb_typeof(x)<>'string'
      or x#>>'{}' not in ('summary','action_items','meeting_minutes','crm_note','follow_up_email')) then
    v_settings:=jsonb_set(v_settings,'{automaticOutputTypes}','[]');
  end if;
  v_original_model:=coalesce(v_settings->>'defaultOpenaiModel','gpt-6.1-sol');
  v_model:=case
    when v_original_model in ('gemini-3.1-flash-lite','gemini-3.1-pro-preview','gemini-3.5-flash') then 'gemini-3.6-flash'
    when v_original_model in ('gpt-4.1-mini','gpt-4.1-nano','gpt-5.4','gpt-5.4-mini','gpt-5.4-nano',
      'gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna') then 'gpt-6.1-sol'
    when v_original_model in ('gpt-6-astra-low','gpt-6-astra-medium') then 'gpt-6-astra'
    else v_original_model end;
  if v_model not in ('gpt-6.1-sol','gpt-6-astra','gemini-3.6-flash','gemini-3.8-flash',
    'mistral-small-2603','mistral-large-2512') then return new; end if;
  v_effort:=coalesce(v_settings->>'defaultReasoningEffort',case when v_original_model='gpt-6-astra-low' then 'low' else 'medium' end);
  if v_effort not in ('low','medium','high','xhigh','max') then return new; end if;
  v_provider:=case when v_model like 'gemini-%' then 'gemini'::public.ai_provider
    when v_model like 'mistral-%' then 'mistral'::public.ai_provider else 'openai'::public.ai_provider end;
  v_config:=jsonb_build_object('provider',v_provider,'provider_model',v_model,
    'reasoning_effort',case when v_provider='openai' then v_effort end,
    'thinking_level',case when v_provider='gemini' then 'medium' end);
  if v_provider in ('mistral','gemini') then
    v_config:=v_config||jsonb_build_object('temperature',0.3);
  end if;
  if v_provider='gemini' then
    v_config:=v_config||jsonb_build_object('sampling_temperature_supported',true);
  end if;
  select * into v_transcript from public.transcripts where recording_id=new.id and user_id=new.user_id
    order by created_at desc,id desc limit 1;
  if not found or v_transcript.completion_generation_key is null then return new; end if;
  for v_type in select unnest(array['summary','action_items','meeting_minutes','crm_note','follow_up_email','timeline_chapters']) loop
    if not coalesce(case when v_type='timeline_chapters' then v_settings->'autoTimelineAfterTranscription'='true'::jsonb
      else jsonb_typeof(v_settings->'automaticOutputTypes')='array' and v_settings->'automaticOutputTypes' ? v_type end,false) then continue; end if;
    select * into v_prompt from public.prompt_templates where is_system and processing_type::text=v_type order by id limit 1 for share;
    if not found then continue; end if;
    select * into v_override from public.prompt_template_overrides where system_prompt_id=v_prompt.id and user_id=new.user_id and is_active for share;
    v_override_found:=found;
    v_outputs:=v_outputs||jsonb_build_array(jsonb_build_object('processing_type',v_type,'model',v_model,'provider',v_provider,
      'provider_config',v_config||jsonb_build_object('response_format',case when v_prompt.output_schema is null then 'text' else 'json_schema' end),
      'prompt_id',v_prompt.id,'prompt_name',v_prompt.name,'output_schema',v_prompt.output_schema,
      'override_id',case when v_override_found then v_override.id end,'revision',case when v_override_found then v_override.revision end,
      'source',case when v_override_found then 'user_override' else 'system' end,
      'text',case when v_override_found then v_override.prompt_text else v_prompt.prompt_text end));
  end loop;
  if jsonb_array_length(v_outputs)>0 then
    insert into public.capture_timeline_snapshots values(v_transcript.id,new.user_id,
      jsonb_build_object('completion_generation_key',v_transcript.completion_generation_key,'outputs',v_outputs))
    on conflict(transcript_id) do nothing;
  end if;
  return new;
end;
$snapshot$;

-- Keep the source UUID after cleanup deletes its row; a foreign key would erase retry replay identity.
alter table public.ai_processing_jobs add column retry_source_job_id uuid
  check (retry_source_job_id is null or (execution_mode = 'manual' and retry_source_job_id <> id));
comment on column public.ai_processing_jobs.retry_source_job_id is 'Immutable source UUID of an explicit failed manual job retry; snapshot inputs are cloned exactly and source deletion does not clear lineage.';
-- Nullable additive audit snapshot; old turns remain null and retain their historical identity.
alter table public.transcript_chat_turns add column provider_config jsonb;
comment on column public.transcript_chat_turns.provider_config is 'Exact provider/effort/temperature snapshot for newly accepted chat turns; legacy turns remain null.';
revoke all on function public.mark_capture_timeline_consent_v1() from public,anon,authenticated,service_role;
commit;
