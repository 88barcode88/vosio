# Whole checklist deletion

"Smazat celý checklist" removes every structured checklist row of one transcript:
tasks (`transcript_tasks`), decisions (`transcript_decisions`) and risks/blockers
(`transcript_risks`), across every source AI output and owner category. Timeline
chapters (`transcript_chapters`) are not part of the working checklist and stay.
Source AI outputs, jobs, notes, summary, transcript and audio always remain.

The app uses the `_v2` RPCs from `20261103140000_checklist_delete_all_items.sql`.
That migration must be applied to the target database before the app is deployed.
The `_v1` task-only RPCs from `20261003010000_add_atomic_checklist_delete.sql`
stay in place unchanged and are no longer called by the app. Browser fixtures
alone do not establish database or authenticated production acceptance; every
installation needs its own read-only consistency preflight and apply.

`GET /api/transcripts/:transcriptId/checklist` is a manager-only review. It calls
`get_managed_transcript_checklist_v2` with the authenticated session, returning:

```ts
type Review = {
  snapshot: {
    transcriptId: string;
    generation: string | null;
    transcriptVersion: string;
    outputs: Array<{ id: string; version: string }>;
    tasks: Array<{ id: string; version: string; updatedAt: string; status: string }>;
    decisions: Array<{ id: string; version: string }>;
    risks: Array<{ id: string; version: string }>;
  };
  logicalCounts: { tasks: number; decisions: number; risks: number };
  rowCount: number; // raw rows: tasks + decisions + risks
};
```

The complete transcript set spans every source output and owner category,
regardless of lazy hydration or metadata page. `logicalCounts` use the workspace
dedupe keys (`getTaskDedupeKey`, `getDecisionDedupeKey`, `getRiskDedupeKey`), so
the confirmation matches what the UI shows; `rowCount` counts all raw rows. The
public snapshot has no item text, transcript text, output body, provider
configuration or job content. The private SQL review returns only the dedupe-key
fields (title/status/impact/deadline/category) to the server for counting and
drops them from the HTTP response. Each task, decision, risk and output set is
bounded at 1000 raw rows. A larger set refuses with 409; it never truncates a page.

`DELETE /api/transcripts/:transcriptId/checklist` accepts exactly `{ snapshot }`
from that review (all four arrays required) and calls
`delete_managed_transcript_checklist_v2` once. The route verifies the RPC receipt
per kind against the reviewed IDs and count; any mismatch is 409. Success:

```ts
type Receipt = {
  ok: true;
  transcriptId: string;
  deletedIds: string[];            // task, decision and risk IDs together
  deletedCounts: { tasks: number; decisions: number; risks: number };
  suppressionIds: string[];        // reviewed output IDs
  deletedCount: number;
};
```

`suppressionIds` names the preserved reviewed output IDs, including sources with
empty projections. The client adds `id:<rowId>` tombstones for every deleted
task/decision/risk and `output:<outputId>` tombstones for the suppressed sources;
`applyClientGuards` in `use-transcript-ai-state.ts` filters tasks, decisions and
risks by both, so late client hydration (props, lazy bodies, metadata refresh)
cannot bring them back. A newly created output has a new ID and remains eligible.
No local broad dedupe-key suppression should hide a later generation. Filter
suppressed incoming rows before display deduplication, so an old `done` task
cannot displace a new source's `new` row. Confirmed deletion clears task status
overrides only for reviewed task/source IDs, preserving edits on later sources.
The transcript provider owns a validated success receipt across tab unmounts;
its transcript identity fence prevents an old callback from mutating a different
transcript. Raw bodies remain cached and export uses guarded active projections.

