# Atomic capture and durable async transcription

## Browser completion presentation

The persistent browser recorder may navigate to a confirmed accessible draft before upload or transcript finalization completes. Local completion presentation carries only the exact recording ID, phase, safe message and `audioConfirmed`; it does not grant access or replace a server receipt. Generation fences and remote-before-local safety cleanup are unchanged.

Blocked operation recovery uses the existing manager-authorized `POST .../transcription/recover` with `{operationId,requestId,action:"resume"}`. Automatic lookup is bounded to three attempts, reuses the same request identity for that lookup, and never sends `action:"stop"` or creates a replacement transcription. Unconfirmed provider submission remains reserved; starting a new paid attempt still requires the existing explicit closure/start protocol. Reload may resume the same existing operation but must not create a new paid attempt. Live target behavior and migration compatibility require separate authorized preflight; these source changes do not prove deployed behavior.

Contract: base migration `20260923010000_add_capture_operation_contracts.sql` after `20260923000000`, with additive `20261005020000_complete_saved_transcript_and_dispatch.sql`, `20261006122518_add_transcription_recovery.sql` and `20261006140000_add_transcription_recovery_read.sql`. Target state and application deployment must be verified separately.

## Manager recovery of the original Soniox operation

`POST /api/recordings/{recordingId}/transcription/recover` accepts strictly `{operationId,requestId,action:"resume"|"stop"}`. Same-origin authenticated requests require the current manager's latest operation before allocating an admin client. It cannot POST a new provider job. Recovery uses the frozen region and model; the provider credential must represent the original Soniox account. After a credential change to a different account, absence cannot prove the original job was stopped.

The server reads the exact operation/recording pair and ordered manifest through service-only `get_recording_transcription_recovery_v1`, a bounded read-only snapshot. Capture tables still deny direct SELECT to `service_role`; BYPASSRLS does not replace table grants. Internal claims and locators never enter the HTTP response. Failed-job diagnostics use the same RPC and return only an allowlisted code. Database read errors report `503 / recovery_unavailable`; `409 / state_changed` is reserved for a mismatched snapshot or concurrent state change.

Resume lists at most ten 1000-job pages within a 60-second provider deadline. Only complete successful pagination can establish absence. Exact `client_reference_id`, frozen model, canonical audio object and submission time must match; duplicates and partial/error responses fail closed. Existing accepted IDs are checked independently. Verified originals bind through the existing service resolution RPC, then the dispatcher continues the same operation. Processing or completed originals must be resumed instead of discarded.

Stop deletes only verified terminal-error provider jobs and requires a subsequent exact-ID GET 404. Queued/processing jobs must be resumed: Soniox has no conditional cancellation API, so queued work could finish before a DELETE and lose its result. Authenticated `prepare_recording_transcription_stop_v1` checks fresh manager/latest operation, exact work snapshot and drained submit/poll/finalize leases (15 minutes), then durably reserves stop before external mutation. Canonical operation locking fences every worker mutator/resolution and discovery skips reserved operations. A service-only `verify_recording_transcription_stop_v1` stores metadata-only evidence in an immutable actor/request capture receipt. Authenticated-only `stop_recording_transcription_v1` rechecks management, latest operation and snapshot, then marks unfinished historical work failed/cancelled and the recording failed. It preserves canonical audio, saved transcripts and AI history. Same-request replay does not increment revision again. Uncertain DELETE retains the reservation indefinitely; explicit resume can release it after the 120-second stop lease and fresh provider verification. A different stop request waits for that lease. No automatic timeout releases potentially irreversible work.

The UI stops automatic reconcile/GET polling at `manual_required`, failed and done. Blocked controls collapse under Vyřešit přepis: first Dohledat původní přepis, then an explicitly confirmed Spustit nový přepis if the old attempt can be safely closed. Check and stop remain secondary actions inside the same popup. A recovery error stays fully visible after an unchanged metadata check; an explicit new start, changed operation or verified terminal state clears the old error. New paid work uses the existing start endpoint only after successful old-operation closure and a fresh capture revision. Recovery request identity survives an unconfirmed browser response; a changed recording remounts its controls.

Definite submission HTTP rejection (400/401/403/404/413/422/429) and failures before provider POST settle through service-only `fail_recording_submission_v1` with an exact submit claim and a fixed safe error code. Timeouts, 5xx and malformed successful responses remain uncertain and never automatically repeat POST. API key/region diagnostics contain no provider message, credential or signed audio URL.

