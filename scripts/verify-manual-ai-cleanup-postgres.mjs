import { createHash } from "node:crypto";
import console from "node:console";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";

const databaseUrl = process.env.VOSIO_DISPOSABLE_DATABASE_URL;
if (!databaseUrl) {
  console.error("BLOCKED: VOSIO_DISPOSABLE_DATABASE_URL is required for the disposable PostgreSQL proof.");
  process.exit(2);
}

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  console.error("BLOCKED: the disposable PostgreSQL URL is invalid.");
  process.exit(2);
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
if (!loopbackHosts.has(parsedUrl.hostname) || !databaseName.endsWith("_vosio_cleanup_test")) {
  console.error("REFUSED: database must be loopback-only and its name must end with _vosio_cleanup_test.");
  process.exit(2);
}

const psql = process.env.PSQL_PATH || "psql";
const connectionArgs = [
  "-X", "-v", "ON_ERROR_STOP=1", "-h", parsedUrl.hostname.replace(/^\[|\]$/g, ""),
  "-p", parsedUrl.port || "5432", "-U", decodeURIComponent(parsedUrl.username), "-d", databaseName
];
const childEnv = {
  ...process.env,
  PGPASSWORD: decodeURIComponent(parsedUrl.password),
  PGSSLMODE: parsedUrl.searchParams.get("sslmode") || "prefer"
};
const probe = spawnSync(psql, ["--version"], { encoding: "utf8", env: childEnv });
if (probe.error || probe.status !== 0) {
  console.error("BLOCKED: psql is not available for the mandatory real PostgreSQL proof.");
  process.exit(2);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "vosio-manual-cleanup-"));
const cleanupMigrationName = "20260908103000_add_manual_ai_job_cleanup.sql";
const migrationsDirectory = resolve("supabase/migrations");
const activePsqlSessions = new Set();

// runPsql executes one local disposable-database command without printing connection credentials.
function runPsql(args, options = {}) {
  const result = spawnSync(psql, [...connectionArgs, ...args], {
    encoding: "utf8",
    env: childEnv,
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = String(result.stderr || "").replaceAll(databaseUrl, "[redacted]");
    throw new Error(`psql failed without exposing its URL: ${stderr.slice(0, 2_000)}`);
  }
  return result;
}

// runSqlFile writes a temporary UTF-8 proof file and executes it with ON_ERROR_STOP.
function runSqlFile(name, source) {
  const path = join(temporaryDirectory, name);
  writeFileSync(path, source, "utf8");
  return runPsql(["-f", path]);
}

// startPsqlSession opens one named interactive connection for deterministic transaction interleavings.
function startPsqlSession(applicationName) {
  if (!/^[a-z0-9-]+$/.test(applicationName)) throw new Error("Invalid proof session name.");
  const child = spawn(psql, [...connectionArgs, "-qAt"], {
    env: { ...childEnv, PGAPPNAME: applicationName },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const session = { applicationName, child, exited: false, stderr: "", stdout: "" };
  activePsqlSessions.add(session);
  child.stdout.on("data", (chunk) => { session.stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { session.stderr += String(chunk); });
  child.on("exit", () => {
    session.exited = true;
    activePsqlSessions.delete(session);
  });
  return session;
}

// sendSessionSql advances an interactive proof connection without exposing connection credentials.
function sendSessionSql(session, source) {
  if (session.exited || session.child.stdin.destroyed) throw new Error(`${session.applicationName} exited before proof completion.`);
  session.child.stdin.write(`${source.trim()}\n`);
}

// waitForSessionOutput waits for a SQL marker, rejecting on timeout or premature connection exit.
function waitForSessionOutput(session, marker, timeoutMs = 10_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      session.child.stdout.off("data", check);
      session.child.off("error", fail);
      session.child.off("exit", exited);
    };
    const succeed = () => {
      cleanup();
      resolvePromise();
    };
    const fail = (error) => {
      cleanup();
      rejectPromise(error);
    };
    const check = () => {
      if (session.stdout.includes(marker)) succeed();
    };
    const exited = (code) => fail(new Error(
      `${session.applicationName} exited (${code}) before ${marker}: ${session.stderr.replaceAll(databaseUrl, "[redacted]").slice(0, 2_000)}`
    ));
    timer = setTimeout(() => fail(new Error(`${session.applicationName} did not reach ${marker} within ${timeoutMs}ms.`)), timeoutMs);
    session.child.stdout.on("data", check);
    session.child.once("error", fail);
    session.child.once("exit", exited);
    check();
  });
}

// closePsqlSession exits a completed proof connection and verifies its process status.
function closePsqlSession(session) {
  if (session.exited) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    session.child.once("error", rejectPromise);
    session.child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(
        `${session.applicationName} exited (${code}): ${session.stderr.replaceAll(databaseUrl, "[redacted]").slice(0, 2_000)}`
      ));
    });
    session.child.stdin.end("\\q\n");
  });
}

