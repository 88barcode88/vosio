# Environment Variables

## Local development

Local secrets live in `.env.local`. This file is ignored by git and must not be committed.

Tracked template:

- `.env.example`

## Vercel

Add the same variables in Vercel project settings before deploying connected features.

## Production Vercel baseline

Vosio production currently expects the required variables below. `GEMINI_API_KEY` is optional unless Gemini models are enabled for real use. This is the deployment baseline for a new maintainer cloning the repo.

| Variable | Required for | Why it exists |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL used by auth, database, and storage clients. It is browser-safe. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser | Publishable Supabase key for client-side authenticated access. RLS still controls rows and storage objects. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged server-side writes for transcription jobs, transcript persistence, AI jobs, signed storage access, and live transcript saves. Never expose it to the browser. |
| `SONIOX_API_KEY` | Server only | Creates async transcription jobs and mints temporary realtime keys. Never expose it to the browser. |
| `SONIOX_REGION` | Server only | Selects the Soniox regional API endpoint. Use `eu` only with an EU Soniox project key. Leave empty/delete for a US Soniox project. |
| `SONIOX_TEMP_KEY_EXPIRES_SECONDS` | Server only | Controls how long a temporary browser key can be used to establish the Soniox WebSocket connection. Current operational value: `60`. |
| `OPENAI_API_KEY` | Server only | Runs OpenAI AI processing over completed transcripts. Models are selected in the app, not through Vercel. |
| `GEMINI_API_KEY` | Server only, optional | Required only when the app user selects a Gemini model for AI processing. Never expose it to the browser. |

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

`SONIOX_API_BASE_URL`

- Optional Soniox REST API base URL.
- Defaults to `https://api.soniox.com`.
- Use the documented regional API URL only when the deployment requires data residency.

`SONIOX_REGION`

- Optional Soniox region alias.
- Defaults to the US/global Soniox endpoint when empty.
- Use `eu` only with an EU Soniox project API key.

`SONIOX_ASYNC_MODEL`

- Optional async transcription model.
- Defaults to `stt-async-v5`.

`SONIOX_TEMP_KEY_EXPIRES_SECONDS`

- Optional lifetime for browser-safe Soniox temporary keys.
- Defaults to `60`.
- You can delete this from Vercel if the default is acceptable.
- This is only the time window for connecting to Soniox after the key is minted, not the recording duration.

`SONIOX_STT_WS_URL`

- Optional Soniox realtime websocket URL.
- Use only for documented regional routing, for example EU data residency.

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

### App behavior constants

`RECORDINGS_BUCKET`

- Not a runtime environment variable.
- The Storage bucket name is a code constant in `src/lib/recordings/types.ts`.
- Current value: `recordings`.

`recordings.file_size_limit`

- Not a runtime environment variable.
- `/recordings/new` reads `file_size_limit` from the private Supabase Storage bucket `recordings` through the server-only admin client.
- The detected positive integer is passed to the browser for UI copy, pre-upload validation and the live-audio cutoff. Supabase Storage remains the final enforcement boundary.
- The baseline migration creates the bucket with `52428800` bytes (50 MB). A paid project can raise both its global Storage limit and this per-bucket limit; the application adopts the new bucket value after the page is refreshed.
- If the bucket or a positive explicit limit cannot be read, audio upload and audio-backed live mode are disabled. Live transcript-only and transcript import remain available.

`LIVE_RECORDING_AUDIO_BITS_PER_SECOND`

- Not a runtime environment variable.
- The requested MediaRecorder bitrate is a code constant in `src/lib/recordings/types.ts`.
- Current value: `128000` bits per second.
- The browser uses the actual recorder bitrate to estimate when live audio reaches the limit read from `recordings.file_size_limit`. At that point audio capture is discarded while realtime transcription continues.

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

The app uses `@supabase/ssr` with cookie-backed sessions. The Next.js `proxy.ts` refreshes sessions before protected routes render.

Do not enable public sign-up in the application UI unless the access model is redesigned first.

`NEXT_PUBLIC_APP_URL` is intentionally not required. Auth redirects and callbacks use the current request URL, so the deployed domain belongs in Supabase Auth settings, not in app runtime config.
