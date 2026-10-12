-- Additive public-client admission; existing registrations remain static and retain their grants.
set lock_timeout = '5s';
set statement_timeout = '30s';

alter table vosio_mcp_private.clients add column registration_type text not null default 'static'
  check (registration_type in ('static','dynamic'));

-- Claude Code uses the exact localhost host; only the ephemeral port may vary for loopback callbacks.
create or replace function vosio_mcp_private.redirect_matches(registered text,actual text) returns boolean
language sql immutable strict set search_path='' as $$
select registered=actual or (
  registered ~ '^http://(127[.]0[.]0[.]1|[[]::1[]]|localhost)(:[0-9]{1,5})?/[^?#]*$'
  and actual ~ '^http://(127[.]0[.]0[.]1|[[]::1[]]|localhost)(:[0-9]{1,5})?/[^?#]*$'
  and regexp_replace(registered,'^(http://(127[.]0[.]0[.]1|[[]::1[]]|localhost))(:[0-9]{1,5})?(/.*)$',$parts$\1\4$parts$)
    =regexp_replace(actual,'^(http://(127[.]0[.]0[.]1|[[]::1[]]|localhost))(:[0-9]{1,5})?(/.*)$',$parts$\1\4$parts$)
);
$$;
revoke all on function vosio_mcp_private.redirect_matches(text,text) from public,anon,authenticated,service_role;

-- Serialize admission and pending cleanup before examining client references.
create function public.mcp_register_dynamic_client_v1(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  client_cap constant integer := 256;
  rate_cap constant integer := 30;
  rate_window constant interval := interval '60 seconds';
  unused_retention constant interval := interval '24 hours';
  admitted_at timestamptz; first_recent timestamptz; recent_count integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_payload) key)
       is distinct from array['clientId','name','redirects']::text[]
    or jsonb_typeof(p_payload->'clientId') is distinct from 'string'
    or jsonb_typeof(p_payload->'name') is distinct from 'string'
    or length(btrim(p_payload->>'name')) not between 1 and 100
    or jsonb_typeof(p_payload->'redirects') is distinct from 'array'
    then raise exception 'Invalid registration request' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'redirects') not between 1 and 10
    or exists(select 1 from jsonb_array_elements(p_payload->'redirects') uri
      where jsonb_typeof(uri) is distinct from 'string' or length(uri #>> '{}') not between 1 and 2000)
    then raise exception 'Invalid registration request' using errcode='22023'; end if;
  -- ponytail: one installation lock at the existing 256-client ceiling; shard only if that hosting model changes.
  perform pg_advisory_xact_lock(20261003,1);
  perform pg_advisory_xact_lock(20261003,2);
  admitted_at := clock_timestamp();
  delete from vosio_mcp_private.pending where expires_at <= admitted_at;
  delete from vosio_mcp_private.clients c where c.registration_type='dynamic'
    and c.created_at < admitted_at-unused_retention
    and not exists(select 1 from vosio_mcp_private.pending p where p.client_id=c.id)
    and not exists(select 1 from vosio_mcp_private.grants g where g.client_id=c.id);
  select count(*),min(created_at) into recent_count,first_recent from vosio_mcp_private.clients
    where registration_type='dynamic' and created_at > admitted_at-rate_window;
  if recent_count >= rate_cap then
    return jsonb_build_object('status','rate_limited','retryAfter',greatest(1,ceil(extract(epoch from first_recent+rate_window-admitted_at))::integer));
  end if;
  if (select count(*) from vosio_mcp_private.clients) >= client_cap then
    return jsonb_build_object('status','capacity_limited','retryAfter',60);
  end if;
  insert into vosio_mcp_private.clients(id,name,redirects,created_at,registration_type)
    values((p_payload->>'clientId')::uuid,btrim(p_payload->>'name'),p_payload->'redirects',admitted_at,'dynamic');
  return jsonb_build_object('status','accepted');
end; $$;
alter function public.mcp_register_dynamic_client_v1(jsonb) owner to postgres;
revoke all on function public.mcp_register_dynamic_client_v1(jsonb) from public,anon,authenticated;
grant execute on function public.mcp_register_dynamic_client_v1(jsonb) to service_role;
