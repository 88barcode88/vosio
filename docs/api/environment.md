# Environment Variables

## Local development

Local secrets live in `.env.local`. This file is ignored by git and must not be committed.

Tracked template:

- `.env.example`

## Vercel

Vosio has one installation model: each person or company deploys its own application and supplies its own Supabase, Soniox, and AI credentials. There is no shared credential pool or separate supported staging installation flow.

Add the variables below in Vercel project settings before deploying connected features. Production and Preview use the same required variable names when both environments should be fully functional. If both scopes point to the same Supabase and provider projects, Preview uses the same data and creates the same provider costs as Production. An owner may choose different values, but the application setup and required names do not change.

Environment changes are read when the app is built or started. Redeploy or restart the application after adding or changing them.

## Vercel baseline

Vosio expects the required variables below. `GEMINI_API_KEY` is optional unless Gemini models are enabled for real use.

| Variable | Required for | Why it exists |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL used by auth, database, and storage clients. It is browser-safe. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser | Publishable Supabase key for client-side authenticated access. RLS still controls rows and storage objects. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged server-side writes for transcription jobs, transcript persistence, AI jobs, signed storage access, and live transcript saves. Never expose it to the browser. |
| `SONIOX_API_KEY` | Server only | Creates async transcription jobs and mints temporary realtime keys. Never expose it to the browser. |
| `OPENAI_API_KEY` | Server only | Runs OpenAI AI processing over completed transcripts. Models are selected in the app, not through Vercel. |
| `GEMINI_API_KEY` | Server only, optional | Required only when the app user selects a Gemini model for AI processing. Never expose it to the browser. |

## Safe configuration diagnostics

- Before Supabase can initialize, `/configuration` shows only missing public Supabase variable names and the coarse environment label. It never imports a Supabase client or displays values.
- After authentication, **Settings -> Technical information** shows readiness, the environment label, optional Gemini presence, and missing required names only. It never displays secret values, prefixes, lengths, or hashes.
- Diagnostics do not apply environment changes. Redeploy or restart after fixing the hosting configuration.

## Variables

### Browser-safe

`NEXT_PUBLIC_SUPABASE_URL`

- Required.
- Supabase project URL.
- Safe for browser use.

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

- Required.
- Supabase publishable/anon key for browser clients.
- Safe for browser use when RLS is correct.

### Server-only

`SUPABASE_SERVICE_ROLE_KEY`

- Required for server-side transcription, live transcript persistence, AI job writes, and signed Storage access.
- Server-only Supabase service role key.
- Never expose to client components or `NEXT_PUBLIC_*`.
- Use only in server routes/workers for privileged job operations.

`SONIOX_API_KEY`

- Required for Soniox async transcription and realtime temporary key minting.
- Server-only Soniox API key.
- Used for transcription job creation and realtime temporary key minting.

`SONIOX_ASYNC_MODEL`

- Optional async transcription model.
- Defaults to `stt-async-v5`.

`OPENAI_API_KEY`

- Required only for AI processing.
- Server-only OpenAI API key.
- Used for OpenAI AI processing.
- App model options include `gpt-5.6-sol` with reasoning `xhigh`, `gpt-5.6-terra` with reasoning `high` and `gpt-5.6-luna` with reasoning `xhigh`; the selected model is stored as a safe user preference and sent only server-side. Indicative prices are $5/$30, $2/$12 and $0.20/$1.20 per 1M input/output tokens respectively; provider billing remains the source of truth. For complex calls prefer Sol or Terra and review generated tasks/evidence against the transcript because smaller, cheaper models can miss details even with the same prompt and schema.

`GEMINI_API_KEY`

- Optional.
- Required only when users select Gemini models in `/settings` or the recording AI tab.
- Server-only Google Gemini API key.
- Current Gemini option is `gemini-3.6-flash` with thinking level `medium` and an indicative price of $1.50/$7.50 per 1M input/output tokens; provider billing remains the source of truth.
- Paid Gemini API content is not used to improve Google's products according to the current Google AI pricing/data-use table; do not use Gemini Free tier for sensitive production call content.

### App-managed model preferences

`sonioxRegion` (app-managed preference)

- Selected per user in **Settings** and stored in Supabase Auth `user_metadata.vosio_settings`.
- **Global** is the default for legacy, missing, or invalid metadata.
- **EU** routes both realtime and new async jobs to the EU endpoints. Each async job stores its chosen region so later polling keeps the original route.
- EU requires an EU-enabled Soniox project and matching regional key. If EU access or authentication fails, contact `support@soniox.com`.
- Region is not selected through a Vercel environment variable.

The browser-safe Soniox temporary key has a fixed internal connection lifetime of 60 seconds. It is not configurable. The lifetime controls how soon the browser must establish its realtime connection after minting; it does not cap the duration of an established recording.

`SONIOX_REALTIME_MODEL`

- Not needed as a Vercel runtime variable.
- Realtime STT model is a safe user preference in `/settings`.
- Current default is `stt-rt-v5`.
- Soniox async transcription remains on the current `stt-async-v5` model.

