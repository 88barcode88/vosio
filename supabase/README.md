# Supabase Setup

This folder contains the canonical database and Storage setup expected by Vosio.

## Fresh Project

A new empty project must apply every migration in timestamp order:

1. `20260617000000_initial_schema.sql`
2. `20260804100000_add_evidence_locations.sql`
3. `20260804110000_add_recording_organization.sql`
4. `20260804120000_add_recording_markers.sql`
5. `20260804130000_add_transcript_fulltext_search.sql`

The baseline is not the complete current schema by itself. The complete source contract is the baseline plus all four forward migrations.

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

- application tables for recordings, transcripts, jobs, prompts, AI outputs and audit logs
- RLS policies for user-owned data
- private Storage bucket settings for `recordings`, including a safe 50 MB baseline limit and Soniox-compatible MIME types; paid projects can raise the global and per-bucket limits, which the app reads at runtime
- seed prompt templates
- provider configuration for Soniox, OpenAI and optional Gemini
- evidence locations, recording organization, live markers and indexed transcript search
- indexes used by recording detail, transcript processing and search screens

## Deployment State

This public repository is the source contract, not a deployment ledger. It does not assert that any particular hosted Supabase project has applied the chain.

Before deploying application code to an existing target:

1. inspect its actual schema and `supabase_migrations.schema_migrations` history,
2. reconcile any legacy migration history explicitly,
3. apply only the missing migrations in order,
4. run the target-specific schema, grants, RLS and two-user postflight,
5. deploy the application only after the database contract is verified.

Do not reset an existing production database merely to make its history resemble this fresh-project chain. Schema parity and migration-history parity are separate facts.

The repository includes `npm run search:backfill`, but running it against a live database requires a separate operational decision. Migration `20260804130000` already contains an inline raw-text fallback backfill for existing non-empty transcripts.

## Multiple Supabase Projects

Each deployment should use its own Supabase project. Future schema changes must be new timestamped migration files applied consistently to every target. Project-specific values belong in environment variables and Supabase project settings, never in this repository.
