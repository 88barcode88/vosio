# Supabase Setup

This folder contains the canonical database and Storage setup expected by Vosio.

## Fresh Project

A new empty project must apply every migration in timestamp order:

1. `20260617000000_initial_schema.sql`
2. `20260804100000_add_evidence_locations.sql`
3. `20260804110000_add_recording_organization.sql`
4. `20260804120000_add_recording_markers.sql`
5. `20260804130000_add_transcript_fulltext_search.sql`
6. `20260810005550_restore_recordings_from_trash.sql`
7. `20260813000000_add_recording_status_filters.sql`
8. `20260813090000_add_prompt_overrides_and_job_snapshots.sql`
9. `20260815073029_harden_prompt_override_privileges.sql`
10. `20260827094435_add_automatic_timeline_idempotency.sql`
11. `20260827100000_add_trash_retention_deadlines.sql`
12. `20260828130631_add_transcript_chat.sql`
13. `20260828131010_add_transcript_chat_schema.sql`
14. `20260904140126_harden_manual_ai_job_recovery.sql`

The baseline is not the complete current schema by itself. The complete source contract is the baseline plus all thirteen forward migrations.

Apply the chain with the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

For a local disposable database:

```bash
supabase start
supabase db reset
```

Use `supabase db push` only for a fresh target or a target whose migration history has already been explicitly reconciled with this chain. Existing targets must be inspected before applying only their missing forwards. Schema parity and migration-ledger parity are separate facts.
## What The Migrations Create

- application tables for recordings, transcripts, jobs, prompts, AI outputs and audit logs,
- RLS policies for user-owned data,
- private Storage bucket settings for `recordings`, including a safe 50 MB baseline limit and Soniox-compatible MIME types; the app reads both `file_size_limit` and `allowed_mime_types` at runtime and fails closed when either is unavailable,
- seed prompt templates,
- provider configuration for Soniox, OpenAI and optional Gemini,
- evidence locations, recording organization, live markers and indexed transcript search,
- status-aware V2 recording list/search RPCs and exact status facets,
- per-user text overrides for the six system AI prompts with revision-safe save/reset RPCs and exact processing-job snapshots,
- least-privilege prompt-override grants, a locked-down validator trigger function and a reverse-FK index for system prompt references,
- persistent transcript chat plus durable manual AI failure metadata, exact-lease claim/settlement and provider-free reconciliation,
- indexes used by recording detail, transcript processing and search screens.

## Deployment State

This public repository is the source contract, not a deployment ledger. It does not assert that any particular hosted Supabase project has applied the chain.

Every forward migration is treated as unverified on a target until that target completes its own ordered apply and postflight.

Before deploying application code to an existing target:

1. inspect its actual schema and `supabase_migrations.schema_migrations` history,
2. reconcile any legacy migration history explicitly,
3. apply only the missing migrations in order,
4. run the target-specific schema, grants, RLS and two-user postflight,
5. deploy the application only after the database contract is verified.

Do not reset an existing production database merely to make its history resemble this fresh-project chain. Schema parity and migration-history parity are separate facts.

The repository includes `npm run search:backfill`, but running it against a live database requires a separate operational decision. Migration `20260804130000` already contains an inline raw-text fallback backfill for existing non-empty transcripts.

## Current Recording And Prompt Contracts

The V1 recording list/search RPCs remain compatibility-only. The current UI uses the V2 RPCs, and status facets cover the complete current query, organization and tag scope while deliberately ignoring the active status. Deleted recordings remain a separate Trash count.

Users can override only the text of the same six system quick-action prompts. Output JSON schemas stay system-owned and read-only. Reset deactivates the override, and every AI processing job stores the exact effective prompt name, text, output schema, source and revision used for that run.

Prompt-override browser access is limited to `SELECT`, `INSERT` and `UPDATE` under forced owner RLS. The validator trigger function is not directly executable by browser roles, and `prompt_template_overrides(system_prompt_id)` has a reverse-FK index.

## Multiple Supabase Projects

