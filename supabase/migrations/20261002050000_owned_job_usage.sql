begin;
do $owner$ begin
  if not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.can_read_recording(uuid)'::regprocedure and r.rolname=current_user
    and (r.rolsuper or r.rolbypassrls) and r.rolname not in ('anon','authenticated','service_role')) then
    raise exception 'apply as trusted T1 owner' using errcode='42501'; end if;
end; $owner$;
-- Cost-only owner accounting survives loss of content access; no prompts, provider IDs or content leave this RPC.
create function public.get_owned_job_usage_v1(p_created_from timestamptz,p_created_before timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'accounting denied' using errcode='42501'; end if;
  if p_created_from is null or p_created_before is null or p_created_from>=p_created_before
    or p_created_before-p_created_from>interval '32 days' then raise exception 'invalid accounting period' using errcode='22023'; end if;
  return jsonb_build_object('ai',coalesce((select jsonb_agg(jsonb_build_object(
    'created_at',j.created_at,'model',j.model,'status',j.status,'input_token_count',j.input_token_count,'output_token_count',j.output_token_count) order by j.created_at desc,j.id)
    from public.ai_processing_jobs j where j.user_id=auth.uid() and j.created_at>=p_created_from and j.created_at<p_created_before),'[]'::jsonb),
    'soniox',coalesce((select jsonb_agg(jsonb_build_object('created_at',j.created_at,'recording_id',j.recording_id,
      'mode',j.mode,'provider',j.provider,'status',j.status) order by j.created_at desc,j.id)
      from public.transcription_jobs j where j.user_id=auth.uid() and j.provider='soniox' and j.created_at>=p_created_from and j.created_at<p_created_before),'[]'::jsonb));
end;
$$;
revoke all on function public.get_owned_job_usage_v1(timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_owned_job_usage_v1(timestamptz,timestamptz) to authenticated;
commit;
