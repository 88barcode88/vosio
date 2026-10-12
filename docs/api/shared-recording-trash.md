# Shared recording Trash and child deletion

Status: source-only, not applied or PostgreSQL/runtime verified. Forward
`20260922220000_add_shared_recording_trash.sql` follows the reviewed `210000`
saved-output-types migration. Apply transactionally as the same trusted owner
as T1 `can_read_recording`. Do not deploy before coordinated T3 session callers
and the manual Storage worker adopt this contract. No earlier migration changes.

## Session APIs

All UUIDs identify exact entities, never a caller-supplied user or project scope.
All mutation functions are volatile SECURITY DEFINER with empty search_path,
explicit trusted ownership and authenticated-only EXECUTE. Private helpers have
no browser/service EXECUTE. PUBLIC/anon are denied. No table grants are added.

| Function (public schema) | Result |
| --- | --- |
| `trash_recording_v1(p_recording_id uuid,p_expected_updated_at timestamptz,p_retention_hours integer default 720)` | JSON `{recordingId,status,changed}` |
| `restore_shared_recording_v1(p_recording_id uuid,p_expected_updated_at timestamptz)` | Same JSON |
| `prepare_recording_purge_v1(p_recording_id uuid,p_request_id uuid,p_expected_updated_at timestamptz)` | JSON `{operationId,phase}` |
| `start_recording_purge_v1(p_operation_id uuid)` | JSON `{operationId,phase,changed}` |
| `release_recording_purge_v1(p_operation_id uuid)` | Same JSON |
| `delete_managed_transcript_task_group_v1(p_task_id uuid,p_expected_updated_at timestamptz,p_task_ids uuid[])` | JSON `{deletedCount,recordingId}` |
| `delete_managed_ai_output_v1(p_output_id uuid)` | JSON `{deletedId,recordingId}` |
| `get_managed_recording_trash_v1(p_recording_ids uuid[])` | Rows `(recording_id uuid,deleted_at timestamptz,trash_retention_hours smallint,purge_after timestamptz,purge_phase text)` |

The read enrichment is stable and bounded to 100 input IDs, returns each managed
deleted recording once, silently omits foreign/missing/active IDs, and returns no
rows without auth.uid. `purge_phase` is only `none|prepared|started`; an automatic
worker lease maps to `started`. It exposes no actor/storage owner, path, claim,
attempt/error details. Enrich IDs already returned by the DB Trash list; do not
use it to filter a paginated active recording page. Its snapshot may change
between requests; new mutations independently check authority and state. Recovery
of an actor's existing opaque receipt is the explicit non-mutating exception below.

## Authority, locking and state

Mutations acquire canonical T1 `recording_sharing_lock_v1` first, then the exact
recording lock, then receipt/child locks. T1 sharing/member mutations take the
same transaction advisory lock before their project/member/recording locks;
therefore authorization is evaluated after any preceding revoke commits and
cannot race a later canonical revoke. Raw trusted administrative writes must
honor this lock too; uncoordinated superuser changes are not an application API.

The canonical manager is the founder of project-visible/project-selected
content, or the owner of private/standalone content. Technical authors, editors,
readers and selected recipients gain no destructive rights from read/edit access.
Private-in-project content remains the private owner's responsibility. Child
deletion requires an active recording (the existing `capabilities.delete`). Both
parent and child are locked, current authority is rechecked after child lock,
and inconsistent legacy child/job/transcript lineage fails closed. Output deletion
catches descendants with either a different transcript or a different processing
job, even if that other job belongs to the same technical user but another
recording. The existing composite `(ai_output_id,user_id)` foreign keys enforce
child/output owner equality; the RPC checks the remaining cross-job lineage.
An inconsistent child rejects the whole output delete without a cascade.
Valid output deletion
cascades its task/chapter/decision/risk projections but retains the processing job
and its idempotency semantics.

The forward also adds idempotent B-tree indexes beginning `(ai_output_id,
transcript_id)` on transcript_tasks, transcript_chapters, transcript_decisions
and transcript_risks. These support lineage probes and existing output FK
cascades; they grant no data access and change no RLS. Existing migration-chain
index names do not collide. Runtime catalog checks verify valid ready indexes
with the required prefix; IF NOT EXISTS alone is not proof of correct shape.
Index creation is transactional (not concurrent), so plan write-lock/build time
for representative production-sized projection tables before apply.