Each deployment should use its own Supabase project. Future schema changes must be new timestamped migration files applied consistently to every target. Project-specific values belong in environment variables and Supabase project settings, never in this repository.
The same source chain is intended for private and public deployments, while project-specific values belong in Vercel environment variables and Supabase project settings. Each target still requires its own verified apply, postflight and compatible migration history.

## Self-hosting an existing Supabase target

This is the operational guide for a GitHub checkout connected to **your own** Supabase project. The database, Storage and `trash-retention` Edge Function use that same project. The worker is not a Vercel worker and this procedure does not use Vercel Cron or Vercel variables.

### 1. Choose the correct migration path

For a new empty project, review the source, link the intended target and run the normal CLI chain:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

For a disposable local database, use `supabase start` followed by `supabase db reset`. The CLI records the full fourteen-file chain in timestamp order.

An existing target with unknown or non-canonical history must first be inspected; apply reviewed migrations one at a time only after target-specific preflight is green. Never delete history rows, run `db reset`, or mark versions as applied merely to silence the CLI.

### 2. Mandatory preflight for an existing target

Run these read-only queries before applying the two latest migrations. Every query must return zero rows. Any row blocks the apply until a person reviews its lineage; do not deduplicate or delete data automatically.

```sql
-- Automatic-timeline unique output guard.
select
  processing_job_id,
  count(*) as output_count,
  array_agg(id order by created_at, id) as ai_output_ids
from public.ai_outputs
group by processing_job_id
having count(*) > 1
order by processing_job_id;

-- Prompt override uniqueness must already hold before its snapshots are used downstream.
select user_id, system_prompt_id, count(*) as override_count
from public.prompt_template_overrides
group by user_id, system_prompt_id
having count(*) > 1
order by user_id, system_prompt_id;

-- Trash rows must have one coherent old metadata snapshot before retention augments it.
select id, status, deleted_at, deleted_from_status, purge_started_at, purge_claim_id
from public.recordings
where (status = 'deleted' and (deleted_at is null or deleted_from_status is null))
   or (status <> 'deleted' and (deleted_at is not null or deleted_from_status is not null))
   or ((purge_started_at is null) <> (purge_claim_id is null));
```

Apply `20260827094435_add_automatic_timeline_idempotency.sql` first and `20260827100000_add_trash_retention_deadlines.sql` second, each as a separately reviewed action. Re-run the relevant preflight and complete the postflight below after each migration. A migration error is a stop condition, not a reason to alter production history.

### 3. Mandatory database postflight

On the same target, verify a valid `ai_outputs(processing_job_id)` unique index, `automatic_timeline_intents` forced RLS with no browser-role grants, all automatic-timeline and purge RPCs executable only by `service_role`, and `recordings_manage_trash_metadata()` revoked from `PUBLIC`, `anon` and `authenticated`. Confirm deleted rows have one of `24`, `168`, `720` retention hours and `purge_after = deleted_at + retention`; restored rows must have retention and claim metadata cleared. Store the target, timestamp and result with deployment evidence.

## Manual AI recovery migration

The source file is `supabase/migrations/20260904140126_harden_manual_ai_job_recovery.sql` with source SHA256 `048829215E3D80AA9AEAAA513FE39E5B1C2BCCD9CB4A42F934C9F2B611E3126D`. It is additive: it adds `failure_code`, `retry_after_at` and the service-role-only `claim_manual_ai_job_v1`, `settle_manual_ai_job_v1` and `reconcile_manual_ai_job_v1` RPCs. It does not rewrite or delete existing jobs. The presence of this source file is not evidence that any hosted target applied it.

Before applying it to an existing target, use a read-only administrative connection to verify the current `ai_processing_jobs` columns and constraints, the unique `ai_outputs(processing_job_id)` index, absence of duplicate output lineage, forced RLS/owner policy, existing grants and the exact migration ledger. Any conflict, duplicate output, unexpected browser-role grant or ambiguous legacy row blocks the apply.

