-- ONLY for a new disposable native loopback PostgreSQL fixture, never a Supabase/live database.
create role anon nologin nosuperuser nobypassrls;
create role authenticated nologin nosuperuser nobypassrls;
create role service_role nologin nosuperuser bypassrls;
create extension if not exists pgcrypto;
create schema auth;
create schema storage;
create table auth.users (
 id uuid primary key, aud text, role text, email text, email_confirmed_at timestamptz,
 raw_user_meta_data jsonb not null default '{}'::jsonb, raw_app_meta_data jsonb not null default '{}'::jsonb,
 created_at timestamptz default now(), updated_at timestamptz default now()
);
create table auth.sessions(id uuid,user_id uuid,oauth_client_id uuid,not_after timestamptz);
-- Match only the Auth claim interfaces consumed by the installed migrations.
create function auth.uid() returns uuid language sql stable set search_path='' as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
   nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
$$;
create table storage.buckets(id text primary key,name text not null,public boolean not null default false,
 file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),
 name text not null,owner uuid,metadata jsonb not null default '{}'::jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
-- Match Storage policy folder extraction; this fixture does not emulate HTTP or physical audio storage.
create function storage.foldername(name text) returns text[] language sql immutable set search_path='' as $$
 select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1];
$$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select on auth.users to authenticated,service_role;
grant all on storage.buckets,storage.objects to service_role;
grant select,insert,update,delete on storage.objects to authenticated;
