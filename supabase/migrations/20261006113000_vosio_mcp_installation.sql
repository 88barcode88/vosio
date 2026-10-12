-- Additive, disabled-first installation metadata. No credentials or customer content.
set lock_timeout = '5s';
set statement_timeout = '30s';

create table vosio_mcp_private.installation (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  web_origin text not null check (web_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' and length(web_origin) <= 2000),
  public_supabase_url text not null check (public_supabase_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' and length(public_supabase_url) <= 2000),
  upstream_client_id uuid not null
);
alter table vosio_mcp_private.installation owner to postgres;
alter table vosio_mcp_private.installation enable row level security;
alter table vosio_mcp_private.installation force row level security;
revoke all on vosio_mcp_private.installation from public, anon, authenticated, service_role;

-- Fixed service-only cases; immutable installation identity prevents token/resource reassignment.
create function public.mcp_installation_v1(p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row vosio_mcp_private.installation; desired vosio_mcp_private.installation;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid installation request' using errcode='22023'; end if;
  if p_action = 'read' then
    if p_payload <> '{}'::jsonb then raise exception 'Invalid installation request' using errcode='22023'; end if;
  elsif p_action = 'configure' then
    if (select array_agg(key order by key) from jsonb_object_keys(p_payload) key) is distinct from array['enabled','publicSupabaseUrl','upstreamClientId','webOrigin']::text[]
      or p_payload->'enabled' is distinct from 'false'::jsonb
      or jsonb_typeof(p_payload->'webOrigin') <> 'string' or jsonb_typeof(p_payload->'publicSupabaseUrl') <> 'string' or jsonb_typeof(p_payload->'upstreamClientId') <> 'string'
      then raise exception 'Invalid installation request' using errcode='22023'; end if;
    desired.web_origin := p_payload->>'webOrigin'; desired.public_supabase_url := p_payload->>'publicSupabaseUrl'; desired.upstream_client_id := (p_payload->>'upstreamClientId')::uuid;
    insert into vosio_mcp_private.installation(singleton, enabled, web_origin, public_supabase_url, upstream_client_id)
      values(true,false,desired.web_origin,desired.public_supabase_url,desired.upstream_client_id) on conflict(singleton) do nothing;
    select * into row from vosio_mcp_private.installation where singleton for update;
    if row.web_origin <> desired.web_origin or row.public_supabase_url <> desired.public_supabase_url or row.upstream_client_id <> desired.upstream_client_id then
      raise exception 'Installation identity conflict' using errcode='22023';
    end if;
  elsif p_action = 'enable' then
    if (select array_agg(key) from jsonb_object_keys(p_payload) key) is distinct from array['enabled']::text[] or jsonb_typeof(p_payload->'enabled') <> 'boolean' then
      raise exception 'Invalid installation request' using errcode='22023';
    end if;
    update vosio_mcp_private.installation set enabled = (p_payload->>'enabled')::boolean where singleton;
    if not found then raise exception 'Installation missing' using errcode='22023'; end if;
  else raise exception 'Invalid installation request' using errcode='22023'; end if;
  select * into row from vosio_mcp_private.installation where singleton;
  if not found then return null; end if;
  return jsonb_build_object('enabled',row.enabled,'webOrigin',row.web_origin,'publicSupabaseUrl',row.public_supabase_url,'upstreamClientId',row.upstream_client_id);
end;
$$;
alter function public.mcp_installation_v1(text,jsonb) owner to postgres;
revoke all on function public.mcp_installation_v1(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_installation_v1(text,jsonb) to service_role;
reset lock_timeout;
reset statement_timeout;
