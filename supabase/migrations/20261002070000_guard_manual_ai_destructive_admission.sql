begin;
-- Source-only current-dev legacy destructive admission repair; historical migration bytes remain unchanged.
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
      and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501';
  end if;
end; $owner$;

-- Trusted API helpers bind their authenticated actor before job locks, under the sharing/recording lock.
create function public.assert_current_personal_ai_manager_v1(p_transcript_id uuid,p_actor_id uuid) returns void
language plpgsql security definer set search_path = '' as $authority$
declare v_record public.recordings; v_owner uuid; v_id uuid;
begin
  select recording_id,user_id into v_id,v_owner from public.transcripts where id=p_transcript_id;
  v_record:=public.lock_recording_capture_v1(v_id);
  if p_actor_id is null or v_owner is distinct from p_actor_id or v_record.user_id is distinct from p_actor_id
    or v_record.status='deleted' or v_record.purge_claim_id is not null
    or not(v_record.project_id is null or v_record.visibility='private'
      or exists(select 1 from public.recording_projects p where p.id=v_record.project_id and p.user_id=p_actor_id)) then
    raise exception 'current personal management required' using errcode='42501'; end if;
end;
$authority$;
revoke all on function public.assert_current_personal_ai_manager_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assert_current_personal_ai_manager_v1(uuid,uuid) to service_role;