Local native proof: prepare an owned loopback database named `*_recovery_test` with the application baseline and both exact recovery migrations; set `VOSIO_DISPOSABLE_DATABASE_URL` and optional `PSQL_BIN`, then run `node scripts/verify-transcription-recovery-postgres.mjs`. It verifies direct private-table read denial, service-only snapshot reads, exact recording binding, manager/reader/editor boundaries, stop fencing, exact claim/snapshot races, latest-operation guards, replay and audio/text preservation without a provider call. The proof never bootstraps or resets a target. Backout disables recovery callers but retains reservations and the worker fence; the read RPC can be revoked in a forward migration without changing user data. Accepted stop/provider side effects are irreversible; do not drop their reservation/history. A later forward migration may restore prior lock/claim/enrichment bodies and revoke additive recovery APIs only after all reservations have been explicitly reconciled. Never edit an applied migration.

## Worker dispatch and saved transcript confirmation

After a matching session prepare/start receipt, the API uses Next `after` to dispatch only that accepted operation for at most 240 seconds. `claim_recording_transcription_work_v2(p_limit,p_operation_id)` retains the original lease, horizon, fairness and no-resubmit logic; the old one-argument service API delegates to it. A configured public HTTPS `NEXT_PUBLIC_APP_URL` registers Soniox completion callbacks at `/api/jobs/recording-transcription/{operationId}/{jobId}`. Authentication is a domain-separated per-job HMAC using the server Soniox key. Request origins/Host cannot select the callback destination.

Callbacks require matching frozen DB operation/job/provider custody, then use the existing provider GET, token-bound settle and finalization. They never trust submitted status/text as a result. Duplicate callbacks cannot create new jobs; an unbound early callback returns retryable 503. Rotating the Soniox key invalidates old callback capabilities. Session `POST /api/recordings/{recordingId}/transcription/reconcile` authorizes the existing managed operation and wakes at most one unit without preparing a new job. The UI invokes it before read-only GET checks. An unclaimed `started` operation is reported as queued.

The bounded dispatcher and provider callback do not create an external scheduler. Jobs with failed callback delivery or work exceeding the dispatch budget may need the existing worker or an authorized session reconcile. A local HTTP origin does not register a callback. Deployment must preserve the public callback URL across the job's lifetime, including preview/production boundaries.

`POST /api/recordings/{recordingId}/complete-saved-transcript` accepts only `{requestId,captureRevision}` and calls `complete_saved_recording_transcript_v1` with current session authority. Canonical recording locks, fresh manager/capture-author permission, revision CAS and an immutable actor/request receipt govern the transition. It allows created/uploading/uploaded/failed in-app/realtime rows only, requires a nonempty already saved owner transcript and blocks active or uncertain transcription and purge. It sets lifecycle completed and increments revision, retaining all transcript/AI/Storage content and every audio binding field. The receipt records `completionMode=saved_transcript,audioConfirmed=false`; it does not certify complete audio. The browser explicitly confirms this consequence and hides a completed local manifest only after server state confirmation, without deleting IDB audio.

## Existing paths and deliberate changes

`src/lib/recordings/upload.ts` prepares browser uploads/live drafts; T1 already supplies `create_recording_with_access_v1` and `prepare_recording_upload_v1`. Existing live-draft, live-final, import, recover-live and transcription routes combine session capability checks with later admin writes. The new contracts replace that split authorization, not merely add another preflight check.

`src/lib/soniox/client.ts` sends `client_reference_id` with async POST, but the repository provides **no documented provider idempotency guarantee or lookup by this reference**. The stable job UUID is a correlation key, not permission to retry POST. Realtime browser transcripts have no provider-ID attestation; they remain session-current-authority writes and cannot use the async continuation APIs.

The legacy completion helper rewrites transcript history, removes prior AI/job/intent artifacts and can schedule personal AI. New settlement intentionally does none of those things. It creates one new operation-bound transcript generation, keeps historical transcripts and saved AI outputs, and makes its `created_at` strictly later than existing generations. Latest reads must use `created_at DESC, id DESC`. Any new personal AI/timeline work is a separate, currently authorized user action.

## Common contract

All mutators are empty-`search_path` SECURITY DEFINER functions owned by the same trusted superuser/BYPASSRLS owner as T1 `can_read_recording`. Default/public/anon/authenticated/service rights are revoked before explicit grants below. Internal tables, including the versioned model allowlist and manual resolutions, force RLS and have no direct role grants; new recording columns have no direct grants. No caller supplies an actor, technical owner, project, provider configuration document, column patch or SQL.

