# Decision 0005: Manual AI job recovery

## Status

Accepted as the source contract for the integrated manual AI recovery implementation. The forward migration and application changes are source-only in this checkout. The migration has not been applied to production; production schema, deploy and live behavior are not verified here.

## Context

Manual AI processing is accepted asynchronously through Next.js `after()`. The browser can lose the response, the host can interrupt the work, and the provider does not guarantee idempotency for a repeated request. Retrying an uncertain provider call automatically could therefore charge twice or produce two competing outputs. A durable job row is also required so navigation does not erase an accepted request.

## Decision

Every new manual request persists one `ai_processing_jobs` row with:

- `execution_mode = 'manual'`, `attempt_count = 0`, `max_attempts = 1`,
- a request UUID that is reused only for transport retry,
- an exact prompt, model and provider snapshot,
- no active lease while it is `queued`.

The processing endpoint returns the existing owner/transcript job for the same UUID and request identity. It does not reschedule it. An explicit user retry always creates a new UUID; the previous row and any output remain audit data. No manual AI job is physically deleted to remove it from the queue.

Provider execution requires the service-role-only `claim_manual_ai_job_v1` RPC. The claim is short and row-locked, changes only a valid new manual shape to `running`, increments the attempt to one and assigns an exact 480-second lease. Both the processing and reconcile routes declare the 300-second runtime budget; the remaining 180 seconds are recovery grace. The lease is not renewed and a running provider call is never reclaimed automatically. Settlement requires the exact job, transcript, owner and lease token; a zero-row settlement is a real unsuccessful settlement.

Reconciliation is provider-free and checks the durable output first:

| Durable row | Reconcile result | Provider call |
| --- | --- | --- |
| New `queued` manual shape | `schedule`, or explicit `interrupt` | At most one, only after a winning claim |
| Legacy/manual shape outside the new protocol | `operator_required` | Never automatic |
| `running` with an unexpired lease | `busy` | None |
| Expired `running` with owner-consistent output | `done` and clear lease | None |
| Expired `running` without output | `failed` with `execution_interrupted` and clear lease | None |
| `done` or `failed` | Terminal no-op | None |

The owner-authenticated endpoint `POST /api/transcripts/{transcriptId}/manual-ai/reconcile` accepts only `{ jobId, action: "reconcile" | "interrupt" }`. `interrupt` can terminalize a new queued or stale running job, but never claims that a fresh provider call was cancelled. The three RPCs are `SECURITY INVOKER`, use an empty `search_path`, fully qualify objects, and grant execute only to `service_role`.

## Safe failure and privacy

Manual failures persist and expose only these machine-readable codes: `insufficient_credit_or_quota`, `rate_limited`, `invalid_model`, `provider_unavailable`, `provider_configuration`, `execution_interrupted`, `persistence_failed` and `unknown`. A valid `retry_after_at` may accompany `rate_limited`. The UI maps codes to fixed Czech messages. Raw provider messages, HTTP bodies, prompts, transcript text, output content, request secrets and provider identifiers do not enter error metadata, API responses or logs.

## Operational boundary

The source migration is exactly `supabase/migrations/20260904140126_harden_manual_ai_job_recovery.sql`. It is additive and does not rewrite or delete existing jobs. This public repository is a source contract and does not assert that any hosted target has applied the migration.

Before applying it to an existing target, an operator must inspect the target schema, output lineage, grants, RLS and migration ledger through an approved read-only preflight. Apply only the reviewed missing migration in one explicit transaction. The postflight must verify columns, checks, all three function signatures, `SECURITY INVOKER`, empty `search_path`, forced RLS/owner policy preservation and service-role-only execute ACL. Migration history must not be changed merely to silence tooling.

Legacy or otherwise non-canonical manual jobs return `operator_required`. Their resolution requires a separate target-specific inventory and approval, must not repeat an uncertain provider call and must not delete audit rows or outputs automatically. Report source publication, database apply/postflight, application deploy and live verification as separate states.
