import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const exe = resolve(process.env.VOSIO_TEST_PG_BIN ?? '.tmp/p1-postgres/pgsql/bin', 'psql.exe');
const args = ['-X','-qAt','-h','127.0.0.1','-p','55448','-U','legacy_owner','-d','legacy_final_vosio_recovery_test','-v','ON_ERROR_STOP=1'];
// Only the existing disposable loopback proof database is allowed.
function sql(source) {
  const r = spawnSync(exe,[...args,'-f','-'],{input:source,encoding:'utf8'});
  if(r.status!==0) throw new Error(r.stderr);
  return r.stdout.trim().split(/\r?\n/).at(-1);
}
// Quote only synthetic generated fixture data.
function lit(v) { return "'"+String(v).replaceAll("'","''")+"'"; }
// Use real API roles with explicit session identity.
function auth(f, role='authenticated', actor=f.owner) { return `set role ${role};select set_config('request.jwt.claim.sub',${lit(actor)},false);`; }
// Check exact database failure semantics.
function denied(source,code) { return `do $$begin ${source.replace(/^select /,'perform ')};raise exception 'expected ${code}';exception when sqlstate '${code}' then null;end $$;`; }
// Retain a real gap and metadata without physical audio or private user data.
function fixture(text='saved synthetic text') {
  const f=Object.fromEntries(['owner','other','recording','transcript','request'].map(k=>[k,randomUUID()]));
  sql(`insert into auth.users(id,email)values(${lit(f.owner)},'owner@example.invalid'),(${lit(f.other)},'other@example.invalid');
   insert into public.recordings(id,user_id,created_by,title,source_type,status,duration_seconds)
    values(${lit(f.recording)},${lit(f.owner)},${lit(f.owner)},'saved proof','in_app_recording','uploading',50);
   insert into public.transcripts(id,recording_id,user_id,raw_text)values(${lit(f.transcript)},${lit(f.recording)},${lit(f.owner)},${lit(text)});
   insert into storage.objects(bucket_id,name,owner,metadata)select 'recordings',${lit(f.owner+'/'+f.recording+'/live/')}||'part-'||lpad(i::text,6,'0')||'.webm',${lit(f.owner)},'{"size":10,"mimetype":"audio/webm"}' from unnest(array[0,2])i;`);
  return f;
}
// Immutable request retry must return precisely the original receipt.
function complete(f, revision=0, request=f.request) { return `select public.complete_saved_recording_transcript_v1(${lit(f.recording)},${lit(request)},${revision})`; }
// Fingerprint all content and audio binding metadata, excluding intentionally changed lifecycle fields.
function fingerprint(f) { return sql(`select encode(sha256(convert_to(jsonb_build_object(
 'text',(select to_jsonb(t)from public.transcripts t where id=${lit(f.transcript)}),
 'audio',(select jsonb_agg(to_jsonb(s)order by name)from storage.objects s where owner=${lit(f.owner)}),
 'binding',(select jsonb_build_array(storage_path,file_size_bytes,source_type,mime_type,duration_seconds)from public.recordings where id=${lit(f.recording)}))::text,'UTF8')),'hex')`); }
