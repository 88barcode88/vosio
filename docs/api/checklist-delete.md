# Whole checklist deletion

`GET /api/transcripts/:transcriptId/checklist` is a manager-only review. It calls
`get_managed_transcript_checklist_v1` with the authenticated session, returning:

```ts
type Review = {
  snapshot: {
    transcriptId: string;
    generation: string | null;
    transcriptVersion: string;
    outputs: Array<{ id: string; version: string }>;
    tasks: Array<{ id: string; version: string; updatedAt: string; status: string }>;
  };
  logicalCount: number;
  rowCount: number;
};
```

The complete transcript task set spans every source output and owner category,
regardless of lazy hydration or metadata page. `logicalCount` uses the existing
workspace task dedupe key; `rowCount` counts all raw rows. The public snapshot has
no task text, transcript text, output body, provider configuration or job content.
The private SQL review returns only title/deadline/category to the server for
counting and drops it from the HTTP response. Each task and output set is bounded
at 1000 raw rows. A larger set refuses with 409; it never truncates a page.

`DELETE /api/transcripts/:transcriptId/checklist` accepts exactly `{ snapshot }`
from that review and calls `delete_managed_transcript_checklist_v1` once. Success:

```ts
type Receipt = {
  ok: true;
  transcriptId: string;
  deletedIds: string[];
  suppressionIds: string[];
  deletedCount: number;
};
```

`suppressionIds` names the preserved reviewed output IDs, including sources with
empty projections. Use exact task tombstones and these output IDs to reject late
client hydration. A newly created output has a new ID and remains eligible.
No local broad dedupe-key suppression should hide a later generation.
Filter suppressed incoming rows before display deduplication, so an old `done`
row cannot displace a new source's `new` row. Confirmed deletion clears status
overrides only for reviewed task/source IDs, preserving edits on later sources.
The transcript provider owns a validated success receipt across tab unmounts;
its transcript identity fence prevents an old callback from mutating a different
transcript. Raw bodies remain cached and export uses guarded active projections.

Before DELETE the UI must obtain this review, display the logical item count and
explain that source AI outputs, notes, summary, transcript and audio remain, then
obtain explicit confirmation. Cancel sends no mutation. Every 409 requires a new
GET and a new confirmation. Editor, reader, revoked actor and missing parent
return 403. Malformed input returns 400; unknown database errors return a safe
500. Both responses use `private, no-store`. The route never calls a provider,
admin client, refresh, regeneration or paid retry.

## Database boundary

Forward migration `20261003010000_add_atomic_checklist_delete.sql` adds two
authenticated RPCs, a private builder, insertion fences and a private suppression
table. The trusted sharing function owner must apply it; browser/service roles
cannot execute the private builder or read/write the table directly. Functions
use an empty search path and fully qualified objects.

Authority is resolved after canonical sharing lock, recording row lock and
transcript row lock, then output and task rows are locked by ascending UUID.
All lineage is checked against transcript/output/job custody before mutation.
The exact JSON snapshot includes every task/output ID and `xmin` version, task
status/time, transcript version and completion generation. Any changed set,
version, generation or status raises 40001 before any committed deletion.
`xmin` is an opaque optimistic version, not a timestamp or API sequence number;
vacuum/version maintenance may conservatively require renewed confirmation.

Insertion triggers lock the transcript parent before adding tasks or outputs,
so an insertion cannot slip between review comparison and deletion. An insert
committed before the delete lock changes the snapshot; one waiting behind it
is serialized after the delete. A deadlock with a pre-existing child-first
writer aborts rather than partially applying and maps to 409. Task-only DELETE
and all suppression entries are committed together or rolled back together.

Manual raw output and projection persistence currently use separate requests.
Authoritative projection reads alone therefore cannot prevent late task inserts
from a preserved old source. `transcript_checklist_suppressions` stores only
output/transcript IDs and creation time; the task insertion fence skips later
restoration from these IDs. This also covers an empty projection at review time.
New outputs are not suppressed. A genuine removal of the parent output cascades
its suppression entry. Active checklist/UI/export must still read projections,
never reconstruct tasks from retained raw output JSON. Historical raw output text
can continue to show the original tasks.

Outputs, jobs, usage, intents, other projections, recording and transcript content
are untouched by this operation. Suppression is the only added durable metadata.
Success on an empty projection returns zero deleted rows and still fences the
reviewed source IDs. Transport loss does not prove rollback: refresh the review
before reporting the remaining state, and never auto-submit a new confirmation.

## Release gates and isolated proof

`tests/sql/checklist-delete-proof.sql` passed on a native loopback PostgreSQL 17.11
database after replaying all 32 baseline migrations through `20261002070000`.
Its synthetic recording supplies the required `created_by` explicitly. It checks
the database name suffix `_vosio_checklist_test`, requires psql variable
`approved_disposable`, applies the forward inside BEGIN, inserts new synthetic
users/recording/project/jobs/outputs/tasks and unconditionally ROLLBACKs. Execute
only through an explicitly selected loopback connection. No real account or
fixture is reused. The rehearsal covers role decisions, revoke, missing parent,
mixed snapshot scope, status/task/output/generation drift, no partial deletion,
preserved output/job/transcript and late projection suppression, plus ACL checks.

Independent runtime proof passed 16 checklist cases, including 10 real two-session
interleavings with observed PostgreSQL lock waits. Authenticated manager, editor,
reader, revoked actor, anon and service-role behavior was exercised. The checks
cover insert/delete ordering, revoke, status/output/generation drift, 1000/1001
bounds, empty sets, source suppression, privileged retarget rejection and new
outputs. Fingerprints preserve raw outputs, jobs/usage, intents, other projections,
transcript, recording and Storage metadata. The compatible local auth/storage
schemas do not prove the Supabase HTTP gateway or physical audio object behavior.
The owned local server was stopped after proof.

With explicit user authorization, both P1 forwards committed in one transaction
after a target rollback rehearsal and independent rollback verification. Original
rows/columns across 43 tables were fingerprinted under locks and remained unchanged:
53 recordings, 49 transcripts, 105 outputs, 1062 tasks, 158 jobs and 461 Storage
objects. Postflight confirms the two parent fences, narrow RPC/table grants and RLS;
suppression is empty and the 15-row legacy ledger remains unchanged under ADR 0004.
There were zero unexpired AI leases or source mismatches; eight historical active
job rows were preserved. No real checklist or output was deleted as a test.
The target exposes no usable backup/PITR restore point; transactional rehearsal
and preservation guards are not a backup. Other targets require separate approval,
reviewed hashes, preflight and postflight.
Deployment and desktop/mobile browser acceptance remain separate release gates.
Backout first disables/revokes the two new public RPCs in a new forward; keep
suppression records/fence while saved raw sources remain. Do not automatically
repopulate deleted tasks or drop the fence as a rollback convenience.
