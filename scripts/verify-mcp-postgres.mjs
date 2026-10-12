import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";
import process from "node:process";
import { setTimeout } from "node:timers";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = resolve(root, "supabase/migrations/20261003143836_vosio_mcp_oauth_bridge.sql");
const source = readFileSync(migration, "utf8").replaceAll("\r\n", "\n");
const installationMigration = resolve(root, "supabase/migrations/20261006113000_vosio_mcp_installation.sql");
const installationSource = readFileSync(installationMigration, "utf8").replaceAll("\r\n", "\n");
const registrationSource = readFileSync(resolve(root, "supabase/migrations/20261007100000_vosio_mcp_dynamic_registration.sql"), "utf8").replaceAll("\r\n", "\n");
const connection = process.env.VOSIO_DISPOSABLE_DATABASE_URL;
const psql = process.env.PSQL_BIN || "psql";
let url;
try { url = new URL(connection || ""); } catch { throw new Error("BLOCKED: provide VOSIO_DISPOSABLE_DATABASE_URL for an already prepared disposable database."); }
const database = decodeURIComponent(url.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  || !/^[a-z0-9_]+_mcp_test$/.test(database) || database.length > 63 || !url.username || url.hash
  || [...url.searchParams.keys()].some((key) => key !== "sslmode")) throw new Error("REFUSED: only an explicitly named, owned loopback _mcp_test database is allowed.");
const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", url.hostname.replace(/^\[|\]$/g, ""), "-p", url.port || "5432", "-U", decodeURIComponent(url.username), "-d", database];
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGCLIENTENCODING: "UTF8", PGSSLMODE: url.searchParams.get("sslmode") || "prefer", PGOPTIONS: "-c statement_timeout=15000 -c lock_timeout=10000" };
const results = []; const sessions = []; const runId = randomUUID();
let observedLockRaces = 4;