Before DELETE the UI obtains this review, shows the logical counts of the
non-zero kinds with Czech plural forms (for example "Odstraní se 12 úkolů,
3 rozhodnutí a 2 blokery tohoto přepisu. Původní AI výstupy, zápisy, shrnutí,
nahrávka a přepis zůstanou.") and requires explicit confirmation. Cancel sends no
mutation. While DELETE is in flight, the reviewed task/decision/risk IDs are hidden
optimistically and restored on failure. Every 409 requires a new GET and a new
confirmation. The checklist header (with the delete action) is shown whenever any
task, decision or risk exists, so rows left without tasks remain deletable.
Editor, reader, revoked actor and missing parent return 403. Malformed input,
including a v1-shaped snapshot without `decisions`/`risks`, returns 400; unknown
database errors return a safe 500. Both responses use `private, no-store`. The
route never calls a provider, admin client, refresh, regeneration or paid retry.

## Database boundary

`20261003010000_add_atomic_checklist_delete.sql` (v1) provides the private
snapshot builder `managed_transcript_checklist_snapshot_v1`, the parent-lock
triggers on `ai_outputs` and `transcript_tasks`, and the private suppression table
`transcript_checklist_suppressions` (output/transcript IDs and creation time only).
`20261103140000_checklist_delete_all_items.sql` (v2) adds, with the same
SECURITY DEFINER, empty `search_path`, fully qualified objects and trusted
sharing-owner apply check:

- `lock_checklist_item_parent_v2()` trigger function (no grants) and two triggers
  on `transcript_decisions` and `transcript_risks` (insert or update of
  `transcript_id, ai_output_id, processing_job_id, user_id`);
- `managed_transcript_checklist_snapshot_v2(uuid)` private builder (no grants):
  calls the v1 builder first, then locks, bounds, scope-checks and aggregates
  decisions and risks;
- `get_managed_transcript_checklist_v2(uuid)` and
  `delete_managed_transcript_checklist_v2(uuid, jsonb)`: revoked from
  public/anon/authenticated/service_role, granted to `authenticated` only.

Authority is resolved after canonical sharing lock, recording row lock and
transcript row lock, then output and task rows are locked by ascending UUID,
followed by decision and risk rows by ascending UUID. All lineage is checked
against transcript/output/job custody before mutation; an inconsistent or
foreign-scope projection raises 42501 instead of being deleted. The exact JSON
snapshot includes every task/decision/risk/output ID and `xmin` version, task
status/time, transcript version and completion generation. Any changed set,
version, generation or status raises 40001 before any committed deletion.
`xmin` is an opaque optimistic version, not a timestamp or API sequence number;
vacuum/version maintenance may conservatively require renewed confirmation.

Insertion triggers lock the transcript parent before adding tasks, decisions,
risks or outputs, so an insertion cannot slip between review comparison and
deletion. An insert committed before the delete lock changes the snapshot; one
waiting behind it is serialized after the delete and, for a suppressed source, is
skipped. A deadlock with a pre-existing child-first writer aborts rather than
partially applying and maps to 409. Task, decision and risk deletion and all
suppression entries are committed together or rolled back together.

Manual raw output and projection persistence currently use separate requests.
Authoritative projection reads alone therefore cannot prevent late projection
inserts from a preserved old source. The task, decision and risk insertion fences
skip later restoration from the suppressed output IDs (an update that retargets a
row to a suppressed source raises 40001). This also covers an empty projection at
review time. New outputs are not suppressed. A genuine removal of the parent
output cascades its suppression entry. Active checklist/UI/export must still read
projections, never reconstruct rows from retained raw output JSON. Historical raw
output text can continue to show the original items.

Outputs, jobs, usage, intents, timeline chapters, other projections, recording
and transcript content are untouched by this operation. Suppression is the only
added durable metadata. Success on an empty projection returns zero deleted rows
and still fences the reviewed source IDs. Transport loss does not prove rollback:
refresh the review before reporting the remaining state, and never auto-submit a
new confirmation.

## Release gates and isolated proof

`tests/sql/checklist-delete-proof.sql` is the v1 rehearsal (applies the v1 forward
on a clone through `20261002070000`).
`tests/sql/checklist-delete-all-items-proof.sql` is the v2 rehearsal: it needs a
fresh disposable loopback PostgreSQL whose database name ends with
`_vosio_checklist_test`, with every migration through `20261103120100` applied
(compatible auth/storage schemas from `tests/sql/legacy-live-recovery-bootstrap.sql`,
superuser `postgres` because later migrations alter objects owned by it). Run
`psql -X -v approved_disposable=1 -f tests/sql/checklist-delete-all-items-proof.sql`
against an explicitly selected loopback connection. It requires the psql variable
`approved_disposable`, applies the v2 forward inside BEGIN, inserts synthetic
users/recording/project/jobs/outputs/tasks/decisions/risks/chapters and
unconditionally ROLLBACKs; no real account or fixture is reused. It covers role
decisions, revoke, missing parent, v1-shaped and mixed-scope snapshots, new
task/decision/risk/output and generation drift, no partial deletion, isolation
from another transcript, preservation of outputs/jobs/chapters/transcript,
second delete on an empty set, late decision/risk suppression, new-generation
admission, retarget/scope rejection, status-only edits and ACLs. `xmin` drift of
an edited row needs separate transactions and was proven on the committed
disposable fixture (stale snapshot after an edit raises 40001; a concurrent late
decision insert waits for the delete lock and is then suppressed).

The v1 forward was independently proven on native PostgreSQL 17.11 (16 runtime
cases including 10 real two-session interleavings with observed lock waits,
1000/1001 bounds, authenticated manager/editor/reader/revoked/anon/service-role
behavior) and committed to the private target with a transaction rehearsal and
preservation fingerprints. No backup or PITR restore point existed, so
transactional rehearsal and preservation guards are not a backup. The compatible
local auth/storage schemas do not prove the Supabase HTTP gateway or physical
audio object behavior. Other targets require separate approval, reviewed hashes,
preflight and postflight. Deployment and desktop/mobile browser acceptance remain
separate release gates.

Backout first disables/revokes the two public RPCs in a new forward; keep
suppression records/fences while saved raw sources remain. Do not automatically
repopulate deleted rows or drop the fences as a rollback convenience.
