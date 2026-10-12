# Owner usage and safe Trash audio metadata

Status: source-only, not applied or PostgreSQL/runtime verified. Additive forward
`20260922230000_add_owned_usage_and_trash_audio.sql` follows reviewed `220000`.
Apply transactionally as the canonical trusted T1 owner. No older migration or
v1 function is replaced, and no table grants, RLS policies or data are changed.
Rollback, if required after rollout, is a separate forward removing the three
new functions only after their callers have been moved back or disabled.

All three functions are stable SECURITY DEFINER, empty search_path, explicitly
owned by the same superuser/BYPASSRLS owner as `can_read_recording`. Only
authenticated has EXECUTE; PUBLIC/anon/service_role are explicitly revoked.

## Owner-only Settings usage

```sql
get_owned_recording_usage_summary_v1(
  p_created_from timestamptz, p_created_before timestamptz
) returns table(
  count bigint, deleted_count bigint,
  total_duration_seconds bigint, total_file_size_bytes numeric,
  with_duration_count bigint, with_file_size_count bigint
)

get_owned_recording_durations_v1(p_recording_ids uuid[])
  returns table(recording_id uuid, duration_seconds integer)
```

The sole row scope is `recordings.user_id = auth.uid()`: technical ownership,
not current canRead, project membership, author display identity, or founder
management. Shared-only recipients/founders cannot inflate their own usage from
other people's recordings. A revoked technical owner still gets this narrow
accounting metadata for their own recordings without regaining content access.
No owner UUID, project/taxonomy, title, storage locator or protected worker data
is returned. The later `20261002050000_owned_job_usage.sql` adds
`get_owned_job_usage_v1(from,before)` for the same owner-only half-open monthly
period. It returns only cost inputs (model/status/token counts and Soniox
recording/mode/status), not prompts, provider IDs, configuration, errors or content.
Settings uses this narrow projection instead of job table SELECT, whose content
RLS correctly denies a revoked author. This preserves their accounting without
restoring recording access; its prepared SQL tests are not executed DB proof.

Summary uses the half-open recording-created interval `[from,before)`, including
all statuses and counting deleted as a subset. Bounds must be non-null, finite,
strictly increasing and at most 32 elapsed days (`22023` otherwise). This covers
UTC calendar months including 31 days without an unbounded aggregate endpoint.
Auth.uid absent fails with `42501`. There is exactly one summary row, including
empty periods. Counts are zero for empty sets. Each total is NULL when no row
has a non-null value; a stored zero contributes to the non-null count and sum.
Duration is integer in the table and SUM returns bigint; bytes are bigint in the
table and SUM returns numeric to avoid aggregate bigint overflow. Consumers must
handle PostgREST numeric values deliberately and must not silently conflate NULL
with zero or lose precision above JavaScript's safe-integer range.

Duration lookup is independent of recording-created date, so jobs created this
month can use an older recording's duration. It accepts at most 1000 RAW array
elements before any deduplication and rejects nonempty multidimensional arrays
with `22023`. NULL/empty arrays return no rows; NULL elements, duplicates,
foreign/shared-only/missing IDs are safely omitted/deduped. Auth.uid absent also
returns no rows. Existing owned rows with unknown duration return NULL, not an
invented zero. Results are deterministic by recording ID. Callers chunk their
owner-only transcription-job recording IDs into batches of at most 1000.

## Manager-only Trash v2

```sql
get_managed_recording_trash_v2(p_recording_ids uuid[])
  returns table(
    recording_id uuid, deleted_at timestamptz,
    trash_retention_hours smallint, purge_after timestamptz,
    purge_phase text, audio_availability text
  )
```

The five existing safe v1 fields and manager/deleted scope are retained. Use this
to enrich IDs already returned by the server's paginated Trash list, never to
filter a completed page. Max100 RAW one-dimensional IDs; NULL/empty safe; NULL
elements/duplicates safely omitted/deduped; foreign/missing/active/read-only
records omitted. Auth.uid absent returns no rows. Invalid bound/dimension uses
`22023`. Founder manages shared project/selected Trash; private/standalone owner
manages their own Trash. A technical project author, editor, reader, selected
recipient or revoked member has no Trash metadata merely because of read access.

`audio_availability` is one of `none|segmented|single` and follows the existing
server-side audio locator's canonical rules:

- NULL/empty locator or wrong `{technicalOwner}/{recordingId}/` prefix: `none`.
- Any backslash or empty/`.`/`..` relative component: `none`.
- Exact canonical `{technicalOwner}/{recordingId}/live/`: `segmented` (the one
  allowed trailing slash). Nested or malformed live folders fail closed.
- Other nonempty canonical file path: `single`.

No path, owner, claim/token/error is returned, and no Storage objects are listed.
This value describes the validated locator shape, **not physical object
existence or successful playback**. A later audio request must still use the
existing authorized locator/download flow and handle missing Storage objects.
`purge_phase` remains `none|prepared|started`, as in v1. Reviewed v1 stays unchanged.

## Adoption and verification gate

T3 Settings must replace broad recordings RLS queries with these owner-only RPCs;
do not add a direct `user_id` grant or use admin reads after a capability check.
Trash UX must adopt v2 to display audio state without guessing from revoked
storage_path. Old callers remain unchanged by this DB-only task.

Source test `tests/unit/owned-usage-trash-audio-contract.test.ts` is structural
evidence, not runtime authorization proof. `supabase/tests/owned_usage_and_trash_audio.sql`
is a role-switched disposable-DB pgTAP fixture covering aggregate null/zero and
date boundaries, membership revoke, owner-vs-shared scope, raw bounds, manager
matrix and safe audio classification. PostgreSQL execution, PostgREST numeric
serialization, representative owner/month and bounded-ID EXPLAIN, actual UI
adoption and Storage/playback verification remain unperformed rollout gates.
