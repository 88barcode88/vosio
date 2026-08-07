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
5. In `Audio do {efektivní live limit} + přepis` mode, the browser records one local audio file. Its hard live limit is `min(effective manual upload limit, 128 MiB)`, and the finalized Blob is uploaded on stop only after validation against that hard limit.
6. The browser estimates an earlier cutoff at `hard live limit - min(5% of hard live limit, 2 MiB)`. When the estimate reaches that cutoff, or the user selects `Jen live přepis`, local audio is discarded while realtime transcription continues and saves the final transcript without a Storage audio object.
7. The final live transcript is stored in `transcripts` and linked to a realtime `transcription_jobs` row. The job `provider_config.storage` records whether the source was `supabase_recording_upload` or `transcript_only`.

Live language selection is separate from audio retention and speaker identification:

- The supported live options are `auto`, `cs`, `en`, `de`, `es`, `it`, `sk`, `sl`, `hu`, and `pl`.
- `auto` enables Soniox language identification and omits both `language_hints` and `language_hints_strict`.
- A selected language sends one matching `language_hints` value with `language_hints_strict = true`.
- `enable_speaker_diarization` stays enabled in both modes. Language hints are provider guidance/best effort, not an absolute guarantee that every token uses the selected language.
- The default is stored in `user_metadata.vosio_settings.sonioxRealtimeLanguage`, with `auto` as the fallback for legacy or invalid metadata.
- The full recorder can override the default while idle before a call starts. The selected value is fixed for that capture session; changing the setting later applies to a future call.
- This contract is live-only. Manual audio uploads and their async Soniox transcription continue using the existing async configuration and do not inherit the live override.

The root `PersistentRecordingSessionProvider` owns the real `BrowserRecorder`. Leaving `/recordings/new` through an internal Next.js navigation removes only the full slot and moves the same recorder instance into the compact dock; capture, Soniox, MediaRecorder, marker clock and stop ownership continue without restart. On mobile the dock must stay above the actual `MobileNav`, and its stop and marker controls must remain separately clickable.

## Live Recording Markers

The live marker button appears in both the full recorder and compact dock, but is enabled only after the current Soniox capture is active and the exact `recordings` draft exists. Readiness starts one monotonic `performance.now()` boundary. A marker offset is the rounded monotonic delta clamped to the inclusive `0..86400000` ms schema range; it is not derived from `Date.now()`, elapsed UI text or Soniox token timestamps.

Every new live marker attempt uses a browser-generated UUID and currently sends `markerType = important` with `note = null`. The schema and API also support `task`, `decision` and `follow_up`, plus a trimmed nullable note up to 280 characters. `POST /api/recordings/{recordingId}/markers` validates a strict UUID recording id and payload, authenticates the user, verifies an owned non-deleted recording, and inserts through authenticated Supabase RLS.

The first insert returns `201`. A unique conflict on `(user_id, client_marker_id)` returns the existing marker with `200` only if recording, user, UUID, offset, type and note all exactly match. Reusing the UUID with a changed field returns `409`. On a transport, validation or persistence failure, the recorder remains active and the same immutable attempt is retained for retry; a marker error must not change capture lifecycle, timer, transcript or stop state.

The recording detail loads markers once for the active recording through RLS and orders them by `offset_ms`, then `id`. `Označené momenty` renders before AI chapters. Without an active transcript marker actions are disabled with explanatory copy. With a transcript, a direct click rejects cross-recording or cross-transcript targets, opens the transcript tab and chooses the block containing the marker point or a deterministic nearest block. `single` audio seeks once and plays from the direct click. `none` and legacy `segmented` perform only scroll/highlight and never fetch, seek or play audio. Loading the detail or timeline never creates autoplay intent.

Recorder lifecycle ownership is generation-scoped. Provider callbacks are accepted only for the current start session; final Soniox results remain accepted during graceful stop only for its exact result session; every asynchronous save step checks the exact stop owner. Stop waits up to five seconds for its pending draft. If an audio-backed draft settles after timeout, only that exact late row is failed. If transcript-only stop already has text, its exact late draft can complete once in the background and no fallback duplicate row is created. Stale callbacks, marker responses and stop settlements must not mutate a newer recording session.

