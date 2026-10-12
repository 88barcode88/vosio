# Manual AI cleanup and rollout

This source feature removes only recoverably classified manual jobs without outputs or projections. It does not run providers or introduce a scheduler.

## API

- Authenticated owner-only `GET /api/transcripts/{transcriptId}/manual-ai/cleanup?cursor=...` returns `candidates: [{job_id, cleanup_reason}]` and `next_cursor`, at most 50 per page. The opaque keyset cursor binds owner/transcript and orders by created_at/id.
- `POST` accepts `{job_ids: UUID[]}`, 1 to 50 exact IDs. It returns per-ID `results` with `deleted|protected|busy|reconciled|missing|conflict`, plus `removed_job_ids` and `changed_jobs`. Repeated calls are idempotent.
- The UI alternates bounded GET/POST pages, removes only confirmed IDs and merges changed jobs. Missing entries in a status page are never deletion evidence.
- AI state exposes server-owned `poll_eligible`, `actions` and `cleanup_reason`. It does not serialize prompts or provider configuration.
- Authentication failure is 401, non-owned transcript 404, invalid/cross-owner cursor 400, unavailable DB contract 503. Errors are sanitized.

## Safety boundary

All new RPCs are invoker, empty-search-path, service-role-only and owner/transcript/manual scoped. Cleanup locks parents in deterministic ID order, then dependencies. Any linked `ai_outputs`, tasks, chapters, decisions or risks protect the parent. The settlement RPC uses the same parent lock. A late dependent insert either wins and protects the job or fails its foreign key after deletion; it must never silently disappear through a cascade.

Terminal failed/cancelled/done jobs with no dependencies are eligible. Only the exact recognized single-attempt expired-lease/unclaimed lifecycle can be reconciled or cleaned automatically. Historical queued/running jobs without a recognized snapshot/lease contract remain `unsupported_legacy` and stop polling; they are not silently deleted. A protected output-bearing legacy row is retained. This feature does not claim to repair every historical stuck job.

## Source migrations and non-Docker proof

After the existing canonical migration chain, the new source files are:

1. `20260908101824_add_mistral_ai_provider.sql`: adds only the Mistral provider enum value. Commit this enum change before transactions that use the value.
2. `20260908103000_add_manual_ai_job_cleanup.sql`: classifier, cursor listing, cleanup and locked settlement functions.

Source presence is not applied/deployed/live verification. Before any target apply, obtain explicit authorization, compare its ledger and actual schema with the repository, and reconcile drift using the existing manual-forward decision. Do not blindly run `supabase db push`. Verify forced RLS, narrow grants, function signatures and owner/dependency safeguards before exposing cleanup.

Inspect actual enums, tables, triggers, constraints, policies, function bodies/ACL and foreign-key delete actions, independently of the ledger. Dry-run aggregate candidate/protected counts by owner/transcript without logging row IDs, content or secrets. After separately approved apply, verify enum membership and exact function/lease/dependency behavior again. No bulk cleanup runs automatically.

After separately approved deployment, use a disposable owned fixture and classify first; run one cleanup only with explicit authorization. Prove output/projection protection and concurrent completion separately. Verify provider account access independently from key presence, without unapproved paid calls. Each self-hosted/public target needs its own evidence.

Rollback the app to the prior build while leaving the additive enum and compatible RPCs in place. Do not remove the enum value or promise recovery of deleted eligible jobs: stopping further cleanup cannot restore them. Report source-only, applied, deployed, provider-account verified and live-browser verified separately. ChatGPT/Codex subscription OAuth remains out of this phase.

Run `node scripts/verify-manual-ai-cleanup-postgres.mjs` only on a disposable native local PostgreSQL database. It requires `VOSIO_DISPOSABLE_DATABASE_URL` on loopback with database-name suffix `_vosio_cleanup_test`, and `psql` or `PSQL_PATH`. Keep connection values out of command history/logs. The cluster must already have compatible non-superuser anon/authenticated (no BYPASSRLS) and service_role (BYPASSRLS) roles. The harness refuses missing/incompatible roles and never creates or alters cluster-global roles. It creates fixture schemas/data only in that disposable database.
