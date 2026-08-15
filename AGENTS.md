# AGENTS.md

## What this project is

Vosio is a Next.js PWA for recording or uploading calls, transcribing them with Soniox, organizing recordings, and producing structured AI outputs. It uses Supabase Auth, Postgres, and private Storage.

## Users and purpose

The application is intended for authenticated users who need searchable call transcripts, recording organization, speaker metadata, timelines, and reusable AI processing actions.

## What is out of scope

- This repository is source code, not a deployment ledger for any hosted Supabase or Vercel target.
- Never commit provider keys, Supabase secrets, production data, or private deployment identifiers.
- License and redistribution boundaries are defined by `LICENSE.md`.

## Working rules

- Preserve the public repository's independent Git history and public-safe documentation.
- Add database changes as timestamped forward migrations; never reset a production database to match the baseline.
- Keep RLS, ownership checks, and server-side secret boundaries intact.
- Update current documentation when behavior changes.
- Before completion, run `npm.cmd run check` and `npm.cmd run build`; run focused E2E checks when the changed behavior requires them.

## Documentation

- Architecture: `docs/architecture.md`
- Conventions: `docs/conventions.md`
- Gotchas: `docs/gotchas.md`
- Database contract: `docs/api/supabase-schema.md`
- Product requirements: `docs/requirements/`
- Decisions: `docs/decisions/`