Outputs have no updated_at/version: exact current
locked row semantics apply. Task deletion preserves the existing UI logical-task
dedupe behavior: the app reads candidate tasks for that recording through its
session-safe reads, applies the existing JS `getTaskDedupeKey`, and sends exact
matching IDs. The DB accepts 1..1000 RAW elements before dedup, only a one-dimensional
non-null UUID array, and requires target ID membership. It locks the parent then
all requested child rows in deterministic ID order, checks complete existence,
consistent lineage and the same recording for every child, current manager
authority, and the target's real updated_at. Only then does it delete the exact
deduped set atomically. Duplicate input IDs count once; mixed-recording/missing
members reject the whole group without enumerating them or partial deletion.
Different transcripts/projections of the same recording are allowed. The DB does
not duplicate JS dedupe logic: a manager is allowed to delete any selected group
within their managed recording. Concurrent new projections not included in the
submitted ID snapshot are not implicitly deleted. The earlier exact-task RPC
is replaced, not retained as an alternative app path.

Missing/foreign/unauthorized targets share SQLSTATE `42501`. Invalid input is
`22023`; stale timestamp is `40001`; incompatible status, upload fence or claim
is `55000`. These errors are not success. Delete/restore already at their intended
state returns `changed:false` after current authority verification. A repeated
task-group/output delete fails `42501`. Task version conflict returns generic
`40001` without revealing other group members. Timestamps are optimistic checks, not monotonic
revision numbers (multiple updates in one transaction can share timestamps).

The existing trigger still snapshots exact deleted_from_status, deleted_at and
retention on entry into Trash. Retention is 24/168/720 hours (default 720), remains
immutable while deleted, and restore uses the saved status, not client input.
Any purge claim blocks restore. Claims may be maintained only by service_role or
the exact trusted definer owner, not a caller-supplied flag/GUC. Manager RPCs do
not change custody, sharing, storage bindings or arbitrary recording columns.

## Manual purge: accepted receipt and Storage protocol

1. New session `prepare` rechecks authority under lock, exact updated_at and deleted
   state. Manual purge retains the existing 24-hour upload fence; it deliberately
   does not wait for the automatic purge_after deadline. The caller must generate
   and retain a random request UUID **before calling prepare**, and reuse it for
   the same recording after a lost response. An authenticated actor can always
   recover their own existing operation ID and current phase through that exact
   actor/request/recording tuple, even after authority loss or recording deletion.
   The canonical lock is taken first; a non-authoritative own-receipt lookup
   identifies the recording, then recording and receipt locks are taken and the
   exact actor/request/recording is revalidated. No current manager is required
   for this receipt-only response, and no claim, content, path or token is returned.
   Recovery never creates, starts, renews, releases or resets work. It reports
   `prepared|started|released|superseded|completed`; terminal and dead-letter
   responses do not authorize another attempt. Another actor cannot recover the
   receipt with the same request UUID, and a request UUID cannot switch recordings.
   With no own existing receipt, normal current manager authorization is mandatory.
   A different request cannot steal a fresh (<15 minute)
   claim. The server retains the receipt; do not persist it in public logs.
2. Session `start` rechecks current authority under the same locks. Until it
   succeeds, service fetch is denied and **no Storage deletion may occur**.
   Prepared work can be recovered and released by its original actor even after
   authority loss. Recovery does not make a subsequent unauthorized start valid.
3. After successful start, the accepted receipt—not the actor's later membership—
   authorizes cleanup. The service calls
   `acquire_recording_purge_work_v1(p_operation_id uuid,p_claim_id uuid default null)` returning exactly
   `(recording_id uuid,storage_prefix text,claim_id uuid)`. This is also the
   receipt-bound refresh RPC; pass the returned token before every Storage deletion batch.
   It checks the current exact claim, deleted generation and storage owner and
   renews the lease. Null token acquires only unclaimed or 15-minute-stale work,
   rotating the claim; it cannot borrow a fresh lease. A worker must never accept a client-provided Storage prefix
   or use legacy worker RPCs for this operation. Only bucket `recordings` and the
   returned canonical `{storageOwner}/{recordingId}/` prefix are in scope.
4. Use existing strict recursive listing/key validation and bounded cleanup
   rounds through the Storage API, including all original/chunk/late objects in
   the prefix. Preserve the existing bounded per-recording concurrency (2) and
   failure behavior. Re-list until empty; Storage/list/remove errors after start
   retain the receipt and claim for retry, even if no deletion is known to have
   occurred. Never release started work or restore partially erased content.
5. Service `finalize_recording_purge_work_v1(p_operation_id uuid,p_claim_id uuid)` rechecks exact
   accepted claim/generation under lock and actual `storage.objects` prefix
   emptiness, then deletes the recording and existing FK descendants and marks
   the receipt completed in one transaction. It returns boolean true; a completed
   receipt returns true on retry with that same final token without another deletion.
   A wrong/stale token is denied, including after completion. No SQL Storage delete.