// Execute only the explicitly guarded disposable target and never log its credential-bearing URL.
function sql(text, allowFailure = false) {
  const result = spawnSync(psql, [...args, "-f", "-"], { input: text, encoding: "utf8", env, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0 && !allowFailure) throw new Error(`Local PostgreSQL proof failed: ${String(result.stderr || result.error?.message || "unknown error").replaceAll(connection, "[redacted]").slice(0, 2500)}`);
  return result;
}
// Quote only generated fixture values and fixed proof metadata, never external SQL text.
function lit(value) { return `'${String(value).replaceAll("'", "''")}'`; }
// Read one scalar without printing synthetic rows or custody material.
function scalar(text) { return sql(text).stdout.trim(); }
// Parse a nullable JSON RPC result under the actual caller role.
function json(text) { const value = scalar(text); return value ? JSON.parse(value) : null; }
// Hash all opaque test credentials before sending them to custody RPCs.
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
// Generate a fresh opaque test credential without a embedded actor identity.
function opaque() { return randomBytes(32).toString("base64url"); }
// Record only the completed case name in the reproducible receipt.
function pass(name) { results.push(name); console.log(`PASS ${name}`); }
// Install real role and JWT claims for canonical RLS checks.
function auth(user, session, client, role = "authenticated") {
  const claims = JSON.stringify({ sub: user, session_id: session, ...(client ? { client_id: client } : {}), aud: "authenticated", role });
  return `set role ${role}; do $claims$ begin perform set_config('request.jwt.claim.sub',${lit(user)},false); perform set_config('request.jwt.claims',${lit(claims)},false); end $claims$;`;
}
// Invoke the fixed service-only custody API instead of writing grants through a broad API.
function call(action, payload) { return `select public.mcp_oauth_custody_v1(${lit(action)},${lit(JSON.stringify(payload))}::jsonb);`; }
// Run one custody action as the real non-superuser service role.
function custody(action, payload) { return json(`set role service_role; ${call(action, payload)}`); }
// Assert SQLSTATE inside a transaction without depending on localized database messages.
function rejected(statement, state = "42501") { return `do $proof$ begin ${statement.replace(/^select /, "perform ")} raise exception 'expected denial'; exception when sqlstate '${state}' then null; end $proof$;`; }

// Require ownership, known Supabase-compatible roles, empty fixtures and an existing application baseline.
function preflight() {
  const facts = json(`select jsonb_build_object('owned',(select datdba=(select oid from pg_roles where rolname=current_user) from pg_database where datname=current_database()),'users',(select count(*) from auth.users),'baseline',to_regprocedure('public.recording_capabilities_v1(uuid)') is not null);`);
  if (!facts?.owned || facts.users !== 0 || !facts.baseline) throw new Error("REFUSED: target must be owned, already bootstrapped with the Vosio baseline, and contain no user fixtures. This script never bootstraps or resets an unknown/nonempty target.");
  const roles = json("select jsonb_object_agg(rolname,jsonb_build_object('super',rolsuper,'bypass',rolbypassrls)) from pg_roles where rolname in ('anon','authenticated','service_role');");
  for (const name of ["anon", "authenticated", "service_role"]) assert.deepEqual(roles[name], { super: false, bypass: name === "service_role" });
  const installed = scalar("select to_regprocedure('public.mcp_oauth_custody_v1(text,jsonb)') is not null;") === "t";
  if (!installed) {
    if (!process.argv.includes("--apply")) throw new Error("BLOCKED: migration missing; explicitly pass --apply on the already prepared, empty owned target.");
    const applied = spawnSync(psql, [...args, "-1", "-f", migration], { encoding: "utf8", env });
    if (applied.status !== 0) throw new Error(`Atomic local migration apply failed: ${String(applied.stderr).slice(0, 2000)}`);
  }
  assert.equal(scalar("select count(*) from vosio_mcp_private.clients;"), "0");
  // Compare the actual function bodies to the exact source being proved, rather than trusting an old apply.
  for (const [name, signature] of [["mcp_oauth_custody_v1", "text,jsonb"], ["mcp_auth_session_active_v1", ""], ["mcp_list_own_connections_v1", ""], ["mcp_revoke_own_connection_v1", "uuid"]]) {
    const start = source.indexOf(`create function public.${name}(`); const open = source.indexOf("as $$", start) + 5; const close = source.indexOf("$$;", open);
    assert(start >= 0 && open > start && close > open);
    const actual = scalar(`select prosrc from pg_proc where oid=${lit(`public.${name}(${signature})`)}::regprocedure;`).replaceAll("\r\n", "\n").trim();
    assert.equal(hash(actual), hash(source.slice(open, close).trim()), `installed ${name} source differs`);
  }
  for (const [name, signature] of [["redirect_matches", "text,text"], ["grant_json", "vosio_mcp_private.grants"]]) {
    const start = source.indexOf(`create function vosio_mcp_private.${name}(`); const open = source.indexOf("as $$", start) + 5; const close = source.indexOf("$$;", open);
    assert(start >= 0 && open > start && close > open);
    const actual = scalar(`select prosrc from pg_proc where oid=${lit(`vosio_mcp_private.${name}(${signature})`)}::regprocedure;`).replaceAll("\r\n", "\n").trim();
    assert.equal(hash(actual), hash(source.slice(open, close).trim()), `installed private ${name} source differs`);
  }
  pass("owned_empty_loopback_baseline_exact_forward_source_and_real_roles");
}

// Seed only generated users, content and sessions without calling any paid provider.
function fixture() {
  const names = ["founder", "author", "editor", "reader", "selectedE", "selectedR", "outsider", "other"];
  const f = Object.fromEntries([...names, "project", "projectRecording", "privateRecording", "privateProjectRecording", "selectedRecording", "standaloneSelected", "deletedRecording", "transcript", "job", "output", "task", "upstreamClient", "client", "browserSession"].map((name) => [name, randomUUID()]));
  f.sessions = Object.fromEntries(names.map((name) => [name, randomUUID()]));
  sql(`begin; insert into auth.users(id,aud,role,email,email_confirmed_at) select x,'authenticated','authenticated',x::text||'@mcp-proof.invalid',now() from unnest(array[${names.map((name) => `${lit(f[name])}::uuid`).join(",")}])x;
  ${names.map((name) => `insert into auth.sessions(id,user_id,oauth_client_id) values(${lit(f.sessions[name])},${lit(f[name])},${lit(f.upstreamClient)});`).join("\n")}
  insert into auth.sessions(id,user_id,oauth_client_id) values(${lit(f.browserSession)},${lit(f.editor)},null);
  insert into public.recording_projects(id,user_id,name) values(${lit(f.project)},${lit(f.founder)},'Synthetic MCP project');
  insert into public.recording_project_members(project_id,user_id,role) values(${lit(f.project)},${lit(f.editor)},'editor'),(${lit(f.project)},${lit(f.reader)},'reader'),(${lit(f.project)},${lit(f.author)},'editor');
  insert into public.recordings(id,user_id,created_by,title,source_type,status,project_id,visibility,deleted_from_status,deleted_at,trash_retention_hours,purge_after) values
  ${[["projectRecording", "project", "project"], ["privateRecording", "private", null], ["privateProjectRecording", "private", "project"], ["selectedRecording", "selected", "project"], ["standaloneSelected", "selected", null], ["deletedRecording", "project", "project"]].map(([name, visibility, project]) => `(${lit(f[name])},${lit(f.author)},${lit(f.author)},'Synthetic ${name}','upload',${lit(name === "deletedRecording" ? "deleted" : "completed")},${project ? lit(f.project) : "null"},${lit(name === "projectRecording" ? "private" : visibility)},${name === "deletedRecording" ? "'completed',now(),24,now()+interval '24 hours'" : "null,null,null,null"})`).join(",")};
  ${["selectedRecording", "standaloneSelected"].map((name) => `insert into public.recording_access_grants(recording_id,user_id,role,scope_project_id) values(${lit(f[name])},${lit(f.selectedE)},'editor',${name === "selectedRecording" ? lit(f.project) : "null"}),(${lit(f[name])},${lit(f.selectedR)},'reader',${name === "selectedRecording" ? lit(f.project) : "null"});`).join("\n")}
  insert into public.transcripts(id,recording_id,user_id,raw_text,speakers,segments,completion_generation_key) values(${lit(f.transcript)},${lit(f.projectRecording)},${lit(f.author)},'Synthetic transcript','[{"id":"1","name":null,"role":"unknown"}]','[{"speaker":"1","text":"Synthetic","start_ms":0,"end_ms":20}]','proof:current-generation');
  insert into public.ai_processing_jobs(id,transcript_id,user_id,provider,model,processing_type,status,prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_snapshot_exact) values(${lit(f.job)},${lit(f.transcript)},${lit(f.author)},'openai','synthetic-no-provider','action_items','done','system','Synthetic','Synthetic',true);
  insert into public.ai_outputs(id,processing_job_id,transcript_id,user_id,output_text) values(${lit(f.output)},${lit(f.job)},${lit(f.transcript)},${lit(f.author)},'Synthetic historical source');
  insert into public.transcript_tasks(id,ai_output_id,processing_job_id,transcript_id,user_id,position,title,owner_category) values(${lit(f.task)},${lit(f.output)},${lit(f.job)},${lit(f.transcript)},${lit(f.author)},1,'Synthetic task','Klient');
  ${auth(f.author, f.sessions.author, f.upstreamClient)} select public.share_recording_v1(${lit(f.projectRecording)},'project','[]');
  ${auth(f.founder, f.sessions.founder, f.upstreamClient)} select public.revoke_project_member_v1(${lit(f.project)},${lit(f.author)}); commit;`);
  assert.deepEqual(custody("register", { clientId: f.client, name: "Synthetic host", redirects: ["https://host.example/callback", "http://127.0.0.1:40000/callback", "http://[::1]:40000/callback"] }), { ok: true });
  return f;
}

// Build a genuine approved/claimed grant through the narrow custody workflow.
function grant(f, options = {}) {
  const g = { id: randomUUID(), pendingId: randomUUID(), clientId: f.client, userId: f.editor, sessionId: f.sessions.editor,
    resource: "https://installation.example/api/mcp", redirectUri: options.redirectUri || "https://host.example/callback", scopes: ["vosio:read", "vosio:write"], codeHash: hash(opaque()), nonceHash: hash(opaque()), stateHash: hash(opaque()), challenge: createHash("sha256").update(opaque()).digest("base64url"), upstreamExpiresAt: Math.floor(Date.now() / 1000) + 3600 };
  g.clientId = options.clientId || g.clientId;
  assert.deepEqual(custody("pending_create", { id: g.pendingId, clientId: g.clientId, redirectUri: g.redirectUri, resource: g.resource, state: "synthetic-state", challenge: g.challenge, scopes: g.scopes, nonceHash: g.nonceHash, upstreamStateHash: g.stateHash, encrypted: "synthetic-encrypted-verifier" }), { ok: true });
  assert.equal(custody("pending_approve", { id: g.pendingId, nonceHash: g.nonceHash, userId: g.userId, scopes: g.scopes }).userId, g.userId);
  assert.equal(custody("pending_claim", { nonceHash: g.nonceHash, stateHash: g.stateHash }).id, g.pendingId);
  assert.equal(custody("pending_claim", { nonceHash: g.nonceHash, stateHash: g.stateHash }), null);
  assert.deepEqual(custody("grant_create", { pendingId: g.pendingId, grantId: g.id, userId: g.userId, sessionId: g.sessionId, encrypted: "synthetic-encrypted-upstream", upstreamExpiresAt: g.upstreamExpiresAt, codeHash: g.codeHash }), { ok: true });
  return g;
}
// Claim the downstream code using the exact selected redirect, resource, client and PKCE challenge.
function codeArgs(g) { return { codeHash: g.codeHash, clientId: g.clientId, redirectUri: g.redirectUri, resource: g.resource, challenge: g.challenge }; }
// Produce fresh hashed bridge credentials within the maximum 300-second lifetime.
function tokenArgs(g, fence) { return { grantId: g.id, fence, accessHash: hash(opaque()), refreshHash: hash(opaque()), accessExpiresAt: Math.floor(Date.now() / 1000) + 250 }; }
// Activate a synthetic grant solely through code consumption and the returned database fence.
function issue(g) { const claimed = custody("code_claim", codeArgs(g)); const tokens = tokenArgs(g, claimed.fence); assert.deepEqual(custody("token_issue", tokens), { ok: true }); return tokens; }
// Build the exact successful refresh finish receipt, using the previously claimed fence.
function finishArgs(g, fence) { return { ...tokenArgs(g, fence), sessionId: g.sessionId, encrypted: "synthetic-rotated-upstream", upstreamExpiresAt: g.upstreamExpiresAt }; }

// Open a genuinely independent backend for transaction interleaving and observed lock waits.
function session(label) {
  const name = `mcp-${runId.slice(0, 8)}-${label}`;
  const child = spawn(psql, args, { env: { ...env, PGAPPNAME: name }, stdio: ["pipe", "pipe", "pipe"] });
  const s = { name, child, out: "", err: "", exited: false }; sessions.push(s);
  child.stdout.on("data", (data) => { s.out += data; }); child.stderr.on("data", (data) => { s.err += data; }); child.on("exit", () => { s.exited = true; });
  return s;
}
// Send one deterministic SQL step without timing-based assumptions about transaction ordering.
function send(s, text) { if (s.exited) throw new Error("Proof backend exited early."); s.child.stdin.write(`${text}\n`); }
// Wait for a backend marker while rejecting timeouts and real PostgreSQL errors.
async function marker(s, text) {
  const deadline = Date.now() + 10000;
  while (!s.out.includes(text)) { if (s.exited || Date.now() > deadline) throw new Error(`Proof backend failed before ${text}: ${s.err.slice(0, 1500)}`); await new Promise((done) => setTimeout(done, 20)); }
}
// Observe pg_stat_activity Lock state, proving another actual backend is waiting on the held row.
async function blocked(s) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (scalar(`select count(*) from pg_stat_activity where application_name=${lit(s.name)} and wait_event_type='Lock';`) === "1") return; await new Promise((done) => setTimeout(done, 25)); }
  throw new Error("Expected PostgreSQL lock wait was not observed.");
}
// Close completed proof sessions and require zero process exit status.
async function close(s) { const exited = new Promise((done, fail) => { s.child.once("exit", (code) => code === 0 ? done() : fail(new Error(`Backend failed: ${s.err}`))); }); s.child.stdin.end("\\q\n"); await exited; }

