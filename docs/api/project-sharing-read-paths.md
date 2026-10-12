# Project sharing read paths

Status: **source-only; not applied, not runtime verified, not rollout-ready**.
Apply `20260922200000_add_project_sharing_read_paths.sql` after
`20260922190000_add_project_sharing.sql`, each in one transaction under the trusted
migration owner. The new functions require that owner's existing table access and
RLS bypass, as do the T1 authority helpers. Neither migration can be deployed alone
against an older owner-only deployment. The source checkout adopts the new callers;
target compatibility and actual apply remain unverified.

## Session API

All arguments use the existing RPC names/defaults so callers can change RPC names
without rebuilding filtering or page composition. The session identity comes only
from `auth.uid()`. These four APIs grant EXECUTE only to `authenticated`;
`PUBLIC`, `anon`, and direct `service_role` execution are revoked. An authenticated
request without a user ID returns no recording rows and zero facets.

```sql
list_accessible_recordings_v1(
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}',
  p_status public.recording_status default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
) returns setof public.accessible_recording_row_v1

get_accessible_recording_v1(p_recording_id uuid)
  returns setof public.accessible_recording_row_v1

search_accessible_recordings_v1(
  p_query text,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}',
  p_status public.recording_status default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  recording_id uuid, title text, source_type public.recording_source_type,
  mime_type text, duration_seconds integer, file_size_bytes bigint,
  status public.recording_status, created_at timestamptz, updated_at timestamptz,
  client_id uuid, project_id uuid, folder_id uuid, matched_excerpt text,
  match_start_ms bigint, match_end_ms bigint, total_count bigint,
  visibility text, project_name text, tag_ids uuid[]
)

count_accessible_recording_statuses_v1(
  p_query text default null,
  p_client_id uuid default null,
  p_project_id uuid default null,
  p_folder_id uuid default null,
  p_tag_ids uuid[] default '{}'
) returns table (status public.recording_status, total_count bigint)
```

List/detail rows contain exactly `id, title, source_type, mime_type,
duration_seconds, file_size_bytes, status, created_at, updated_at, client_id,
project_id, folder_id, visibility, project_name, tag_ids`.
No Storage paths, provider errors, purge/retention snapshots, request fingerprints,
private audit or provider data are present. List does not add a total count; search
preserves the original V2 flat columns and appends the three sharing fields.
No public recording projection contains the original author's `created_by` UUID.
This forward revokes authenticated direct SELECT on `recordings.project_id` and
`recordings.created_by`, closing the earlier T1 column-grant bypass. Project IDs
are exposed only through the scope-masked RPC projection, including for owners.
Authenticated EXECUTE on the legacy `get_personal_recording_metadata_v1(uuid)` is
also revoked: its whole-row JSON would otherwise bypass the project mask for an
owner whose project membership was revoked. The safe detail RPC retains only the
authorized owner client/folder/tag fields and the independently masked project.
No replacement whole-row JSON path is introduced.

## Authority and metadata

The single private `accessible_recording_rows_v1` helper calls the T1
`can_read_recording` predicate. Private content belongs to its owner, project-visible
content to founder/active members, project-selected content to founder/exact active
scoped grants, standalone-selected content to owner/exact active standalone grants.
A recording is emitted once, regardless of combined membership/grant paths.
Technical authorship alone does not authorize shared project content.
Deleted rows additionally require `can_manage_recording`, so project members and
selected recipients cannot see another person's Trash.

Only a currently authorized original owner receives `client_id`, `folder_id`,
and `tag_ids`. Non-owner values are SQL NULL (owner no-tags is an empty array).
Client/folder/tag filters exclude non-owners; requested tags use ALL semantics after
deduplicating IDs and dropping NULL entries.

Project metadata uses two scopes. `can_read_recording_project` still authorizes
general project rows through founder or active membership. An exact selected grant
additionally permits `project_id` and safe `project_name` **on that accessible
recording only**, including its search/filter behavior. This never opens a project
row/list or the founder's client association. A selected outsider filtering by a
project sees only their exact recording grants. Standalone content has no project.
A private recording owner who has lost project access retains their recording but
receives NULL project ID/name and cannot search/filter by the hidden project.

## Search, counts and paging