Canonical mutation locking is T1 global sharing lock → project → project member rows ordered by user ID → recording → exact jobs ordered by ID → operation → work. The global lock serializes revoke, share/bulk share, Trash, capture and operation starts. Destructive statement triggers take it before row locks. Service continuation verifies frozen technical owner, author, project, async Soniox job, provider ID and accepted T1 custody receipt, not current membership after irreversible start.

Errors: `42501` unavailable/unauthorized/exact receipt or payload conflict; `22023` malformed input; `40001` stale capture revision; `55000` invalid lifecycle, reserved work or operator review required. Never turn an error into success or automatically create a new request UUID to bypass it. Transactions roll back all state on error. `get_recording_capture_state_v1` returns SQL NULL for inaccessible/missing rows; bounded manager reads omit foreign IDs.

## Session APIs (`authenticated` only)

```sql
get_recording_capture_state_v1(p_recording_id uuid) returns jsonb
-- {recordingId, status, captureRevision}

apply_recording_capture_transition_v1(
  p_recording_id uuid, p_request_id uuid, p_expected_capture_revision bigint,
  p_transition text, p_duration_seconds integer default null,
  p_mime_type text default null, p_file_size_bytes bigint default null,
  p_raw_text text default null, p_segments jsonb default null,
  p_speakers jsonb default null
) returns jsonb
-- {recordingId, status, captureRevision, transcriptId, jobId}; unused IDs are null

prepare_recording_transcription_v1(
  p_recording_id uuid, p_request_id uuid, p_expected_capture_revision bigint,
  p_region text, p_model text, p_purpose text default 'capture'
) returns jsonb -- {operationId, phase}
start_recording_transcription_v1(p_operation_id uuid) returns jsonb
release_recording_transcription_v1(p_operation_id uuid) returns jsonb
-- {operationId, phase}

get_managed_recording_transcription_v1(p_recording_ids uuid[])
returns table(recording_id uuid, operation_id uuid, phase text, created_at timestamptz)
```

Capture writes require the current original technical author plus current edit/capture authority (project founder/editor as applicable); founder cannot inject another author's live/import payload. Only `recover`, which accepts no new transcript payload, additionally permits the current destructive manager. Reader/selected recipient/foreign/revoked author cannot write. `captureRevision` is the CAS token, not `updated_at`. All successful transitions increment it once; stable same-request/same-payload replay returns its original result without writing. Unlike async prepare recovery, capture replay still requires current authority. Request collision fails.

| Transition | Allowed current status | Effect / payload |
| --- | --- | --- |
| `upload_complete` | created/uploading/failed | Already fixed canonical single object must exist in Storage catalog with exact MIME and positive byte count; status uploaded. Optional nonnegative duration. |
| `capture_failed` | created/uploading/failed | Fixed safe error and failed status, no path/content deletion. No duration or transcript payload. |
| `text_only` | created/uploading/failed | In-app/realtime only. Canonical recording prefix must contain no Storage object; then realtime/source, NULL path, zero bytes, uploaded. |
| `live_draft` | created/uploading/failed | In-app/realtime; bounded raw text, segments, speakers and optional duration. Updates only exact capture transcript, does not finalize status. Empty text does not replace saved text. |
| `live_final` | created/uploading/uploaded/failed | Same author/source rules, nonempty text; exact capture transcript + realtime done job with NULL provider ID + completed recording atomically. Non-NULL audio binding must be canonical and have a catalog object. |
| `import_final` | created/uploading/uploaded/failed | Realtime source, NULL path, nonempty transcript; completed recording, no fake provider job. |
| `recover` | created/uploading/failed/transcribing | In-app/realtime, no caller text/metadata. Existing durable text → completed, audio-only → uploaded; missing both fails. At most 1000 matching objects, all size metadata valid. |

Text-only `live_draft` intentionally leaves a new recording in `created` while persisting its transcript. After a crash/revoke, the current founder/manager may recover that durable text directly from `created`, without a pseudo-upload/begin transition, a new transcript or restored author access. The existing current authorized capture-author recovery path is also retained; an unrelated editor, reader or revoked author cannot recover. `created` with neither durable nonempty text nor canonical audio still returns `nothing to recover` without changing revision/receipts. Malformed live-prefix objects remain fail-closed even when text exists. Recovery retains its exact request replay/CAS rules and accepts no browser transcript payload.