The internal forced-RLS receipt table has no direct browser/service privileges;
it contains opaque identities/state, no transcript/content. On completion a
minimal tombstone retains operation/request/actor/recording IDs, final claim and
completed_at; the former storage owner/deleted generation are cleared. There is
deliberately no recording FK: cascade cannot erase the completion receipt.
Receipt retention/archival is not implemented by this migration.

The DB itself is the durable accepted-work queue. Service-only
`claim_started_recording_purge_work_v1(p_limit integer default 5)` returns rows
`(operation_id uuid,recording_id uuid,storage_prefix text,claim_id uuid)`. It clamps
the batch to 0..5, locks exact recording rows with SKIP LOCKED under the sharing
lock and atomically leases only valid started, unclaimed/15-minute-stale receipts.
It never returns prepared work or actor/title/content data. This recovers a crash
immediately after start even if the app never persisted/received the operation ID
and even after actor authority loss. Two workers cannot claim the same fresh
receipt; exact acquire cannot borrow that lease without its token. Both discovery
and initial/stale exact acquire rotate the claim and increment work_attempt_count;
matching-token refresh does not increment it. Superseded workers fail refresh and
finalize. Do not expose discovery or its output to a browser.

After 5 worker acquisitions an expired operation is dead-lettered by remaining
started and fenced, with no automatic release, Storage action or DB deletion.
Discovery and token-less acquire exclude it; session prepare cannot reset that
exhausted receipt using another request. An existing fifth worker may finish its
already accepted attempt using its still-current token. Operator diagnostics and
manual recovery need separate approval; this forward adds no reset/backdoor RPC.
The worker deployment must schedule bounded recovery batches, alert on exhausted
work, retain claims after errors and verify prefix emptiness before finalization.

A non-exhausted stale claim can be taken over by a currently authorized manager after 15
minutes with a new request. The old receipt becomes superseded and its worker
fails subsequent fetch/finalize. If the old receipt was started, the replacement
is also started and inherits the cumulative work_attempt_count: a new request ID
cannot reset the five-acquisition budget. Prepared-never-started replacement may
start at zero because it authorized no worker work. At five attempts a replacement
is denied; same-request replay can return the existing exhausted receipt but cannot
renew/reset its budget. The accepted operation cannot reopen restore or release. A previously accepted
in-flight Storage batch may still complete for the same prefix; rotation prevents
its DB finalize, and all such batches are already authorized deletion of that
same generation. If the actor loses authority after start, the existing worker
still finishes using the accepted receipt; the actor cannot prepare new work.

Prepared receipts have no service discovery or automatic expiry. They continue to
exclude automatic retention and restore until the original actor recovers/releases
them or a current manager replaces a stale reservation (then starts or releases
that replacement). Recovery of a superseded receipt only reports that state;
release cannot clear the replacement's claim. Retaining the request UUID before
prepare is therefore an integration gate, not optional UI retry bookkeeping.

## Automatic retention compatibility

The four legacy service-only signatures remain: `claim_due_recording_purges_v1(integer
default 20)`, `refresh_recording_purge_claim_v1(uuid,uuid)`,
`release_recording_purge_claim_v1(uuid,uuid)`, `finalize_recording_purge_v1(uuid,uuid)`.
All now use the canonical lock and exclude active prepared/started manual
receipts, including stale ones. Due time, 24-hour fence, max 5 automatic attempts,
15-minute lease age and max 20 batch size stay unchanged. Existing automatic
worker Storage verification/retry behavior remains required; its legacy finalize
is not a substitute for the new receipt-bound path. Manual claims do not increment
automatic attempt_count. Neither worker family can borrow the other's active claim.

## Verification and rollout gate

Source tests are structural regressions, not runtime authorization/race proof.
`supabase/tests/shared_recording_trash.sql` is real disposable-DB pgTAP coverage;
`shared_recording_trash_concurrency.spec` contains eleven isolationtester schedules. Neither
has run here. Run the full migration chain, pgTAP, actual two-session schedules,
and representative lock/EXPLAIN checks before rollout. The authority-loss fixture
uses trusted project founder reassignment because a founder is not a revocable
membership; this does not introduce or authorize a product transfer API.

Also validate crash/retry across every Storage boundary, late TUS uploads after
the 24-hour fence, current bucket upload RLS, stale receipt takeover, worker
isolation, transaction advisory lock contention, trigger owner identity, FK
cascades and PostgreSQL/PostgREST signatures. Runtime, Storage and concurrent
execution remain required deployment gates, not claimed passes.
