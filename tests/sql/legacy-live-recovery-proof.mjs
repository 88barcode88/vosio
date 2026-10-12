import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import console from 'node:console';

// Fixed disposable loopback fixture; no live credentials, HTTP calls or audio files.
const exe = resolve(process.env.VOSIO_TEST_PG_BIN ?? '.tmp/p1-postgres/pgsql/bin', 'psql.exe');
const args = ['-X', '-qAt', '-h', '127.0.0.1', '-p', '55448', '-U', 'legacy_owner', '-d', 'legacy_final_vosio_recovery_test', '-v', 'ON_ERROR_STOP=1'];
// Execute SQL only against the fixed disposable connection and fail on every SQL error.
function sql(source) {
  const result = spawnSync(exe, [...args, '-f', '-'], { encoding: 'utf8', input: source });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim().split(/\r?\n/).at(-1);
}
// Quote synthetic fixture values as SQL literals.
function lit(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
// Exercise real API roles and session claims rather than mocked permissions.
function auth(f, actor = f.owner, role = 'authenticated') { return `set role ${role};select set_config('request.jwt.claim.sub',${lit(actor)},false);`; }
// Require the exact SQLSTATE without relying on localized database messages.
function denied(source, code) { return `do $proof$ begin ${source.replace(/^select /, 'perform ')};raise exception 'expected ${code}';exception when sqlstate '${code}' then null;end $proof$;`; }
const parts = [0, 1, 2, 3].map(index => ({ index, mimeType: 'audio/webm', bytes: 10 }));
// Invoke the deployed-compatible adoption RPC with the complete expected browser scope.
function adoption(f, manifest = parts) { return `select public.adopt_legacy_live_parts_v1(${lit(f.recording)},0,${lit(JSON.stringify(manifest))}::jsonb)`; }
// Invoke the unchanged public upload preparation contract.
function prepare(f, index = 1, size = 10) { return `select public.prepare_recording_live_part_v1(${lit(f.recording)},0,${index},'audio/webm',${size})`; }
// Seed fresh synthetic accounts and metadata only, never real user fixtures.
function fixture(label, capture = false, editorCapture = false) {
  const f = Object.fromEntries(['owner', 'editor', 'reader', 'other', 'project', 'recording', 'transcript'].map(k => [k, randomUUID()]));
  f.captureAuthor = editorCapture ? f.editor : f.owner;
  f.prefix = `${f.captureAuthor}/${f.recording}/live/`;
  sql(`insert into auth.users(id,email)select x,x::text||'@example.invalid' from unnest(array[${[f.owner,f.editor,f.reader,f.other].map(x => lit(x)+'::uuid').join(',')}])x;
    insert into public.recording_projects(id,user_id,name)values(${lit(f.project)},${lit(f.owner)},${lit(label)});
    insert into public.recording_project_members(project_id,user_id,role)values(${lit(f.project)},${lit(f.editor)},'editor'),(${lit(f.project)},${lit(f.reader)},'reader');
    insert into public.recordings(id,user_id,created_by,title,source_type,status,project_id,visibility,capture_request_id)
      values(${lit(f.recording)},${lit(f.captureAuthor)},${lit(f.captureAuthor)},${lit(label)},'in_app_recording','uploading',${lit(f.project)},'project',${capture ? lit(randomUUID()) : 'null'});
    insert into public.transcripts(id,recording_id,user_id,raw_text)values(${lit(f.transcript)},${lit(f.recording)},${lit(f.captureAuthor)},'synthetic retained text');
    insert into storage.objects(bucket_id,name,owner,metadata)select 'recordings',${lit(f.prefix)}||'part-'||lpad(i::text,6,'0')||'.webm',${lit(f.captureAuthor)},'{"size":10,"mimetype":"audio/webm"}' from unnest(array[0,2])i;`);
  return f;
}
// Verify byte-for-byte retained transcript and original Storage metadata rows.
function fingerprint(f) {
  return sql(`select encode(sha256(convert_to(jsonb_build_object('text',(select to_jsonb(t) from public.transcripts t where id=${lit(f.transcript)}),
    'objects',(select jsonb_agg(to_jsonb(s)order by name)from storage.objects s where owner=${lit(f.owner)}))::text,'UTF8')),'hex')`);
}
// Read safe metadata through the authenticated list contract.
function list(f) { return JSON.parse(sql(auth(f)+`select to_jsonb(r)from public.list_recoverable_recording_captures_v1() r where id=${lit(f.recording)}`)); }
// Start independent real PostgreSQL sessions for observed lock interleavings.
function session(name) {
  const p = spawn(exe, args, { env: { ...process.env, PGAPPNAME: name }, stdio: ['pipe','pipe','pipe'] });
  const s = { p, name, out: '', err: '' };
  p.stdout.on('data', chunk => { s.out += chunk; });p.stderr.on('data', chunk => { s.err += chunk; });return s;
}
// Bound waits while checking actual server state, not assuming timing establishes ordering.
async function until(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) { if (Date.now()>deadline) throw new Error('bounded lock proof timeout');await new Promise(r=>setTimeout(r,30)); }
}
// Send one deliberate session step.
function send(s, source) { s.p.stdin.write(source+'\n'); }
// Roll back any remaining fixture transaction and close the owned client.
function close(s) { s.p.stdin.end('rollback;\n\\q\n'); }
const checks=[];
// Collect successful proof assertions without logging user content.
function check(name, fn) { fn();checks.push(name); }
assert.equal(sql('select current_database()'), 'legacy_final_vosio_recovery_test');
assert.equal(sql("select inet_server_addr()::text||':'||inet_server_port()::text"), '127.0.0.1/32:55448');
const f=fixture('legacy gaps');const before=fingerprint(f);
check('metadata gaps and original bytes',()=> { const row=list(f);assert.equal(row.segment_count,2);assert.equal(row.storage_bytes,20);assert.deepEqual(row.missing_part_indices,[1]);assert.equal(row.canRecover,false);assert.equal(row.canDelete,true);assert.equal(row.recovery_issue,'missing_audio_parts');assert.equal(row.legacy_adoption_state,'requires_local_manifest'); });
check('editor reader outsider anon service denied',()=> {
  for (const actor of [f.editor,f.reader,f.other]) sql(auth(f,actor)+denied(adoption(f),'42501'));
  for (const role of ['anon','service_role']) sql(auth(f,f.owner,role)+denied(adoption(f),'42501'));
});
check('invalid gap MIME metadata and remote omission denied',()=> {
  for(const manifest of [parts.filter(x=>x.index!==1),parts.map(x=>({...x,bytes:11})),parts.map(x=>({...x,mimeType:'audio/mp4'})),parts.slice(0,2)])
    sql(auth(f)+denied(adoption(f,manifest),'22023'));
  assert.equal(fingerprint(f),before);
  assert.equal(sql(`select count(*)from public.recording_live_part_registrations where recording_id=${lit(f.recording)}`),'0');
});
check('adoption retry keeps identity and all original data',()=> {
  sql(auth(f)+adoption(f));const id=sql(`select capture_request_id from public.recordings where id=${lit(f.recording)}`);
  sql(auth(f)+adoption(f));assert.equal(sql(`select capture_request_id from public.recordings where id=${lit(f.recording)}`),id);assert.equal(fingerprint(f),before);
  const row=list(f);assert.equal(row.expected_segment_count,4);assert.deepEqual(row.missing_part_indices,[1,3]);
  sql(auth(f)+denied(adoption(f,parts.slice(0,3)),'22023'));
});
check('expected scope frozen and existing bytes immutable',()=> {
  sql(auth(f)+prepare(f));sql(auth(f)+denied(prepare(f,4),'22023'));sql(auth(f)+denied(prepare(f,1,11),'22023'));
  assert.equal(sql(auth(f)+`select public.can_write_recording_object_v1(${lit(f.prefix+'part-000000.webm')})`),'f');
  assert.equal(sql(auth(f)+`select public.can_read_recording_object_v1(${lit(f.prefix+'part-000000.webm')})`),'t');
  assert.equal(sql(auth(f)+`select public.can_write_recording_object_v1(${lit(f.prefix+'part-000001.webm')})`),'t');
  sql(auth(f)+denied(`select public.complete_recording_live_parts_v1(${lit(f.recording)},${lit(randomUUID())},0,60)`,'55000'));
});
check('missing parts upload through real Storage RLS then strict completion',()=> {
  sql(auth(f)+`insert into storage.objects(bucket_id,name,owner,metadata)select 'recordings',${lit(f.prefix)}||'part-'||lpad(i::text,6,'0')||'.webm',${lit(f.owner)},'{"size":10,"mimetype":"audio/webm"}'from unnest(array[1,3])i;`);
  const row=list(f);assert.equal(row.segment_count,4);assert.deepEqual(row.missing_part_indices,[]);assert.equal(row.storage_bytes,40);assert.equal(row.canRecover,true);
  sql(auth(f)+`select public.complete_recording_live_parts_v1(${lit(f.recording)},${lit(randomUUID())},0,60)`);
  assert.equal(sql(`select status||':'||file_size_bytes::text from public.recordings where id=${lit(f.recording)}`),'uploaded:40');
  assert.equal(sql(`select raw_text from public.transcripts where id=${lit(f.transcript)}`),'synthetic retained text');
});
check('new capture unregistered remote manifest remains denied',()=> {
  const n=fixture('new capture',true);
  assert.equal(list(n).recovery_issue,'invalid_audio_manifest');assert.equal(list(n).canRecover,false);
  sql(auth(n)+adoption(n));sql(auth(n)+prepare(n,0));
  sql(auth(n)+denied(`select public.complete_recording_live_parts_v1(${lit(n.recording)},${lit(randomUUID())},0,60)`,'55000'));
  assert.equal(sql(`select count(*)from public.recording_live_part_registrations where recording_id=${lit(n.recording)}`),'1');
  assert.equal(list(n).recovery_issue,'invalid_audio_manifest');assert.equal(list(n).canRecover,false);
});
check('registered exact prefix rejects a matching but unregistered extra remote part in list and completion',()=> {
  const n=fixture('extra remote part',true);
  sql(auth(n)+prepare(n,0)+';'+prepare(n,1));
  sql(`insert into storage.objects(bucket_id,name,owner,metadata)values('recordings',${lit(n.prefix+'part-000001.webm')},${lit(n.owner)},'{"size":10,"mimetype":"audio/webm"}')`);
  assert.equal(list(n).expected_segment_count,2);assert.equal(list(n).segment_count,3);
  assert.deepEqual(list(n).missing_part_indices,[]);assert.equal(list(n).recovery_issue,'invalid_audio_manifest');assert.equal(list(n).canRecover,false);
  sql(auth(n)+denied(`select public.complete_recording_live_parts_v1(${lit(n.recording)},${lit(randomUUID())},0,60)`,'55000'));
});
check('legacy active job blocks adoption and preserves state',()=> {
  const n=fixture('busy legacy');const hash=fingerprint(n);
  sql(`insert into public.transcription_jobs(recording_id,user_id,provider,mode,status)values(${lit(n.recording)},${lit(n.owner)},'soniox','async','queued')`);
  sql(auth(n)+denied(adoption(n),'55000'));assert.equal(fingerprint(n),hash);
  assert.equal(list(n).recovery_issue,'active_transcription');assert.equal(list(n).legacy_adoption_state,'blocked');
  assert.equal(list(n).canDelete,false);
});
check('non-author founder ordinary recovery list matches locked RPC authority while adoption stays denied',()=> {
  const n=fixture('founder recovery',false,true);
  sql(`delete from storage.objects where name=${lit(n.prefix+'part-000002.webm')} and bucket_id='recordings'`);
  assert.equal(list(n).canRecover,true);
  sql(auth(n)+denied(adoption(n),'42501'));
  const recover=`select public.apply_recording_capture_transition_v1(${lit(n.recording)},${lit(randomUUID())},0,'recover')`;
  for(const actor of [n.reader,n.other]) {
    assert.equal(sql(auth(n,actor)+`select count(*)from public.list_recoverable_recording_captures_v1() where id=${lit(n.recording)}`),'0');
    sql(auth(n,actor)+denied(recover,'42501'));
  }
  for(const role of ['anon','service_role']) sql(auth(n,n.owner,role)+denied(recover,'42501'));
  const receipt=JSON.parse(sql(auth(n)+recover));assert.equal(receipt.status,'completed');
  assert.equal(sql(`select user_id::text||':'||created_by::text from public.recordings where id=${lit(n.recording)}`),n.editor+':'+n.editor);
  assert.equal(sql(`select raw_text from public.transcripts where id=${lit(n.transcript)}`),'synthetic retained text');
});
check('legacy missing unsupported mixed and mismatched MIME report invalid retained audio',()=> {
  for(const mime of [null,'application/octet-stream','audio/mp4','video/webm']) {
    const n=fixture('MIME diagnostics');
    sql(`delete from storage.objects where owner=${lit(n.owner)} and name=${lit(n.prefix+'part-000002.webm')};
      update storage.objects set metadata=${lit(JSON.stringify({size:10,...(mime===null?{}:{mimetype:mime})}))}::jsonb where owner=${lit(n.owner)}`);
    if(mime==='video/webm') sql(`insert into storage.objects(bucket_id,name,owner,metadata)values('recordings',${lit(n.prefix+'part-000001.webm')},${lit(n.owner)},'{"size":10,"mimetype":"audio/webm"}')`);
    const row=list(n);assert.equal(row.recovery_issue,'invalid_audio_manifest');assert.equal(row.canRecover,false);assert.equal(row.legacy_adoption_state,'blocked');
  }
  const n=fixture('duplicate index');
  sql(`delete from storage.objects where owner=${lit(n.owner)} and name=${lit(n.prefix+'part-000002.webm')};
    insert into storage.objects(bucket_id,name,owner,metadata)values('recordings',${lit(n.prefix+'part-000000.m4a')},${lit(n.owner)},'{"size":10,"mimetype":"audio/mp4"}')`);
  assert.equal(list(n).recovery_issue,'invalid_audio_manifest');assert.equal(list(n).canRecover,false);
});
// A real second session must wait on canonical authority locks before adoption reads authority.
for (const outcome of ['revoke','adopt','revision','reservation']) {
  const n=fixture('lock '+outcome);const first=session('legacy-first-'+outcome),second=session('legacy-second-'+outcome);
  try {
    send(first,`begin;select public.lock_recording_capture_v1(${lit(n.recording)}) is not null;select 'FIRST_READY';`);
    await until(()=>first.out.includes('FIRST_READY'));
    if(outcome==='revoke') send(first,`update public.recordings set created_by=${lit(n.editor)} where id=${lit(n.recording)};`);
    else if(outcome==='revision') send(first,`update public.recordings set capture_revision=1 where id=${lit(n.recording)};`);
    else if(outcome==='reservation') send(first,`insert into public.transcription_jobs(recording_id,user_id,provider,mode,status)values(${lit(n.recording)},${lit(n.owner)},'soniox','async','queued');`);
    else send(first,auth(n)+adoption(n)+';');
    const state={revoke:'42501',revision:'40001',reservation:'55000'}[outcome];
    send(second,'begin;'+auth(n)+(state?denied(adoption(n),state):adoption(n)+';')+"select 'SECOND_DONE';commit;");
    await until(()=>sql(`select count(*)from pg_stat_activity where application_name=${lit(second.name)} and wait_event_type='Lock'`)==='1');
    send(first,'commit;');await until(()=>second.out.includes('SECOND_DONE'));
    assert.equal(second.err,'');
    const count=sql(`select count(*)from public.recording_live_part_registrations where recording_id=${lit(n.recording)}`);
    assert.equal(count,outcome==='adopt'?'4':'0');checks.push('two-session '+outcome+' serializes before mutation');
  } finally { close(first);close(second); }
}
console.log(JSON.stringify({ passed: checks.length, checks },null,2));