Transcript bounds are checked before receipt hashing/locking/writes: raw text ≤1,000,000 characters and ≤4,000,000 UTF-8 bytes; segments array ≤200,000 entries and ≤32 MiB serialized bytes; speakers array ≤1000 entries and ≤32 MiB serialized bytes, including all nested values. Async finalize uses the same validator. Unexpected per-transition fields fail. The trusted path-clear exception uses a transaction/backend/recording-bound single-use internal permit; it is not a `current_user`/GUC bypass. An existing object prevents text-only clearing (`55000`); app must preserve audio and use recovery, not delete Storage. Service out-of-band Storage mutation is prohibited during capture. Authenticated Storage writes continue through T1's locked exact-object policy. Physical TUS upload consistency and the existing 24h purge upload fence remain deployment/runtime gates.

Async `purpose=capture` requires the current author and uploaded status; `retranscribe` current author and completed status; `retry` current destructive manager and failed status. Retry cannot replace prepared/started/accepted/uncertain work. Region is `global|eu`; model must be active in private `recording_transcription_models_v1`. The only seeded model is `stt-async-v5`, configuration version 1, matching `src/lib/env.server.ts`'s supported default. Each operation freezes that version; prepare and irreversible start both require the active approved configuration. Regex-valid unknown/costly models are rejected, not forwarded. Existing own prepare replay returns its historical receipt even if the model was later disabled. Options are server-fixed Czech language hints, language identification and speaker diarization, never personal provider/prompt settings.

The server freezes the exact canonical single object or complete sorted legacy `/live/` manifest (1–1000 objects), then preallocates one async job UUID per part without contacting the provider. The shared private manifest helper first enumerates up to 1001 **all** objects under the exact canonical live prefix, then rejects any excess or unsupported member before constructing work/recovery output. Only `[A-Za-z0-9_-]+` basename plus lowercase `webm|ogg|mp3|m4a|wav|mp4|flac` extension is accepted. Nested paths, uppercase extensions, unsupported names and a root-prefix placeholder object all fail closed; no filtering them away to obtain a partial transcript. Recovery and segmented live final use the same check; no Storage delete occurs.

Caller must generate and persist the request UUID **before prepare** along with its exact payload/revision. Same actor/request/payload recovers `{operationId,phase}` even after revoke/content purge. Different actor cannot recover it; collision fails. `start` always rechecks current authority under locks, including retries; after revoke it denies. Started operation is durable queue work independent of the browser. Prepared expires after 24h or may be released by its actor even after revoke/current manager. Released/terminal receipt cannot be restarted; prepared expiry needs the service expiry worker, not a client timer.

Manager enrichment accepts ≤100 raw one-dimensional IDs, deduplicates by result set, sorts recording IDs, returns only each managed recording's latest operation. NULL/empty return no rows, NULL elements match nothing. It exposes no locator, owner, model, claim/provider token or error. `manual_required` is the safe phase for uncertain, over-horizon or exhausted work. This does not permit cancellation/resubmission of uncertain work.

## Service APIs (`service_role` only)

```sql
claim_recording_transcription_work_v1(p_limit integer default 5)
returns table(operation_id uuid, job_id uuid, claim_id uuid, work_kind text,
  storage_path text, client_reference_id text, region text, model text,
  provider_job_id text, manifest jsonb)
refresh_recording_transcription_claim_v1(
  p_operation_id uuid, p_job_id uuid, p_claim_id uuid
) returns boolean
accept_recording_provider_job_v1(
  p_operation_id uuid, p_job_id uuid, p_claim_id uuid, p_provider_job_id text
) returns jsonb
settle_recording_provider_job_v1(
  p_operation_id uuid, p_job_id uuid, p_claim_id uuid, p_status text,
  p_audio_duration_ms bigint default null
) returns jsonb
finalize_recording_transcription_v1(
  p_operation_id uuid, p_claim_id uuid, p_raw_text text,
  p_segments jsonb, p_speakers jsonb, p_duration_seconds integer
) returns jsonb
mark_recording_submission_uncertain_v1(
  p_operation_id uuid, p_job_id uuid, p_claim_id uuid
) returns jsonb
resolve_uncertain_recording_job_v1(
  p_operation_id uuid, p_job_id uuid, p_resolution text,
  p_evidence_sha256 text, p_provider_job_id text default null
) returns jsonb
expire_prepared_recording_transcriptions_v1(p_limit integer default 5) returns integer
```

Accept/settle/uncertain return `{operationId,jobId,phase}`; finalize returns `{operationId,phase:'completed',transcriptId}`; manual resolution `{operationId,jobId,resolved:true}`. A real provider ID is a bounded 1–200 character identifier. Only the trusted service verifies provider responses; the database cannot independently attest external truth. Session roles cannot invoke these APIs.

Worker flow:

