# Project sharing rollout runbook

Status: the source, ordered migrations and verification fixtures are included. Each installation must complete its own preflight, apply and postflight. Publishing this repository does not deploy Auth, Storage, email or workers.

## Candidate and prerequisites

Use the entire ordered migration chain, not a standalone sharing migration:

1. `20260922190000_add_project_sharing.sql`
2. `20260922200000_add_project_sharing_read_paths.sql`
3. `20260922210000_add_shared_ai_output_types.sql`
4. `20260922220000_add_shared_recording_trash.sql`
5. `20260922230000_add_owned_usage_and_trash_audio.sql`
6. `20260923000000_add_bulk_recording_sharing.sql`
7. `20260923010000_add_capture_operation_contracts.sql`
8. `20261002000000_list_selected_capture_authorizations.sql`
9. `20261002010000_capture_personal_intents_and_contacts.sql`
10. `20261002020000_capture_index_and_speaker_repairs.sql`
11. `20261002030000_founder_owned_private_sharing.sql`
12. `20261002040000_release_absent_purge_requests.sql`
13. `20261002050000_owned_job_usage.sql`
14. `20261002060000_integrate_dev_capture_features.sql`
15. `20261002070000_guard_manual_ai_destructive_admission.sql`

Check exact filenames against `supabase/migrations/` and bind the full candidate to
commit/worktree hashes. Preserve earlier baseline/search/prompt/retention migrations.
Do not edit already reviewed historical forwards to conceal an upgrade dependency.
The current-dev prerequisite chain also includes durable manual AI/recovery/cleanup,
Mistral provider and independent automatic AI outputs. Verify their actual schema,
not ledger entries alone. Forward `006` integrates those features without destructive
legacy transcript completion or historical backfill; see the capture contract.

Contracts: [sharing](recording-sharing.md), [invitations](recording-invitations.md),
[reads](project-sharing-read-paths.md), [bulk](bulk-recording-sharing.md),
[capture/worker](capture-operation-contracts.md),
[Trash](shared-recording-trash.md), [manual purge](manual-recording-purge-worker.md).

## Read-only target preflight

Record target project/environment, app and worker revisions, migration ledger and
schema parity separately. Repository evidence is not a current baseline for the selected target. Inventory actual owners/BYPASSRLS, table/column/
function privileges, forced RLS, policies, triggers, constraints and extension
schemas. Compare expected definitions; unknown drift blocks apply.

Count recordings by status/visibility, transcripts, saved outputs/projections,
jobs/intents, Storage objects and byte totals. Inventory orphan/mismatched owner,
project/client/FK/path rows, legacy in-flight provider jobs, active uploads, active
purge reservations and retention scheduling. Do not guess whether a timed-out
provider request committed. Resolve legacy work with a separately approved policy.

Check Auth public signup disabled, allowed redirect URLs, Invite user/Magic link
templates, SMTP delivery capability and isolated sink accounts. Template contracts
are exact in the invitation API document. Never print tokens, secret values,
transcripts or provider configuration documents in evidence.

Required existing env names without values: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SONIOX_API_KEY`,
`OPENAI_API_KEY`, optional `GEMINI_API_KEY`, optional `SONIOX_ASYNC_MODEL`.
The transcription worker requires `RECORDING_TRANSCRIPTION_WORKER_TOKEN`; there
is no global transcription enable switch. Verify the exact DB, compatible app,
discovery/expiry scheduling and alerts before invoking the worker. The model must
match active DB allowlist/version; an env override is not approval for another model.
Manual purge uses the existing `TRASH_RETENTION_ENABLED` and
`TRASH_RETENTION_SCHEDULER_TOKEN` conventions. No global sharing enable switch or
tested incident DB deny-shared-access control is supplied by this candidate.
The rollout/backout controls below are target-specific prerequisites, not claims
that an app flag or scheduler has been implemented or activated.

## Disposable verification

Use a disposable full-chain Supabase/Postgres database, both clean bootstrap and
representative upgrade copy. Never reset an existing target for testing. Execute
the sharing/read/output/Trash/usage/bulk/capture and new-forward SQL fixtures under
their real roles. Source-regex tests are not parse/apply or RLS proof.

Run isolationtester scenarios with two real sessions: revoke/edit and create/start,
speaker same/different slot, bulk/revoke and worker claim/settle fairness. Rehearse
rollback/forward repair without dropping accepted work. Measure bounded 100×100
bulk requests, history-heavy revocation, search and worker queue with representative
EXPLAIN plans, including lock waits. Verify actual Storage catalog/TUS and purge
races; mocks cannot demonstrate physical upload consistency.

Use an isolated Auth/email sink for new and existing accounts, verified identity,
OTP/password, preview without consume, explicit accept, old-token rejection,
resend cooldown/exhaustion, failed/ambiguous delivery and concurrent accept/revoke.
Real provider tests require separate spending/send approval and cover exact IDs,
lost submit response, consumed leases, segment offsets and post-revoke finalization.

Before an authorized source push, the mandatory pre-push hook runs lint,
typecheck and full Vitest on the final merge HEAD. Do not bypass the hook or
claim an additional `npm.cmd run check` invocation. Separately run
`npm.cmd run build` and inert desktop/mobile browser checks for
`project-sharing.spec.ts`, `project-invitations.spec.ts`,
`new-recording-workspace.spec.ts` and `manual-ai-quiet-refresh.spec.ts`.
Bind receipts to the actual final candidate; the DB gate remains separate.
Fixtures prove only their local caller/UI scope, not target Auth/RLS/provider state.

## Approved rollout sequence

1. Obtain target-specific approval, backup/recovery point and compatible maintenance
   window. Pause new sharing/capture starts and check active operations again.
2. Apply the full reviewed chain transactionally as the trusted owner after drift
   reconciliation. Never blind `db push` over unresolved legacy ledger history.
3. Deploy the compatible app before scheduling worker calls; verify private smoke, exact ACLs,
   full-chain role tests and zero loss against preflight counts. Existing private
   recordings must remain private. UI hiding alone is not a DB access gate.
4. Explicitly resume approved sharing/invitation operations under the chosen
   target-specific controls, and activate exact worker discovery/expiry scheduling
   plus manual-required alerts. The transcription worker is independent
   of browser polling. Do not assume a schedule exists because its route builds.
5. Only authorized test recipients receive first emails. Run two-session F/E/R/S/X
   list/search/count/deep-link/audio/edit/revoke/capture smoke on the exact target.
   Verify personal AI without editor/revoked access bypass and preserved history.
6. Record commit, push/PR, DB applied, deployed, enabled, target verified and user
   accepted as separate states, with counts, command exits and remaining gaps.

## Incident/backout

Stop new sharing/invite/provider starts first; preserve private ownership and all
receipts, grants, stored content and accepted operations. A tested database deny
shared-access path is required for access incidents; an app flag alone is insufficient.
Use compatible read-only mode and a reviewed forward fix. Returning to owner-only
code can restore revoked authors' access, so is not a safe automatic rollback.

Never bulk backfill shared rows to private, drop grants, delete job/intents or restore
old service EXECUTE privileges while work remains active. Finish or externally
resolve uncertain operations using the exact evidence-bound capture runbook. A
backup restore requires separate approval of the precise restore target/data loss.
No automatic account transfer or deletion policy is introduced.