create or replace function public.reconcile_manual_ai_job_v1(
  p_job_id uuid,
  p_transcript_id uuid,
  p_user_id uuid,
  p_action text,
  p_now timestamptz
)
returns table (result text, job_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_has_output boolean;
  v_is_new_shape boolean;
  v_job public.ai_processing_jobs%rowtype;
begin
  perform public.assert_current_personal_ai_manager_v1(p_transcript_id,p_user_id);
  if p_now is null or p_action not in ('reconcile', 'interrupt') then
    raise exception 'invalid manual AI reconciliation action' using errcode = '22023';
  end if;

  select j.*
  into v_job
  from public.ai_processing_jobs j
  where j.id = p_job_id
    and j.transcript_id = p_transcript_id
    and j.user_id = p_user_id
    and j.execution_mode = 'manual'
  for update;

  if not found then
    return query select 'missing'::text, p_job_id;
    return;
  end if;

  if v_job.status in ('done', 'failed', 'cancelled') then
    return query select 'terminal'::text, p_job_id;
    return;
  end if;

  v_is_new_shape := v_job.max_attempts = 1
    and v_job.prompt_snapshot_exact is true
    and v_job.model is not null
    and btrim(v_job.model) <> ''
    and v_job.prompt_text_snapshot is not null
    and btrim(v_job.prompt_text_snapshot) <> ''
    and v_job.provider is not null
    and v_job.provider_config is not null
    and coalesce(jsonb_typeof(v_job.provider_config -> 'metadata') = 'object', false)
    and (
      case
        when jsonb_typeof(v_job.provider_config -> 'temperature') = 'number'
          then (v_job.provider_config ->> 'temperature')::numeric between 0 and 2
        else false
      end
    )
    and (
      (
        v_job.status = 'queued'
        and v_job.attempt_count = 0
        and v_job.lease_token is null
        and v_job.lease_expires_at is null
      )
      or
      (
        v_job.status = 'running'
        and v_job.attempt_count = 1
        and v_job.lease_token is not null
        and v_job.lease_expires_at is not null
      )
    );

  if not v_is_new_shape then
    return query select 'operator_required'::text, p_job_id;
    return;
  end if;

  if v_job.status = 'queued' then
    if p_action = 'reconcile' then
      return query select 'schedule'::text, p_job_id;
    else
      update public.ai_processing_jobs j
      set completed_at = p_now,
          error_message = null,
          failure_code = 'execution_interrupted',
          retry_after_at = null,
          status = 'failed'
      where j.id = p_job_id
        and j.transcript_id = p_transcript_id
        and j.user_id = p_user_id
        and j.status = 'queued';
      return query select 'interrupted'::text, p_job_id;
    end if;
  end if;

  if v_job.status = 'running' then
    if v_job.lease_expires_at is null or v_job.lease_expires_at > p_now then
      return query select 'busy'::text, p_job_id;
      return;
    end if;

    select exists (
      select 1
      from public.ai_outputs o
      where o.processing_job_id = p_job_id
        and o.transcript_id = p_transcript_id
        and o.user_id = p_user_id
    ) into v_has_output;

    if v_has_output then
      update public.ai_processing_jobs j
      set completed_at = coalesce(j.completed_at, p_now),
          error_message = null,
          failure_code = null,
          lease_expires_at = null,
          lease_token = null,
          retry_after_at = null,
          status = 'done'
      where j.id = p_job_id
        and j.transcript_id = p_transcript_id
        and j.user_id = p_user_id
        and j.status = 'running'
        and j.lease_token is not distinct from v_job.lease_token;
      return query select 'done'::text, p_job_id;
      return;
    end if;

    update public.ai_processing_jobs j
    set completed_at = p_now,
        error_message = null,
        failure_code = 'execution_interrupted',
        lease_expires_at = null,
        lease_token = null,
        retry_after_at = null,
        status = 'failed'
    where j.id = p_job_id
      and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and j.status = 'running'
      and j.lease_token is not distinct from v_job.lease_token;
    return query select 'interrupted'::text, p_job_id;
    return;
  end if;

  return query select 'operator_required'::text, p_job_id;
end;
$$;

create or replace function public.cleanup_manual_ai_jobs_v1(
  p_job_ids uuid[],
  p_transcript_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns table (job_id uuid, result text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actions text[];
  v_has_output boolean;
  v_has_projection boolean;
  v_job public.ai_processing_jobs%rowtype;
  v_reason text;
  v_results text[];
  v_requested record;
begin
  perform public.assert_current_personal_ai_manager_v1(p_transcript_id,p_user_id);
  if p_job_ids is null or cardinality(p_job_ids) not between 1 and 50 or p_now is null
    or cardinality(p_job_ids) <> (select count(distinct id) from unnest(p_job_ids) ids(id)) then
    raise exception 'invalid manual AI cleanup request' using errcode = '22023';
  end if;

  -- Parent FOR UPDATE locks are acquired for the whole batch before dependency inspection.
  for v_requested in
    select requested.id from unnest(p_job_ids) requested(id) order by requested.id
  loop
    perform j.id
    from public.ai_processing_jobs j
    where j.id = v_requested.id
      and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and j.execution_mode = 'manual'
    for update;
  end loop;

  -- Existing children are locked in one global order; parent locks also block late FK inserts.
  perform o.id from public.ai_outputs o
    join public.ai_processing_jobs j on j.id = o.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by o.processing_job_id, o.id for update of o;
  perform p.id from public.transcript_tasks p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;
  perform p.id from public.transcript_chapters p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;
  perform p.id from public.transcript_decisions p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;
  perform p.id from public.transcript_risks p
    join public.ai_processing_jobs j on j.id = p.processing_job_id
    where j.id = any(p_job_ids) and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id and j.execution_mode = 'manual'
    order by p.processing_job_id, p.id for update of p;

  for v_requested in
    select requested.id, requested.ordinal
    from unnest(p_job_ids) with ordinality requested(id, ordinal)
    order by requested.ordinal
  loop
    select j.*
    into v_job
    from public.ai_processing_jobs j
    where j.id = v_requested.id
      and j.transcript_id = p_transcript_id
      and j.user_id = p_user_id
      and j.execution_mode = 'manual';
    if not found then
      v_results[v_requested.ordinal] := 'missing';
      continue;
    end if;

    select exists(select 1 from public.ai_outputs o where o.processing_job_id = v_job.id)
      into v_has_output;
    select
      exists(select 1 from public.transcript_tasks p where p.processing_job_id = v_job.id)
      or exists(select 1 from public.transcript_chapters p where p.processing_job_id = v_job.id)
      or exists(select 1 from public.transcript_decisions p where p.processing_job_id = v_job.id)
      or exists(select 1 from public.transcript_risks p where p.processing_job_id = v_job.id)
      into v_has_projection;

    select c.cleanup_reason, c.actions
    into v_reason, v_actions
    from public.classify_manual_ai_job_cleanup_v1(
      v_job.status, v_job.execution_mode, v_job.attempt_count, v_job.max_attempts,
      v_job.prompt_snapshot_exact, v_job.model, v_job.prompt_text_snapshot, v_job.provider,
      v_job.provider_config, v_job.created_at, v_job.lease_token, v_job.lease_expires_at,
      v_has_output, v_has_projection, p_now
    ) c;

    if v_reason = 'protected_output' then
      if 'reconcile' = any(v_actions) then
        update public.ai_processing_jobs j
        set completed_at = coalesce(j.completed_at, p_now),
            error_message = null,
            failure_code = null,
            lease_expires_at = null,
            lease_token = null,
            retry_after_at = null,
            status = 'done'
        where j.id = v_job.id
          and j.status = 'running'
          and j.lease_token is not distinct from v_job.lease_token;
        v_results[v_requested.ordinal] := 'reconciled';
      elsif v_job.status = 'running' then
        v_results[v_requested.ordinal] := 'busy';
      else
        v_results[v_requested.ordinal] := 'protected';
      end if;
      continue;
    end if;

    if v_reason = 'protected_projection' then
      v_results[v_requested.ordinal] := 'protected';
      continue;
    end if;

    if 'delete' = any(v_actions) then
      if v_job.status in ('queued', 'running') then
        update public.ai_processing_jobs j
        set completed_at = p_now,
            error_message = null,
            failure_code = 'execution_interrupted',
            lease_expires_at = null,
            lease_token = null,
            retry_after_at = null,
            status = 'failed'
        where j.id = v_job.id;
      end if;
      delete from public.ai_processing_jobs j where j.id = v_job.id;
      v_results[v_requested.ordinal] := 'deleted';
      continue;
    end if;

    v_results[v_requested.ordinal] := case
      when v_reason = 'active_or_slow' then 'busy'
      else 'conflict'
    end;
  end loop;

  return query
  select requested.id, v_results[requested.ordinal]
  from unnest(p_job_ids) with ordinality requested(id, ordinal)
  order by requested.ordinal;
end;
$$;

-- Only trusted service entry points remain; claim/settle accepted continuation functions are unchanged.
revoke all on function public.reconcile_manual_ai_job_v1(uuid,uuid,uuid,text,timestamptz),
  public.cleanup_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_manual_ai_job_v1(uuid,uuid,uuid,text,timestamptz),
  public.cleanup_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz) to service_role;
commit;