1. Run prepared expiry separately (limit 1–5), then claim work (1–5 operations per call). Discovery returns no prepared work and needs no durable client queue. Eligible operations are ordered by durable `last_claimed_at NULLS FIRST`, then `created_at,id`; each successful unit/finalizer claim advances that timestamp. Each selection pass claims at most one unit per operation, so an unclaimed newer operation gets a turn before an older operation's second segment, including at limit 1 and across workers. Horizon/exhausted/ineligible rows are excluded before the limit. Within an operation, ready submission units precede polls; uncertain sibling fencing still prevents further submissions. Global sharing lock + row locks/SKIP LOCKED prevents duplicate worker acquisition.
2. `work_kind=submit` returns only its exact canonical storage path and frozen provider options. Mint a short-lived signed URL for that exact path, verify the lease immediately before POST, send its stable job UUID as `client_reference_id`, **POST once**. A timeout/ambiguous HTTP outcome must call uncertain or leave the lease for stale detection. Never repeat POST from a lost claim/response. Even crash before HTTP after acquiring submit claim is conservatively uncertain. Provider ID response → accept with the original submission token; late response may bind after revoke/stale uncertainty.
3. Accept consumes the active submit claim; only its separate original `submission_claim_id` remains valid for exact provider-ID acceptance response-loss replay, not heartbeat or settlement. `work_kind=poll` returns the bound provider ID (no path). GET the exact job. Settle only an observed queued/running/done/failed provider status; network/poll failure is not provider failure. **Every** successful poll observation consumes its active token, including queued/running and terminal outcomes. Repeating/changing that observation or heartbeating with a consumed token returns `42501`; there is no settle replay receipt. After response loss, let durable discovery issue a new poll claim/read-only provider GET (or finalizer work if already done), never reuse the old token. Acknowledged nonterminal poll schedules the next poll after 15 seconds and resets consecutive lost-lease count. Claims expire after 15 minutes; stale takeover rotates the token, old token cannot settle.
4. When all units are done, `work_kind=finalize` has NULL job ID and an ordered manifest `{jobId,providerJobId,position,audioDurationMs}[]`. Fetch those exact results, combine raw text/speakers/tokens using existing segment offset logic, derive duration from provider durations (`ceil(totalMs/1000)`, at least 1 for positive duration, NULL if unknown), then finalize under the operation's claim. Heartbeat uses NULL job ID for this lease. No caller may supply results from another provider job. One new transcript generation and recording/job/custody completion are atomic; same exact token/payload retry returns success even after recording purge. Changed payload or stale token fails.

Operation phases: prepared → started → accepted → completed. Submission uncertainty → uncertain, not failed. An accepted sibling may still finish while another is uncertain; no further unsubmitted parts start in that state. Observed terminal failure cancels only unsubmitted siblings, waits for any already-submitting/accepted/uncertain sibling to resolve, then marks recording/operation failed. It never deletes/private-converts the draft. Private/shared custody and historical artifacts stay intact. Terminal work paths are scrubbed; minimal receipt/job/provider references and hashes remain for exact replay and audit, with no automatic retention deletion in this forward.

Five consecutive lost poll leases or five finalizer acquisitions exhaust automatic work; seven days after start also stops discovery. These are **failed-safe, still-destructive-blocking reservations**, not automatic release/deletion. Worker must alert/route to operator; normal observed queued/running polls are not five total lifetime polls. A late valid current token may still settle. Explicit manual runbook resolution is service-only and records an externally retained evidence SHA-256:

- `not_submitted`: only a submitting/uncertain unbound job, after external verification that provider did not accept it; marks failed, allowing a new currently authorized manager retry when the full operation is terminal.
- `bind_verified`: externally verified original provider ID binds the exact submission receipt; never fabricates an ID.
- `resume_poll`: accepted job only, renews horizon and resets lost-poll budget with a new fencing token; no POST.
- `resume_finalize`: all units done; renews horizon/finalizer budget and fencing token; requires one exact manifest job ID as audit anchor; no POST.

Repeated same resolution/evidence returns its prior result without re-opening the budget. New evidence means a new audited operator decision; this RPC is not a public recovery endpoint. No generic browser cancellation, auto-resubmit or manual-abandon shortcut is provided for unknown external work.

## Destructive and legacy compatibility gates

Any started/accepted/uncertain operation blocks recording Trash, direct recording/job delete and auth/project/client cascades that would strand it. Prepared work may be safely cancelled by those paths. Exact prepared-job DELETE releases the operation and cancels its sibling jobs/work without attempting a nested UPDATE of the same job tuple currently being deleted. Existing T1 retained-project-content guards remain stricter where applicable. Terminal success/failure/released work permits ordinary Trash rules; existing 24h upload fence and purge retention do not change.