Apply only the reviewed SQL file in one explicit transaction. Afterward, verify the new columns/checks and all three function signatures, `SECURITY INVOKER`, empty `search_path`, fully qualified object references, forced RLS preservation and `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated` and granted only to `service_role`. Do not change migration history merely to make a CLI command succeed.

Legacy or non-canonical manual jobs are outside the migration. The runtime returns `operator_required` instead of deleting them or repeating a provider call. Any row-level resolution requires separate target-specific inventory, approval and rollback-safe handling. Database apply/postflight, application deployment and live verification remain separate states.

## Trash retention Edge Function deployment

The source lives in `supabase/functions/trash-retention/`. It accepts only a scheduler request, claims at most 20 due recordings and processes exactly two claims concurrently. It validates the immutable `{user_id}/{recording_id}/` Storage prefix, uses only the Supabase Storage API, and finalizes a database row only after that prefix is empty.

### 1. Set secrets disabled-first and deploy

Generate a high-entropy token outside the repository and keep it out of shell history, screenshots and logs. Set it only in Edge Function secrets; Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function runtime. The Supabase Dashboard secret UI is a safe alternative. Never type the raw token after `TRASH_RETENTION_SCHEDULER_TOKEN=` into an interactive command.

```bash
# Bash: hidden prompt; shell history keeps only the variable expansion, not its value.
read -r -s -p 'Trash retention scheduler token: ' TRASH_RETENTION_SCHEDULER_TOKEN
printf '\n'
export TRASH_RETENTION_SCHEDULER_TOKEN
supabase secrets set "TRASH_RETENTION_SCHEDULER_TOKEN=$TRASH_RETENTION_SCHEDULER_TOKEN" TRASH_RETENTION_ENABLED=false --project-ref <your-project-ref>

supabase functions deploy trash-retention --project-ref <your-project-ref> --use-api
```

```powershell
# PowerShell: hidden prompt; only a temporary process environment variable is expanded.
$secureToken = Read-Host -AsSecureString 'Trash retention scheduler token'
$plainToken = [System.Net.NetworkCredential]::new('', $secureToken).Password
$env:TRASH_RETENTION_SCHEDULER_TOKEN = $plainToken
supabase secrets set "TRASH_RETENTION_SCHEDULER_TOKEN=$env:TRASH_RETENTION_SCHEDULER_TOKEN" TRASH_RETENTION_ENABLED=false --project-ref <your-project-ref>
Remove-Variable plainToken, secureToken -ErrorAction SilentlyContinue

supabase functions deploy trash-retention --project-ref <your-project-ref> --use-api
```

Do not add either retention secret to Vercel, an `.env` file or Git. The request token is compared through SHA-256 digests before the worker claims anything; its raw value is never returned. A database claim has its own UUID lease token, so a stale worker cannot finalize or release another worker's claim.

### 2. Verify the request boundary while disabled

Use `https://<your-project-ref>.functions.supabase.co/trash-retention`. Continue using the same temporary hidden-prompt variable from step 1; do not type the token in a command. The disabled-first PowerShell checks are:

```powershell
# GET is never a scheduler invocation.
curl.exe -i "https://<your-project-ref>.functions.supabase.co/trash-retention"

# POST without Authorization must be rejected before a claim.
curl.exe -i -X POST "https://<your-project-ref>.functions.supabase.co/trash-retention"

# Wrong bearer token must also be rejected before a claim.
curl.exe -i -X POST -H "Authorization: Bearer wrong-token" "https://<your-project-ref>.functions.supabase.co/trash-retention"

# Correct token is accepted but reports disabled and claims zero rows.
curl.exe -i -X POST -H "Authorization: Bearer $env:TRASH_RETENTION_SCHEDULER_TOKEN" "https://<your-project-ref>.functions.supabase.co/trash-retention"

# Remove the temporary process value after the disabled-first test.
Remove-Item Env:\TRASH_RETENTION_SCHEDULER_TOKEN -ErrorAction SilentlyContinue
```