## Recording Organization

The source implementation lets an authenticated user organize recordings by client/company, project, one flat folder and multiple tags. A project always belongs to exactly one client; selecting a project without its client or combining a project with another client is invalid. Folders are intentionally flat and independent of clients/projects. A recording may have zero or one client, project and folder and any number of tags.

The compact organization manager creates and renames the user's clients, projects, folders and tags. The recording editor replaces all four assignment dimensions atomically. Every compact create, rename and assignment editor follows save-collapse behavior: submit keeps the editor open and blocks duplicate/dismiss actions while pending; only a confirmed success for the current editor scope collapses it and returns focus; a validation, auth, transport or database error keeps the draft visible with an inline error. Switching to another recording must ignore a late settlement from the previous scope.

Deletion is explicit and constrained. A client cannot be deleted while it still owns projects or is assigned to recordings. Deleting a project keeps the client on each recording and clears only the project. Deleting a flat folder clears only the folder. Deleting a tag or recording removes its tag links. Names are trimmed and case-insensitively unique per user, with project names unique within their client.

The recordings list exposes canonical URL filters `client`, `project`, `folder` and repeatable `tag` alongside `q`. Invalid, foreign, repeated single-value or client/project-mismatched values are removed from the canonical URL; repeated valid tags are deduplicated. Client, project, folder and tag choices navigate immediately while preserving `q` and unrelated URL parameters; changing the client clears an incompatible project. Search navigates after a 350 ms debounce only when its normalized value is empty or has at least three characters. During a navigation transition organization controls are disabled without discarding their draft, while the search field stays usable; a committed canonical URL settles the transition on the same component instance, and an unchanged canonical target does not push another navigation.

Selected tags use ALL semantics: every returned recording must contain every selected tag. Without `q`, the list RPC returns only the current user's non-deleted rows in `created_at desc, id desc` order. The client reads all organization pages using the stable `(created_at, id)` keyset cursor with identical filters, deduplicates an overlapping boundary and rejects a stalled cursor or later-page error. With `q`, the separate indexed search RPC applies the same organization filters before ranking and uses its own bounded page/offset contract described below.

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

The effective manual upload limit is `min(recordings.file_size_limit, optional per-user plan cap)`. The baseline migration uses a `52428800`-byte (50 MiB) bucket limit; the `free` preference adds a 50 MiB cap, `paid` adds a 500 GiB cap and `auto` adds no cap. A preference can only lower the bucket limit, never raise it or authorize Storage. The global project limit cannot be detected safely and is displayed as unknown. Audio paths fail closed when a positive explicit bucket limit cannot be read. Live audio has a hard limit of `min(effective manual upload limit, 128 MiB)`, an estimated cutoff below it by `min(5% of the hard live limit, 2 MiB)`, and a final Blob validation against the full hard limit.

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

AI processing lets the user choose one current AI model per run. The model selector includes model purpose, provider and indicative token pricing for `gpt-5.6-sol` (xhigh, $5/$30), `gpt-5.6-terra` (high, $2/$12), `gpt-5.6-luna` (xhigh, $0.20/$1.20) and `gemini-3.6-flash` (thinking medium, $1.50/$7.50) per 1M input/output tokens. The selected model is stored in `ai_processing_jobs.model`, the selected provider in `ai_processing_jobs.provider`, and the effective `reasoning_effort` or `thinking_level` in `ai_processing_jobs.provider_config`. The current catalog does not expose temperature because these model configurations do not use it. Model size and reasoning can affect extraction completeness even when the prompt and JSON schema are identical: smaller, cheaper models may miss details, tasks or evidence. Evidence fields remain required by the contract, but users should review important outputs against the transcript; Sol or Terra are preferred for complex calls. Prices are estimates and provider billing remains authoritative. When an AI run starts, the tab must show a visible running state. The same output type can be started again while an earlier run is still pending, because users may want another pass with different settings.