assert.equal(sql('select current_database()'),'legacy_final_vosio_recovery_test');
const checks=[];
// Collect only successful named assertions.
function check(name,fn) { fn();checks.push(name); }
const f=fixture(); const before=fingerprint(f);
check('outsider anon and service cannot confirm',()=>{
 sql(auth(f,'authenticated',f.other)+denied(complete(f),'42501'));
 for(const role of ['anon','service_role'])sql(auth(f,role)+denied(complete(f),'42501'));
});
check('stale revision empty text and active jobs fail closed',()=>{
 sql(auth(f)+denied(complete(f,1),'40001'));
 const empty=fixture('   ');sql(auth(empty)+denied(complete(empty),'55000'));
 const active=fixture();sql(`insert into public.transcription_jobs(recording_id,user_id,provider,mode,status)values(${lit(active.recording)},${lit(active.owner)},'soniox','async','queued');`);
 sql(auth(active)+denied(complete(active),'55000'));
});
check('confirmation preserves text audio gaps and binding, retry is immutable',()=>{
 const receipt=JSON.parse(sql(auth(f)+complete(f)));assert.equal(receipt.status,'completed');assert.equal(receipt.captureRevision,1);
 assert.equal(receipt.transcriptId,f.transcript);assert.equal(receipt.audioConfirmed,false);
 assert.deepEqual(JSON.parse(sql(auth(f)+complete(f))),receipt);
});
check('content custody and single receipt remain exact',()=>{
 assert.equal(fingerprint(f),before);
 assert.equal(sql(`select count(*)from public.recording_capture_receipts where recording_id=${lit(f.recording)}`),'1');
 sql(auth(f)+denied(complete(f,1),'42501'));
 assert.equal(sql(auth(f)+`select count(*)from public.list_recoverable_recording_captures_v1()where id=${lit(f.recording)}`),'0');
});
check('scoped service functions are inaccessible to sessions and anonymous',()=>{
 for(const role of ['anon','authenticated']){
  sql(auth(f,role)+denied(`select public.claim_recording_transcription_work_v2(1,${lit(randomUUID())})`,'42501'));
  sql(auth(f,role)+denied(`select public.get_recording_transcription_dispatch_v1(${lit(randomUUID())})`,'42501'));
 }
});
// Start two distinct synthetic accepted operations through real session contracts.
function started(partCount=1) {
 const n=fixture();
 if(partCount===1) sql(`delete from storage.objects where owner=${lit(n.owner)} and name like '%000002.webm';`);
 else sql(`insert into storage.objects(bucket_id,name,owner,metadata)values('recordings',${lit(n.owner+'/'+n.recording+'/live/part-000001.webm')},${lit(n.owner)},'{"size":10,"mimetype":"audio/webm"}');`);
 const parts=Array.from({length:partCount},(_,index)=>({index,mimeType:'audio/webm',bytes:10}));
 sql(auth(n)+`select public.adopt_legacy_live_parts_v1(${lit(n.recording)},0,${lit(JSON.stringify(parts))});
  select public.apply_recording_capture_transition_v1(${lit(n.recording)},${lit(randomUUID())},0,'recover');`);
 const op=JSON.parse(sql(auth(n)+`select public.prepare_recording_transcription_v1(${lit(n.recording)},${lit(randomUUID())},1,'eu','stt-async-v5','retranscribe')`)).operationId;
 sql(auth(n)+`select public.start_recording_transcription_v1(${lit(op)})`);return {...n,op};
}
check('scoped claims preserve other operations and verify exact provider custody',()=>{
 const one=started(),two=started();
 const work=JSON.parse(sql(auth(one,'service_role')+`select to_jsonb(w)from public.claim_recording_transcription_work_v2(1,${lit(one.op)})w`));
 assert.equal(work.operation_id,one.op);assert.equal(work.work_kind,'submit');
 assert.equal(sql(`select phase from public.recording_transcription_work where operation_id=${lit(two.op)}`),'ready');
 sql(auth(one,'service_role')+`select public.accept_recording_provider_job_v1(${lit(one.op)},${lit(work.job_id)},${lit(work.claim_id)},'synthetic-provider');`);
 sql(auth(one,'service_role')+denied(`select public.get_recording_transcription_dispatch_v1(${lit(one.op)},${lit(work.job_id)},'foreign-provider')`,'42501'));
 assert.equal(JSON.parse(sql(auth(one,'service_role')+`select public.get_recording_transcription_dispatch_v1(${lit(one.op)},${lit(work.job_id)},'synthetic-provider')`)).phase,'accepted');
 assert.equal(sql(auth(one,'service_role')+`select count(*)from public.claim_recording_transcription_work_v2(1,${lit(one.op)})`),'0');
 sql(`update public.recording_transcription_work set next_poll_at=clock_timestamp()-interval '1 second' where operation_id=${lit(one.op)};`);
 const poll=JSON.parse(sql(auth(one,'service_role')+`select to_jsonb(w)from public.claim_recording_transcription_work_v2(1,${lit(one.op)})w`));
 assert.equal(poll.work_kind,'poll');
 sql(auth(one,'service_role')+`select public.settle_recording_provider_job_v1(${lit(one.op)},${lit(poll.job_id)},${lit(poll.claim_id)},'done',50000);`);
 const final=JSON.parse(sql(auth(one,'service_role')+`select to_jsonb(w)from public.claim_recording_transcription_work_v2(1,${lit(one.op)})w`));
 assert.equal(final.work_kind,'finalize');assert.equal(final.manifest[0].providerJobId,'synthetic-provider');
});
check('uncertain submission cannot resubmit, accepted sibling still polls',()=>{
 const n=started(3);
 const first=JSON.parse(sql(auth(n,'service_role')+`select to_jsonb(w)from public.claim_recording_transcription_work_v2(1,${lit(n.op)})w`));
 const sibling=JSON.parse(sql(auth(n,'service_role')+`select to_jsonb(w)from public.claim_recording_transcription_work_v2(1,${lit(n.op)})w`));
 sql(auth(n,'service_role')+`select public.accept_recording_provider_job_v1(${lit(n.op)},${lit(sibling.job_id)},${lit(sibling.claim_id)},'safe-sibling');
  select public.mark_recording_submission_uncertain_v1(${lit(n.op)},${lit(first.job_id)},${lit(first.claim_id)});`);
 assert.equal(JSON.parse(sql(auth(n,'service_role')+`select public.get_recording_transcription_dispatch_v1(${lit(n.op)})`)).pendingAcceptedWork,true);
 sql(`update public.recording_transcription_work set next_poll_at=clock_timestamp()-interval '1 second' where job_id=${lit(sibling.job_id)};`);
 const poll=JSON.parse(sql(auth(n,'service_role')+`select to_jsonb(w)from public.claim_recording_transcription_work_v2(1,${lit(n.op)})w`));
 assert.equal(poll.work_kind,'poll');assert.equal(poll.job_id,sibling.job_id);
 assert.equal(sql(`select phase from public.recording_transcription_work where operation_id=${lit(n.op)} and position=0`),'uncertain');
 assert.equal(sql(`select phase from public.recording_transcription_work where operation_id=${lit(n.op)} and position=2`),'ready');
});
console.log(JSON.stringify({passed:checks.length,checks},null,2));
