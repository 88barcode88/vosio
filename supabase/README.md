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

The baseline is not the complete current schema by itself. The complete source contract is the baseline plus all eight forward migrations.

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