Empty normalized `q` uses list; nonempty `q` uses search. Normalization trims,
collapses whitespace and caps at 120 characters, then uses
`websearch_to_tsquery('simple', ...)`. Empty search itself returns zero rows.
Search only matches title, permitted project name, latest transcript chunks, and
the current owner's personal taxonomy. The original metadata search vector is
used only for that owner; shared title/project vectors are rebuilt from the safe
text, never from a private aggregate. Private clients/folders/tags cannot influence
shared match existence, score, excerpt, total or facets.

The shared private search-winner helper preserves PostgreSQL `ts_rank_cd` and
`ts_headline` markers `[[H]]...[[/H]]`. Latest transcript order is
`created_at desc, id desc`; candidate ties use rank descending, transcript before
metadata, start time ascending NULLS LAST, then chunk position. There is one winner
per recording. Search order is rank descending, recording created_at descending,
recording ID descending. `total_count` is computed after active status selection
and before page limit/offset. Offset beyond the result set returns no row, hence no
embedded total, as in V2. Limit stays 1..50, default 25; offset floors at zero.

List retains descending `(created_at,id)` keyset order, 1..1000 limit (default 100),
and requires both cursor components or neither. Default/status list excludes Trash.
The deliberate extension `p_status='deleted'` lists only current-manager Trash;
nonempty search still excludes deleted, including when asked for deleted status.

Count returns all six active statuses in enum order, including zero rows, plus
`deleted`. Active facets cover the entire same query/organization filter set and
ignore the selected status. The `deleted` row is deliberately the **unfiltered**
current-custody Trash total, independent of active q/organization filters, preserving
the existing separate Trash-counter behavior.

## T3 caller adoption

The T3 source callers in `src/lib/recordings/queries.ts` and `search.ts` now use
these accessible RPCs through the authenticated session client. List and detail
do not query protected recording columns; search preserves server ranking and
facets. A duplicate list row is a contract failure, not silently filtered output.
`get_accessible_recording_v1` supplies the safe detail and personal taxonomy.
Do not request `created_by` from the read APIs or use it as a display identity.
No current `app/`, `src/` or unit-test caller of the legacy personal-metadata
RPC was found during this source review. Its T1 permission artifact describes the
earlier contract in its historical checkpoint. The current
`supabase/tests/project_sharing_permissions.sql` now has narrowly adapted
later-forward compatibility assertions: authenticated callers expect denial and
use the safe detail projection. It requires the final migration chain and must not
be labeled an unchanged standalone T1 artifact or runtime receipt. The immutable
T1 production migration remains untouched.
Any new T3 personal-taxonomy caller must use `get_accessible_recording_v1`, never
the legacy JSON function. The forward remains coupled to the T3 caller switch.
Do not add a second owner predicate, merge owner/shared pages, filter a returned
page in application code, or widen table column grants to keep old queries alive.
`src/lib/recording-sharing/resolve-capabilities.ts` is the canonical application
resolver for `recording_capabilities_v1`; RPC errors, incomplete/malformed flags
and denied read resolve to all-false. Server pages pass those flags into action UI.
Server mutation and provider routes independently resolve current authority.
Use the returned permitted project label directly; a selected-only recipient need
not and must not load the general project list to render it.

Personal organization options remain owner-scoped. Organization URL validation
accepts an exact UUID project filter even when general project options omit it.
The database enforces the exact set. The seven-row facet response replaces the
separate owner-only deleted count; never include deleted in active totals.

Old RPCs and historical migrations remain unchanged. T1 removes broad column
privileges, so the old invoker `r.*` callers remain incompatible until adoption.
This forward does not adopt server/capture routes, authorize service-role requests,
or change existing protected mutation boundaries.

## Verification

`supabase/tests/project_sharing_read_paths.sql` is a rollback-only pgTAP artifact
for a disposable database after the complete migration chain. It exercises actual
authenticated roles F/E/R/S/X/revoked, exact list/search/detail sets, query/status
facets, private and shared Trash, private taxonomy leaks, SQL excerpts/time ranges,
latest transcript, owner ALL tags, keyset/search pages, exact total_count,
selected project metadata vs general project RLS, live-in-transaction revoke,
null identity, protected direct columns and private helper/API ACLs. Catalog tests
assert exact signatures, stable SECURITY DEFINER behavior, fixed empty search_path,
the same trusted owner as the T1 authority function, and absence of author UUIDs
from the public composite/search OUT columns. The invalid project-visible grant
fixture was replaced with a founder grant on an already selected recording, so
the duplicate-authority check obeys the actual T1 selected-scope trigger.