// Prove private ACLs, real current sessions, immutable code bindings and refresh rotation behavior.
function sequential(f) {
  for (const role of ["anon", "authenticated", "service_role"]) {
    sql(`set role ${role}; ${rejected("select * from vosio_mcp_private.grants;")}`);
    if (role !== "service_role") sql(`set role ${role}; ${rejected(call("client", { clientId: f.client }))}`);
    pass(`private_custody_direct_acl_${role}`);
  }
  assert.equal(scalar("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vosio_mcp_private' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity;"), "5"); pass("private_tables_force_rls");
  sql(`set role service_role; ${rejected(call("client", { clientId: f.client, actor: f.editor }), "22023")}`); pass("strict_service_action_payload_no_actor");
  const actor = auth(f.editor, f.sessions.editor, f.upstreamClient);
  assert.equal(scalar(`${actor} select public.mcp_auth_session_active_v1();`), "t");
  assert.equal(scalar(`${auth(f.outsider, f.sessions.editor, f.upstreamClient)} select public.mcp_auth_session_active_v1();`), "f");
  assert.equal(scalar(`${auth(f.editor, f.sessions.editor, randomUUID())} select public.mcp_auth_session_active_v1();`), "f");
  sql(`update auth.sessions set not_after=now()-interval '1 second' where id=${lit(f.sessions.editor)};`); assert.equal(scalar(`${actor} select public.mcp_auth_session_active_v1();`), "f");
  sql(`update auth.sessions set not_after=null where id=${lit(f.sessions.editor)};`); pass("actual_session_actor_oauth_client_and_not_after");
  const missing = randomUUID(); assert.equal(scalar(`${auth(f.editor, missing, f.upstreamClient)} select public.mcp_auth_session_active_v1();`), "f");
  const deleted = randomUUID(); sql(`insert into auth.sessions(id,user_id,oauth_client_id) values(${lit(deleted)},${lit(f.editor)},${lit(f.upstreamClient)}); delete from auth.sessions where id=${lit(deleted)};`);
  assert.equal(scalar(`${auth(f.editor, deleted, f.upstreamClient)} select public.mcp_auth_session_active_v1();`), "f"); pass("deleted_or_absent_session_denied");
  const g = grant(f);
  for (const [field, wrong] of [["resource", "https://wrong.example/api/mcp"], ["clientId", randomUUID()], ["redirectUri", "https://host.example/other"], ["challenge", createHash("sha256").update(opaque()).digest("base64url")]]) { assert.equal(custody("code_claim", { ...codeArgs(g), [field]: wrong }), null); pass(`code_binding_${field}`); }
  const claimed = custody("code_claim", codeArgs(g)); const args = tokenArgs(g, claimed.fence);
  assert.equal(custody("token_issue", { ...args, accessExpiresAt: Math.floor(Date.now() / 1000) + 400 }), null); pass("access_lifetime_cannot_exceed_300_seconds");
  assert.deepEqual(custody("token_issue", args), { ok: true }); assert.equal(custody("access", { accessHash: args.accessHash, resource: g.resource }).id, g.id);
  assert.equal(custody("access", { accessHash: args.accessHash, resource: "https://wrong.example/api/mcp" }), null); pass("resource_bound_access_no_cross_installation");
  assert.equal(custody("code_claim", codeArgs(g)), null); assert.equal(custody("access", { accessHash: args.accessHash, resource: g.resource }), null); pass("code_replay_revokes_existing_family");
  const expired = grant(f); sql(`update vosio_mcp_private.grants set code_expires_at=now()-interval '1 second' where id=${lit(expired.id)};`); assert.equal(custody("code_claim", codeArgs(expired)), null); pass("expired_code_denied");
  const rotated = grant(f); const old = issue(rotated);
  assert.equal(custody("refresh_claim", { refreshHash: old.refreshHash, clientId: randomUUID(), resource: rotated.resource }), null);
  assert.equal(custody("refresh_claim", { refreshHash: old.refreshHash, clientId: rotated.clientId, resource: "https://wrong.example/api/mcp" }), null);
  const refresh = custody("refresh_claim", { refreshHash: old.refreshHash, clientId: rotated.clientId, resource: rotated.resource });
  assert.equal(custody("access", { accessHash: old.accessHash, resource: rotated.resource }), null); pass("refresh_claim_consumes_old_opaque_tokens_before_upstream");
  const next = finishArgs(rotated, refresh.fence); assert.deepEqual(custody("refresh_finish", next), { ok: true }); assert.equal(custody("access", { accessHash: next.accessHash, resource: rotated.resource }).id, rotated.id);
  assert.equal(custody("refresh_claim", { refreshHash: old.refreshHash, clientId: rotated.clientId, resource: rotated.resource }), null); assert.equal(custody("access", { accessHash: next.accessHash, resource: rotated.resource }), null); pass("refresh_reuse_revokes_rotated_family");
  const own = grant(f); const ownedToken = issue(own);
  assert.equal(json(`${auth(f.outsider, f.sessions.outsider, f.upstreamClient)} select public.mcp_list_own_connections_v1();`).length, 0);
  assert.equal(scalar(`${auth(f.outsider, f.sessions.outsider, f.upstreamClient)} select public.mcp_revoke_own_connection_v1(${lit(own.id)});`), "f");
  const connections = json(`${actor} select public.mcp_list_own_connections_v1();`); assert(connections.some((item) => item.id === own.id)); assert(!JSON.stringify(connections).includes("encrypted"));
  assert.equal(scalar(`${actor} select public.mcp_revoke_own_connection_v1(${lit(own.id)});`), "t"); assert.equal(custody("access", { accessHash: ownedToken.accessHash, resource: own.resource }), null); pass("own_connections_only_and_revoke_next_request");
  const ttl = grant(f); const tt = issue(ttl); sql(`update vosio_mcp_private.tokens set access_expires_at=extract(epoch from now())::bigint-1 where access_hash=${lit(tt.accessHash)};`); assert.equal(custody("access", { accessHash: tt.accessHash, resource: ttl.resource }), null); pass("expired_access_token_denied");
  const dynamic = grant(f, { redirectUri: "http://127.0.0.1:53219/callback" });
  assert.equal(custody("code_claim", { ...codeArgs(dynamic), redirectUri: "http://127.0.0.1:40000/callback" }), null); assert.equal(custody("code_claim", codeArgs(dynamic)).id, dynamic.id); pass("numeric_loopback_registration_port_exception_exact_code_selected_port");
  assert.equal(scalar("select vosio_mcp_private.redirect_matches('http://[::1]:40000/callback','http://[::1]:53219/callback');"), "t");
  for (const actual of ["http://localhost:53219/callback", "http://127.0.0.1:53219/other", "http://127.0.0.1:53219/callback?extra=1", "http://127.0.0.1:53219/callback#fragment", "http://192.168.1.1:53219/callback"]) assert.equal(scalar(`select vosio_mcp_private.redirect_matches('http://127.0.0.1:40000/callback',${lit(actual)});`), "f"); assert.equal(scalar("select vosio_mcp_private.redirect_matches('http://127.0.0.1:40000/callback?extra=1','http://127.0.0.1:53219/callback?extra=1');"), "f"); pass("loopback_exception_never_changes_host_path_query_fragment");
  sql(`begin; insert into vosio_mcp_private.clients(id,name,redirects) select gen_random_uuid(),'Synthetic cap','["https://host.example/callback"]' from generate_series(1,256-(select count(*) from vosio_mcp_private.clients)::integer); set role service_role; do $cap$ begin if public.mcp_oauth_custody_v1('register',${lit(JSON.stringify({ clientId: randomUUID(), name: "cap overflow", redirects: ["https://host.example/callback"] }))}::jsonb) is not null then raise exception 'client cap bypassed'; end if; end $cap$; rollback;`); pass("durable_client_cap_256");
  sql(`begin; insert into vosio_mcp_private.pending(id,client_id,redirect_uri,resource,state,challenge,scopes,nonce_hash,upstream_state_hash,encrypted) select gen_random_uuid(),${lit(f.client)},'https://host.example/callback','https://installation.example/api/mcp','synthetic',${lit(opaque())},array['vosio:read'],repeat('a',64),md5(n::text)||md5('state'||n::text),'synthetic' from generate_series(1,1000-(select count(*) from vosio_mcp_private.pending)::integer)n; set role service_role; do $cap$ begin if public.mcp_oauth_custody_v1('pending_create',${lit(JSON.stringify({ id: randomUUID(), clientId: f.client, redirectUri: "https://host.example/callback", resource: "https://installation.example/api/mcp", state: "", challenge: opaque(), scopes: ["vosio:read"], nonceHash: hash(opaque()), upstreamStateHash: hash(opaque()), encrypted: "synthetic" }))}::jsonb) is not null then raise exception 'pending cap bypassed'; end if; end $cap$; rollback;`); pass("durable_pending_cap_1000");
}