// waitForLockWait proves the named session is blocked on a PostgreSQL lock instead of relying on elapsed time.
async function waitForLockWait(applicationName, timeoutMs = 10_000) {
  if (!/^[a-z0-9-]+$/.test(applicationName)) throw new Error("Invalid proof session name.");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = queryScalar(
      `select count(*) from pg_stat_activity where application_name='${applicationName}' and wait_event_type='Lock'`
    );
    if (waiting === "1") return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`${applicationName} never entered an observed PostgreSQL lock wait.`);
}

// queryScalar returns one unaligned scalar used only for local assertions and fingerprints.
function queryScalar(sql) {
  return String(runPsql(["-At", "-c", sql]).stdout).trim();
}

// assertCompatibleProofRoles keeps cluster-global role setup outside this database-scoped harness.
function assertCompatibleProofRoles() {
  const expectedRoles = [
    { bypassRls: false, name: "anon" },
    { bypassRls: false, name: "authenticated" },
    { bypassRls: true, name: "service_role" }
  ];
  const rawState = queryScalar(String.raw`
select coalesce(jsonb_agg(jsonb_build_object(
  'name', rolname,
  'rolbypassrls', rolbypassrls,
  'rolsuper', rolsuper
) order by rolname), '[]'::jsonb)::text
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role');
  `);
  let roleStates;
  try {
    roleStates = JSON.parse(rawState);
  } catch {
    throw new Error("REFUSED: pre-existing Postgres role state could not be verified.");
  }
  if (!Array.isArray(roleStates)) {
    throw new Error("REFUSED: pre-existing Postgres role state could not be verified.");
  }

  for (const expected of expectedRoles) {
    const state = roleStates.find((candidate) => candidate?.name === expected.name);
    if (!state) {
      throw new Error(`BLOCKED: required pre-existing PostgreSQL role ${expected.name} is missing; configure a disposable Supabase-compatible cluster first.`);
    }
    if (state.rolsuper !== false || state.rolbypassrls !== expected.bypassRls) {
      throw new Error(`REFUSED: pre-existing Postgres role ${expected.name} has incompatible security attributes.`);
    }
  }
}

const bootstrap = String.raw`
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable set search_path = '' as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text not null,
  name text not null, owner uuid
);
create or replace function storage.foldername(name text) returns text[]
language sql immutable set search_path = '' as $$ select string_to_array(name, '/') $$;
grant usage on schema auth, storage to authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant all on storage.buckets, storage.objects to service_role;
grant select, insert, update, delete on storage.objects to authenticated;
`;

const policyFingerprintSql = String.raw`
select encode(digest(jsonb_build_object(
  'rls', (select jsonb_agg(jsonb_build_array(c.relname, c.relrowsecurity, c.relforcerowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'policies', (select coalesce(jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname), '[]'::jsonb)
    from pg_policies p where p.schemaname = 'public')
)::text, 'sha256'), 'hex');
`;

const schemaFingerprintSql = String.raw`
select encode(digest(jsonb_build_object(
  'settle', pg_get_functiondef('public.settle_manual_ai_job_v1(uuid,uuid,uuid,uuid,boolean,integer,integer,text,timestamptz,timestamptz)'::regprocedure),
  'reconcile', pg_get_functiondef('public.reconcile_manual_ai_job_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure),
  'cleanup_objects', (select coalesce(jsonb_agg(jsonb_build_array(c.relkind, c.relname) order by c.relkind, c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like '%manual%cleanup%'),
  'policy_fingerprint', (${policyFingerprintSql.replace(/;\s*$/, "")})
)::text, 'sha256'), 'hex');
`;