The old service `accept_recording_job_custody_v1` and `finalize_recording_job_v1` EXECUTE rights are revoked in this forward. Existing queued/running legacy jobs block capture/prepare; this migration does not guess their external outcome or mint retrospective receipts. Before rollout, inventory and resolve old in-flight work using a separately approved, externally verified operator policy. There is no automatic conversion of legacy realtime NULL-provider jobs into async authority.

## Adoption, upgrade, rollback and verification

Source T4 now uses the session capture/transition APIs and separate service worker.
Forward `20261002000000_list_selected_capture_authorizations.sql` additionally exposes
`list_selected_recording_capture_authorizations_v1(project_id)` to authenticated users.
It returns at most 100 own unconsumed, unexpired, non-revoked reservations whose creator
is still the founder and whose author still has capture authority. It returns only the
exact request ID, recipients, expiry and email labels limited to that approved set.
The editor chooses this reservation directly
in the app; no manual approval code is required. Creation still rechecks authority,
TTL and exact recipients atomically. One reservation supports only one file/capture.
The same forward adds `list_recoverable_recording_captures_v1()` with authority filtering
before its 100-row bound and transcript character counts without returning text.
`supabase/tests/selected_capture_authorizations.sql` is prepared role/TTL/revoke evidence,
not an executed database check. The development-only project-sharing browser fixture
uses local capture and bulk transport fakes; it does not establish RLS/provider acceptance.

Deploy gate: replace **all** legacy split-check/admin capture, live/import/recovery, submission/poll/completion/retry paths with these contracts; deploy service discovery/heartbeat/expiry and alerting before enabling starts. Do not expose service storage locators to browser/readers or forward arbitrary browser transcripts to async finalize. Keep `prepare_recording_upload_v1` and session TUS; new completion takes no caller storage path. Disable legacy completion cleanup and its implicit AI scheduling; personal timeline uses the separate current-authority follow-up below. Preserve caller request IDs/CAS state across network retry and distinguish current-author realtime from durable service async.

Provider configuration preflight must compare the worker's effective `SONIOX_ASYNC_MODEL` against the active approved DB model/version and fail startup/enable on mismatch. An environment override is not approval for a new model. Model/configuration changes require a separately reviewed forward/configuration update under the sharing lock, not a permissive regex or runtime browser input. This task does not read environment secrets or verify a deployed provider configuration.

Apply the forward transactionally as trusted T1 owner on the full reviewed chain. No rollback script deletes accepted operations: after any irreversible start, stop new starts, retain receipts/guards, finish or externally resolve existing work, then design a separately reviewed forward repair. Do not revert old EXECUTE grants while new operations remain active.

Artifacts: `tests/unit/capture-operation-contracts.test.ts` are source contracts only; `supabase/tests/capture_operation_contracts.sql` is executable pgTAP, including huge nested speaker rejection, full role/PUBLIC/helper ACL matrix, model allowlist, malformed/oversized whole manifests, consumed claims, prepared exact-job DELETE, two-operation fairness, five actual finalizer acquisitions, seven-day horizon and auth/project/client destructive guards. `supabase/tests/capture_operation_concurrency.spec` includes a two-worker fairness interleaving. These SQL assertions are prepared, **not executed**. pgTAP, isolation, real catalog ACL validation, representative EXPLAIN (complete manifest prefix scans, manager latest lookup, least-recently-claimed queue under history/backlog), physical Storage/TUS races and provider uncertain-response recovery remain **unexecuted runtime gates**. Use disposable full-chain Postgres/Supabase, never production fixtures. Also verify application integration tests for segment offsets/latest generation/history/no-AI behavior and actual provider response handling before rollout.
# T4 additive application follow-up contracts

Forwards `20261002000000` through `20261002070000` are source-only prerequisites, not applied DB evidence.

