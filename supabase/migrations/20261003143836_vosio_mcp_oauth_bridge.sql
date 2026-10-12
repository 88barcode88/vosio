-- SOURCE ONLY. Each installation registers its own upstream OAuth client and server key.
-- No application content is available through these credential custody functions.
create schema if not exists vosio_mcp_private;
revoke all on schema vosio_mcp_private from public, anon, authenticated, service_role;

create table vosio_mcp_private.clients (
  id uuid primary key, name text not null check (length(name) between 1 and 100),
  redirects jsonb not null check (jsonb_typeof(redirects)='array' and jsonb_array_length(redirects) between 1 and 10),
  created_at timestamptz not null default clock_timestamp()
);
create table vosio_mcp_private.pending (
  id uuid primary key, client_id uuid not null references vosio_mcp_private.clients(id),
  redirect_uri text not null, resource text not null, state text not null,
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  scopes text[] not null check (scopes @> array['vosio:read'] and scopes <@ array['vosio:read','vosio:write']),
  nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
  upstream_state_hash text unique not null check (upstream_state_hash ~ '^[a-f0-9]{64}$'),
  encrypted text not null check (length(encrypted)<=40000), user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','claimed','denied')),
  expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes')
);
create table vosio_mcp_private.grants (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null, client_id uuid not null references vosio_mcp_private.clients(id),
  resource text not null, scopes text[] not null check (scopes @> array['vosio:read'] and scopes <@ array['vosio:read','vosio:write']),
  encrypted text not null check (length(encrypted)<=40000), upstream_expires_at bigint not null,
  code_hash text unique not null check (code_hash ~ '^[a-f0-9]{64}$'),
  code_expires_at timestamptz not null default (clock_timestamp()+interval '60 seconds'),
  challenge text not null, redirect_uri text not null,
  status text not null default 'awaiting_code' check (status in ('awaiting_code','issuing','active','refreshing','revoked')),
  fence uuid, created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '30 days')
);
create index mcp_grants_user_created on vosio_mcp_private.grants(user_id,created_at desc,id desc);
create table vosio_mcp_private.tokens (
  access_hash text primary key check (access_hash ~ '^[a-f0-9]{64}$'),
  refresh_hash text unique not null check (refresh_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid not null references vosio_mcp_private.grants(id) on delete cascade,
  access_expires_at bigint not null, refresh_consumed boolean not null default false
);
create index mcp_tokens_grant on vosio_mcp_private.tokens(grant_id);

alter table vosio_mcp_private.clients enable row level security;
alter table vosio_mcp_private.clients force row level security;
alter table vosio_mcp_private.pending enable row level security;
alter table vosio_mcp_private.pending force row level security;
alter table vosio_mcp_private.grants enable row level security;
alter table vosio_mcp_private.grants force row level security;
alter table vosio_mcp_private.tokens enable row level security;
alter table vosio_mcp_private.tokens force row level security;
revoke all on all tables in schema vosio_mcp_private from public,anon,authenticated,service_role;

-- Project only the custody fields needed by the trusted bridge, never code/token hashes.
create function vosio_mcp_private.grant_json(g vosio_mcp_private.grants) returns jsonb
language sql immutable set search_path='' as $$
select jsonb_build_object('id',g.id,'user_id',g.user_id,'session_id',g.session_id,'client_id',g.client_id,
  'resource',g.resource,'scopes',g.scopes,'encrypted',g.encrypted,'upstream_expires_at',g.upstream_expires_at,'fence',g.fence);
$$;
revoke all on function vosio_mcp_private.grant_json(vosio_mcp_private.grants) from public,anon,authenticated,service_role;

-- A registered numeric HTTP loopback callback may change only its ephemeral port.
-- The trusted bridge additionally requires MCP_ALLOW_LOOPBACK and a portless numeric origin allowlist.
create function vosio_mcp_private.redirect_matches(registered text,actual text) returns boolean
language sql immutable strict set search_path='' as $$
select registered=actual or (
  registered ~ '^http://(127[.]0[.]0[.]1|[[]::1[]])(:[0-9]{1,5})?/[^?#]*$'
  and actual ~ '^http://(127[.]0[.]0[.]1|[[]::1[]])(:[0-9]{1,5})?/[^?#]*$'
  and regexp_replace(registered,'^(http://(127[.]0[.]0[.]1|[[]::1[]]))(:[0-9]{1,5})?(/.*)$',E'\\1\\4')
    =regexp_replace(actual,'^(http://(127[.]0[.]0[.]1|[[]::1[]]))(:[0-9]{1,5})?(/.*)$',E'\\1\\4')
);
$$;
revoke all on function vosio_mcp_private.redirect_matches(text,text) from public,anon,authenticated,service_role;

-- Fixed service-only cases use row locks and one-use fences before any external token operation.
create function public.mcp_oauth_custody_v1(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p vosio_mcp_private.pending; g vosio_mcp_private.grants; t vosio_mcp_private.tokens;
  c vosio_mcp_private.clients; allowed text[]; grant_id uuid; now_seconds bigint:=extract(epoch from clock_timestamp())::bigint;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536 then raise exception 'invalid custody request' using errcode='22023'; end if;
  allowed:=case p_action
    when 'register' then array['clientId','name','redirects'] when 'client' then array['clientId']
    when 'pending_create' then array['id','clientId','redirectUri','resource','state','challenge','scopes','nonceHash','upstreamStateHash','encrypted']
    when 'pending' then array['id','nonceHash'] when 'pending_approve' then array['id','nonceHash','userId','scopes']
    when 'pending_deny' then array['id','nonceHash'] when 'pending_claim' then array['nonceHash','stateHash']
    when 'grant_create' then array['pendingId','grantId','userId','sessionId','encrypted','upstreamExpiresAt','codeHash']
    when 'code_claim' then array['codeHash','clientId','redirectUri','resource','challenge']
    when 'token_issue' then array['grantId','fence','accessHash','refreshHash','accessExpiresAt']
    when 'access' then array['accessHash','resource'] when 'refresh_claim' then array['refreshHash','clientId','resource']
    when 'refresh_finish' then array['grantId','fence','encrypted','sessionId','upstreamExpiresAt','accessHash','refreshHash','accessExpiresAt']
    when 'revoke' then array['tokenHash','clientId'] when 'revoke_grant' then array['grantId'] else null end;
  if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(allowed)))
    or exists(select 1 from unnest(allowed) k where not(p_payload ? k)) then raise exception 'invalid custody request' using errcode='22023'; end if;
  if p_action='register' then
    -- Serialize the fixed installation cap so concurrent server instances cannot evade it.
    perform pg_advisory_xact_lock(20261003,1);
    if (select count(*) from vosio_mcp_private.clients)>=256 then return null; end if;
    insert into vosio_mcp_private.clients(id,name,redirects) values((p_payload->>'clientId')::uuid,p_payload->>'name',p_payload->'redirects'); return jsonb_build_object('ok',true);
  elsif p_action='client' then
    select * into c from vosio_mcp_private.clients where id=(p_payload->>'clientId')::uuid;
    if not found then return null; end if; return jsonb_build_object('id',c.id,'name',c.name,'redirects',c.redirects);
  elsif p_action='pending_create' then
    -- Temporary credential custody has a bounded live population across every instance.
    perform pg_advisory_xact_lock(20261003,2);
    delete from vosio_mcp_private.pending where expires_at<=clock_timestamp();
    if (select count(*) from vosio_mcp_private.pending)>=1000 then return null; end if;
    select * into c from vosio_mcp_private.clients where id=(p_payload->>'clientId')::uuid
      and exists(select 1 from jsonb_array_elements_text(redirects) r(uri) where vosio_mcp_private.redirect_matches(r.uri,p_payload->>'redirectUri'));
    if not found or length(p_payload->>'state')>1024 or length(p_payload->>'resource')>2000 then return null; end if;
    insert into vosio_mcp_private.pending(id,client_id,redirect_uri,resource,state,challenge,scopes,nonce_hash,upstream_state_hash,encrypted)
      values((p_payload->>'id')::uuid,c.id,p_payload->>'redirectUri',p_payload->>'resource',p_payload->>'state',p_payload->>'challenge',
      array(select jsonb_array_elements_text(p_payload->'scopes')),p_payload->>'nonceHash',p_payload->>'upstreamStateHash',p_payload->>'encrypted'); return jsonb_build_object('ok',true);
  elsif p_action in ('pending','pending_approve','pending_deny') then
    select * into p from vosio_mcp_private.pending where id=(p_payload->>'id')::uuid and nonce_hash=p_payload->>'nonceHash'
      and expires_at>clock_timestamp() and status in ('pending','approved') for update;
    if not found then return null; end if;
    if p_action='pending_approve' then
      if p.status<>'pending' or not(array(select jsonb_array_elements_text(p_payload->'scopes')) <@ p.scopes) then return null; end if;
      update vosio_mcp_private.pending set user_id=(p_payload->>'userId')::uuid,scopes=array(select jsonb_array_elements_text(p_payload->'scopes')),status='approved' where id=p.id returning * into p;
    elsif p_action='pending_deny' then update vosio_mcp_private.pending set status='denied' where id=p.id; return jsonb_build_object('ok',true); end if;
    return jsonb_build_object('id',p.id,'clientId',p.client_id,'redirectUri',p.redirect_uri,'resource',p.resource,'state',p.state,
      'scopes',p.scopes,'userId',p.user_id,'encrypted',p.encrypted,'status',p.status);
  elsif p_action='pending_claim' then
    update vosio_mcp_private.pending set status='claimed' where nonce_hash=p_payload->>'nonceHash' and upstream_state_hash=p_payload->>'stateHash'
      and status='approved' and expires_at>clock_timestamp() returning * into p;
    if not found then return null; end if;
    return jsonb_build_object('id',p.id,'clientId',p.client_id,'redirectUri',p.redirect_uri,'resource',p.resource,'state',p.state,'scopes',p.scopes,'userId',p.user_id,'encrypted',p.encrypted);
  elsif p_action='grant_create' then
    select * into p from vosio_mcp_private.pending where id=(p_payload->>'pendingId')::uuid and status='claimed' and expires_at>clock_timestamp() for update;
    if not found or p.user_id<>(p_payload->>'userId')::uuid or (p_payload->>'upstreamExpiresAt')::bigint<=now_seconds then return null; end if;
    insert into vosio_mcp_private.grants(id,user_id,session_id,client_id,resource,scopes,encrypted,upstream_expires_at,code_hash,challenge,redirect_uri)
      values((p_payload->>'grantId')::uuid,p.user_id,(p_payload->>'sessionId')::uuid,p.client_id,p.resource,p.scopes,p_payload->>'encrypted',
        (p_payload->>'upstreamExpiresAt')::bigint,p_payload->>'codeHash',p.challenge,p.redirect_uri);
    update vosio_mcp_private.pending set status='denied',encrypted='' where id=p.id; return jsonb_build_object('ok',true);
  elsif p_action='code_claim' then
    select * into g from vosio_mcp_private.grants where code_hash=p_payload->>'codeHash' for update;
    if not found or g.client_id<>(p_payload->>'clientId')::uuid or g.resource<>p_payload->>'resource' or g.redirect_uri<>p_payload->>'redirectUri' or g.challenge<>p_payload->>'challenge' then return null; end if;
    if g.status<>'awaiting_code' then update vosio_mcp_private.grants set status='revoked' where id=g.id; return null; end if;
    if g.code_expires_at<=clock_timestamp() or g.upstream_expires_at<=now_seconds then return null; end if;
    update vosio_mcp_private.grants set status='issuing',fence=gen_random_uuid() where id=g.id returning * into g;
    return vosio_mcp_private.grant_json(g);
  elsif p_action='access' then
    select gr.* into g from vosio_mcp_private.tokens tok join vosio_mcp_private.grants gr on gr.id=tok.grant_id
      where tok.access_hash=p_payload->>'accessHash' and tok.access_expires_at>now_seconds and not tok.refresh_consumed
      and gr.status='active' and gr.resource=p_payload->>'resource' and gr.upstream_expires_at>now_seconds and gr.expires_at>clock_timestamp();
    if not found then return null; end if; return vosio_mcp_private.grant_json(g);
  elsif p_action='refresh_claim' then
    select tok.grant_id into grant_id from vosio_mcp_private.tokens tok where refresh_hash=p_payload->>'refreshHash';
    if not found then return null; end if;
    select * into g from vosio_mcp_private.grants where id=grant_id for update;
    if g.client_id<>(p_payload->>'clientId')::uuid or g.resource<>p_payload->>'resource' then return null; end if;
    select * into t from vosio_mcp_private.tokens where refresh_hash=p_payload->>'refreshHash' for update;
    if t.refresh_consumed or g.status<>'active' or g.expires_at<=clock_timestamp() then
      update vosio_mcp_private.grants set status='revoked',encrypted='' where id=g.id; return null;
    end if;
    update vosio_mcp_private.tokens set refresh_consumed=true where access_hash=t.access_hash;
    update vosio_mcp_private.grants set status='refreshing',fence=gen_random_uuid() where id=g.id returning * into g;
    return vosio_mcp_private.grant_json(g);
  elsif p_action in ('token_issue','refresh_finish') then
    select * into g from vosio_mcp_private.grants where id=(p_payload->>'grantId')::uuid for update;
    if not found or g.fence is distinct from (p_payload->>'fence')::uuid or g.status<>(case when p_action='token_issue' then 'issuing' else 'refreshing' end)
      or g.expires_at<=clock_timestamp() then return null; end if;
    if p_action='refresh_finish' then
      if g.session_id<>(p_payload->>'sessionId')::uuid then update vosio_mcp_private.grants set status='revoked',encrypted='' where id=g.id; return null; end if;
      g.encrypted:=p_payload->>'encrypted'; g.upstream_expires_at:=(p_payload->>'upstreamExpiresAt')::bigint;
    end if;
    if (p_payload->>'accessExpiresAt')::bigint<=now_seconds or (p_payload->>'accessExpiresAt')::bigint>least(now_seconds+300,g.upstream_expires_at) then return null; end if;
    insert into vosio_mcp_private.tokens(access_hash,refresh_hash,grant_id,access_expires_at) values(p_payload->>'accessHash',p_payload->>'refreshHash',g.id,(p_payload->>'accessExpiresAt')::bigint);
    update vosio_mcp_private.grants set status='active',fence=null,encrypted=g.encrypted,upstream_expires_at=g.upstream_expires_at where id=g.id;
    return jsonb_build_object('ok',true);
  elsif p_action='revoke' then
    select tok.grant_id into grant_id from vosio_mcp_private.tokens tok join vosio_mcp_private.grants gr on gr.id=tok.grant_id
      where (tok.refresh_hash=p_payload->>'tokenHash' or tok.access_hash=p_payload->>'tokenHash') and gr.client_id=(p_payload->>'clientId')::uuid;
    if found then update vosio_mcp_private.grants set status='revoked',encrypted='' where id=grant_id; end if; return jsonb_build_object('ok',true);
  elsif p_action='revoke_grant' then
    update vosio_mcp_private.grants set status='revoked',encrypted='' where id=(p_payload->>'grantId')::uuid; return jsonb_build_object('ok',true);
  end if;
  raise exception 'invalid custody request' using errcode='22023';
