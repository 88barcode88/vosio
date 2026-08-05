# Real Workspace

## Current Behavior

The authenticated workspace loads real `recordings` rows from Supabase for the current user.

When the user uploads an audio file:

1. The browser validates MIME type and size.
2. The app creates a `recordings` row with status `uploading`.
3. The file uploads directly to the private Supabase Storage bucket `recordings`.
4. The storage path uses `{user_id}/{recording_id}/{timestamp-filename}`.
5. The app updates the row to status `uploaded`.
6. The workspace refreshes and shows the real recording.

When the user starts transcription:

1. The app calls `POST /api/recordings/{recordingId}/transcription`.
2. The server verifies ownership through Supabase Auth and RLS.
3. The server creates a short-lived signed URL for the private Storage object.
4. The server creates a Soniox async transcription job with model `stt-async-v5`.
5. The app stores the provider job and provider configuration in `transcription_jobs`.
6. The recording moves to status `transcribing`.

When the user checks transcription:

1. The app calls `GET /api/recordings/{recordingId}/transcription`.
2. The server polls Soniox.
3. The job status is mapped into `queued`, `running`, `done`, or `failed`.
4. Completed transcripts are stored in `transcripts`.
5. The workspace refreshes and displays the saved transcript text.

When a recording is in status `transcribing`, the client also polls the same `GET` endpoint automatically about every 15 seconds while the detail view is open. The request uses `cache: "no-store"` so the browser does not reuse stale status responses. The UI shows that Soniox is processing on the provider side, the last check time, and the latest returned job status. This is a foreground convenience poll, not a durable background worker.

When a completed transcript contains Soniox token-level `speaker` fields, the transcript tab groups consecutive tokens by speaker and displays one compact transcript table with columns for time, speaker, and text. Each speaker gets a stable color class. The speaker summary above the table lets the user save a manual speaker name and business role (`client_customer`, `delivery_team`, or `unknown`) into `transcripts.speakers`; the compact speaker editor scrolls internally when a call has many speakers, so 8+ speakers do not push the whole detail page down. If the provider did not return speaker ids, the UI falls back to the plain `raw_text` transcript.

## Private Audio Playback

The recording detail renders a player only when safe client metadata says `audioAvailability = single`, meaning `recordings.storage_path` points to one concrete Storage object. `none` means there is no audio object. `segmented` means a legacy `/live/` prefix with multiple objects; those recordings remain supported for recovery/retranscription but are not exposed as one playable source.

For a single object the browser calls `GET /api/recordings/{recordingId}/audio`. The route requires a valid Supabase Auth user, queries the recording with both `id` and `user_id`, and returns a 300-second HTTP(S) signed URL only after ownership and eligibility checks. The raw DB `storage_path` is not returned as a separate field or metadata, but the Supabase signed URL contains the encoded object path. Security therefore relies on auth and ownership checks, the private bucket, the signed token and its short expiry rather than path secrecy. Opaque path secrecy would require a media proxy.

`Cache-Control: private, no-store` applies to the JSON API envelope, including error responses, not to the Storage media response or its cache metadata. Uploads currently set Storage `cacheControl` to 3600 seconds. The 300-second signed-token lifetime limits authorization for later URL use; it is not a prohibition on caching audio that was already fetched.

Loading the detail, switching tabs and fetching the signed URL must never create play intent. Only a direct user click on a transcript timestamp or `Otevřít v přepisu` requests playback. If metadata is not ready, the controller may execute that same explicit intent after `loadedmetadata`; this remains click-initiated playback, not autoplay. Transcript-only and segmented recordings still switch tabs and, when a renderable transcript block exists, scroll and highlight evidence without any audio fetch or seek.

When the user records live in the browser:

1. The app asks for microphone permission.
2. The server issues a short-lived Soniox temporary API key for realtime websocket transcription.
3. The browser streams microphone audio directly to Soniox through the Web SDK.
4. The UI displays live transcript tokens.
5. In `Audio do {aktuální limit bucketu} + přepis` mode, the browser records one local audio file and uploads it on stop only when the whole file stays within the detected `recordings.file_size_limit`.
6. If live audio reaches the detected limit, or the user selects `Jen live přepis`, the app continues realtime transcription and saves the final transcript without a Storage audio object.
7. The final live transcript is stored in `transcripts` and linked to a realtime `transcription_jobs` row. The job `provider_config.storage` records whether the source was `supabase_recording_upload` or `transcript_only`.

