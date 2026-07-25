# Supabase Setup

This folder contains the database and storage setup expected by Vosio.

## Fresh Project

The `supabase/migrations` folder contains a single baseline migration for fresh projects. It represents the current schema and replaces the earlier development migration chain.

Apply it with the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

For a local development database:

```bash
supabase start
supabase db reset
```

## What The Migrations Create

- application tables for recordings, transcripts, jobs, prompts, AI outputs, and audit logs
- RLS policies for user-owned data
- private Storage bucket settings for `recordings`, including a safe 50 MB baseline limit and Soniox-compatible MIME types; paid projects can raise the global and per-bucket limits, which the app reads at runtime
- seed prompt templates
- provider configuration for Soniox, OpenAI, and optional Gemini
- indexes used by recording detail and transcript processing screens

## Multiple Supabase Projects

Each deployment should use its own Supabase project. For future schema changes, create a new migration file after the baseline and apply the same migration to every deployment. Project-specific values belong in Vercel environment variables and Supabase project settings.

## Existing Production Projects

Do not reset an existing production database to this baseline unless you intentionally plan a data migration. Existing production projects can keep their historical `supabase_migrations.schema_migrations` entries as long as the actual schema matches the baseline.

Before pushing future migrations to an existing project, check:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

The important rule is that new migrations after this baseline should be identical across all Supabase projects.
