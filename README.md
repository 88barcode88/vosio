# Vosio

Vosio is a Next.js PWA for recording or uploading audio, storing recordings in Supabase, transcribing with Soniox, and generating AI outputs from saved transcripts.

This is the canonical public source repository. It contains source code, documentation, tests, CI, and the complete fresh-project Supabase migration chain, but no real API keys or production data.

Current source release: `0.1.7`

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F88barcode88%2Fvosio&project-name=vosio&repository-name=vosio&env=NEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY%2CSUPABASE_SERVICE_ROLE_KEY%2CSONIOX_API_KEY%2COPENAI_API_KEY&envDescription=Vosio%20requires%20your%20own%20Supabase%2C%20Soniox%2C%20and%20OpenAI%20projects.&envLink=https%3A%2F%2Fgithub.com%2F88barcode88%2Fvosio%23vercel-environment-variables)

## Stack

- Next.js App Router
- Supabase Auth, Postgres, and private Storage
- Soniox speech-to-text
- OpenAI for post-transcription AI processing by default, with optional Gemini support
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

## Deploy With Vercel

The button above copies this public repository into your own GitHub, GitLab, or Bitbucket account and creates a separate Vercel project. You do not need to download the repository manually.

Before the deployment is usable:

1. Create your own Supabase project.
2. Apply the complete migration chain from `supabase/migrations/` with `supabase db push`.
3. Create a Soniox project and use its API key.
4. Fill the required environment variables in Vercel. Add `GEMINI_API_KEY` only if you want Gemini processing in addition to the default OpenAI processing.

The deployment uses your own Supabase, Soniox, Vercel, and optional AI-provider accounts. No keys or hosted services are supplied by this repository.

The copied repository is independent. Upstream Vosio updates do not automatically appear in your copy; sync or redeploy them deliberately.

## One Installation Flow

Vosio supports one self-hosted installation flow: each person or company runs its own Vercel deployment and connects its own Supabase, Soniox, and AI credentials. The owner controls the data, provider accounts, access, and resulting provider costs. Secrets belong only in `.env.local` or the deployment platform, never in git.

Choose the Soniox region per user in **Settings**, not through a deployment variable. Global is the default. EU requires an EU-enabled Soniox project and matching regional key; if EU access or authentication fails, contact `support@soniox.com`.

## Supabase

Supabase setup, migration safety gates and the self-hosted Edge Function runbook live in [`supabase/README.md`](supabase/README.md).

For a disposable or newly reviewed project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

The ordered migration chain creates the application schema, RLS policies, private `recordings` Storage bucket settings, indexes, system prompt templates, automatic-timeline idempotency, and Trash-retention deadlines. For a fresh project, `supabase db push` applies the complete chain. Existing projects require target-specific preflight, reviewed manual apply when their ledger is not canonical, and postflight; do not copy the private Vosio ledger workaround as a generic installation method.

The optional `trash-retention` Edge Function is a Supabase worker in that same project, not a Vercel worker. Its disabled-first secret, deploy, verification, Vault/Cron scheduling, emergency-stop and exhausted-claim recovery procedure is in [`supabase/README.md`](supabase/README.md#trash-retention-edge-function-deployment). It must not be enabled or scheduled until a separate backlog-deletion approval.

The app expects:

- private Storage bucket `recordings`
- RLS enabled on user-owned tables
- Supabase Auth email/password users
- server-only service role usage for transcription, AI processing, signed Storage access, and recovery operations

For multiple deployments, connect each Vercel project to its own Supabase project. The code stays identical; only Vercel environment variables and Supabase project refs differ.

### Storage plan preference

The real upload boundary comes from the explicit `file_size_limit` of your private `recordings` bucket. In Vosio Settings, each signed-in user can choose `Auto`, `Free`, or `Paid` for their own account:

- `Auto` uses the detected bucket limit without adding a plan cap and is the recommended default.
- `Free` can only lower the effective limit to the Free-plan cap.
- `Paid` can only lower the effective limit to the Paid-plan cap.

This preference never changes your Supabase subscription, global project limit, or bucket configuration. The deployment owner configures Supabase once; each application user controls only their own preference.

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

Add these in Vercel Project Settings before deployment. Put real values only in Vercel or `.env.local`, never in git. If both Vercel Production and Preview must be fully functional, configure the same required variable names in both environments. When their values point to the same provider projects, Preview works with the same data and incurs the same provider costs as Production.

| Variable | Required | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser and server Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Browser-safe Supabase key; RLS still protects rows. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only privileged Supabase writes, signed Storage access, recovery, jobs. |
| `SONIOX_API_KEY` | Yes | Server-only async transcription and temporary realtime key creation. |
| `OPENAI_API_KEY` | Yes | Server-only default AI processing provider. |
| `GEMINI_API_KEY` | Optional | Required when users select Gemini AI processing. |

The Soniox region is selected in the app. Temporary realtime keys have a fixed internal 60-second connection window; this is not configurable and does not limit recording duration.

Environment changes require a redeploy on Vercel or a local process restart. Supabase Auth redirect configuration for Production and Preview, plus safe diagnostics, are documented in `docs/api/environment.md`.

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
