import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";

// This rehearsal deliberately accepts only the dedicated loopback fixture database.
const [psql, port = "55731"] = process.argv.slice(2);
assert.ok(psql, "Pass the installed psql executable path");
assert.match(port, /^\d+$/);
const owner = "c1000000-0000-4000-8000-000000000001";
const reader = "c1000000-0000-4000-8000-000000000002";
const recording = "c2000000-0000-4000-8000-000000000001";
const client = "c3000000-0000-4000-8000-000000000001";
const actor = `set request.jwt.claim.sub='${owner}';`;
const target = `'${recording}','${client}',null,null,'{}'`;

// startSession exposes a database-emitted barrier after the sharing lock is actually held.
function startSession(sql) {
  const child = spawn(psql, ["-X", "-q", "-At", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "organization_fixture", "-v", "ON_ERROR_STOP=1", "-c", sql], { windowsHide: true });
  let output = "";
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("LOCK_READY")) resolveReady(); });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const completed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { resolveReady(); resolve({ code, output: output.trim() }); });
  });
  return { completed, ready };
}

// query requires successful fixture setup/readback and never suppresses a database error.
async function query(sql) {
  const result = await startSession(sql).completed;
  assert.equal(result.code, 0, result.output);
  return result.output;
}

const cleanup = `delete from public.recordings where id='${recording}'; delete from public.recording_clients where id='${client}'; delete from auth.users where id in ('${owner}','${reader}');`;
try {
  await query(`begin; insert into auth.users(id,email) values ('${owner}','race-owner@example.invalid'),('${reader}','race-reader@example.invalid');
    insert into public.recording_clients(id,user_id,name) values ('${client}','${owner}','Organization race fixture');
    insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility) values ('${recording}','${owner}','${owner}','Organization race fixture','upload','completed','selected');
    insert into public.recording_access_grants(recording_id,user_id,role) values ('${recording}','${reader}','reader'); commit;`);
  let fingerprint = await query(`${actor} select public.preview_recording_organization_v1(${target})->>'fingerprint';`);
  const revokeFirst = startSession(`begin; ${actor} select public.recording_sharing_lock_v1(); select 'LOCK_READY'; select pg_sleep(1); select public.revoke_recording_grant_v1('${recording}','${reader}'); commit;`);
  await revokeFirst.ready;
  const staleSave = startSession(`${actor} select public.assign_recording_organization_v2(${target},'${fingerprint}');`);
  assert.equal((await revokeFirst.completed).code, 0);
  const staleResult = await staleSave.completed;
  assert.notEqual(staleResult.code, 0);
  assert.match(staleResult.output, /organization preview stale/);
  assert.equal(await query(`select r.client_id is null and g.revoked_at is not null from public.recordings r join public.recording_access_grants g on g.recording_id=r.id where r.id='${recording}';`), "t");
  console.log("PASS revoke holds sharing lock before save: stale confirmation rejected; assignment unchanged; revocation retained");

  await query(`update public.recording_access_grants set revoked_at=null where recording_id='${recording}';`);
  fingerprint = await query(`${actor} select public.preview_recording_organization_v1(${target})->>'fingerprint';`);
  const saveFirst = startSession(`begin; ${actor} select public.recording_sharing_lock_v1(); select 'LOCK_READY'; select pg_sleep(1); select public.assign_recording_organization_v2(${target},'${fingerprint}'); commit;`);
  await saveFirst.ready;
  const laterRevoke = startSession(`${actor} select public.revoke_recording_grant_v1('${recording}','${reader}');`);
  assert.equal((await saveFirst.completed).code, 0);
  assert.equal((await laterRevoke.completed).code, 0);
  assert.equal(await query(`select r.client_id='${client}' and g.revoked_at is not null from public.recordings r join public.recording_access_grants g on g.recording_id=r.id where r.id='${recording}';`), "t");
  console.log("PASS save holds sharing lock before revoke: assignment commits; later revoke remains revoked");
} finally {
  await query(cleanup);
}