// Prove actual canonical role/RLS behavior without pretending manager Trash reads are MCP access.
function contentMatrix(f) {
  const matrix = [["founder", "projectRecording", true, true], ["editor", "projectRecording", true, true], ["reader", "projectRecording", true, false], ["author", "projectRecording", false, false], ["outsider", "projectRecording", false, false], ["author", "privateRecording", true, true], ["founder", "privateRecording", false, false], ["author", "privateProjectRecording", true, true], ["founder", "privateProjectRecording", false, false], ["editor", "privateProjectRecording", false, false], ["selectedE", "selectedRecording", true, true], ["selectedR", "selectedRecording", true, false], ["editor", "selectedRecording", false, false], ["founder", "selectedRecording", true, true], ["selectedE", "standaloneSelected", true, true], ["author", "standaloneSelected", true, true], ["outsider", "standaloneSelected", false, false], ["founder", "deletedRecording", true, false], ["editor", "deletedRecording", false, false], ["reader", "deletedRecording", false, false]];
  for (const [name, recording, read, edit] of matrix) {
    const caller = auth(f[name], f.sessions[name], f.upstreamClient);
    const cap = json(`${caller} select public.recording_capabilities_v1(${lit(f[recording])});`) ?? { read: false, editTitle: false, editSpeakers: false, editTaskStatus: false };
    assert.equal(cap.read, read); assert.equal(cap.editTitle, edit); assert.equal(cap.editSpeakers, edit); assert.equal(cap.editTaskStatus, edit);
    assert.equal(scalar(`${caller} select count(*) from public.recordings where id=${lit(f[recording])};`), read ? "1" : "0");
    if (edit) { sql(`${caller} select public.edit_recording_title_v1(${lit(f[recording])},'Synthetic exact ${name}');`); assert.equal(scalar(`select title from public.recordings where id=${lit(f[recording])};`), `Synthetic exact ${name}`); }
    else sql(`${caller} ${rejected(`select public.edit_recording_title_v1(${lit(f[recording])},'Denied');`)}`);
    pass(`canonical_${name}_${recording}_read_${read}_edit_${edit}`);
  }
  const editor = auth(f.editor, f.sessions.editor, f.upstreamClient); const reader = auth(f.reader, f.sessions.reader, f.upstreamClient);
  sql(`${editor} select public.edit_recording_task_status_v1(${lit(f.task)},'done');`); assert.equal(scalar(`select status from public.transcript_tasks where id=${lit(f.task)};`), "done");
  sql(`${reader} ${rejected(`select public.edit_recording_task_status_v1(${lit(f.task)},'new');`)}`); assert.equal(scalar(`select status from public.transcript_tasks where id=${lit(f.task)};`), "done"); pass("exact_task_status_editor_saved_reader_denied");
  assert.equal(json(`${editor} select public.patch_transcript_speaker_v1(${lit(f.transcript)},'1',0,'Eva','delivery_team');`).outcome, "saved");
  const conflict = json(`${editor} select public.patch_transcript_speaker_v1(${lit(f.transcript)},'1',0,'Overwritten','unknown');`); assert.equal(conflict.outcome, "conflict"); assert.equal(conflict.speaker.name, "Eva"); pass("actual_speaker_cas_conflict_preserves_fresh_slot");
  assert.equal(scalar(`${editor} with changed as (update public.recordings set title='Direct bypass' where id=${lit(f.projectRecording)} returning id) select count(*) from changed;`), "0"); assert.notEqual(scalar(`select title from public.recordings where id=${lit(f.projectRecording)};`), "Direct bypass"); pass("no_broad_content_update_grant_widening");
  assert.equal(json(`${editor} select public.recording_capabilities_v1(${lit(f.projectRecording)});`).editTitle, true);
  sql(`update public.recording_project_members set role='reader' where project_id=${lit(f.project)} and user_id=${lit(f.editor)};`);
  sql(`${editor} ${rejected(`select public.edit_recording_title_v1(${lit(f.projectRecording)},'Stale precheck');`)}`); pass("fresh_locked_title_write_denies_after_role_downgrade");
  sql(`update public.recording_project_members set role='editor',revoked_at=now() where project_id=${lit(f.project)} and user_id=${lit(f.editor)};`); assert.equal(json(`${editor} select public.recording_capabilities_v1(${lit(f.projectRecording)});`)?.read ?? false, false); pass("revoked_project_member_loses_current_read");
  sql(`update public.recording_access_grants set revoked_at=now() where recording_id=${lit(f.selectedRecording)} and user_id=${lit(f.selectedE)};`); assert.equal(json(`${auth(f.selectedE, f.sessions.selectedE, f.upstreamClient)} select public.recording_capabilities_v1(${lit(f.selectedRecording)});`)?.read ?? false, false); pass("revoked_selected_grant_loses_current_read");
  assert.equal(scalar(`${auth(f.selectedR, f.sessions.selectedR, f.upstreamClient)} select count(*) from public.recording_projects where id=${lit(f.project)};`), "0"); pass("selected_recording_never_reveals_general_project_taxonomy");
}