For Bash, use `curl -i -X POST -H "Authorization: Bearer $TRASH_RETENTION_SCHEDULER_TOKEN" "https://<your-project-ref>.functions.supabase.co/trash-retention"` for the correct-token check, then run `unset TRASH_RETENTION_SCHEDULER_TOKEN`. Expected statuses are the same.

Expected statuses are `405`, `401`, `401`, then `200` with `{ "status": "disabled", "claimed": 0 }`. Do not enable yet. Verify the deployed function identity, service-only RPC grants, Storage prefix guard and sanitized aggregate logs first.

### 3. Enable only after an explicit backlog decision

The first enabled call can permanently delete every due recording and its private audio. There is no dry run. Decide explicitly whether the existing Trash backlog is allowed to be destroyed, then set the non-secret enable flag only after that approval:

```bash
supabase secrets set TRASH_RETENTION_ENABLED=true --project-ref <your-project-ref>
```

Emergency stop is immediate: disable the worker and then remove or pause its Cron job. A request already processing up to two claims may finish its current item.

```bash
supabase secrets set TRASH_RETENTION_ENABLED=false --project-ref <your-project-ref>
```

After a read-only review identifies the exact `trash-retention` job ID, remove only that schedule:

```sql
select cron.unschedule(<exact-trash-retention-job-id>);
```

### 4. Recover a row with exhausted attempts

Claims stop after five attempts. This worker has no target-only retry mode: turning the global enable flag back on can claim up to 20 other due rows. Do not reset `purge_attempt_count` or lease fields blindly.

First set `TRASH_RETENTION_ENABLED=false` and pause or delete the Cron schedule. For the exact recording ID, inventory the exact database row and canonical `{user_id}/{recording_id}/` Storage prefix using an administrative path. Keep the report sanitized: it may identify stable IDs and counts, but not titles, transcript content, object names or bearer tokens.

Choose exactly one recovery path after the inventory:

- Restore is allowed only when **all** expected audio objects are provably present and intact. Under one explicit transaction and row lock, a service-role administrative action must check the exact recording ID, owner ID, `status='deleted'`, expected prior status and `purge_attempt_count >= 5`. A non-null lease may be cleared only after its `purge_started_at` is at least 15 minutes stale; then clear the exact claim metadata and restore that same row.
- If any Storage object is missing, uncertain or partially deleted, restore is forbidden. Finish deleting only the remaining objects under that canonical prefix through the Supabase Storage API or Dashboard, verify the prefix is empty, then use the explicit guarded finalization below for that exact locked row.

The following **restore-only** template is deliberately inert until the operator replaces all placeholders after the Storage inventory. Run it only through the service-role administrative path; it does not retry the worker and it may run `commit;` only after verifying the returned row:

```sql
begin;
set local role service_role;

select id, user_id, status, deleted_from_status, purge_attempt_count, purge_claim_id, purge_started_at
from public.recordings
where id = '<recording-id>'::uuid
  and user_id = '<owner-id>'::uuid
  and status = 'deleted'::public.recording_status
  and deleted_from_status = '<expected-prior-status>'::public.recording_status
  and purge_attempt_count >= 5
  and purge_claim_id is not distinct from nullif('<expected-current-purge-claim-id-or-empty>', '')::uuid
  and (
    (purge_claim_id is null and purge_started_at is null)
    or (purge_claim_id is not null and purge_started_at <= statement_timestamp() - interval '15 minutes')
  )
for update;

-- The trigger rejects restore while OLD has a lease. Clear only an exact stale exhausted lease first.
update public.recordings
set
  purge_claim_id = null,
  purge_started_at = null,
  purge_attempt_count = 0
where id = '<recording-id>'::uuid
  and user_id = '<owner-id>'::uuid
  and status = 'deleted'::public.recording_status
  and deleted_from_status = '<expected-prior-status>'::public.recording_status
  and purge_attempt_count >= 5
  and purge_claim_id is not distinct from nullif('<expected-current-purge-claim-id-or-empty>', '')::uuid
  and (
    (purge_claim_id is null and purge_started_at is null)
    or (purge_claim_id is not null and purge_started_at <= statement_timestamp() - interval '15 minutes')
  )
returning id, user_id, purge_claim_id, purge_started_at, purge_attempt_count;

update public.recordings
set status = deleted_from_status
where id = '<recording-id>'::uuid
  and user_id = '<owner-id>'::uuid
  and status = 'deleted'::public.recording_status
  and deleted_from_status = '<expected-prior-status>'::public.recording_status
  and purge_attempt_count = 0
  and purge_claim_id is null
  and purge_started_at is null
returning id, user_id, status, deleted_at, trash_retention_hours, purge_after,
  purge_attempt_count, purge_claim_id, purge_started_at;
```

