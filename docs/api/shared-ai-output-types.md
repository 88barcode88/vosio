# Saved AI output types

Status: **source-only; not applied, not runtime verified, not rollout-ready**.
`20260922210000_add_shared_ai_output_types.sql` follows T1 project sharing and
`20260922200000_add_project_sharing_read_paths.sql`. Apply the entire forward in
one transaction as the same trusted owner as `can_read_recording`; the migration
checks that owner has superuser or BYPASSRLS authority, excludes browser/service
roles, and explicitly sets function ownership. No existing table grants or RLS
policies are changed.

```sql
public.get_accessible_ai_output_types_v1(p_output_ids uuid[])
  returns table(output_id uuid, processing_type public.ai_processing_type)
```

The authenticated session first reads saved `ai_outputs` through its ordinary RLS
client, then sends those output IDs in batches of at most 1000. The RPC returns
only `output_id` and the authoritative `ai_processing_jobs.processing_type` for
existing outputs whose transcript's recording passes canonical T1
`can_read_recording`. It also requires job/output transcript and user lineage to
match; separate legacy FKs alone do not ensure same-transcript lineage. A malformed
cross-transcript output is omitted, even if its output row passes RLS.

The raw input cap applies before deduplication, including NULLs and repeats.
More than 1000 elements or a multidimensional array raises SQLSTATE `22023` with
the same input-only error regardless of output existence. NULL/empty arrays return
no rows; NULL elements are ignored; duplicates produce one row. Result order is
ascending output UUID, not request order. Unknown, inaccessible, removed, and
inconsistent-lineage outputs are all omitted, without placeholder/status rows or
distinct errors. Invalid UUID syntax is rejected by PostgreSQL's argument parser.
This is result-level non-enumeration, not a constant-time guarantee.

The function is `STABLE SECURITY DEFINER`, has an empty pinned `search_path`, and
uses the session `auth.uid()` rather than an actor parameter. The projection query
and canonical stable authority helper use the calling statement's MVCC snapshot.
Under ordinary READ COMMITTED requests, a revoke committed before the statement
is visible; a concurrent revoke does not retroactively erase an already-running
statement or already-returned content. A caller-chosen repeatable-read transaction
retains its normal transaction snapshot. No authorization cache, advisory lock,
new job visibility policy or service-role application workaround is introduced.

`PUBLIC`, `anon` and direct `service_role` execution are revoked; only
`authenticated` is granted EXECUTE. A role without `auth.uid()` receives no rows.
The result never includes job ID, prompt, provider/model, input snapshot, error,
cost or any other private job data. Normal job SELECT remains owner **and current
recording read** only, including after technical-author membership loss.

Deleted recordings follow `can_read_recording`: private/standalone custody stays
with its owner, shared project custody with its founder; members and selected
recipients cannot read another custodian's Trash. The RPC adds no active-only
filter, because detail/Trash and the AI archive must choose their own existing
recording-status presentation rules. There is no independent archived-output flag.
Hard-deleted outputs cannot return a type from a surviving job.

For T3 caller adoption, replace the embedded private-job join with this projection
through the same authenticated client. Missing type results must be omitted or
handled as unavailable; never infer a type from `output_json`, substitute a default,
or retry as admin. If access is revoked between the RLS read and the RPC call, the
later type response drops that output. Separate HTTP requests are not one atomic
snapshot and cannot retract data already returned by the earlier request.
RPC/type failure must fail closed and remain visible as a load failure. This
forward alone is not deployable without its callers. T3 source in
`src/lib/ai/queries.ts` now reads explicit saved-content RLS projections first,
pages detail/archive outputs without a 1000-row truncation, and resolves types in
batches of at most 1000. It does not join private jobs, infer JSON types or use an
admin fallback. Missing type rows are omitted; RPC failures abort the load.
Archive delete controls receive separately resolved recording capabilities.

`tests/unit/shared-ai-output-types-contract.test.ts` has executed RED (3 failures
before the migration existed) and GREEN (3 passing source-contract checks). It
does not execute SQL or prove RLS. `supabase/tests/shared_ai_output_types.sql`
contains rollback-only pgTAP checks for catalog/ACL, owner/founder/member/selected
sets, revoked and foreign IDs, bounded/deduplicated inputs, private jobs,
inconsistent lineage, Trash, removed outputs and authorization changes.

Required before rollout: apply the full chain in a disposable PostgreSQL database,
run `pg_prove supabase/tests/shared_ai_output_types.sql` against that database,
inspect exact-ID/batch query plans on representative data, rehearse rollback, and
verify coordinated T3 callers. PostgreSQL/pg_prove are absent here and Docker's
daemon is unavailable; SQL catalog, fixture, RLS, plan and rollback checks have
not run. No install, live apply, database write or provider call was performed.
Rollback is a separate authorized forward that drops only
`public.get_accessible_ai_output_types_v1(uuid[])` after reverting dependent callers;
it does not remove data or loosen existing RLS.
