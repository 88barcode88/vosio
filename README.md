# Vosio

Vosio is a Next.js PWA for recording or uploading audio, storing recordings in Supabase, transcribing with Soniox, and generating AI outputs from saved transcripts.

This is the canonical public source repository. It contains source code, documentation, tests, CI, and the complete fresh-project Supabase migration chain, but no real API keys or production data.

## Stack

- Next.js App Router
- Supabase Auth, Postgres, and private Storage
- Soniox speech-to-text
- OpenAI by default, with optional Gemini support
- TypeScript, Zod, Vitest, Playwright

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment template:

```bash
copy .env.example .env.local
```

3. Fill `.env.local` with your own Supabase and provider keys. Do not commit real secrets.

4. Run the app:

```bash
npm.cmd run dev
```

The local app runs on `http://127.0.0.1:3047`.

## Supabase

Supabase setup lives in `supabase/`.

For a new project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

The timestamp-ordered migration chain creates the application schema, RLS policies, private `recordings` Storage bucket settings, indexes, and system prompt templates.

The app expects:

- private Storage bucket `recordings`
- RLS enabled on user-owned tables
- Supabase Auth email/password users
- server-only service role usage for transcription, AI processing, signed Storage access, and recovery operations

For multiple deployments, connect each Vercel project to its own Supabase project. The code stays identical; only Vercel environment variables and Supabase project refs differ.

## Branch Workflow

- `main` is the stable public production branch.
- `dev` is the integration branch for upcoming changes.
- Feature and fix branches should target `dev`.
- Promote tested changes from `dev` to `main`.

```bash
git clone https://github.com/88barcode88/vosio.git
git switch dev
```

Never commit `.env.local`, Supabase service role keys, Soniox keys, OpenAI keys, Gemini keys, or Vercel project metadata.

## Vercel Environment Variables

Add these in Vercel Project Settings before deployment. Put real values only in Vercel or `.env.local`, never in git.

| Variable | Required | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser and server Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Browser-safe Supabase key; RLS still protects rows. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only privileged Supabase writes, signed Storage access, recovery, jobs. |
| `SONIOX_API_KEY` | Yes | Server-only async transcription and temporary realtime key creation. |
| `SONIOX_REGION` | Optional | Use `eu` only for an EU Soniox project; leave empty for the default endpoint. |
| `SONIOX_TEMP_KEY_EXPIRES_SECONDS` | Optional | Temporary realtime key connection window. Defaults to `60`. |
| `OPENAI_API_KEY` | Optional | Required when users run OpenAI AI processing. |
| `GEMINI_API_KEY` | Optional | Required when users select Gemini AI processing. |

Advanced optional Soniox variables are documented in `docs/api/environment.md`.

Do not add `SUPABASE_SERVICE_ROLE_KEY`, `SONIOX_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` with a `NEXT_PUBLIC_` prefix. Anything prefixed `NEXT_PUBLIC_` is shipped to the browser.

## Useful Commands

```bash
npm.cmd run check
npm.cmd run build
npm.cmd run test:e2e
```

`check` runs typecheck, lint, and unit tests.

`test:e2e` runs the Playwright smoke test. It does not need a real account, but `.env.local`
must contain a syntactically valid `NEXT_PUBLIC_SUPABASE_URL` and a non-empty
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, otherwise the auth middleware fails before the
login redirect that the test asserts.

## Support Development

Vosio is provided for free use under the repository license. The `Kup mi kafe` link is voluntary support for the author; it is not required for using, deploying, or self-hosting the app, and it does not unlock any features.

[Kup mi kafe](https://donate.stripe.com/3cI7sLdRHaWJ1Lke48dZ602)

## Documentation

- `DESIGN.md` captures the design direction.
- `docs/architecture.md` describes the current system architecture.
- `docs/conventions.md` covers project conventions.
- `docs/gotchas.md` lists important operational edge cases.
- `docs/api/supabase-schema.md` documents the intended Supabase schema.

## License

See `LICENSE.md`.

Short version: you may use, modify, deploy, and share Vosio for free, including with other people. You may not sell it, resell it, charge for access to it, offer it as a paid SaaS/managed service, or white-label it without written permission.