- `list_selected_recording_capture_authorizations_v1(project)` offers only the current active editor's unexpired, unconsumed exact founder reservation. Recipient labels are limited to that approved set. No pasted code is required.
- `list_confirmed_recording_recipients_v1()` projects at most 100 previously confirmed contacts reachable through the actor's current managed grants or accepted invitations. No Auth directory enumeration. Standalone capture may select these contacts; new email invitation stays on the saved detail.
- Completion records an immutable private `capture_timeline_snapshots` row, with generation key and snapshots for each of the six configured automatic output types, bounded current-dev catalog model/config and system/override prompt. It creates no AI job or authorization intent. `schedule_capture_automatic_intents_v2(transcript)` requires current personal owner/read/manage plus current opt-in, then consumes only stored snapshots into the existing per-type intent outbox. The v1 timeline wrapper delegates to v2. Historical transcripts without capture snapshots are not backfilled; replay does not resnapshot. Separate owner reconciliation preserves independent automatic outputs. Provider custody completion itself never calls AI. A locked job-insertion trigger also denies new personal AI after authority loss while existing accepted jobs retain their exact continuation.
- Live draft/final and audio/text completion share one per-session serialized revision queue. Indexing consumes validated persisted receipts and uses the existing `replace_transcript_search_chunks_v2` version fence. Raw text fallback remains transactional; failure reports the existing nonfatal precise-search warning. A bounded service-only rotating index repair claim resumes after response loss or index failure, without provider submission.
- Speaker patch materializes only missing IDs proved by persisted flat/nested tokens, under the existing recording/slot locks. Partial legacy slots, history and other speaker edits are preserved.
- Explicit absent purge cancellation tombstones the exact actor/request/recording under the prepare lock. Late prepare replays released; uncertain or started receipts cannot be discarded. False cleanup acquisition is not reported as completed.
- `get_owned_job_usage_v1(from,before)` returns only the owner's cost inputs, regardless of current content visibility, with a maximum 32-day range. It returns no prompt, transcript or provider identifier.

Forward `006` also preserves current-dev durable audio: `prepare_recording_live_part_v1`
registers an immutable index/MIME/size under the current exact capture and revision;
Storage grants only that deterministic registered path and rechecks current authority.
No broad prefix upload grant is introduced. Completed parts cannot be overwritten.
`complete_recording_live_parts_v1` binds the complete contiguous homogeneous manifest,
verifies actual object size/MIME, and returns an exact idempotent receipt. Redundant
registered parts can be removed only by a current manager after a distinct complete
main object is proven and no active transcription work remains. Recovery returns
the exact transcript receipt for replay-safe indexing, without deleting history.
`supabase/tests/dev_capture_integration.sql` and the amended follow-up fixture are
prepared disposable SQL evidence only, not executed DB acceptance.

Failed safety-part resume may reopen only the current capture to `uploading` while
the same sharing/recording lock proves no prepared/started/accepted/uncertain
transcription or legacy queued/running job. NULL/negative revisions are rejected.
Recovery and finalization verify the entire registered manifest, not a remote
contiguous prefix. A prepared exact `live/recording.webm` or `.m4a` archive may
retarget to that manifest only when the archive is provably absent, with a private
transaction-bound permit; existing archives and active operations reject retarget.
Browser recovery never cleans a pending/unconfirmed local generation and rereads
its local confirmation before cleanup. It then binds the exact original confirmed
snapshot keys/identity/confirmation to a conditional IndexedDB cleanup. Matching
and deletion occur inside the same readwrite transaction; a new, pending, changed
or scope-mismatched row retains the entire generation and reports a conflict.
Unknown local resume state remains retained. Other recorder cleanup paths keep
their existing unconditional generation semantics.

Forward `007` preserves the legacy trusted-service cleanup/reconcile contracts but
checks their exact authenticated API actor against current personal management
under the sharing/recording lock before job locks or destructive changes. Private
to foreign-founder project custody cannot race a stale API check. Browser roles
have no EXECUTE on these helpers. Accepted manual job claim/settle/provider
continuation functions are unchanged. The disposable
`supabase/tests/manual_ai_sharing_admission.sql` fixture and expanded audio fixture
are prepared, not executed; actual two-session races remain a separate DB gate.

## Legacy live recovery compatibility

Forward `20261005010000_adopt_legacy_live_recovery.sql` adds authenticated
`adopt_legacy_live_parts_v1(recording, expectedCaptureRevision, parts)` for an
original author with current capture authority. `parts` is the complete contiguous
browser manifest, at most 1000 `{index, mimeType, bytes}` entries. It includes
already uploaded parts and expected missing tail parts. Under canonical sharing,
project/member, recording and existing Storage metadata locks, adoption requires
an idle legacy in-app recording at revision zero with NULL capture request and
NULL main binding. Every existing remote prefix member must exactly match the
manifest name, MIME and size. Unknown extras, archives, mixed MIME, active work,
stale revisions and other actors refuse before mutation.

Adoption assigns a capture identity and registers all expected parts atomically.
Its private fingerprint freezes the expected tail and makes identical retry safe;
it never replaces an existing object or alters transcript/history. New captures
receive no additional permission. Existing strict upload/complete/recover contracts
continue to reject missing, unregistered, mixed or mismatched objects. The migration
itself does not adopt or change any existing recording. Backout revokes adoption
in a new forward and retains identity/registrations/audio; do not undo adopted rows.

