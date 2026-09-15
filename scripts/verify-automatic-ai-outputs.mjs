/* global process: readonly, fetch: readonly, AbortSignal: readonly, console: readonly, setTimeout: readonly */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
// option reads a named value without confusing an absent flag with the first argument.
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const target = option("--target");
const mode = option("--mode");
const manifestPath = resolve(option("--manifest") || ".tmp/automatic-ai-proof-manifest.json");
if (!args.includes("--approved-synthetic-db-verification") || !/^[a-z]{20}$/.test(target ?? "")
  || target !== process.env.SUPABASE_EXPECTED_PROJECT_REF || !["rehearse", "concurrency", "cleanup"].includes(mode)) {
  throw new Error("Require explicit approval, mode, target and matching SUPABASE_EXPECTED_PROJECT_REF.");
}
const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_VOSIO_TOKEN;
if (!token) throw new Error("Management token must be supplied in the environment.");
const endpoint = `https://api.supabase.com/v1/projects/${target}/database/query`;
const migrationPath = resolve("supabase/migrations/20260915170017_add_automatic_ai_outputs.sql");
const migration = await readFile(migrationPath, "utf8");
const hash = createHash("sha256").update(migration).digest("hex");
if (hash !== option("--migration-sha256")) throw new Error("Exact reviewed migration SHA-256 required.");
if (/^\s*(commit|rollback)\s*;/im.test(migration)) throw new Error("Migration must not escape the runner transaction.");
const types = ["summary", "action_items", "meeting_minutes", "crm_note", "follow_up_email", "timeline_chapters"];
const pending = [];
const manifest = mode === "cleanup" ? JSON.parse(await readFile(manifestPath, "utf8")) : {
  version: 1, target, migrationSha256: hash, runId: randomUUID(),
  owners: [randomUUID(), randomUUID()], recordings: [randomUUID(), randomUUID(), randomUUID()],
  transcripts: [randomUUID(), randomUUID(), randomUUID()], overrides: Array.from({ length: 12 }, () => randomUUID()),
  jobs: [], intents: [], outputs: []
};
assert.equal(manifest.target, target);
assert.equal(manifest.version, 1);
assert.match(manifest.runId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
for (const [field, size] of [["owners", 2], ["recordings", 3], ["transcripts", 3], ["overrides", 12]]) {
  assert.equal(manifest[field]?.length, size, "Invalid fixture manifest cardinality.");
}
for (const key of ["owners", "recordings", "transcripts", "overrides", "jobs", "intents", "outputs"]) {
  assert.ok(Array.isArray(manifest[key]));
  for (const id of manifest[key]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
}
const [ownerA, ownerB] = manifest.owners;
const [transcriptA, transcriptB, transcriptC] = manifest.transcripts;
const prefix = `aai-proof-${manifest.runId.slice(0, 8)}`;
const key = (suffix) => `proof_${manifest.runId}_${suffix}`;
const list = (ids) => ids.map((id) => `'${id}'::uuid`).join(",");

// query uses one bounded Management API session without logging SQL, tokens or user content.
async function query(sql, readOnly = false) {
  const response = await fetch(endpoint, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Automatic AI proof HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected database proof envelope.");
  return data;
}

// transaction enforces finite server timeouts and never leaves a deliberately open session.
function transaction(name, sql, rollback = false) {
  return `begin; set local application_name='${name}'; set local statement_timeout='30s'; set local lock_timeout='15s'; ${sql}; ${rollback ? "rollback" : "commit"};`;
}

// complete retains the exact generation identity and uses only synthetic transcript owners.
function complete(transcript, owner, generation, selected = types) {
  return `select * from public.complete_transcript_generation_v2('${generation}','import','${transcript}','${owner}',null,null,
    array[${selected.map((type) => `'${type}'`).join(",")}]::text[],'openai','gpt-5.6-terra','{"provider_model":"gpt-5.6-terra"}'::jsonb)`;
}

// setup creates only new identifiable auth/recording/override fixtures; no real account is reused.
function setup() {
  return `insert into auth.users(id,aud,role,email,created_at,updated_at) values
    ('${ownerA}','authenticated','authenticated','${ownerA}@example.invalid',now(),now()),
    ('${ownerB}','authenticated','authenticated','${ownerB}@example.invalid',now(),now());
    ${manifest.recordings.map((id, i) => `insert into public.recordings(id,user_id,title,source_type,status)
      values ('${id}','${i === 1 ? ownerB : ownerA}','Synthetic automatic AI proof ${manifest.runId}','realtime','created');
      insert into public.transcripts(id,recording_id,user_id,raw_text) values
      ('${manifest.transcripts[i]}','${id}','${i === 1 ? ownerB : ownerA}','Synthetic verification text.');`).join("\n")}
    ${manifest.owners.flatMap((owner, oi) => types.map((type, ti) => `insert into public.prompt_template_overrides
      (id,user_id,system_prompt_id,prompt_text) select '${manifest.overrides[oi * 6 + ti]}','${owner}',id,
      'Synthetic owner ${oi} ${type} prompt snapshot' from public.prompt_templates where is_system and processing_type='${type}';`)).join("\n")}`;
}

// enqueue restores exactly the current synthetic outbox into durable jobs.
function enqueue(transcript, owner) {
  return `select j.id from public.automatic_timeline_intents i cross join lateral
    public.enqueue_automatic_ai_job_v2(i.transcript_id,i.user_id,i.processing_type::text,i.automatic_idempotency_key) j
    where i.transcript_id='${transcript}' and i.user_id='${owner}'`;
}

// claim returns a count so the two-session proof can distinguish the single winner.
function claim(job, lease) {
  return `select count(*)::integer n from public.claim_automatic_ai_job_v2('${job}','${lease}',now(),900)`;
}

// publish uses exact synthetic identities with an optional deliberately invalid projection.
function publish(job, lease, generation, output = randomUUID(), badProjection = false) {
  manifest.outputs.push(output);
  const rows = badProjection ? [{ ai_output_id: output, processing_job_id: job, transcript_id: transcriptA,
    user_id: ownerA, position: -1, title: "Synthetic invalid projection", owner_category: "Nejasné", status: "new", raw_item: {} }] : [];
  const projections = JSON.stringify({ tasks: rows, chapters: [], decisions: [], risks: [] });
  return `select count(*)::integer n from public.publish_automatic_ai_output_v2('${job}','${ownerA}','${transcriptA}',
    '${generation}','${lease}','${output}','Synthetic proof output',null,4,2,'${projections}'::jsonb)`;
}

// remember persists an exact cleanup manifest before each committed fixture/race request.
async function remember() { await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n"); }

// catalog captures relevant definitions/ACLs without printing their contents.
async function catalog() {
  return query(`select md5(coalesce(string_agg(value,'\n' order by value),'')) digest from (
    select pg_get_functiondef(p.oid) || coalesce(p.proacl::text,'') value
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and (p.proname like '%automatic%v%' or p.proname like 'complete_transcript_generation_v%')
    union all select c.relname || coalesce(c.relacl::text,'') || c.relrowsecurity || c.relforcerowsecurity
      from pg_class c where c.oid in ('public.transcripts'::regclass,'public.ai_processing_jobs'::regclass,'public.automatic_timeline_intents'::regclass,'public.prompt_templates'::regclass)
    union all select attrelid::text || attname || atttypid::text || attnotnull || coalesce(pg_get_expr(d.adbin,d.adrelid),'')
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped
      and a.attrelid in ('public.transcripts'::regclass,'public.ai_processing_jobs'::regclass,'public.automatic_timeline_intents'::regclass)
    union all select conrelid::text || conname || pg_get_constraintdef(oid) from pg_constraint
      where conrelid in ('public.transcripts'::regclass,'public.ai_processing_jobs'::regclass,'public.automatic_timeline_intents'::regclass)
    union all select tablename || policyname || roles::text || coalesce(qual,'') || coalesce(with_check,'') from pg_policies
      where schemaname='public' and tablename in ('transcripts','ai_processing_jobs','automatic_timeline_intents','prompt_templates')
    union all select indexdef from pg_indexes where schemaname='public' and tablename in ('transcripts','ai_processing_jobs','automatic_timeline_intents')
  ) catalog_rows`, true);
}

// assertClean verifies every fixture family by exact IDs or its exact synthetic transcript FK.
async function assertClean() {
  const rows = await query(`select
    (select count(*) from auth.users where id in (${list(manifest.owners)}))::integer owners,
    (select count(*) from public.recordings where id in (${list(manifest.recordings)}))::integer recordings,
    (select count(*) from public.transcripts where id in (${list(manifest.transcripts)}))::integer transcripts,
    (select count(*) from public.ai_processing_jobs where transcript_id in (${list(manifest.transcripts)}))::integer jobs,
    (select count(*) from public.ai_outputs where transcript_id in (${list(manifest.transcripts)}))::integer outputs,
    (select count(*) from public.automatic_timeline_intents where transcript_id in (${list(manifest.transcripts)}))::integer intents,
    (select count(*) from public.prompt_template_overrides where id in (${list(manifest.overrides)}))::integer overrides`, true);
  assert.ok(Object.values(rows[0]).every((count) => count === 0), "Exact fixture cleanup incomplete; retain manifest.");
}

// cleanup removes only manifest roots, then proves all narrowly identified descendants are gone.
async function cleanup() {
  await Promise.all(pending);
  await query(transaction(`${prefix}-cleanup`, `delete from public.recordings where id in (${list(manifest.recordings)})
    and title='Synthetic automatic AI proof ${manifest.runId}'
    and user_id in (select id from auth.users where id in (${list(manifest.owners)}) and email in ('${ownerA}@example.invalid','${ownerB}@example.invalid'));
    delete from public.prompt_template_overrides where id in (${list(manifest.overrides)})
    and prompt_text like 'Synthetic owner % prompt snapshot'
    and user_id in (select id from auth.users where id in (${list(manifest.owners)}) and email in ('${ownerA}@example.invalid','${ownerB}@example.invalid'));
    delete from auth.users where id in (${list(manifest.owners)})
    and email in ('${ownerA}@example.invalid','${ownerB}@example.invalid')`));
  await assertClean();
  console.log("PASS exact fixture cleanup", manifest.runId);
}

// waitFor requires observed PostgreSQL sleep/lock waits rather than guessed request timing.
async function waitFor(name, kind) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const rows = await query(`select count(*)::integer n from pg_stat_activity where application_name='${name}'
      and ${kind === "lock" ? "wait_event_type='Lock'" : "wait_event='PgSleep'"}`, true);
    if (rows[0]?.n === 1) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`No observed ${kind} for exact proof session ${name}`);
}

// race tracks both real sessions until settlement, even if the observer fails.
async function race(label, firstSql, secondSql) {
  await remember();
  const start = (sql) => {
    const task = query(sql).then((value) => ({ value }), (error) => ({ error }));
    pending.push(task); return task;
  };
  const first = start(transaction(`${prefix}-${label}-a`, `set local role service_role;
    create temporary table proof_result on commit drop as ${firstSql}; select pg_sleep(8); select * from proof_result`));
  await waitFor(`${prefix}-${label}-a`, "sleep");
  const second = start(transaction(`${prefix}-${label}-b`, `set local role service_role; ${secondSql}`));
  await waitFor(`${prefix}-${label}-b`, "lock");
  const outcomes = await Promise.all([first, second]);
  for (const outcome of outcomes) if (outcome.error) throw outcome.error;
  console.log("PASS observed two-session lock wait", label);
  return outcomes.map((outcome) => outcome.value);
}

// postflight checks service-only invoker ACLs, current uniqueness and forced RLS without content.
async function postflight() {
  const rows = await query(`select
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('complete_transcript_generation_v2','enqueue_automatic_ai_job_v2','claim_automatic_ai_job_v2',
        'settle_automatic_ai_job_v2','publish_automatic_ai_output_v2') and not p.prosecdef
      and p.proconfig @> array['search_path=""'] and not has_function_privilege('anon',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute'))::integer functions,
    (select count(*) from pg_class where oid in ('public.ai_processing_jobs'::regclass,'public.automatic_timeline_intents'::regclass)
      and relrowsecurity and relforcerowsecurity)::integer rls,
    (select count(*) from (select 1 from public.automatic_timeline_intents group by user_id,transcript_id,completion_generation_key,processing_type having count(*)>1) x)::integer duplicate_intents,
    (select count(*) from (select 1 from public.ai_outputs group by processing_job_id having count(*)>1) x)::integer duplicate_outputs`, true);
  assert.deepEqual(rows[0], { functions: 5, rls: 2, duplicate_intents: 0, duplicate_outputs: 0 });
  console.log("PASS catalog ACL/RLS/uniqueness", hash);
}

if (mode === "cleanup") { await cleanup(); process.exit(0); }
// Exclusive creation preserves any prior cleanup identity before the first database request.
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
await assertClean();
if (mode === "rehearse") {
  const before = await catalog();
  const gen = key("sequential");
  try {
    const semantics = `${setup()}; set local role service_role;
      ${complete(transcriptA, ownerA, gen)}; ${complete(transcriptB, ownerB, key("sequential-b"))};
      ${enqueue(transcriptA, ownerA)}; ${enqueue(transcriptB, ownerB)};
      select * from public.complete_transcript_generation_v1('${key("sequential-b")}','import','${transcriptB}','${ownerB}',null,null,false,'openai','gpt-5.6-terra','{}');
      select j.id from public.automatic_timeline_intents i cross join lateral public.enqueue_automatic_timeline_job_v1(
        i.automatic_idempotency_key,i.transcript_id,i.user_id,i.provider,i.model,i.prompt_id,i.prompt_override_id,
        i.prompt_source,i.prompt_name_snapshot,i.prompt_text_snapshot,i.prompt_output_schema_snapshot,i.prompt_revision_snapshot,i.provider_config) j
        where i.transcript_id='${transcriptB}' and i.processing_type='timeline_chapters';
      do $proof$ declare j uuid; lease uuid := gen_random_uuid(); output_id uuid := gen_random_uuid();
        n integer; job_before jsonb; projections jsonb; fixture_json jsonb; failed_constraint text; begin
        assert (select count(*)=6 from public.automatic_timeline_intents where transcript_id='${transcriptA}');
        assert (select count(*)=12 from public.ai_processing_jobs where transcript_id in ('${transcriptA}','${transcriptB}'));
        assert not exists(select 1 from public.automatic_timeline_intents where user_id='${ownerA}' and prompt_text_snapshot not like 'Synthetic owner 0 %');
        assert not exists(select 1 from public.automatic_timeline_intents where user_id='${ownerB}' and prompt_text_snapshot not like 'Synthetic owner 1 %');
        ${complete(transcriptA, ownerA, gen, []).replace('select *', 'perform *')};
        assert (select count(*)=6 from public.automatic_timeline_intents where transcript_id='${transcriptA}');
        select id into j from public.ai_processing_jobs where transcript_id='${transcriptA}' and processing_type='summary';
        perform * from public.claim_automatic_ai_job_v2(j,lease,now(),900);
        select count(*) into n from public.publish_automatic_ai_output_v2(j,'${ownerA}','${transcriptA}','${gen}',gen_random_uuid(),gen_random_uuid(),'Synthetic',null,1,1,'{"tasks":[],"chapters":[],"decisions":[],"risks":[]}'); assert n=0;
        select count(*) into n from public.publish_automatic_ai_output_v2(j,'${ownerA}','${transcriptA}','wrong-generation',lease,gen_random_uuid(),'Synthetic',null,1,1,'{"tasks":[],"chapters":[],"decisions":[],"risks":[]}'); assert n=0;
        update public.ai_processing_jobs set lease_expires_at=now()-interval '1 second' where id=j;
        select count(*) into n from public.publish_automatic_ai_output_v2(j,'${ownerA}','${transcriptA}','${gen}',lease,gen_random_uuid(),'Synthetic',null,1,1,'{"tasks":[],"chapters":[],"decisions":[],"risks":[]}'); assert n=0;
        update public.ai_processing_jobs set lease_expires_at=now()+interval '900 seconds' where id=j;
        select to_jsonb(job) into job_before from public.ai_processing_jobs job where id=j;
        fixture_json := '{"action_items":[{"task":"Synthetic task"}],"chapters":[{"title":"Synthetic chapter"}]}'::jsonb;
        -- Representative buildStructuredAiItems rows: valid linkage and required mapped fields.
        projections := jsonb_build_object(
          'tasks',jsonb_build_array(jsonb_build_object('ai_output_id',output_id,'processing_job_id',j,
            'transcript_id','${transcriptA}','user_id','${ownerA}','position',1,'title','Synthetic task',
            'owner_category','Nejasné','status','new','raw_item',fixture_json->'action_items'->0)),
          'chapters',jsonb_build_array(jsonb_build_object('ai_output_id',output_id,'processing_job_id',j,
            'transcript_id','${transcriptA}','user_id','${ownerA}','position',1,'title','Synthetic chapter',
            'topics','[]'::jsonb,'speakers','[]'::jsonb,'dominant_roles','[]'::jsonb,'raw_item',fixture_json->'chapters'->0)),
          'decisions','[]'::jsonb,'risks','[]'::jsonb);
        begin
          -- The chapter constraint fails after raw output AND the valid task have been inserted.
          perform * from public.publish_automatic_ai_output_v2(j,'${ownerA}','${transcriptA}','${gen}',lease,output_id,'Synthetic',fixture_json,4,2,
            jsonb_set(projections,'{chapters,0,position}','-1'::jsonb));
          raise exception 'Invalid projection unexpectedly published';
        exception when check_violation then
          get stacked diagnostics failed_constraint = constraint_name;
          assert failed_constraint='transcript_chapters_position_check';
        end;
        assert not exists(select 1 from public.ai_outputs where processing_job_id=j);
        assert not exists(select 1 from public.transcript_tasks where processing_job_id=j);
        assert not exists(select 1 from public.transcript_chapters where processing_job_id=j);
        assert not exists(select 1 from public.transcript_decisions where processing_job_id=j);
        assert not exists(select 1 from public.transcript_risks where processing_job_id=j);
        assert (select to_jsonb(job)=job_before and status='running' from public.ai_processing_jobs job where id=j);
        select count(*) into n from public.publish_automatic_ai_output_v2(j,'${ownerA}','${transcriptA}','${gen}',lease,output_id,'Synthetic',fixture_json,4,2,projections); assert n=1;
        assert (select count(*)=1 from public.ai_outputs where processing_job_id=j);
        assert (select user_id='${ownerA}' and transcript_id='${transcriptA}' and processing_job_id=j
          and output_text='Synthetic' and ai_outputs.output_json=fixture_json from public.ai_outputs where id=output_id);
        assert (select count(*)=1 and bool_and(to_jsonb(task) @> (projections->'tasks'->0)) from public.transcript_tasks task where processing_job_id=j);
        assert (select count(*)=1 and bool_and(to_jsonb(chapter) @> (projections->'chapters'->0)) from public.transcript_chapters chapter where processing_job_id=j);
        assert not exists(select 1 from public.transcript_decisions where processing_job_id=j);
        assert not exists(select 1 from public.transcript_risks where processing_job_id=j);
        assert (select status='done' and input_token_count=4 and output_token_count=2 and completed_at is not null
          and lease_token is null and lease_expires_at is null from public.ai_processing_jobs where id=j);
        assert (select count(*)=0 from public.claim_automatic_timeline_job_v1(j,gen_random_uuid(),now(),900));
      end $proof$;
      reset role;
      -- Transaction-local visibility fault proves the real missing-prompt branch without editing a system prompt.
      grant execute on function public.complete_transcript_generation_v2(text,text,uuid,uuid,uuid,integer,text[],public.ai_provider,text,jsonb) to authenticated;
      grant select,insert,delete on public.automatic_timeline_intents to authenticated;
      grant update on public.prompt_templates to authenticated;
      create policy proof_intents on public.automatic_timeline_intents for all to authenticated using(user_id='${ownerA}') with check(user_id='${ownerA}');
      create policy proof_missing_prompt on public.prompt_templates as restrictive for select to authenticated using(processing_type <> 'crm_note');
      select set_config('request.jwt.claim.sub','${ownerA}',true); set local role authenticated;
      do $missing$ begin
        begin ${complete(transcriptC, ownerA, key("missing")).replace('select *', 'perform *')};
          raise exception 'Missing prompt unexpectedly completed'; exception when no_data_found then null; end;
        assert (select completion_generation_key is null from public.transcripts where id='${transcriptC}');
        assert (select status='created' from public.recordings where id='${manifest.recordings[2]}');
        assert not exists(select 1 from public.automatic_timeline_intents where transcript_id='${transcriptC}');
      end $missing$; reset role;
      set local role service_role;
      select * from public.complete_transcript_generation_v1('${key("legacy-off")}','import','${transcriptC}','${ownerA}',null,null,false,'openai','gpt-5.6-terra','{}');
      ${complete(transcriptC, ownerA, key("legacy-off"))};
      do $legacy$ begin assert not exists(select 1 from public.automatic_timeline_intents where transcript_id='${transcriptC}'); end $legacy$;
      reset role;`;
    await query(transaction(`${prefix}-rehearse`, migration + "\n" + semantics, true));
  } finally {
    assert.deepEqual(await catalog(), before, "Rehearsal did not restore function catalog.");
    await assertClean();
  }
  console.log("PASS rollback-only semantic rehearsal and catalog restoration", hash);
} else {
  await postflight();
  try {
    await query(transaction(`${prefix}-setup`, setup()));
    const generation = key("concurrent");
    const completionRace = await race("completion", complete(transcriptA, ownerA, generation), complete(transcriptA, ownerA, generation));
    assert.equal(completionRace[0][0].is_new_generation, true); assert.equal(completionRace[1][0].is_new_generation, false);
    await query(transaction(`${prefix}-enqueue`, `set local role service_role; ${enqueue(transcriptA, ownerA)}`));
    const jobs = await query(`select id,processing_type from public.ai_processing_jobs where transcript_id='${transcriptA}' and user_id='${ownerA}'`, true);
    assert.equal(jobs.length, 6); manifest.jobs = jobs.map((job) => job.id);
    manifest.intents = (await query(`select id from public.automatic_timeline_intents where transcript_id='${transcriptA}'`, true)).map((row) => row.id);
    const job = jobs.find((row) => row.processing_type === "summary").id;
    const leaseA = randomUUID(), leaseB = randomUUID();
    const claims = await race("claim", claim(job, leaseA), claim(job, leaseB));
    assert.equal(claims[0][0].n, 1); assert.equal(claims[1][0].n, 0);
    await query(transaction(`${prefix}-expire`, `update public.ai_processing_jobs set lease_expires_at=now()-interval '1 second' where id='${job}' and user_id='${ownerA}'`));
    const transfer = await race("transfer", claim(job, leaseB), publish(job, leaseA, generation));
    assert.equal(transfer[0][0].n, 1); assert.equal(transfer[1][0].n, 0);
    await remember();
    await query(transaction(`${prefix}-projection`, `set local role service_role; do $projection$ begin
      begin ${publish(job, leaseB, generation, randomUUID(), true).replace('select count(*)::integer n', 'perform count(*)')};
        raise exception 'Invalid projection unexpectedly published'; exception when check_violation then null; end;
      assert not exists(select 1 from public.ai_outputs where processing_job_id='${job}');
      assert (select status='running' from public.ai_processing_jobs where id='${job}'); end $projection$`));
    const stale = await race("generation", complete(transcriptA, ownerA, key("next"), []), publish(job, leaseB, generation));
    assert.equal(stale[0][0].is_new_generation, true); assert.equal(stale[1][0].n, 0);
    const invariant = await query(`select (select count(*) from public.ai_outputs where transcript_id='${transcriptA}')::integer outputs,
      (select count(*) from public.ai_processing_jobs where transcript_id='${transcriptA}')::integer jobs`, true);
    assert.deepEqual(invariant[0], { outputs: 0, jobs: 0 });
    await postflight();
  } finally { await remember(); await cleanup(); }
  console.log("PASS real concurrent completion, claim, lease transfer and generation fences", hash);
}