// Exercise two real sessions per race and assert an observed row lock before releasing the winner.
async function races(f) {
  const code = grant(f); const c1 = session("code-first"); const c2 = session("code-replay");
  send(c1, `begin; set role service_role; ${call("code_claim", codeArgs(code))} \n\\echo CODE_HELD`); await marker(c1, "CODE_HELD");
  send(c2, `begin; set role service_role; ${call("code_claim", codeArgs(code))} commit; \n\\echo CODE_REPLAY_DONE`); await blocked(c2); send(c1, "commit;"); await marker(c2, "CODE_REPLAY_DONE");
  assert.equal(scalar(`select status from vosio_mcp_private.grants where id=${lit(code.id)};`), "revoked"); await close(c1); await close(c2); pass("race_code_replay_observed_lock_then_family_revocation");
  const refresh = grant(f); const tokens = issue(refresh); const r1 = session("refresh-first"); const r2 = session("refresh-reuse"); const claim = { refreshHash: tokens.refreshHash, clientId: refresh.clientId, resource: refresh.resource };
  send(r1, `begin; set role service_role; ${call("refresh_claim", claim)} \n\\echo REFRESH_HELD`); await marker(r1, "REFRESH_HELD");
  send(r2, `begin; set role service_role; ${call("refresh_claim", claim)} commit; \n\\echo REFRESH_REUSE_DONE`); await blocked(r2); send(r1, "commit;"); await marker(r2, "REFRESH_REUSE_DONE");
  assert.equal(scalar(`select status from vosio_mcp_private.grants where id=${lit(refresh.id)};`), "revoked"); await close(r1); await close(r2); pass("race_refresh_claim_reuse_observed_lock_then_family_revocation");
  for (const revokeFirst of [true, false]) {
    const g = grant(f); const old = issue(g); const claimed = custody("refresh_claim", { refreshHash: old.refreshHash, clientId: g.clientId, resource: g.resource }); const finish = finishArgs(g, claimed.fence);
    const one = session(`revoke-finish-${revokeFirst}-a`); const two = session(`revoke-finish-${revokeFirst}-b`);
    const revoke = call("revoke_grant", { grantId: g.id }); const finished = call("refresh_finish", finish);
    send(one, `begin; set role service_role; ${revokeFirst ? revoke : finished} \n\\echo WINNER_HELD`); await marker(one, "WINNER_HELD");
    send(two, `begin; set role service_role; ${revokeFirst ? finished : revoke} commit; \n\\echo FOLLOWER_DONE`); await blocked(two); send(one, "commit;"); await marker(two, "FOLLOWER_DONE");
    assert.equal(custody("access", { accessHash: finish.accessHash, resource: g.resource }), null); assert.equal(scalar(`select status from vosio_mcp_private.grants where id=${lit(g.id)};`), "revoked");
    if (revokeFirst) assert.equal(scalar(`select count(*) from vosio_mcp_private.tokens where access_hash=${lit(finish.accessHash)};`), "0");
    await close(one); await close(two); pass(`race_${revokeFirst ? "revoke_before_finish" : "finish_before_revoke"}_observed_lock_current_access_denied`);
  }
}