`sonioxRealtimeLanguage` (app-managed preference)

- Not a runtime environment variable and must not contain a provider key.
- Stored in Supabase Auth `user_metadata.vosio_settings` with `auto` as the fallback default.
- Supported live values are `auto`, `cs`, `en`, `de`, `es`, `it`, `sk`, `sl`, `hu` and `pl`.
- `auto` enables Soniox language identification and omits language hints. A fixed value sends one strict hint for that language.
- The full recorder offers an idle-only per-recording override; it is captured at start and does not mutate an active session.
- This preference applies only to live microphone recording. Manual file uploads keep the existing async Soniox configuration.
- Speaker diarization remains enabled in both automatic and fixed-language live modes.

### Supabase Edge Function secrets for Trash retention

`TRASH_RETENTION_SCHEDULER_TOKEN`

- Custom high-entropy bearer token stored only in Supabase Edge Function secrets.
- The worker compares the complete token in constant time and fails closed before any claim for missing or invalid authorization.
- This is not a Vercel variable and no example value belongs in the repository.

`TRASH_RETENTION_ENABLED`

- The worker performs claims only when the secret value is exactly `true`; missing, empty or any other value means disabled.
- Keep it disabled until the source migration has been separately applied and postflighted, the function has been deployed to the same Supabase project, and a scheduler has been explicitly approved.

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the Edge Function runtime. `trash-retention` uses those same-project values for its service-only RPC and Storage API calls. Its local function config disables the Supabase JWT gateway because the opaque scheduler credential is not a user JWT; the function's own complete-token check is therefore the mandatory fail-closed request boundary. The repository contains only source: this work does not set secrets, deploy the function, enable it or create a schedule.

### App behavior constants

`RECORDINGS_BUCKET`

- Not a runtime environment variable.
- The Storage bucket name is a code constant in `src/lib/recordings/types.ts`.
- Current value: `recordings`.

`recordings.file_size_limit`

- Not a runtime environment variable.
- `/recordings/new` reads `file_size_limit` from the private Supabase Storage bucket `recordings` through the server-only admin client.
- The detected positive integer is combined with the optional per-user `auto`, `free` or `paid` plan cap. The effective manual upload limit is `min(bucket limit, optional user plan cap)` and is passed to the browser for UI copy and pre-upload validation. Supabase Storage remains the final enforcement boundary.
- The global project limit cannot be detected safely and is displayed as unknown. The application never treats an unknown global limit as unlimited.
- The baseline migration creates the bucket with `52428800` bytes (50 MiB). A paid project can change its global and per-bucket limits outside the application, but after refresh the app uses the bucket value only as one input to the effective minimum.
- If the bucket or a positive explicit limit cannot be read, audio upload and audio-backed live mode are disabled. Live transcript-only and transcript import remain available.

`LIVE_RECORDING_AUDIO_BITS_PER_SECOND`

- Not a runtime environment variable.
- The requested MediaRecorder bitrate is a code constant in `src/lib/recordings/types.ts`.
- Current value: `128000` bits per second.
- The hard live-audio limit is `min(effective manual upload limit, 128 MiB)`. The browser uses the actual recorder bitrate to estimate an earlier cutoff at `hard live limit - min(5% of hard live limit, 2 MiB)`; when that estimate reaches the cutoff, local audio capture is discarded while realtime transcription continues. After `stop()`, any finalized Blob is still validated against the full hard live limit before upload.

## Rules

- Only variables prefixed with `NEXT_PUBLIC_` may be read by browser code.
- Provider keys and service role keys must be imported only by server-only modules.
- Do not log full env objects.
- Do not add real values to `.env.example`.

## Supabase Auth

Vosio uses Supabase Auth with email and password for internal users.

Runtime requirements:

- Email provider enabled in Supabase Auth.
- Users are created manually in Supabase Auth, not through public app registration.
- Local Site URL: `http://localhost:3047`.
- Local callback URL: `http://localhost:3047/auth/callback`.
- Production Site URL: `https://<your-app>.vercel.app` (your deployment domain).
- Production callback URL: `https://<your-app>.vercel.app/auth/callback`.
- Add every stable custom domain and Production callback to Supabase Auth redirect URLs.
- For Vercel Preview, add `https://*-<team-or-account-slug>.vercel.app/**` to the Supabase Auth redirect URLs, replacing the placeholder with the deployment owner slug. This is the current [Supabase-documented Vercel wildcard callback](https://supabase.com/docs/guides/auth/redirect-urls#vercel-preview-urls); keep the pattern scoped to the project owner. Preview deployments must be covered before password or email callback flows can return to them.

The app uses `@supabase/ssr` with cookie-backed sessions. The Next.js `proxy.ts` refreshes sessions before protected routes render.

Do not enable public sign-up in the application UI unless the access model is redesigned first.

`NEXT_PUBLIC_APP_URL` is intentionally not required. Auth redirects and callbacks use the current request URL, so the deployed domain belongs in Supabase Auth settings, not in app runtime config.