Tasks extracted by AI are stored as checklist rows with owner category (`Moje práce`, `Klient`, `Nejasné`), optional owner name, deadline, status and evidence quote. Toggling a task updates `transcript_tasks.status` through a server action and RLS. The AI tab groups checklist rows by owner category, shows evidence quotes inline, and keeps raw markdown artifacts collapsed when normalized rows exist. The markdown output remains available for review/export, but task state belongs to the normalized table.

## AI Evidence Navigation

Tasks, decisions and risks show `Otevřít v přepisu` only when the app has a complete safe evidence range. The server never trusts milliseconds supplied by the AI provider. It normalizes the quote with NFC, Czech locale case folding, collapsed whitespace and Unicode punctuation removal while preserving accents, symbols and compatibility characters. It searches the full saved Soniox token stream for one exact contiguous whole-token match. Repeated/ambiguous, partial, non-contiguous, missing-timestamp or unmatched quotes keep their text but receive no action.

For legacy tasks and decisions with a quote and null times, `TranscriptTabs` derives a runtime-only location from `activeTranscript.segments`. Risks receive the same fallback only when they have a quote. The derived objects do not mutate server props and are never persisted. If evidence spans speakers, navigation first prefers a block containing the whole range and otherwise the block containing `startMs`; start membership is `[start, end)`, so an exact boundary selects the new block rather than the previous ended block. If no speaker block can own the start, the tab still opens and eligible single audio seeks to the exact time without inventing a highlight.

Direct-click evidence navigation requests play only for eligible single audio. With `none` or `segmented`, the same click performs transcript scroll/highlight without player activity. A mismatched `transcriptId` is rejected before either navigation or seek.

Search results use the one-shot deep-link contract `tab=transcript&at=<ms>&highlight=<query>`. The server and browser reject duplicate values, non-canonical or out-of-range `at` values and empty/overlong highlights. Timestamp resolution selects the containing speaker block, otherwise the next timed block, otherwise the nearest prior block. A transcript without renderable speaker blocks may use the raw-text anchor. Highlight-only navigation is allowed only for exactly one normalized match across the whole renderable transcript; an ambiguous or missing match stays visible as a search result excerpt but must not create a false highlight. A timestamp may still navigate without a highlight if the query is not in the selected block.

The URL target never creates autoplay. With `single` audio it performs at most one seek with `play: false`; with `none` or legacy `segmented` it performs only transcript scroll/highlight. After the target is staged, the client removes only `at` and `highlight` through `history.replaceState`, preserving `tab`, unrelated query parameters and the current browser history state.

The action-items prompt treats `decisions_to_confirm` as unresolved confirmations only. Already agreed choices belong to `decided_items`, tasks or risks so the UI can show them as agreed decisions instead of open confirmations. The prompt explicitly checks short mentions of Customer Portal, permissions, documents, email templates and process-stage decisions because these often create product follow-up items.

Live recording uses the Soniox realtime model and default language stored in app settings. The current selectable realtime STT model is `stt-rt-v5`; the live language contract is documented above. No setting for warning after a number of recording minutes is part of the active recorder lifecycle.

The settings screen shows a compact read-only usage summary for the current month. It counts AI processing jobs from `ai_processing_jobs`, sums stored input/output token counts, estimates AI cost from the stored model id and the app's local model price map, and counts recordings from `recordings`. Total recording duration and file size are displayed only from rows that have `duration_seconds` or `file_size_bytes`; missing metadata is shown as incomplete coverage, not inferred. Soniox cost is an approximate app-side estimate from completed Soniox STT jobs and known recording durations: async transcription uses roughly `$0.10/h`, realtime uses roughly `$0.12/h`. Jobs without known duration are excluded from the estimate and shown as incomplete coverage. Provider dashboards remain the source of truth for billing.

Recording detail export is Markdown-first. The user can export or copy the whole recording, a working package, the transcript only, or one selected AI output. The working package includes recording metadata, transcript, raw AI outputs and normalized checklist/timeline/decision/risk rows. Each saved AI output also has local copy and Markdown download actions. Follow-up email outputs expose a `mailto:` action for the user's default browser/system mail handler; deeper Gmail/Zoho sending is a future integration and must not be faked in the UI.