// Rehearse additive installation metadata with existing synthetic content/grants, then prove its ACL.
function installationProof(f) {
  grant(f);
  const tables = ["recordings", "transcripts", "storage.objects", "vosio_mcp_private.clients", "vosio_mcp_private.pending", "vosio_mcp_private.grants", "vosio_mcp_private.tokens"];
  const snapshot = () => tables.map((table) => scalar(`select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),'')) from ${table} t;`));
  const before = snapshot();
  if (scalar("select to_regprocedure('public.mcp_installation_v1(text,jsonb)') is null;") !== "t") throw new Error("Use a fresh prepared target for additive migration rehearsal.");
  sql(`begin; ${installationSource} rollback;`);
  assert.equal(scalar("select to_regprocedure('public.mcp_installation_v1(text,jsonb)') is null;"), "t");
  assert.deepEqual(snapshot(), before); pass("installation_rollback_rehearsal_preserves_content_storage_and_existing_grants");
  if (!process.argv.includes("--apply")) throw new Error("BLOCKED: installation forward needs explicit local --apply.");
  sql(`begin; ${installationSource} commit;`);
  assert.deepEqual(snapshot(), before);
  assert.equal(scalar("select relrowsecurity and relforcerowsecurity from pg_class where oid='vosio_mcp_private.installation'::regclass;"), "t");
  assert.equal(scalar("select p.prosecdef and p.proconfig=array['search_path=\"\"'] and r.rolsuper from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.mcp_installation_v1(text,jsonb)'::regprocedure;"), "t");
  for (const role of ["anon", "authenticated"]) {
    sql(`set role ${role}; ${rejected("select public.mcp_installation_v1('read','{}'::jsonb);")}`);
    sql(`set role ${role}; ${rejected("select public.mcp_installation_v1('enable','{\"enabled\":true}'::jsonb);")}`);
  }
  for (const role of ["anon", "authenticated", "service_role"]) sql(`set role ${role}; ${rejected("select count(*) from vosio_mcp_private.installation;")}`);
  const callInstall = (action, payload = {}) => `select public.mcp_installation_v1(${lit(action)},${lit(JSON.stringify(payload))}::jsonb);`;
  const install = (action, payload) => json(`set role service_role; ${callInstall(action, payload)}`);
  assert.equal(install("read"), null);
  const configured = { enabled: false, webOrigin: "https://web.example", publicSupabaseUrl: "https://supabase.example", upstreamClientId: f.upstreamClient };
  assert.deepEqual(install("configure", configured), configured);
  assert.deepEqual(install("configure", configured), configured);
  sql(`set role service_role; ${rejected(callInstall("configure", { ...configured, webOrigin: "https://foreign.example" }), "22023")}`);
  sql(`set role service_role; ${rejected(callInstall("enable", { enabled: true, actor: f.editor }), "22023")}`);
  assert.deepEqual(install("enable", { enabled: true }), { ...configured, enabled: true });
  assert.equal(install("configure", configured).enabled, true);
  assert.deepEqual(install("enable", { enabled: false }), configured);
  assert.deepEqual(snapshot(), before);
  pass("installation_exact_service_acl_force_rls_identity_retry_enable_disable_and_preservation");
}

