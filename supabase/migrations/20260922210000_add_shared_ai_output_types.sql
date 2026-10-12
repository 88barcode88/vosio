-- SOURCE ONLY: apply after T1 and read paths, in one transaction under the T1 owner.
-- Complements ai_outputs RLS; it does not expose jobs or replace output reads.

-- Resolve only the type of bounded, existing outputs the session can currently read.
create function public.get_accessible_ai_output_types_v1(p_output_ids uuid[])
returns table(output_id uuid, processing_type public.ai_processing_type)
language plpgsql stable security definer set search_path = '' as $types$
begin
  -- Validate the raw array before deduplication; repeated IDs cannot evade the cap.
  if pg_catalog.cardinality(p_output_ids) > 1000
    or pg_catalog.array_ndims(p_output_ids) > 1 then
    raise exception 'output IDs must be a one-dimensional array of at most 1000 elements'
      using errcode = '22023';
  end if;
  if auth.uid() is null then return; end if;

  -- STABLE and the canonical STABLE predicate share the calling statement snapshot.
  -- An absent, inaccessible or inconsistent output produces no row, never a marker.
  return query
    select o.id, j.processing_type
    from (
      select distinct requested.id
      from pg_catalog.unnest(p_output_ids) as requested(id)
      where requested.id is not null
    ) requested
    join public.ai_outputs o on o.id = requested.id
    join public.transcripts t on t.id = o.transcript_id and t.user_id = o.user_id
    join public.ai_processing_jobs j on j.id = o.processing_job_id
      and j.transcript_id = o.transcript_id and j.user_id = o.user_id
    where public.can_read_recording(t.recording_id)
    order by o.id;
end;
$types$;

-- Match the existing trusted authority owner explicitly, never a caller/browser role.
do $owner$
declare v_owner name;
begin
  select r.rolname into v_owner
  from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = 'public.can_read_recording(uuid)'::regprocedure
    and (r.rolsuper or r.rolbypassrls)
    and r.rolname not in ('anon', 'authenticated', 'service_role');
  if v_owner is null or v_owner <> current_user then
    raise exception 'apply as the trusted T1 authority owner' using errcode = '42501';
  end if;
  execute pg_catalog.format(
    'alter function public.get_accessible_ai_output_types_v1(uuid[]) owner to %I', v_owner
  );
end;
$owner$;

revoke all on function public.get_accessible_ai_output_types_v1(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_accessible_ai_output_types_v1(uuid[]) to authenticated;