## Indexed Recording Search

The recordings list supports URL-driven indexed PostgreSQL search through `q`. The query is whitespace-normalized, capped at 120 characters and interpreted by `websearch_to_tsquery('simple', ...)`; the UI does not build SQL syntax and must not load `raw_text` payloads into the list shell. Search covers the recording title, client, project, flat folder, tags and chunks derived from the latest transcript only. Latest means `created_at desc, id desc`, so a deterministic id tie-breaker is required everywhere the active transcript is selected.

`search_own_recordings_v1` is `SECURITY INVOKER` and returns only the authenticated user's non-deleted recordings. Client, project, folder and ALL-tag filters are applied before ranking. Transcript text and metadata use stored `tsvector` columns with GIN indexes. The RPC returns one winning row per recording with a bounded excerpt, optional safe timestamp and total count; it never returns the complete transcript.

Search results use bounded URL page numbers and RPC `limit/offset`, 25 rows per page. The no-query organization list still uses the stable descending `(created_at, id)` keyset. The service backfill is a third distinct flow and uses ascending transcript-id keyset batches. These pagination contracts must not be combined or described as one mechanism.

Precise transcript chunks are derived from the same consecutive renderable speaker groups as the UI. If no speaker groups can be rendered, one manual/raw-text fallback chunk without timestamps is used. A database trigger first keeps that raw fallback synchronized in the transcript write transaction; successful server-side indexing then atomically replaces it with precise chunks. If precise replacement fails, the transcript remains saved and searchable through the raw fallback. The user sees the stable nonfatal warning once; the notice removes only its own `warning=transcript_search_index_incomplete` parameter through `history.replaceState`, preserving other query parameters and browser history.

AI outputs can be deleted individually from the recording detail. Deleting an AI output removes stored generated content but keeps the processing job metadata available for usage accounting. Recordings use a two-step delete model: first soft-delete to Trash, then permanent delete from Trash, including the Storage object and cascading DB records. Delete actions must ask for confirmation and then update the visible UI optimistically while the server action finishes.

## Forward Migration Release Boundary

The complete source schema is the ordered chain `20260617000000_initial_schema.sql` -> evidence `20260804100000` -> organization `20260804110000` -> markers `20260804120000` -> transcript search `20260804130000`. The baseline alone is not the complete source of truth. This public repository is not a deployment ledger and does not assert the migration state of any hosted target. Release order is evidence, organization, markers, transcript search, successful database postflight on the target database, then application deploy.

For every unverified target, validate the actual evidence/organization/marker/search constraints, trigger and indexes, authenticated GIN `EXPLAIN`, grants, forced RLS, anon-vs-auth and cross-tenant isolation, current-vs-old transcript selection, manual/raw/deleted search behavior, runtime keyset/offset pagination and any required backfill. Do not deploy application code using a forward contract before the target has an explicitly approved apply and successful postflight. Source tests, `npm run check` and production build are not evidence of a successful Supabase migration.

The repository exposes `npm run search:backfill` with explicit disposable/live safety flags, bounded transcript-id keyset batches and a dry-run option. Running it against a live target is a separate operational decision; migration `13000` already includes an inline raw-text fallback backfill.

Development browser tests must run through `npm run test:e2e`. The outer runner creates one guarded temporary Next workspace under repo `.tmp`, copies only an explicit application allowlist and passes the exact owned path to Playwright. The config rejects direct unguarded Playwright execution, starts its own isolated server with `reuseExistingServer: false`, and cleanup may remove only the validated temp child. The runner does not discover or terminate unrelated processes or listeners.

## Not Yet Implemented

- Webhook or background worker ingestion for automatic Soniox completion.
- Background-safe chunked browser recording for very long mobile sessions.
- Signed upload URL orchestration.

The UI must show these as pending real workflow states, not as fake transcript or AI data.
