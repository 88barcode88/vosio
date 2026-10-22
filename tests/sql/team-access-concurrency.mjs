import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";

const connection = process.env.VOSIO_DISPOSABLE_DATABASE_URL;
const url = new URL(connection ?? "postgresql://invalid/");
const database = decodeURIComponent(url.pathname.slice(1));
assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost"].includes(url.hostname)
  && /^[a-z0-9_]+_team_verification$/.test(database) && database.length <= 63 && url.username && !url.hash
  && [...url.searchParams.keys()].every((key) => key === "sslmode"), "REFUSED: owned loopback _team_verification fixture required");
const psql = process.env.PSQL_BIN ?? "psql";
const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", url.hostname, "-p", url.port || "5432", "-U", decodeURIComponent(url.username), "-d", database];
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c statement_timeout=15000 -c lock_timeout=10000" };
const sessions = [];
const fixture = Object.fromEntries(["admin", "recipient", "session", "recipientSession", "client", "recording"].map((name) => [name, randomUUID()]));

// Quote generated fixture metadata only; connection credentials never enter SQL or output.
function lit(value) { return `'${String(value).replaceAll("'", "''")}'`; }

// Execute only the guarded owned disposable target and suppress fixture rows from the receipt.
function sql(source) {
  const result = spawnSync(psql, [...args, "-f", "-"], { input: source, encoding: "utf8", env });
  if (result.error || result.status !== 0) throw new Error(`Disposable team SQL failed: ${String(result.error?.message ?? result.stderr).slice(0, 1500)}`);
  return result.stdout.trim();
}

// Install the real authenticated role and current synthetic JWT/session pair.
function auth(user, session) {
  return `set role authenticated; select set_config('request.jwt.claim.sub',${lit(user)},false); select set_config('request.jwt.claims',${lit(JSON.stringify({ sub: user, session_id: session }))},false);`;
}

// Start a named psql session whose open transaction can be released after a competing wait is observed.
function session(name) {
  const child = spawn(psql, [...args, "-f", "-"], { env: { ...env, PGAPPNAME: name }, stdio: ["pipe", "pipe", "pipe"] });
  const state = { child, name, output: "", error: "", closed: false, completion: null };
  child.stdout.on("data", (chunk) => { state.output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { state.error += chunk.toString(); });
  state.completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { state.closed = true; if (code === 0) resolve(); else reject(new Error(`Fixture session failed: ${state.error.slice(0, 1000)}`)); });
  });
  state.completion.catch(() => {});
  sessions.push(state);
  return state;
}

// Wait for a bounded observable condition, never infer a database lock from a sleep alone.
async function until(predicate, label) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timeout: ${label}`);
    await delay(40);
  }
}

// Hold the canonical sharing lock, observe the real competing advisory wait, then commit the first writer.
async function race(label, firstSql, secondSql) {
  const name = `team_race_${randomUUID().replaceAll("-", "")}`;
  const first = session(`${name}_first`);
  first.child.stdin.write(`begin; select public.recording_sharing_lock_v1(); ${firstSql} select 'LOCK_HELD';\n`);
  await until(() => first.output.includes("LOCK_HELD"), "first writer sharing lock");
  const second = session(`${name}_second`);
  second.child.stdin.end(`${secondSql}\n`);
  await until(() => sql(`select count(*) from pg_catalog.pg_stat_activity where application_name=${lit(second.name)} and wait_event_type='Lock' and wait_event='advisory';`) === "1", "competing writer advisory wait");
  assert.equal(second.closed, false, "second writer must not finish before the first commit");
  first.child.stdin.end("commit;\n");
  await Promise.all([first.completion, second.completion]);
  console.log(`PASS ${label} (actual advisory wait observed)`);
}

try {
  assert.equal(sql("select datdba=(select oid from pg_roles where rolname=current_user) from pg_database where datname=current_database();"), "t");
  sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values(${lit(fixture.admin)},${lit(`${fixture.admin}@race.invalid`)},now()),(${lit(fixture.recipient)},${lit(`${fixture.recipient}@race.invalid`)},now());
    insert into auth.sessions(id,user_id) values(${lit(fixture.session)},${lit(fixture.admin)}),(${lit(fixture.recipientSession)},${lit(fixture.recipient)});
    insert into vosio_team_private.installation_administrators(user_id) values(${lit(fixture.admin)});
    insert into vosio_team_private.contacts(owner_id,user_id) values(${lit(fixture.admin)},${lit(fixture.recipient)});
    insert into public.recording_clients(id,user_id,name) values(${lit(fixture.client)},${lit(fixture.admin)},'Synthetic concurrency client');
    insert into public.recordings(id,user_id,created_by,title,source_type,status,visibility,client_id) values(${lit(fixture.recording)},${lit(fixture.admin)},${lit(fixture.admin)},'Synthetic concurrency recording','upload','completed','selected',${lit(fixture.client)});
    commit;`);
  const grant = `select public.set_team_access_v1('client',${lit(fixture.client)},null,${lit(fixture.recipient)},'reader');`;
  await race("grant_serializes_with_authorized_fixture_move", `update public.recordings set client_id=null where id=${lit(fixture.recording)};`, `${auth(fixture.admin, fixture.session)} ${grant}`);
  assert.equal(sql(`${auth(fixture.recipient, fixture.recipientSession)} select public.can_read_recording(${lit(fixture.recording)});`).split(/\r?\n/).at(-1), "f", "moved recording must not retain a materialized scope grant");
  sql(`update public.recordings set client_id=${lit(fixture.client)} where id=${lit(fixture.recording)};`);
  assert.equal(sql(`${auth(fixture.recipient, fixture.recipientSession)} select public.can_read_recording(${lit(fixture.recording)});`).split(/\r?\n/).at(-1), "t", "moving back must dynamically recover the still-valid grant");
  await race("administrator_revoke_serializes_and_waiting_grant_rechecks", `update vosio_team_private.installation_administrators set revoked_at=clock_timestamp() where user_id=${lit(fixture.admin)};`, `${auth(fixture.admin, fixture.session)} do $$ begin ${grant.replace(/^select /, "perform ")} raise exception 'removed administrator grant unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;`);
  assert.equal(sql(`${auth(fixture.recipient, fixture.recipientSession)} select public.can_read_recording(${lit(fixture.recording)});`).split(/\r?\n/).at(-1), "f", "unbounded grant invalid after administrator removal");
  console.log("PASS dynamic_move_out_back_and_removed_authority (actual authenticated roles)");
} finally {
  for (const active of sessions) if (!active.closed) active.child.kill();
  await Promise.allSettled(sessions.map((active) => active.completion));
  sql(`begin; delete from public.recordings where id=${lit(fixture.recording)}; delete from public.recording_clients where id=${lit(fixture.client)}; delete from auth.sessions where id in (${lit(fixture.session)},${lit(fixture.recipientSession)}); delete from auth.users where id in (${lit(fixture.admin)},${lit(fixture.recipient)}); commit;`);
}
