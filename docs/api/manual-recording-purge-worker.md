# Manual recording purge application integration

Status: source-only. The application adopts the statically reviewed
[shared Trash contract](shared-recording-trash.md); no migration, pgTAP,
PostgREST, Storage, isolation, browser, deploy or scheduler verification is implied.

## Session and recovery

Recording delete/restore use canonical capabilities for the initial server guard,
then the accessible detail's `updated_at` and the locked session mutation RPC.
Child task/output deletes use `capabilities.delete`, never technical authorship.
Task deletion reads the full recording-scoped RLS task set, matches the existing
JS logical-task dedupe key, and sends one atomic group of at most 1000 IDs with
the target's real version. Larger groups fail closed, not partial-delete.
Output cards may submit several exact output IDs; these are sequential per-output
transactions, not an atomic multi-output operation. Earlier successful deletes
remain committed if a later output fails; feedback must not report full success.

Before prepare, the browser stores `{recordingId,requestId,expectedUpdatedAt}` in
localStorage under an independent random request key. No content, storage path,
claim token or secret is stored. A retry reuses that snapshot; uncertain replies
never clear/rotate it. Storage failure blocks starting a new request. Separate keys
avoid overwriting another tab's uncertain receipt. The recovery panel on `/trash`
can replay retained keys even if the recording no longer appears after revoke.
This is an explicit receipt-only authority exception: `prepare` itself performs
the locked own-receipt lookup or current manager check, and `start` reauthorizes.
An already-started receipt is not started again. Completed replay succeeds; an
explicit release is possible for the original actor's prepared reservation. The
later `20261002040000` forward also cancels a never-accepted exact actor/request/
recording key under the prepare lock. Its private tombstone makes late prepares
return released instead of creating work. This cannot cancel an uncertain or
started reservation. False worker acquisition is not reported as completed and
does not clear the local recovery key.
No automatic compensation releases started work, even before any known removal.

Local keys are origin/browser-specific, may remain after a redirecting successful
purge until recovery confirms completion, and are not a cross-device recovery
store. Do not clear site data while a prepared request is unresolved. Prepared
reservations are not service-discoverable; recovery after losing all client keys
requires a currently authorized manager's separately approved stale replacement
flow. Started work does not depend on client persistence: the DB receipt is its
durable queue, including a crash immediately after start.

## Service work

After session start, the action may invoke exact service acquisition immediately.
`src/lib/recordings/manual-purge-worker.server.ts` also discovers at most five
started/unclaimed-or-stale receipts via `claim_started_recording_purge_work_v1`.
It runs at most two receipts concurrently. Only the RPC-returned canonical
`{storageOwner}/{recordingId}/` prefix in bucket `recordings` is used. Recursive
names are validated before traversal, listings are fully paginated, removal is
batched by 100 and token refresh precedes every removal. Up to three removal
rounds are followed by a full-prefix empty check; exact operation/token finalize
must return `true`. Failure retains the accepted receipt and claim. The DB owns
the cumulative five-acquisition budget and dead-letter fencing; the app does not
reset it, release it, or directly delete a recording row.

`POST /api/jobs/manual-recording-purge` is the bounded recovery invocation contract.
It accepts no caller-supplied operation, prefix or user scope. It requires both
`Authorization: Bearer <TRASH_RETENTION_SCHEDULER_TOKEN>` and the exact
`TRASH_RETENTION_ENABLED=true` switch, matching the existing automatic-retention
worker's secret/enable conventions. It returns only `{claimed,completed,failed}`;
auth/disabled/internal failures return 401/503/500 without database/provider detail.
The Next route declares a 300-second maximum, subject to deployment platform limits.

The existing automatic Edge worker and its legacy claim/finalize semantics remain
unchanged. The new DB forward isolates manual receipts from those automatic leases.
This repository change does **not** configure a schedule, environment secrets,
deployment or exhausted-work alerts. Production readiness requires a bounded
recovery schedule, handling of dead-letter operations without a reset backdoor,
platform timeout validation and real Storage/race/DB evidence. An empty discovery
batch alone does not prove there are no exhausted or freshly leased operations.

## UI and evidence limits

Trash list ordering remains the accessible RPC's `(created_at,id)` keyset. Only
IDs from that list are enriched through `get_managed_recording_trash_v1` in batches
of 100. Missing enrichment disables actions without filtering/reordering the list;
no protected retention/claim/owner fields are queried directly. Visible new-action
controls require server capabilities plus known `purge_phase=none`; accepted-work
recovery uses the explicit own-receipt exception above.

Focused Vitest tests cover real application route/service calls with mocked RPC
and Storage boundaries: denial, matched outcome, logical group bounds, lost
prepare response, revoked replay, discovery after lost operation response, token
rotation, no-release failures, bounded cleanup and scheduler authorization. These
are source integration evidence, not proof of PostgreSQL authorization, actual
two-worker isolation, dead-letter attempt accounting or Storage object emptiness.
