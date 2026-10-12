begin;
-- New SECURITY DEFINER contracts must retain the reviewed privileged, non-API owner.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- A new capture's completion records preference eligibility, never AI jobs or provider work.
create table public.capture_timeline_snapshots(transcript_id uuid primary key references public.transcripts(id) on delete cascade,
  user_id uuid not null, snapshot jsonb not null);
alter table public.capture_timeline_snapshots enable row level security;
alter table public.capture_timeline_snapshots force row level security;
revoke all on table public.capture_timeline_snapshots from public,anon,authenticated,service_role;
create function public.mark_capture_timeline_consent_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_metadata jsonb; v_model text; v_provider public.ai_provider; v_config jsonb;
  v_prompt public.prompt_templates; v_override public.prompt_template_overrides; v_override_found boolean;
begin
  if new.status='completed' and old.status<>'completed' and (new.capture_request_id is not null or exists(
    select 1 from public.transcripts t where t.recording_id=new.id and t.completion_generation_key like 'async:%'))
    and (new.project_id is null or new.visibility='private' or exists(select 1 from public.recording_projects p where p.id=new.project_id and p.user_id=new.user_id)) then
    select raw_user_meta_data->'vosio_settings' into v_metadata from auth.users where id=new.user_id;
    if v_metadata->'autoTimelineAfterTranscription' is distinct from 'true'::jsonb then return new; end if;
    v_model:=v_metadata->>'defaultOpenaiModel';
    -- Mirror the bounded application catalog normalization, never accept arbitrary provider parameters.
    if v_model is null or v_model not in ('gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gemini-3.6-flash') then
      v_model:=case when v_model like 'gemini-%' then 'gemini-3.6-flash' else 'gpt-5.6-terra' end;
    end if;
    v_provider:=case when v_model='gemini-3.6-flash' then 'gemini'::public.ai_provider else 'openai'::public.ai_provider end;
    v_config:=jsonb_build_object('provider',v_provider,'reasoning_effort',case when v_model='gpt-5.6-terra' then 'high' when v_provider='openai' then 'xhigh' end,
      'thinking_level',case when v_provider='gemini' then 'medium' end);
    select * into v_prompt from public.prompt_templates where is_system and processing_type='timeline_chapters' order by id limit 1 for share;
    if not found then return new; end if;
    select * into v_override from public.prompt_template_overrides where system_prompt_id=v_prompt.id and user_id=new.user_id and is_active for share;
    v_override_found:=found;
    insert into public.capture_timeline_snapshots(transcript_id,user_id,snapshot)
    select t.id,t.user_id,jsonb_build_object('model',v_model,'provider',v_provider,
        'provider_config',v_config||jsonb_build_object('response_format',case when v_prompt.output_schema is null then 'text' else 'json_schema' end),
        'prompt_id',v_prompt.id,'prompt_name',v_prompt.name,'output_schema',v_prompt.output_schema,
        'override_id',case when v_override_found then v_override.id end,'revision',case when v_override_found then v_override.revision end,
        'source',case when v_override_found then 'user_override' else 'system' end,
        'text',case when v_override_found then v_override.prompt_text else v_prompt.prompt_text end)
      from public.transcripts t
      where t.id=(select id from public.transcripts where recording_id=new.id order by created_at desc,id desc limit 1)
      and t.user_id=new.user_id on conflict(transcript_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.mark_capture_timeline_consent_v1() from public,anon,authenticated,service_role;
create trigger recordings_mark_capture_timeline_consent after update of status on public.recordings
for each row execute function public.mark_capture_timeline_consent_v1();

-- Snapshot one personal opt-in intent after current authorization; never replace content, jobs or history.
create function public.schedule_capture_timeline_intent_v1(p_transcript_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_recording uuid; v_transcript public.transcripts; v_snapshot jsonb; v_key text;
begin
  if auth.uid() is null then raise exception 'AI not permitted' using errcode='42501'; end if;
  perform public.recording_sharing_lock_v1();
  select recording_id into v_recording from public.transcripts where id=p_transcript_id;
  perform 1 from public.recordings r where r.id=v_recording and r.user_id=auth.uid() and r.status='completed' for update;
  if not found or not public.can_read_recording(v_recording) or not public.can_manage_recording(v_recording) then
    raise exception 'AI not permitted' using errcode='42501'; end if;
  select * into v_transcript from public.transcripts where id=p_transcript_id and user_id=auth.uid() for update;
  if not found then raise exception 'AI not permitted' using errcode='42501'; end if;
  select snapshot into v_snapshot from public.capture_timeline_snapshots where transcript_id=p_transcript_id and user_id=auth.uid();
  if not found or not exists(select 1 from auth.users u where u.id=auth.uid()
    and u.raw_user_meta_data->'vosio_settings'->'autoTimelineAfterTranscription'='true'::jsonb) then return false; end if;
  v_key:='atl_capture_v1_'||p_transcript_id::text;
  if exists(select 1 from public.automatic_timeline_intents where automatic_idempotency_key=v_key) then return true; end if;
  insert into public.automatic_timeline_intents(automatic_idempotency_key,consent_snapshot,model,prompt_id,prompt_name_snapshot,
    prompt_output_schema_snapshot,prompt_override_id,prompt_revision_snapshot,prompt_source,prompt_text_snapshot,provider,provider_config,transcript_id,user_id)
  values(v_key,true,v_snapshot->>'model',(v_snapshot->>'prompt_id')::uuid,v_snapshot->>'prompt_name',nullif(v_snapshot->'output_schema','null'::jsonb),
    (v_snapshot->>'override_id')::uuid,(v_snapshot->>'revision')::integer,v_snapshot->>'source',v_snapshot->>'text',
    (v_snapshot->>'provider')::public.ai_provider,v_snapshot->'provider_config',p_transcript_id,auth.uid());
  return true;
end;
$$;
revoke all on function public.schedule_capture_timeline_intent_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.schedule_capture_timeline_intent_v1(uuid) to authenticated;

-- Return only contacts already confirmed through this actor's managed access, not an Auth directory.
create function public.list_confirmed_recording_recipients_v1()
returns table("userId" uuid,email text) language sql stable security definer set search_path = '' as $$
  select distinct u.id,u.email::text from auth.users u
  where auth.uid() is not null and u.id<>auth.uid() and u.email_confirmed_at is not null and (
    exists(select 1 from public.recording_access_grants g where g.user_id=u.id and g.revoked_at is null and public.can_manage_recording(g.recording_id))
    or exists(select 1 from public.recording_invitations i where i.created_by=auth.uid() and i.accepted_at is not null
      and i.revoked_at is null and lower(i.email)=lower(u.email) and public.recording_invitation_manager_v1(i.id,auth.uid()))
  ) order by u.id limit 100;
$$;
revoke all on function public.list_confirmed_recording_recipients_v1() from public,anon,authenticated,service_role;
grant execute on function public.list_confirmed_recording_recipients_v1() to authenticated;

-- Founder-only labels for members already in the managed project scope.
create function public.list_project_capture_recipients_v1(p_project_id uuid)
returns table("userId" uuid,email text,role text) language sql stable security definer set search_path = '' as $$
  select u.id,u.email::text,m.role from public.recording_project_members m join auth.users u on u.id=m.user_id
  where m.project_id=p_project_id and m.revoked_at is null and auth.uid() is not null
    and exists(select 1 from public.recording_projects p where p.id=m.project_id and p.user_id=auth.uid())
  order by u.id limit 100;
$$;
revoke all on function public.list_project_capture_recipients_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_project_capture_recipients_v1(uuid) to authenticated;

do $$ begin
  if (select proowner from pg_proc where oid='public.schedule_capture_timeline_intent_v1(uuid)'::regprocedure)
    is distinct from (select proowner from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure) then
    raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
end $$;
commit;