// Rehearse the forward on real custody data, then prove global admission and cleanup under actual roles.
async function registrationProof(f) {
  const tables = ["vosio_mcp_private.clients", "vosio_mcp_private.pending", "vosio_mcp_private.grants", "vosio_mcp_private.tokens"];
  const snapshot = () => tables.map((table) => scalar(`select md5(coalesce(string_agg((to_jsonb(t)-'registration_type')::text,',' order by (to_jsonb(t)-'registration_type')::text),'')) from ${table} t;`));
  const before = snapshot();
  sql(`begin; ${registrationSource} rollback;`);
  assert.equal(scalar("select to_regprocedure('public.mcp_register_dynamic_client_v1(jsonb)') is null;"), "t");
  assert.deepEqual(snapshot(), before); pass("dynamic_forward_rollback_preserves_existing_custody");
  if (!process.argv.includes("--apply")) throw new Error("BLOCKED: dynamic forward needs explicit local --apply.");
  sql(`begin; ${registrationSource} commit;`);
  assert.deepEqual(snapshot(), before);
  assert.equal(scalar("select bool_and(registration_type='static') from vosio_mcp_private.clients;"), "t");
  assert.equal(scalar("select relrowsecurity and relforcerowsecurity from pg_class where oid='vosio_mcp_private.clients'::regclass;"), "t");
  assert.equal(scalar("select p.prosecdef and p.proconfig=array['search_path=\"\"'] and r.rolname='postgres' from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.mcp_register_dynamic_client_v1(jsonb)'::regprocedure;"), "t");
  for (const [qualified, signature] of [["public.mcp_register_dynamic_client_v1", "jsonb"], ["vosio_mcp_private.redirect_matches", "text,text"]]) {
    const start = registrationSource.indexOf(`function ${qualified}(`); const open = registrationSource.indexOf("as $$", start) + 5; const close = registrationSource.indexOf("$$;", open);
    assert(start >= 0 && close > open);
    assert.equal(hash(scalar(`select prosrc from pg_proc where oid=${lit(`${qualified}(${signature})`)}::regprocedure;`).replaceAll("\r\n", "\n").trim()), hash(registrationSource.slice(open, close).trim()), `installed ${qualified} source differs`);
  }
  const payload = (clientId = randomUUID()) => ({ clientId, name: "Synthetic dynamic host", redirects: ["http://localhost:40000/callback"] });
  const dynamic = (value = payload()) => `select public.mcp_register_dynamic_client_v1(${lit(JSON.stringify(value))}::jsonb);`;
  const accept = (value) => json(`set role service_role; ${dynamic(value)}`);
  for (const role of ["anon", "authenticated"]) sql(`set role ${role}; ${rejected(dynamic())}`);
  for (const role of ["anon", "authenticated", "service_role"]) sql(`set role ${role}; ${rejected("select count(*) from vosio_mcp_private.clients;")}`);
  sql(`set role service_role; ${rejected(dynamic({ ...payload(), actor: f.editor }), "22023")}`);
  const grantsBefore = scalar("select count(*) from vosio_mcp_private.grants;");
  assert.deepEqual(accept(), { status: "accepted" });
  assert.equal(scalar("select count(*) from vosio_mcp_private.grants;"), grantsBefore);
  pass("dynamic_forward_exact_source_static_backfill_service_only_force_rls_strict_payload");

  // Keep every trial bounded in its own rolled-back transaction.
  const assertStatus = (value, status) => `do $proof$ begin if (public.mcp_register_dynamic_client_v1(${lit(JSON.stringify(value))}::jsonb)->>'status') is distinct from ${lit(status)} then raise exception 'unexpected admission'; end if; end $proof$;`;
  sql(`begin; update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '2 minutes' where registration_type='dynamic';
    set role service_role; ${Array.from({ length: 30 }, () => assertStatus(payload(), "accepted")).join("\n")}
    ${assertStatus(payload(), "rate_limited")} rollback;`);
  pass("dynamic_sliding_window_accepts_30_then_rejects_with_durable_limit");
  sql(`begin; insert into vosio_mcp_private.clients(id,name,redirects) select gen_random_uuid(),'Static cap','["https://host.example/callback"]' from generate_series(1,256-(select count(*) from vosio_mcp_private.clients)::integer);
    set role service_role; ${assertStatus(payload(), "capacity_limited")} rollback;`);
  pass("dynamic_combined_static_dynamic_cap_256");

  const unused = payload(); const pendingClient = payload(); const grantClient = payload();
  for (const value of [unused, pendingClient, grantClient]) assert.deepEqual(accept(value), { status: "accepted" });
  const pending = { id: randomUUID(), clientId: pendingClient.clientId, redirectUri: pendingClient.redirects[0], resource: "https://installation.example/api/mcp", state: "", challenge: opaque(), scopes: ["vosio:read"], nonceHash: hash(opaque()), upstreamStateHash: hash(opaque()), encrypted: "synthetic" };
  assert.deepEqual(custody("pending_create", pending), { ok: true });
  const abandoned = { ...pending, id: randomUUID(), clientId: unused.clientId, nonceHash: hash(opaque()), upstreamStateHash: hash(opaque()) };
  assert.deepEqual(custody("pending_create", abandoned), { ok: true });
  sql(`update vosio_mcp_private.pending set expires_at=clock_timestamp()-interval '1 second' where id=${lit(abandoned.id)};`);
  const heldGrant = grant(f, { clientId: grantClient.clientId, redirectUri: grantClient.redirects[0] });
  sql("update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '25 hours';");
  assert.deepEqual(accept(), { status: "accepted" });
  assert.equal(scalar(`select count(*) from vosio_mcp_private.clients where id=${lit(unused.clientId)};`), "0");
  for (const client of [f.client, pendingClient.clientId, grantClient.clientId]) assert.equal(scalar(`select count(*) from vosio_mcp_private.clients where id=${lit(client)};`), "1");
  assert(custody("code_claim", codeArgs(heldGrant))?.fence); // Old granted connections still consume their code.
  assert.equal(scalar(`select vosio_mcp_private.redirect_matches('http://localhost:40000/callback','http://localhost:51000/callback');`), "t");
  for (const value of ["http://127.0.0.1:51000/callback", "http://localhost.example:51000/callback", "http://localhost:51000/other", "http://localhost:51000/callback?extra=1"]) assert.equal(scalar(`select vosio_mcp_private.redirect_matches('http://localhost:40000/callback',${lit(value)});`), "f");
  pass("dynamic_unused_cleanup_preserves_static_pending_and_any_grant_exact_localhost_port");

  // One static transaction fills the shared capacity while a genuinely separate DCR request waits.
  sql("update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '2 minutes' where registration_type='dynamic';");
  const a = session("static-cap"); const b = session("dynamic-cap");
  send(a, `begin; insert into vosio_mcp_private.clients(id,name,redirects) select gen_random_uuid(),'Cap','["https://host.example/callback"]' from generate_series(1,255-(select count(*) from vosio_mcp_private.clients)::integer); set role service_role; ${call("register", { clientId: randomUUID(), name: "Static winner", redirects: ["https://host.example/callback"] })} \n\\echo STATIC_HELD`);
  await marker(a, "STATIC_HELD");
  send(b, `begin; set role service_role; ${assertStatus(payload(), "capacity_limited")} commit; \n\\echo DYNAMIC_CAP_DONE`);
  await blocked(b); send(a, "commit;"); await marker(b, "DYNAMIC_CAP_DONE");
  assert.equal(scalar("select count(*) from vosio_mcp_private.clients;"), "256");
  await close(a); await close(b); observedLockRaces++; pass("race_static_dynamic_capacity_shared_advisory_lock");
  sql("delete from vosio_mcp_private.clients c where name in ('Cap','Static winner') and not exists(select 1 from vosio_mcp_private.grants g where g.client_id=c.id);");

  // The thirtieth DCR request holds the lock; the next instance must observe it before admission.
  sql(`begin; update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '2 minutes' where registration_type='dynamic'; set role service_role; ${Array.from({ length: 29 }, () => assertStatus(payload(), "accepted")).join("\n")} commit;`);
  const c = session("rate-winner"); const d = session("rate-follower");
  send(c, `begin; set role service_role; ${assertStatus(payload(), "accepted")} \n\\echo RATE_HELD`); await marker(c, "RATE_HELD");
  send(d, `begin; set role service_role; ${assertStatus(payload(), "rate_limited")} commit; \n\\echo RATE_DONE`);
  await blocked(d); send(c, "commit;"); await marker(d, "RATE_DONE"); await close(c); await close(d);
  observedLockRaces++; pass("race_dynamic_sliding_window_shared_lock_never_exceeds_30");
  sql("update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '2 minutes' where registration_type='dynamic';");

  // Pending creation owns lock 2; cleanup must wait and then preserve its old dynamic client.
  const old = payload(); assert.deepEqual(accept(old), { status: "accepted" });
  sql(`update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '25 hours' where id=${lit(old.clientId)};`);
  const p = session("pending-winner"); const q = session("cleanup-follower");
  send(p, `begin; set role service_role; ${call("pending_create", { ...pending, id: randomUUID(), clientId: old.clientId, nonceHash: hash(opaque()), upstreamStateHash: hash(opaque()) })} \n\\echo PENDING_HELD`); await marker(p, "PENDING_HELD");
  send(q, `begin; set role service_role; ${assertStatus(payload(), "accepted")} commit; \n\\echo CLEANUP_DONE`);
  await blocked(q); send(p, "commit;"); await marker(q, "CLEANUP_DONE"); await close(p); await close(q);
  assert.equal(scalar(`select count(*) from vosio_mcp_private.clients where id=${lit(old.clientId)};`), "1");
  observedLockRaces++; pass("race_pending_before_cleanup_preserves_referenced_dynamic_client");

  // Reverse ordering removes an unused client; a late pending request fails cleanly rather than creating an orphan.
  const gone = payload(); assert.deepEqual(accept(gone), { status: "accepted" });
  sql(`update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '25 hours' where id=${lit(gone.clientId)};`);
  const e = session("cleanup-winner"); const h = session("pending-follower");
  send(e, `begin; set role service_role; ${assertStatus(payload(), "accepted")} \n\\echo CLEANUP_HELD`); await marker(e, "CLEANUP_HELD");
  const late = { ...pending, id: randomUUID(), clientId: gone.clientId, nonceHash: hash(opaque()), upstreamStateHash: hash(opaque()) };
  send(h, `begin; set role service_role; do $proof$ begin if public.mcp_oauth_custody_v1('pending_create',${lit(JSON.stringify(late))}::jsonb) is not null then raise exception 'late pending admitted'; end if; end $proof$; commit; \n\\echo PENDING_DONE`);
  await blocked(h); send(e, "commit;"); await marker(h, "PENDING_DONE"); await close(e); await close(h);
  observedLockRaces++; pass("race_cleanup_before_pending_denies_orphan_without_fk_error");

  // A grant created before pending expiry holds that row until commit; cleanup sees the committed reference.
  const granting = payload(); assert.deepEqual(accept(granting), { status: "accepted" });
  const gp = { ...pending, id: randomUUID(), clientId: granting.clientId, nonceHash: hash(opaque()), upstreamStateHash: hash(opaque()) };
  assert.deepEqual(custody("pending_create", gp), { ok: true });
  custody("pending_approve", { id: gp.id, nonceHash: gp.nonceHash, userId: f.editor, scopes: gp.scopes });
  custody("pending_claim", { nonceHash: gp.nonceHash, stateHash: gp.upstreamStateHash });
  sql(`update vosio_mcp_private.clients set created_at=clock_timestamp()-interval '25 hours' where id=${lit(granting.clientId)};
    update vosio_mcp_private.pending set expires_at=clock_timestamp()+interval '2 seconds' where id=${lit(gp.id)};`);
  const g = session("grant-winner"); const j = session("grant-cleanup");
  const ga = { pendingId: gp.id, grantId: randomUUID(), userId: f.editor, sessionId: f.sessions.editor, encrypted: "synthetic", upstreamExpiresAt: Math.floor(Date.now()/1000)+3600, codeHash: hash(opaque()) };
  send(g, `begin; set role service_role; ${call("grant_create", ga)} \n\\echo GRANT_HELD`); await marker(g, "GRANT_HELD");
  sql("select pg_sleep(2.1);");
  send(j, `begin; set role service_role; ${assertStatus(payload(), "accepted")} commit; \n\\echo GRANT_CLEANUP_DONE`);
  await blocked(j); send(g, "commit;"); await marker(j, "GRANT_CLEANUP_DONE"); await close(g); await close(j);
  assert.equal(scalar(`select count(*) from vosio_mcp_private.clients where id=${lit(granting.clientId)};`), "1");
  assert.equal(scalar(`select count(*) from vosio_mcp_private.grants where id=${lit(ga.grantId)};`), "1");
  observedLockRaces++; pass("race_grant_before_expired_pending_cleanup_preserves_client_and_grant");
}

try {
  preflight(); const f = fixture(); installationProof(f); await registrationProof(f); sequential(f); contentMatrix(f); await races(f);
  const receipt = { completedAt: new Date().toISOString(), database, runId, cases: results.length, passed: results, observedLockRaces,
    migrationSha256: hash(source), installationMigrationSha256: hash(installationSource), registrationMigrationSha256: hash(registrationSource), scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url), "utf8")), sourceOnly: true,
    limits: "Real disposable PostgreSQL roles/RLS/transactions only; no target Auth/Storage/HTTP/browser or cryptographic server acceptance." };
  const path = resolve(root, ".tmp/mcp-postgres/receipt.json"); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`GREEN ${results.length} cases; ${observedLockRaces} observed PostgreSQL lock races. Receipt: .tmp/mcp-postgres/receipt.json`);
} catch (error) {
  console.error(String(error.message).replaceAll(connection, "[redacted]")); process.exitCode = 1;
} finally {
  for (const s of sessions) if (!s.exited) s.child.kill();
}