Browser recovery supplies `prepareManifest: adoptLegacyLiveRecordingParts` to
`resumeDurableSafetyPartsForOwner` before pending parts upload. Rejected preparation
retains the whole browser scope. The compact recovery panel connects this hook and
keeps local counts/bytes separate from server diagnostics. For idle, non-invalid
rows, `shouldReverifyPart` retries historically confirmed parts at diagnosed missing
indices after full preparation, including retries after legacy adoption. Only
legacy rows requiring adoption also retry beyond the observed remote expectation. The canonical upload
reuses exact existing objects without overwrite; confirmed unrelated parts are
not retried. Pending parts still use normal promotion. Shipping only the additive
DB forward does not fix an older deployed browser by itself.

The existing recovery list retains its old columns and grants, adding
`segment_count`, `expected_segment_count`, `missing_part_indices`, `legacy_capture`,
`recovery_issue`, `legacy_adoption_state`, and `canDelete`. Bytes include confirmed
Storage metadata even when recording metadata says zero. Before adoption, the
expected count is only the highest observed remote index plus one, not proof of
the original tail. After adoption it is the full registered expectation. Diagnostics
enumerate at most 1001 objects and at most 1000 missing indices; invalid/oversized
sets refuse recovery rather than hiding extras. No transcript body, object locator,
provider identifier or secret enters the list.

`recovery_issue` is `missing_audio_parts`, `invalid_audio_manifest`,
`active_transcription`, `transcription_review_required`, or NULL.
`legacy_adoption_state` is `requires_local_manifest`, `blocked`, or NULL.
`canRecover` requires current capture-author or canonical manager authority and complete observed audio;
`canDelete` requires current management without active transcription or purge
reservations. These are display capabilities; each action still reauthorizes under
locks. Server Trash uses the existing versioned soft-trash action. Discarding an
exact browser generation is a separate explicitly confirmed local operation.

Run retained native proof from the repository root with PostgreSQL 17 binaries:
`./tests/sql/run-legacy-live-recovery-proof.ps1 -PgBin <absolute PostgreSQL bin>`.
The default uses the existing `.tmp/p1-postgres/pgsql/bin` binaries. The runner
refuses occupied port 55448, creates a new owned cluster in `.tmp/legacy-proof-*`,
uses the retained compatible Auth/Storage bootstrap and replays every ordered
migration, then runs `legacy-live-recovery-proof.mjs` and stops only its own server.
The proof fixes loopback address/port/database, uses new synthetic identities and
checks actual roles/RLS plus four two-session lock waits. It tests metadata only,
not the Supabase HTTP gateway, physical audio objects or provider behavior. Temp
cluster data remains available for investigation; no existing cluster is reused.

`discardDurableSafetyGeneration({manifest, canDiscard})` is the separate browser
operation for an explicitly reviewed local generation. The panel explains that
audio may be its only copy and requires confirmation, disables discard during
resume/recovery and active or uncertain transcription, and supplies a latest
mounted owner/generation fence. Server Trash uses `DeleteRecordingForm` only when
the server supplies `canDelete`; its server action reauthorizes and leaves local
audio available for a separately confirmed discard. The helper snapshots
the supplied identity, verifies the currently authenticated personal owner and
listens for account changes; management membership never grants access to another
owner's local rows. `canDiscard` is a synchronous latest UI/lifecycle fence, not
an authorization substitute. It removes no server object, metadata or transcript.

Discard obtains an immediate exclusive native Web Lock for the exact owner,
recording and generation. The active safety controller holds a shared lease
through final part flush and queued promotion; resumed uploads retain a shared
lease through remote settlement and local confirmation. Unsupported Web Locks
retain browser data on discard without disabling ordinary capture. The writer
also holds a recording-ID parent shared lease through that same lifecycle.
The recovery panel takes immediate exclusive parent custody through recovery RPC,
receipt and local cleanup, or through the existing server Trash action. This also
guards a canonical manager's server-only row without guessing another author's
browser generation. Active writers or unsupported Web Locks fail closed with an
explicit explanation for recovery/Trash; ordinary capture remains available.
The IndexedDB
repository compares every key and immutable metadata field, Blob size/type and
upload confirmation, then deletes inside the same readwrite transaction. New,
changed, foreign, missing or active rows retain the complete scope. Pending parts
are eligible only for this explicit discard; existing confirmed remote cleanup
continues to require every part's upload confirmation. Failures return false or
throw and must retain the review for refresh, never claim successful removal.