try {
  const existingPublicTables = Number(queryScalar(
    "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"
  ));
  if (existingPublicTables !== 0) {
    throw new Error("REFUSED: the disposable database is not empty.");
  }

  assertCompatibleProofRoles();
  runSqlFile("000-bootstrap.sql", bootstrap);
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && name !== cleanupMigrationName)
    .sort();
  for (const migrationFile of migrationFiles) {
    runPsql(["-f", join(migrationsDirectory, migrationFile)]);
  }

  const beforeSchema = queryScalar(schemaFingerprintSql);
  const beforePolicies = queryScalar(policyFingerprintSql);
  const originalSettlement = queryScalar(
    "select pg_get_functiondef('public.settle_manual_ai_job_v1(uuid,uuid,uuid,uuid,boolean,integer,integer,text,timestamptz,timestamptz)'::regprocedure)"
  );

  runPsql(["-f", join(migrationsDirectory, cleanupMigrationName)]);
  const afterPolicies = queryScalar(policyFingerprintSql);
  if (afterPolicies !== beforePolicies) throw new Error("RLS policy or force-RLS fingerprint changed.");

  const fixtureSql = String.raw`
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
insert into public.recordings(id,user_id,title,source_type,status)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Cleanup proof','upload','completed');
insert into public.transcripts(id,recording_id,user_id,raw_text)
values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','proof');

create function pg_temp.add_manual_job(p_id uuid, p_status public.job_status, p_created timestamptz, p_lease uuid default null, p_expiry timestamptz default null)
returns void language sql as $$
  insert into public.ai_processing_jobs(
    id,transcript_id,user_id,provider,model,processing_type,provider_config,status,
    prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact,
    execution_mode,attempt_count,max_attempts,lease_token,lease_expires_at,created_at
  ) values (
    p_id,'30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    'openai','gpt-5.6-terra','summary','{"metadata":{},"temperature":0.2}'::jsonb,p_status,
    'system','Proof','Proof prompt',true,'manual',case when p_status='running' then 1 else 0 end,1,p_lease,p_expiry,p_created
  )
$$;

select pg_temp.add_manual_job('40000000-0000-4000-8000-000000000001','running',now()-interval '10 minutes','50000000-0000-4000-8000-000000000001',now()-interval '2 minutes');
select pg_temp.add_manual_job('40000000-0000-4000-8000-000000000002','running',now()-interval '10 minutes','50000000-0000-4000-8000-000000000002',now()-interval '2 minutes');

-- Every structured dependency family keeps its parent job protected.
select pg_temp.add_manual_job('40000000-0000-4000-8000-000000000010','done',now()-interval '1 day');
select pg_temp.add_manual_job('40000000-0000-4000-8000-000000000011','done',now()-interval '1 day');
select pg_temp.add_manual_job('40000000-0000-4000-8000-000000000012','done',now()-interval '1 day');
select pg_temp.add_manual_job('40000000-0000-4000-8000-000000000013','done',now()-interval '1 day');
select pg_temp.add_manual_job('40000000-0000-4000-8000-000000000014','done',now()-interval '1 day');
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
values ('60000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','projection donor');
insert into public.transcript_tasks(ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values ('60000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'task');
insert into public.transcript_chapters(ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values ('60000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'chapter');
insert into public.transcript_decisions(ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values ('60000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'decision');
insert into public.transcript_risks(ai_output_id,processing_job_id,transcript_id,user_id,position,title)
values ('60000000-0000-4000-8000-000000000010','40000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1,'risk');
do $$ declare v_job uuid; begin
  foreach v_job in array array[
    '40000000-0000-4000-8000-000000000011'::uuid,'40000000-0000-4000-8000-000000000012'::uuid,
    '40000000-0000-4000-8000-000000000013'::uuid,'40000000-0000-4000-8000-000000000014'::uuid
  ] loop
    if exists(select 1 from public.ai_outputs where processing_job_id=v_job)
      then raise exception 'output-less projection parent unexpectedly owns output'; end if;
    if (select result from public.cleanup_manual_ai_jobs_v1(
      array[v_job], '30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()
    )) <> 'protected' then raise exception 'projection family did not protect parent'; end if;
    if not exists(select 1 from public.ai_processing_jobs where id=v_job)
      then raise exception 'projection parent was deleted'; end if;
  end loop;
end $$;
`;
  runSqlFile("100-fixtures-and-races.sql", fixtureSql);

  // Race 1: committed persistence wins while cleanup is observably waiting on its parent lock.
  const persistenceSession = startPsqlSession("vosio-persistence-holds-parent");
  sendSessionSql(persistenceSession, String.raw`
begin;
insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text)
values ('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','durable');
do $$ begin
  if not public.settle_manual_ai_job_v1(
    '40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
    true,1,1,null,null,now()
  ) then raise exception 'settlement-first persistence was rejected'; end if;
end $$;
select 'RACE1_PERSISTENCE_READY';
  `);
  await waitForSessionOutput(persistenceSession, "RACE1_PERSISTENCE_READY");

  const waitingCleanupSession = startPsqlSession("vosio-cleanup-waits-for-persistence");
  sendSessionSql(waitingCleanupSession, String.raw`
begin;
select 'RACE1_RESULT:' || result from public.cleanup_manual_ai_jobs_v1(
  array['40000000-0000-4000-8000-000000000001'::uuid],
  '30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()
);
select 'RACE1_CLEANUP_DONE';
  `);
  await waitForLockWait("vosio-cleanup-waits-for-persistence");
  sendSessionSql(persistenceSession, "commit; select 'RACE1_PERSISTENCE_COMMITTED';");
  await waitForSessionOutput(persistenceSession, "RACE1_PERSISTENCE_COMMITTED");
  await waitForSessionOutput(waitingCleanupSession, "RACE1_CLEANUP_DONE");
  if (!waitingCleanupSession.stdout.includes("RACE1_RESULT:protected")) {
    throw new Error("concurrent settlement-first cleanup was not protected.");
  }
  sendSessionSql(waitingCleanupSession, "commit; select 'RACE1_CLEANUP_COMMITTED';");
  await waitForSessionOutput(waitingCleanupSession, "RACE1_CLEANUP_COMMITTED");
  await Promise.all([closePsqlSession(persistenceSession), closePsqlSession(waitingCleanupSession)]);
  if (queryScalar("select count(*) from public.ai_outputs where id='60000000-0000-4000-8000-000000000001'") !== "1") {
    throw new Error("settlement-first output was lost.");
  }

  // Race 2: cleanup wins while late persistence is observably waiting, then insert and settlement fail closed.
  const cleanupSession = startPsqlSession("vosio-cleanup-holds-parent");
  sendSessionSql(cleanupSession, String.raw`
begin;
select 'RACE2_RESULT:' || result from public.cleanup_manual_ai_jobs_v1(
  array['40000000-0000-4000-8000-000000000002'::uuid],
  '30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()
);
select 'RACE2_CLEANUP_READY';
  `);
  await waitForSessionOutput(cleanupSession, "RACE2_CLEANUP_READY");
  if (!cleanupSession.stdout.includes("RACE2_RESULT:deleted")) {
    throw new Error("cleanup-first transaction did not delete its expired parent.");
  }

  const latePersistenceSession = startPsqlSession("vosio-late-persistence-waits-for-cleanup");
  sendSessionSql(latePersistenceSession, String.raw`
begin;
do $$ begin
  begin
    insert into public.ai_outputs(processing_job_id,transcript_id,user_id,output_text)
    values ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','late');
    raise exception 'late output unexpectedly persisted';
  exception when foreign_key_violation then null; end;
  if public.settle_manual_ai_job_v1(
    '40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002',
    true,1,1,null,null,now()
  ) then raise exception 'late settlement unexpectedly succeeded'; end if;
end $$;
select 'RACE2_LATE_DONE';
  `);
  await waitForLockWait("vosio-late-persistence-waits-for-cleanup");
  sendSessionSql(cleanupSession, "commit; select 'RACE2_CLEANUP_COMMITTED';");
  await waitForSessionOutput(cleanupSession, "RACE2_CLEANUP_COMMITTED");
  await waitForSessionOutput(latePersistenceSession, "RACE2_LATE_DONE");
  sendSessionSql(latePersistenceSession, "commit; select 'RACE2_LATE_COMMITTED';");
  await waitForSessionOutput(latePersistenceSession, "RACE2_LATE_COMMITTED");
  await Promise.all([closePsqlSession(cleanupSession), closePsqlSession(latePersistenceSession)]);
  if (queryScalar("select count(*) from public.ai_processing_jobs where id='40000000-0000-4000-8000-000000000002'") !== "0"
    || queryScalar("select count(*) from public.ai_outputs where processing_job_id='40000000-0000-4000-8000-000000000002'") !== "0") {
    throw new Error("cleanup-first race left a parent or orphan output.");
  }

  const denied = runPsql([
    "-c", "set role authenticated; select * from public.cleanup_manual_ai_jobs_v1(array['40000000-0000-4000-8000-000000000001'::uuid],'30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now())"
  ], { allowFailure: true });
  if (denied.status === 0) throw new Error("authenticated unexpectedly executed privileged cleanup RPC.");

  runSqlFile("110-service-role-success.sql", String.raw`
set role service_role;
select public.classify_manual_ai_job_cleanup_v1(
  'done','manual',1,1,true,'model','prompt','openai','{"metadata":{},"temperature":0.2}',
  now(),null,null,false,false,now()
);
reset role;
`);

  const concurrentIds = ["21", "22"].map((suffix) => `40000000-0000-4000-8000-0000000000${suffix}`);
  runSqlFile("120-deadlock-fixtures.sql", String.raw`
insert into public.ai_processing_jobs(
  id,transcript_id,user_id,provider,model,processing_type,provider_config,status,
  prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact,
  execution_mode,attempt_count,max_attempts,created_at
) values
${concurrentIds.map((id) => `(
  '${id}','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'openai','gpt-5.6-terra','summary','{"metadata":{},"temperature":0.2}','failed',
  'system','Proof','Proof prompt',true,'manual',0,1,now()-interval '1 day'
)`).join(",\n")};
`);
  const concurrencySources = [concurrentIds, [...concurrentIds].reverse()].map((ids) => String.raw`
begin;
select * from public.cleanup_manual_ai_jobs_v1(
  array[${ids.map((id) => `'${id}'::uuid`).join(",")}],
  '30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()
);
select pg_sleep(0.5);
commit;
`);
  const concurrencyFiles = concurrencySources.map((source, index) => {
    const path = join(temporaryDirectory, `130-deadlock-${index}.sql`);
    writeFileSync(path, source, "utf8");
    return path;
  });
  await Promise.all(concurrencyFiles.map((path) => new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(psql, [...connectionArgs, "-f", path], { env: childEnv, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", rejectPromise);
    child.on("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(
      new Error(`concurrent cleanup failed: ${stderr.replaceAll(databaseUrl, "[redacted]").slice(0, 2_000)}`)
    ));
  })));

  const rollbackSql = String.raw`
drop function public.cleanup_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz);
drop function public.list_manual_ai_job_cleanup_v1(uuid,uuid,timestamptz,uuid,integer,timestamptz);
drop function public.classify_manual_ai_jobs_v1(uuid[],uuid,uuid,timestamptz);
drop function public.classify_manual_ai_job_cleanup_v1(
  public.job_status,text,integer,integer,boolean,text,text,public.ai_provider,jsonb,
  timestamptz,uuid,timestamptz,boolean,boolean,timestamptz
);
drop index public.ai_processing_jobs_manual_cleanup_page_idx;
${originalSettlement};
`;
  runSqlFile("900-rollback.sql", rollbackSql);
  const rolledBackSchema = queryScalar(schemaFingerprintSql);
  if (rolledBackSchema !== beforeSchema) throw new Error("cleanup rollback did not restore the pre-schema fingerprint.");

  runPsql(["-f", join(migrationsDirectory, cleanupMigrationName)]);
  const finalPolicies = queryScalar(policyFingerprintSql);
  if (finalPolicies !== beforePolicies) throw new Error("final apply changed the RLS fingerprint.");

  const migrationHash = createHash("sha256")
    .update(readFileSync(join(migrationsDirectory, cleanupMigrationName)))
    .digest("hex");
  console.log(`PASS: disposable PostgreSQL cleanup proof completed; migration sha256=${migrationHash}.`);
} finally {
  for (const session of activePsqlSessions) {
    if (!session.exited) session.child.kill();
  }
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
