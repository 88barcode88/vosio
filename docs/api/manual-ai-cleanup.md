# Manual AI cleanup

This source feature removes only recoverably classified manual jobs without outputs or projections. It does not run providers and does not introduce a scheduler.

## API contract

- Authenticated owner-only `GET /api/transcripts/{transcriptId}/manual-ai/cleanup?cursor=...` returns at most 50 candidates with an opaque owner/transcript-bound keyset cursor.
- `POST` accepts one to 50 exact job UUIDs. It returns per-ID `deleted`, `protected`, `busy`, `reconciled`, `missing` or `conflict` results, plus only server-confirmed removed IDs and changed jobs.
- The UI alternates bounded GET and POST pages. An absent item in a status response is never deletion evidence.
- AI state exposes server-owned `poll_eligible`, `actions` and `cleanup_reason`; it never serializes prompts or provider configuration.
- Authentication failure is `401`, a missing or non-owned transcript is `404`, an invalid or cross-owner cursor is `400`, and an unavailable database contract is `503`. Errors are sanitized.

## Safety boundary

All new RPCs are `SECURITY INVOKER`, use an empty `search_path`, and are executable only by `service_role`. They are scoped to the exact owner, transcript and manual job. Cleanup locks parents in deterministic ID order, then their dependencies. Any linked AI output, task, chapter, decision or risk protects its parent job.

Terminal failed, cancelled or done jobs with no dependencies may be eligible. Only the exact recognized single-attempt expired-lease or stale-unclaimed lifecycle can be reconciled or cleaned. Historical queued or running jobs without that recognized snapshot and lease contract remain `unsupported_legacy`, stop polling and are not silently deleted. The feature does not claim to repair every historical stuck job.

## Source migrations and verification boundary

The ordered source files are:

1. `20260908101824_add_mistral_ai_provider.sql`, which adds only the Mistral provider enum value. PostgreSQL requires committing that enum change before a transaction uses it.
2. `20260908103000_add_manual_ai_job_cleanup.sql`, which adds the classifier, cursor listing, cleanup and locked settlement functions.

Source presence is not applied, deployed or live verification. Each installation requires separate authorization, schema and ledger comparison, forward apply and postflight. Do not run `supabase db push` blindly or alter a migration ledger to make it appear canonical.

Before exposing cleanup, inspect actual enums, tables, triggers, constraints, policies, function bodies, grants and foreign-key delete actions. Verify forced RLS, narrow function grants, owner/dependency safeguards and aggregate candidate/protected counts without logging row IDs, content or secrets. No bulk cleanup runs automatically.

The application may be rolled back while leaving additive enum and compatible RPC changes in place. Removing the enum value is not a rollback strategy, and stopping cleanup cannot restore an eligible job already deleted. Report source-only, applied, deployed, provider-account verified and live-browser verified as separate states.

`node scripts/verify-manual-ai-cleanup-postgres.mjs` is limited to a disposable native local PostgreSQL database. It requires a loopback `VOSIO_DISPOSABLE_DATABASE_URL` whose database name ends in `_vosio_cleanup_test`, plus `psql` or `PSQL_PATH`. The harness refuses missing or incompatible roles and creates fixtures only in that disposable database. Docker is not part of this verification path.