After exactly one returned row matches the pre-verified inventory, explicitly enter `commit;`. Otherwise enter `rollback;` and stop. A stale lease may be reclaimed only after its 15-minute boundary; that does not make a partially deleted prefix restorable.

For an empty prefix after the Storage cleanup, the service-role caller can use the existing exact-lease finalizer instead of globally enabling the worker. It must return `true`; any other result stops the operation and keeps the row:

```sql
begin;
set local role service_role;

with eligible as (
  select id, purge_claim_id
  from public.recordings
  where id = '<recording-id>'::uuid
    and user_id = '<owner-id>'::uuid
    and status = 'deleted'::public.recording_status
    and purge_attempt_count >= 5
    and purge_claim_id = '<exact-current-purge-claim-id>'::uuid
    and purge_started_at <= statement_timestamp() - interval '15 minutes'
  for update
)
select public.finalize_recording_purge_v1(eligible.id, eligible.purge_claim_id) as finalized
from eligible;
```

Zero eligible rows means the RPC was not called: enter `rollback;` and stop. Enter `commit;` only after exactly one finalizer result is `true`; otherwise enter `rollback;`.

If the exact claim is already null, do not manufacture one by globally enabling the worker. Use a separately approved transaction with `set local role service_role`, `FOR UPDATE`, the exact `id`, `user_id`, `status='deleted'`, `purge_attempt_count >= 5`, `purge_claim_id is null` and expected canonical `storage_path`, then delete only that returned row after a second empty-prefix check. Keep the approval and returned ID as the finalization evidence.

```sql
begin;
set local role service_role;

-- Run only after a second Storage API/Dashboard list proves this exact prefix empty.
select id, user_id, status, storage_path, purge_attempt_count, purge_claim_id
from public.recordings
where id = '<recording-id>'::uuid
  and user_id = '<owner-id>'::uuid
  and status = 'deleted'::public.recording_status
  and purge_attempt_count >= 5
  and purge_claim_id is null
  and purge_started_at is null
  and storage_path is not distinct from nullif('<expected-storage-path-or-empty>', '')
for update;

delete from public.recordings
where id = '<recording-id>'::uuid
  and user_id = '<owner-id>'::uuid
  and status = 'deleted'::public.recording_status
  and purge_attempt_count >= 5
  and purge_claim_id is null
  and purge_started_at is null
  and storage_path is not distinct from nullif('<expected-storage-path-or-empty>', '')
returning id, user_id;
```

Enter `commit;` only after exactly one returned row and the approval evidence are recorded; otherwise enter `rollback;`.

### 5. Schedule separately through Vault and Cron

Create the scheduler only after deployment, disabled-first tests, explicit enable approval and a reviewed runbook. Keep the raw token in Edge Function secrets and separately in Supabase Vault. The cron command must read the token from Vault at run time, never embed plaintext in `cron.job`.

Example administrator SQL, after placing the token in Vault under `trash-retention-scheduler-token` through an approved secret-entry workflow:

```sql
select cron.schedule(
  'trash-retention-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.functions.supabase.co/trash-retention',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'trash-retention-scheduler-token'
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Review the scheduled command before enabling it and grant Vault/Cron access only to the administrative execution role. This SQL is a deployment operation, deliberately not part of any Vosio migration. Do not create a schedule while the Edge Function is undeployed, disabled, or awaiting an approved backlog decision.