end; $$;
revoke all on function public.mcp_oauth_custody_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.mcp_oauth_custody_v1(text,jsonb) to service_role;

-- Read the current JWT actor/session pair directly, including upstream OAuth session revocation.
create function public.mcp_auth_session_active_v1() returns boolean
language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from auth.sessions s where s.user_id=auth.uid()
  and s.id::text=auth.jwt()->>'session_id'
  and s.oauth_client_id::text is not distinct from nullif(auth.jwt()->>'client_id','')
  and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function public.mcp_auth_session_active_v1() from public,anon;
grant execute on function public.mcp_auth_session_active_v1() to authenticated;

-- Browser users may inspect only their own bounded connection metadata.
create function public.mcp_list_own_connections_v1() returns jsonb
language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(x.item),'[]'::jsonb) from (select jsonb_build_object('id',g.id,'clientName',c.name,'scopes',g.scopes,'createdAt',g.created_at,'status',g.status) item
  from vosio_mcp_private.grants g join vosio_mcp_private.clients c on c.id=g.client_id
  where g.user_id=auth.uid() and public.mcp_auth_session_active_v1() and g.status in ('active','refreshing') order by g.created_at desc,g.id desc limit 50) x;
$$;
-- Browser revoke has no actor argument and cannot touch another user's grant.
create function public.mcp_revoke_own_connection_v1(p_grant_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.mcp_auth_session_active_v1() then return false; end if;
  update vosio_mcp_private.grants set status='revoked',encrypted='' where id=p_grant_id and user_id=auth.uid();
  return found;
end; $$;
revoke all on function public.mcp_list_own_connections_v1() from public,anon;
revoke all on function public.mcp_revoke_own_connection_v1(uuid) from public,anon;
grant execute on function public.mcp_list_own_connections_v1() to authenticated;
grant execute on function public.mcp_revoke_own_connection_v1(uuid) to authenticated;
