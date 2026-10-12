import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import process from "node:process";
import console from "node:console";

const target = new URL(process.env.VOSIO_DISPOSABLE_DATABASE_URL || "postgres://invalid");
const database = decodeURIComponent(target.pathname.slice(1));
if (!["postgres:", "postgresql:"].includes(target.protocol) || !["127.0.0.1", "localhost"].includes(target.hostname)
  || !/^[a-z0-9_]+_recovery_test$/.test(database) || !target.username || target.hash || target.search) {
  throw new Error("REFUSED: provide an owned loopback _recovery_test database with the prepared Vosio baseline and recovery migration.");
}
const executable = process.env.PSQL_BIN || "psql";
const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", target.hostname, "-p", target.port || "5432", "-U", decodeURIComponent(target.username), "-d", database];
const env = { ...process.env, PGPASSWORD: decodeURIComponent(target.password), PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c statement_timeout=15000 -c lock_timeout=10000" };
const cases = [];
// Execute only the explicit local disposable target; this proof never resets or bootstraps a database.
function sql(source) {
  const result = spawnSync(executable, [...args, "-f", "-"], { input: source, env, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`PostgreSQL proof failed: ${String(result.stderr || result.error).slice(0, 1800)}`);
  return result.stdout.trim();
}
// Quote fixed metadata and freshly generated fixture identities only.
function lit(value) { return `'${String(value).replaceAll("'", "''")}'`; }
// Read one JSON scalar without exposing any existing database content.
function json(source) { return JSON.parse(sql(source)); }
// Authenticate a real non-superuser role for each session-bound RPC.
function auth(actor) { return `set role authenticated; select set_config('request.jwt.claim.sub',${lit(actor)},false);`; }
// Assert the exact SQLSTATE, without swallowing an unexpected success or localized error.
function denied(statement, state = "42501") {
  return `do $proof$ begin ${statement.replace(/^select /, "perform ")} raise exception 'expected denial'; exception when sqlstate '${state}' then null; end $proof$;`;
}
// Record only a completed proof group, never fixture rows or source text.
function pass(name) { cases.push(name); console.log(`PASS ${name}`); }

const owned = sql("select datdba=(select oid from pg_roles where rolname=current_user) from pg_database where datname=current_database();");
assert.equal(owned, "t");
const migration = readFileSync(new URL("../supabase/migrations/20261006122518_add_transcription_recovery.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const trustedOwner = sql("select pg_get_userbyid(proowner) from pg_proc where oid='public.can_read_recording(uuid)'::regprocedure;");
for (const [name, signature, tag] of [["fail_recording_submission_v1", "uuid,uuid,uuid,text", "fail"], ["verify_recording_transcription_stop_v1", "uuid,uuid,uuid,jsonb,text", "verify"], ["stop_recording_transcription_v1", "uuid,uuid", "stop"], ["prepare_recording_transcription_stop_v1", "uuid,uuid,jsonb", "prepare_stop"], ["resume_recording_transcription_stop_v1", "uuid,jsonb", "resume_stop"], ["lock_recording_transcription_operation_unfenced_v1", "uuid", "operation_lock"], ["lock_recording_transcription_operation_v1", "uuid", "fence"], ["claim_recording_transcription_work_v2", "integer,uuid", "claim"], ["get_recording_transcription_dispatch_v1", "uuid,uuid,text", "dispatch"], ["get_managed_recording_transcription_v1", "uuid[]", "managed"]]) {
  const body = migration.split(`as $${tag}$`)[1].split(`$${tag}$;`)[0].trim();
  assert.equal(sql(`select prosrc from pg_proc where oid=${lit(`public.${name}(${signature})`)}::regprocedure;`).replaceAll("\r\n", "\n").trim(), body);
  const facts = json(`select jsonb_build_object('definer',prosecdef,'search',proconfig,'owner',pg_get_userbyid(proowner)) from pg_proc where oid=${lit(`public.${name}(${signature})`)}::regprocedure;`);
  assert.equal(facts.definer, true); assert.deepEqual(facts.search, ['search_path=""']); assert.equal(facts.owner, trustedOwner);
  for (const role of ["anon", "authenticated", "service_role"]) assert.equal(sql(`select has_function_privilege(${lit(role)},${lit(`public.${name}(${signature})`)},'execute');`),
    role === (["operation_lock", "fence"].includes(tag) ? null : ["stop", "prepare_stop", "resume_stop", "managed"].includes(tag) ? "authenticated" : "service_role") ? "t" : "f", `${name} ACL for ${role}`);
}
for (const role of ["anon", "authenticated", "service_role"]) {
  assert.equal(sql(`select has_function_privilege(${lit(role)},'public.lock_recording_transcription_operation_unfenced_v1(uuid)','execute');`), "f");
  assert.equal(sql(`select has_table_privilege(${lit(role)},'public.recording_transcription_stop_reservations','select');`), "f");
}
pass("exact_source_empty_search_path_and_narrow_acl");

const readMigration = readFileSync(new URL("../supabase/migrations/20261006140000_add_transcription_recovery_read.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const readSignature = "public.get_recording_transcription_recovery_v1(uuid,uuid)";
assert.equal(sql(`select prosrc from pg_proc where oid=${lit(readSignature)}::regprocedure;`).replaceAll("\r\n", "\n").trim(), readMigration.split("as $recovery_read$")[1].split("$recovery_read$;")[0].trim());
assert.deepEqual(json(`select jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'search',proconfig,'volatility',provolatile) from pg_proc where oid=${lit(readSignature)}::regprocedure;`),
  { owner: trustedOwner, definer: true, search: ['search_path=""'], volatility: "s" });
for (const role of ["anon", "authenticated", "service_role"]) {
  assert.equal(sql(`select has_function_privilege(${lit(role)},${lit(readSignature)},'execute');`), role === "service_role" ? "t" : "f");
  for (const table of ["recording_transcription_operations", "recording_transcription_work"]) {
    assert.equal(sql(`select has_table_privilege(${lit(role)},${lit(`public.${table}`)},'select');`), "f");
    sql(`set role ${role}; ${denied(`select count(*) from public.${table};`)}`);
  }
}
pass("recovery_read_exact_source_service_only_and_direct_table_reads_denied");

// Seed generated identities with an old saved transcript and synthetic audio metadata, never a provider call.
function fixture(phase = "uncertain", claimed = "clock_timestamp()-interval '1 hour'") {
  const f = Object.fromEntries(["owner", "editor", "reader", "recording", "operation", "job", "claim", "request", "transcript"].map(name => [name, randomUUID()]));
  f.path = `${f.owner}/${f.recording}/audio.webm`;
  sql(`begin;
    insert into auth.users(id,aud,role,email) select x,'authenticated','authenticated',x::text||'@recovery-proof.invalid' from unnest(array[${[f.owner, f.editor, f.reader].map(id => `${lit(id)}::uuid`).join(",")}])x;
    insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,storage_path,file_size_bytes)
      values(${lit(f.recording)},${lit(f.owner)},${lit(f.owner)},'Synthetic recovery','upload','transcribing','selected',${lit(f.path)},100);
    insert into storage.objects(bucket_id,name,metadata) values('recordings',${lit(f.path)},'{"size":100,"mimetype":"audio/webm"}');
    insert into public.recording_access_grants(recording_id,user_id,role) values(${lit(f.recording)},${lit(f.editor)},'editor'),(${lit(f.recording)},${lit(f.reader)},'reader');
    insert into public.transcripts(id,recording_id,user_id,raw_text) values(${lit(f.transcript)},${lit(f.recording)},${lit(f.owner)},'Synthetic saved text');
    insert into public.recording_transcription_operations(id,actor_id,request_id,recording_id,technical_owner_id,capture_author_id,payload_fingerprint,expected_capture_revision,purpose,phase,region,model,model_config_version,started_at)
      values(${lit(f.operation)},${lit(f.owner)},${lit(randomUUID())},${lit(f.recording)},${lit(f.owner)},${lit(f.owner)},'synthetic',0,'retranscribe','uncertain','eu','stt-async-v5',1,clock_timestamp()-interval '1 hour');
    insert into public.transcription_jobs(id,recording_id,user_id,mode,status) values(${lit(f.job)},${lit(f.recording)},${lit(f.owner)},'async','queued');
    insert into public.recording_transcription_work(job_id,operation_id,position,storage_path,phase,claim_id,submission_claim_id,claimed_at)
      values(${lit(f.job)},${lit(f.operation)},0,${lit(f.path)},${lit(phase)},${lit(f.claim)},${lit(f.claim)},${claimed});
    commit;`);
  return f;
}
// Read exactly the frozen unit identity used by the service and authenticated compare-and-swap.
function snapshot(f) { return sql(`select jsonb_agg(jsonb_build_array(job_id,phase,provider_job_id,claim_id,submission_claim_id) order by position) from public.recording_transcription_work where operation_id=${lit(f.operation)};`); }
// Store only the trusted service proof, binding it to the manager and immutable request identity.
function verify(f, snap = snapshot(f), actor = f.owner) {
  return `select public.verify_recording_transcription_stop_v1(${lit(f.operation)},${lit(actor)},${lit(f.request)},${lit(snap)}::jsonb,${lit(createHash("sha256").update("synthetic verification").digest("hex"))});`;
}
// Stop through the authenticated API rather than service-role writes.
function stop(f) { return `select public.stop_recording_transcription_v1(${lit(f.operation)},${lit(f.request)});`; }
// Accept durable cancellation before any synthetic provider-side effect.
function reserve(f, snap = snapshot(f)) {
  return `select public.prepare_recording_transcription_stop_v1(${lit(f.operation)},${lit(f.request)},${lit(snap)}::jsonb);`;
}
const f = fixture();
const recoveryRead = `select public.get_recording_transcription_recovery_v1(${lit(f.operation)},${lit(f.recording)});`;
for (const role of ["anon", "authenticated"]) sql(`set role ${role}; ${denied(recoveryRead)}`);
const readBefore = json(`select jsonb_build_object('op',to_jsonb(o),'work',to_jsonb(w)) from public.recording_transcription_operations o join public.recording_transcription_work w on w.operation_id=o.id where o.id=${lit(f.operation)};`);
const readSnapshot = json(`set role service_role; ${recoveryRead}`);
assert.equal(readSnapshot.operation.id, f.operation); assert.equal(readSnapshot.operation.recording_id, f.recording);
assert.equal(readSnapshot.work.length, 1); assert.equal(readSnapshot.work[0].job_id, f.job);
assert.equal(readSnapshot.work[0].storage_path, f.path);
assert.equal(sql(`set role service_role; select public.get_recording_transcription_recovery_v1(${lit(f.operation)},${lit(randomUUID())}) is null;`), "t");
assert.deepEqual(json(`select jsonb_build_object('op',to_jsonb(o),'work',to_jsonb(w)) from public.recording_transcription_operations o join public.recording_transcription_work w on w.operation_id=o.id where o.id=${lit(f.operation)};`), readBefore);
pass("private_snapshot_exact_recording_binding_no_user_writes_or_browser_access");
sql(`${auth(f.owner)} ${denied(verify(f))} ${denied(stop(f))}`);
pass("session_cannot_forge_verification_or_stop_without_proof");
sql(`set role service_role; ${denied(stop(f))} ${denied(verify(f))}`);
for (const actor of [f.editor, f.reader]) sql(`${auth(actor)} ${denied(reserve(f))}`);
sql(`${auth(f.owner)} ${reserve(f)} reset role; set role service_role; ${verify(f)}`);
for (const actor of [f.editor, f.reader]) sql(`${auth(actor)} ${denied(stop(f))}`);
pass("reader_editor_and_service_cannot_close_manager_operation");
const result = sql(`${auth(f.owner)} ${stop(f)}`).split("\n").at(-1);
assert.deepEqual(JSON.parse(result), { operationId: f.operation, status: "failed", stopped: true });
const facts = json(`select jsonb_build_object('revision',r.capture_revision,'status',r.status,'path',r.storage_path,'audio',(select count(*) from storage.objects where name=${lit(f.path)}),'text',(select raw_text from public.transcripts where id=${lit(f.transcript)}),'job',(select status from public.transcription_jobs where id=${lit(f.job)}),'work',(select phase from public.recording_transcription_work where job_id=${lit(f.job)})) from public.recordings r where id=${lit(f.recording)};`);
assert.deepEqual(facts, { revision: 1, status: "failed", path: f.path, audio: 1, text: "Synthetic saved text", job: "cancelled", work: "failed" });
sql(`${auth(f.owner)} ${stop(f)}`);
assert.equal(sql(`select capture_revision from public.recordings where id=${lit(f.recording)};`), "1");
pass("verified_stop_preserves_audio_text_history_and_replays_once");
const fresh = fixture("submitting", "clock_timestamp()");
sql(`${auth(fresh.owner)} ${denied(reserve(fresh), "55000")}`);
pass("fresh_submit_cannot_be_attested_absent");
const drift = fixture(); const original = snapshot(drift);
sql(`update public.recording_transcription_work set claim_id=null where job_id=${lit(drift.job)}; set role service_role; ${denied(verify(drift, original), "40001")}`);
sql(`${auth(drift.owner)} ${reserve(drift)} reset role; set role service_role; ${verify(drift)}`);
sql(`update public.recording_transcription_work set phase='submitting' where job_id=${lit(drift.job)}; ${auth(drift.owner)} ${denied(stop(drift), "40001")}`);
pass("snapshot_drift_denies_both_attestation_and_final_close");
const superseded = fixture();
sql(`${auth(superseded.owner)} ${reserve(superseded)} reset role; set role service_role; ${verify(superseded)}`);
sql(`insert into public.recording_transcription_operations(id,actor_id,request_id,recording_id,technical_owner_id,capture_author_id,payload_fingerprint,expected_capture_revision,purpose,phase,region,model,model_config_version)
  select ${lit(randomUUID())},actor_id,${lit(randomUUID())},recording_id,technical_owner_id,capture_author_id,'newer',0,'retranscribe','released',region,model,model_config_version from public.recording_transcription_operations where id=${lit(superseded.operation)};
  ${auth(superseded.owner)} ${denied(stop(superseded), "40001")}`);
pass("newer_operation_denies_stale_closure");
const failure = fixture("submitting");
const fail = (claim, code) => `select public.fail_recording_submission_v1(${lit(failure.operation)},${lit(failure.job)},${lit(claim)},${lit(code)});`;
sql(`set role service_role; ${denied(fail(randomUUID(), "provider_authentication"))} ${denied(fail(failure.claim, "raw-provider-details"), "22023")} ${fail(failure.claim, "provider_authentication")}`);
assert.equal(sql(`select error_code from public.recording_transcription_work where job_id=${lit(failure.job)};`), "provider_authentication");
assert.equal(sql(`select status from public.recordings where id=${lit(failure.recording)};`), "failed");
sql(`set role service_role; ${denied(fail(failure.claim, "provider_authentication"), "55000")}`);
pass("definite_failure_exact_claim_safe_code_terminal_replay_denied");

const reserved = fixture();
sql(`${auth(reserved.owner)} ${reserve(reserved)}`);
sql(`update public.recording_transcription_operations set phase='started' where id=${lit(reserved.operation)};`);
assert.equal(json(`set role service_role; select public.get_recording_transcription_dispatch_v1(${lit(reserved.operation)});`).phase, "manual_required");
assert.equal(sql(`${auth(reserved.owner)} select phase from public.get_managed_recording_transcription_v1(array[${lit(reserved.recording)}::uuid]);`).split("\n").at(-1), "manual_required");
assert.equal(sql(`set role service_role; select count(*) from public.claim_recording_transcription_work_v2(5,${lit(reserved.operation)});`), "0");
sql(`set role service_role; ${denied(`select public.refresh_recording_transcription_claim_v1(${lit(reserved.operation)},${lit(reserved.job)},${lit(reserved.claim)});`, "55000")}
  ${denied(`select public.resolve_uncertain_recording_job_v1(${lit(reserved.operation)},${lit(reserved.job)},'bind_verified',${lit("a".repeat(64))},'synthetic-original');`, "55000")}`);
const resume = `select public.resume_recording_transcription_stop_v1(${lit(reserved.operation)},${lit(snapshot(reserved))}::jsonb);`;
sql(`${auth(reserved.owner)} ${denied(resume, "55000")}`);
sql(`update public.recording_transcription_stop_reservations set active_until=clock_timestamp()-interval '1 second' where operation_id=${lit(reserved.operation)}; ${auth(reserved.owner)} ${resume}`);
assert.equal(sql(`select count(*) from public.recording_transcription_stop_reservations where operation_id=${lit(reserved.operation)};`), "0");
pass("reserved_stop_fences_discovery_heartbeat_binding_and_concurrent_resume");

const backends = [];
// Open independent native backends for a deterministic real lock interleaving.
function backend(label) {
  const name = `recovery-${randomUUID()}-${label}`;
  const child = spawn(executable, args, { env: { ...env, PGAPPNAME: name }, stdio: ["pipe", "pipe", "pipe"] });
  const b = { child, name, out: "", err: "" }; backends.push(b);
  child.stdout.on("data", text => { b.out += text; }); child.stderr.on("data", text => { b.err += text; });
  return b;
}
// Wait for observable backend progress with a fixed timeout, rather than assuming sleep means a lock was held.
async function until(predicate) { const deadline = Date.now() + 8000; while (!predicate()) { if (Date.now() > deadline) throw new Error("Native race proof timed out"); await setTimeout(20); } }
try {
  const raced = fixture(); sql(`${auth(raced.owner)} ${reserve(raced)} reset role; set role service_role; ${verify(raced)}`);
  const first = backend("mutation"), second = backend("stop");
  first.child.stdin.write("begin; select public.recording_sharing_lock_v1(); select 'LOCK_HELD';\n");
  await until(() => first.out.includes("LOCK_HELD"));
  second.child.stdin.write(`${auth(raced.owner)} ${denied(stop(raced), "40001")} select 'STALE_STOP_DENIED';\n`);
  await until(() => sql(`select count(*) from pg_stat_activity where application_name=${lit(second.name)} and wait_event_type='Lock';`) === "1");
  first.child.stdin.write(`update public.recording_transcription_work set claim_id=null where job_id=${lit(raced.job)}; commit;\n`);
  await until(() => second.out.includes("STALE_STOP_DENIED"));
  assert.equal(sql(`select phase from public.recording_transcription_operations where id=${lit(raced.operation)};`), "uncertain");
  pass("real_lock_wait_rechecks_snapshot_after_competing_commit");
} finally {
  for (const b of backends) {
    const exit = new Promise(resolve => b.child.once("exit", resolve)); b.child.stdin.end("\\q\n");
    assert.equal(await exit, 0, b.err);
  }
}
console.log(JSON.stringify({ database, groups: cases.length, cases }));