## Supported Upload Types

- `audio/aac`
- `audio/aiff`
- `audio/amr`
- `audio/asf`
- `audio/flac`
- `audio/mp4`
- `audio/mpeg`
- `audio/ogg`
- `audio/wav`
- `audio/webm`
- `audio/x-aiff`
- `audio/x-m4a`
- `application/vnd.ms-asf`
- `video/x-ms-asf`
- `video/mp4`

Maximum file size is read from the explicit `file_size_limit` of the `recordings` bucket. The baseline migration uses `52428800` bytes for Free projects; paid projects may raise both the global Storage limit and the bucket limit. Audio paths fail closed when the bucket limit cannot be read.

## AI Prompt Templates

The database contains system `prompt_templates` for these `ai_processing_type` values:

- `summary`
- `action_items`
- `meeting_minutes`
- `timeline_chapters`
- `crm_note`
- `follow_up_email`
- `custom_prompt`

System templates have `is_system = true` and `user_id = null`. Authenticated users can read them through RLS together with their own non-system templates, but cannot create, update, or delete system templates.

System templates are global defaults for a processing type, not user-owned content. The AI worker resolves them server-side, substitutes `{{raw_text}}`, `{{segments}}`, `{{speakers}}`, `{{metadata}}`, and `{{custom_prompt}}`, and keeps compatibility aliases `{{transcript_text}}`, `{{transcript}}`, and `{{transcript_segments}}`. `output_schema` documents the expected JSON shape for the prompt and provider request. Runtime currently parses JSON when possible and stores parsed output in `ai_outputs.output_json`; strict JSON Schema validation is a future hardening step and must not be claimed as active behavior until implemented. User-created templates stay separate with `is_system = false` and `user_id = auth.uid()`, even when they use the same `processing_type`.

The system AI outputs use a JSON + markdown contract. JSON is the source of truth for the app and automation; the `markdown` field is the human-readable UI/copy version.

After a JSON AI output is saved into `ai_outputs`, the backend derives normalized workspace rows. Action items and meeting minutes can create `transcript_tasks`, `transcript_decisions`, and `transcript_risks`; timeline processing creates `transcript_chapters`. These tables let the UI show a real checklist, compact decision/risk sections, and persisted content chapters without reparsing markdown on every render. Existing AI output cards remain visible because `ai_outputs` is still the raw provider artifact and fallback. Authenticated users can read their own projection rows and can update only `transcript_tasks.status`; content projection changes are created by server-side AI processing.

System prompts distinguish participant roles when the transcript or metadata supports it. `client_customer` means customer, client, prospect, buyer, or external stakeholder. `delivery_team` means supplier, consultant, developer, implementation partner, account manager, support, or internal delivery team. Numeric diarization labels such as `Speaker 1` are preserved but are not enough to infer the role.

The `/templates` workspace separates user-owned templates from the system library. User-owned templates are editable and update through RLS with `is_system = false` and the authenticated `user_id`. System templates are shown in read-only controls with a copy action; submitting the copy action inserts a new user-owned template with the same prompt data, which can then be edited as a custom template.

AI processing lets the user choose one current AI model per run. The model selector includes model purpose, provider and indicative token pricing for `gpt-5.6-terra`, `gpt-5.6-luna` and `gemini-3.6-flash`. The selected model is stored in `ai_processing_jobs.model`, the selected provider in `ai_processing_jobs.provider`, and the effective `reasoning_effort` or `thinking_level` in `ai_processing_jobs.provider_config`. The current catalog does not expose temperature because these model configurations do not use it. When an AI run starts, the tab must show a visible running state. The same output type can be started again while an earlier run is still pending, because users may want another pass with different settings.

Tasks extracted by AI are stored as checklist rows with owner category (`Moje práce`, `Klient`, `Nejasné`), optional owner name, deadline, status and evidence quote. Toggling a task updates `transcript_tasks.status` through a server action and RLS. The AI tab groups checklist rows by owner category, shows evidence quotes inline, and keeps raw markdown artifacts collapsed when normalized rows exist. The markdown output remains available for review/export, but task state belongs to the normalized table.