`tests/unit/project-sharing-read-paths.test.ts` checks mocked real application
callers plus source invariants:
literal fixture grants agree with selected scope, direct column revokes exist,
author identity is excluded, and bounds are within the private scan body. It has
a RED/GREEN receipt but does not execute SQL, inspect a catalog or prove RLS.

### Detail edits and private processing

Title and task status writes use the locked narrow RPC and verify a matching
saved result afterward. A missing row, revoked session, failed RPC or unmatched
result is not success. Task states retain `new/in_progress/waiting/done/unclear/ignored`;
the UI checkbox toggles only `new`/`done`. Speaker edits send the DB slot version,
display the returned fresh conflict, and require explicit retry; unrelated slots
are never rewritten. Search indexing reads a fresh persisted snapshot and calls
`replace_transcript_search_chunks_v2` with its `search_version`, requiring `true`.

Saved transcript/AI/structured content is session RLS-readable; prompt/job snapshots
and provider configuration are never joined into shared saved output reads.
Personal chat history remains own-thread plus current read; sending a turn and
all AI/restart/reconcile entry points require explicit personal-AI capability.
Opening reader/editor detail does not trigger automatic timeline work.

The audio endpoint first checks current `read`, then internally reads the exact
technical locator (`user_id`, `storage_path`, MIME) by recording ID. It validates
the canonical owner/recording object path and signs through the **session Storage
client**, never the service client. Raw locator fields are not passed into client
props. Signed URLs expire after 300 seconds, are `no-store`, and cannot be recalled
retroactively after revoke; every new issuance is checked again.

T2 recording managers mount only with resolved `manageAccess`; project managers
only with the server founder RPC. Project-private publication uses the explicit
T4 visibility/bulk caller. Source capture/upload/recovery and accepted-job custody
paths are adopted across the full chain; raw transcript entry guards remain narrow.
No migration apply or runtime DB/Storage verification is established by that adoption.

### Predicate boundaries and required query-plan gate

The private `accessible_recording_rows_v1` function takes organization filters plus
`p_recording_id, p_status, p_include_deleted, p_before_created_at, p_before_id,
p_limit`. It applies ID/status/keyset constraints and ordering/limit directly
against its underlying recordings query. List passes its bounded page size/cursor
inside this function; detail passes exact ID and limit one. These bounds no longer
depend on predicate pushdown through an outer SECURITY DEFINER Function Scan.

Search first materializes only authorized active recording IDs using the reviewed
T1 `can_read_recording` helper. No title, transcript or private metadata is
projected in that authorization CTE. A correlated lateral content query is bound
to each authorized ID; `OFFSET 0` deliberately prevents flattening this boundary
into a global content-first scan. Hidden title/project/transcript matches therefore
cannot generate exact-ID projection calls. The authority pass still has to
enumerate recording IDs, so no constant-cost or side-channel-free timing claim is made.

Before rollout, representative disposable-data `EXPLAIN (ANALYZE, BUFFERS)` is
required for exact detail (including a revoked ID), first/deep-keyset list,
status/organization-filtered list, selective and broad FTS, offset pages and both
query/non-query facets. Inspect the inner function statements as the trusted test
owner with equivalent JWT claims (or nested-statement auto_explain); a top-level
Function Scan alone is insufficient. Confirm exact-ID lookup, bounded list work,
latest-transcript/index behavior, and absence of full safe-row materialization for
selective search at representative scale. Generic plans, access-predicate cost and
count sorting remain measurement concerns. Verify the authorized-ID materialization
and parameterized content scan, then compare identical accessible fixtures with
large hidden corpora containing zero versus many matching terms: content/helper
work must not grow with hidden matches. Index creation also needs a target-specific
size/lock assessment before any production apply. No query-plan/performance pass is claimed.

No PostgreSQL runtime was available here (psql/Supabase CLI absent; Docker daemon
unavailable). The artifact was written before the migration, but RED/GREEN execution,
SQL catalog/type validation, RLS runtime assertions, plans/performance and rollback
rehearsal remain unexecuted. Source inspection/whitespace checks are not runtime proof.
Once a disposable runtime exists, apply the full chain transactionally and run
`psql -v ON_ERROR_STOP=1 -f supabase/tests/project_sharing_read_paths.sql`.
Inspect pgTAP output for failing assertions (or use pg_prove for failure exit status).
