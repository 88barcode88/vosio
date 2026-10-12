-- SOURCE ONLY: additive T3 read contracts after reviewed 20260922220000; apply transactionally as the trusted T1 owner.
-- No table grants, RLS changes, data rewrite or replacement of reviewed v1 functions.

-- Settings usage is billing/custody metadata for the technical owner, not the broader current content-read scope.
create function public.get_owned_recording_usage_summary_v1(p_created_from timestamptz,p_created_before timestamptz)
returns table(count bigint,deleted_count bigint,total_duration_seconds bigint,total_file_size_bytes numeric,
  with_duration_count bigint,with_file_size_count bigint)
language plpgsql stable security definer set search_path = '' as $usage$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_created_from is null or p_created_before is null or not isfinite(p_created_from) or not isfinite(p_created_before) then
    raise exception 'invalid usage interval' using errcode='22023'; end if;
  if p_created_from>=p_created_before or p_created_before-p_created_from>interval '32 days' then
    raise exception 'invalid usage interval' using errcode='22023'; end if;
  return query select count(*),count(*) filter(where r.status='deleted'),
    sum(r.duration_seconds),sum(r.file_size_bytes),count(r.duration_seconds),count(r.file_size_bytes)
    from public.recordings r where r.user_id=auth.uid()
      and r.created_at>=p_created_from and r.created_at<p_created_before;
end;
$usage$;

-- Exact owner-only duration lookup survives project revoke without exposing content or owner identity.
create function public.get_owned_recording_durations_v1(p_recording_ids uuid[])
returns table(recording_id uuid,duration_seconds integer)
language plpgsql stable security definer set search_path = '' as $durations$
begin
  if auth.uid() is null then return; end if;
  if coalesce(cardinality(p_recording_ids),0)=0 then return; end if;
  if cardinality(p_recording_ids)>1000 or array_ndims(p_recording_ids) is distinct from 1 then
    raise exception 'invalid recording IDs' using errcode='22023'; end if;
  return query select r.id,r.duration_seconds from public.recordings r
    where r.user_id=auth.uid() and r.id=any(p_recording_ids) order by r.id;
end;
$durations$;

-- Manager-only bounded Trash enrichment adds the validated locator shape, never a path or an object-existence claim.
create function public.get_managed_recording_trash_v2(p_recording_ids uuid[])
returns table(recording_id uuid,deleted_at timestamptz,trash_retention_hours smallint,purge_after timestamptz,
  purge_phase text,audio_availability text)
language plpgsql stable security definer set search_path = '' as $audio$
begin
  if auth.uid() is null then return; end if;
  if coalesce(cardinality(p_recording_ids),0)=0 then return; end if;
  if cardinality(p_recording_ids)>100 or array_ndims(p_recording_ids) is distinct from 1 then
    raise exception 'invalid recording IDs' using errcode='22023'; end if;
  return query select r.id,r.deleted_at,r.trash_retention_hours,r.purge_after,
    case when o.phase is not null then o.phase when r.purge_claim_id is not null then 'started' else 'none' end,
    case
      when r.storage_path is null or r.storage_path='' then 'none'
      when left(r.storage_path,length(p.prefix))<>p.prefix or position(chr(92) in r.storage_path)>0 then 'none'
      when r.storage_path=p.prefix||'live/' then 'segmented'
      when exists(select 1 from unnest(string_to_array(substr(r.storage_path,length(p.prefix)+1),'/')) part
        where part in ('','.','..')) or length(r.storage_path)<=length(p.prefix) then 'none'
      else 'single'
    end
    from public.recordings r
    cross join lateral(select r.user_id::text||'/'||r.id::text||'/' as prefix) p
    left join public.recording_purge_operations o on o.recording_id=r.id and o.phase in ('prepared','started')
    where r.id=any(p_recording_ids) and r.status='deleted' and public.can_manage_recording(r.id)
    order by r.id;
end;
$audio$;

-- Pin all new functions to the canonical trusted owner, removing all default/browser/service execution before the narrow grant.
do $owner$
declare v_owner name; v_signature text;
begin
  select r.rolname into v_owner from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and (r.rolsuper or r.rolbypassrls)
      and r.rolname not in ('anon','authenticated','service_role');
  if v_owner is null or v_owner<>current_user then raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
  for v_signature in select unnest(array[
    'get_owned_recording_usage_summary_v1(timestamptz,timestamptz)',
    'get_owned_recording_durations_v1(uuid[])','get_managed_recording_trash_v2(uuid[])'
  ]) loop
    execute format('alter function public.%s owner to %I',v_signature,v_owner);
    execute format('revoke all on function public.%s from public,anon,authenticated,service_role',v_signature);
  end loop;
end;
$owner$;
grant execute on function public.get_owned_recording_usage_summary_v1(timestamptz,timestamptz),
  public.get_owned_recording_durations_v1(uuid[]),public.get_managed_recording_trash_v2(uuid[]) to authenticated;