## AI Evidence Navigation

Tasks, decisions and risks show `Otevřít v přepisu` only when the app has a complete safe evidence range. The server never trusts milliseconds supplied by the AI provider. It normalizes the quote with NFC, Czech locale case folding, collapsed whitespace and Unicode punctuation removal while preserving accents, symbols and compatibility characters. It searches the full saved Soniox token stream for one exact contiguous whole-token match. Repeated/ambiguous, partial, non-contiguous, missing-timestamp or unmatched quotes keep their text but receive no action.

For legacy tasks and decisions with a quote and null times, `TranscriptTabs` derives a runtime-only location from `activeTranscript.segments`. Risks receive the same fallback only when they have a quote. The derived objects do not mutate server props and are never persisted. If evidence spans speakers, navigation first prefers a block containing the whole range and otherwise the block containing `startMs`; start membership is `[start, end)`, so an exact boundary selects the new block rather than the previous ended block. If no speaker block can own the start, the tab still opens and eligible single audio seeks to the exact time without inventing a highlight.

Direct-click evidence navigation requests play only for eligible single audio. With `none` or `segmented`, the same click performs transcript scroll/highlight without player activity. A mismatched `transcriptId` is rejected before either navigation or seek.

The action-items prompt treats `decisions_to_confirm` as unresolved confirmations only. Already agreed choices belong to `decided_items`, tasks or risks so the UI can show them as agreed decisions instead of open confirmations. The prompt explicitly checks short mentions of Customer Portal, permissions, documents, email templates and process-stage decisions because these often create product follow-up items.

Live recording uses the Soniox realtime model stored in app settings. The current selectable realtime STT model is `stt-rt-v5`.

The settings screen shows a compact read-only usage summary for the current month. It counts AI processing jobs from `ai_processing_jobs`, sums stored input/output token counts, estimates AI cost from the stored model id and the app's local model price map, and counts recordings from `recordings`. Total recording duration and file size are displayed only from rows that have `duration_seconds` or `file_size_bytes`; missing metadata is shown as incomplete coverage, not inferred. Soniox cost is an approximate app-side estimate from completed Soniox STT jobs and known recording durations: async transcription uses roughly `$0.10/h`, realtime uses roughly `$0.12/h`. Jobs without known duration are excluded from the estimate and shown as incomplete coverage. Provider dashboards remain the source of truth for billing.

Recording detail export is Markdown-first. The user can export or copy the whole recording, a working package, the transcript only, or one selected AI output. The working package includes recording metadata, transcript, raw AI outputs and normalized checklist/timeline/decision/risk rows. Each saved AI output also has local copy and Markdown download actions. Follow-up email outputs expose a `mailto:` action for the user's default browser/system mail handler; deeper Gmail/Zoho sending is a future integration and must not be faked in the UI.

The recordings list supports URL-driven search through `q`. Current search is intentionally lightweight and filters loaded recording rows by title, status, source and MIME type. Searching inside complete transcript text is a future fulltext feature that needs a DB index/RPC and must not load raw transcript payloads into the list shell.

AI outputs can be deleted individually from the recording detail. Deleting an AI output removes stored generated content but keeps the processing job metadata available for usage accounting. Recordings use a two-step delete model: first soft-delete to Trash, then permanent delete from Trash, including the Storage object and cascading DB records. Delete actions must ask for confirmation and then update the visible UI optimistically while the server action finishes.

## Evidence Migration Release Boundary

The source tree contains `20260804100000_add_evidence_locations.sql`, and unit/component/E2E tests cover its SQL contract, deterministic resolver and user-visible navigation. The migration is not applied to any disposable, staging or live database in this work. Real SQL parse, paired-null constraints, unchanged grants, forced RLS and two-user isolation remain unverified at the database level.

Do not deploy application code that inserts or selects the new evidence columns before an explicitly approved migration apply and postflight. Source/test verification is not evidence of a successful Supabase migration.

## Not Yet Implemented

- Webhook or background worker ingestion for automatic Soniox completion.
- Background-safe chunked browser recording for very long mobile sessions.
- Signed upload URL orchestration.

The UI must show these as pending real workflow states, not as fake transcript or AI data.
