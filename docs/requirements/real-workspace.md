# Real Workspace

## Current Behavior

The authenticated workspace loads real `recordings` rows from Supabase for the current user.

## Installation and provider region

Vosio has one installation flow: each person or company deploys its own application and supplies its own Vercel, Supabase, Soniox, and AI credentials. The required environment variable names are identical in Vercel Production and Preview when both scopes are enabled as fully functional deployments. Reusing the same values means both scopes use the same data and provider costs; this is an owner decision inside the same installation flow, not a second supported staging mode.

The Soniox region is selected per user in **Settings**. **Global** is the default for missing, legacy, or invalid metadata. **EU** requires an EU-enabled Soniox project and matching regional key. If EU access or authentication fails, the UI directs the owner to `support@soniox.com`. Both realtime and new async transcription use the selected region; an async job stores the selected region in `provider_config` and all later polling keeps that stored route. The temporary realtime key connection lifetime is fixed internally at 60 seconds and is not configurable; it does not limit an established recording.

Before Supabase initialization, `/configuration` may show only the environment label and missing public Supabase variable names. After authentication, **Settings -> Technical information** may show the environment, readiness, optional Gemini presence, and missing required names only. Neither surface may expose values, prefixes, lengths, hashes, or full environment objects. Environment changes require a Vercel redeploy or local restart.

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

If Soniox rejects creation of a regular job or any job in a segmented batch, or a later provider poll rejects or returns terminal failure, only that job or complete current batch becomes `failed`. The recording returns to `uploaded`; its `storage_path`, MIME, byte size and duration remain unchanged, so an explicit retry creates a fresh job or batch. API and stored recording copy are stable and do not expose provider details.

When a completed transcript contains Soniox token-level `speaker` fields, the transcript tab groups consecutive tokens by speaker and displays one compact transcript table with columns for time, speaker, and text. Each speaker gets a stable color class. The speaker summary above the table lets the user save a manual speaker name and business role (`client_customer`, `delivery_team`, or `unknown`) into `transcripts.speakers`; the compact speaker editor scrolls internally when a call has many speakers, so 8+ speakers do not push the whole detail page down. If the provider did not return speaker ids, the UI falls back to the plain `raw_text` transcript.

## Private Audio Playback

The recording detail renders a player only when safe client metadata says `audioAvailability = single`, meaning `recordings.storage_path` points to one concrete Storage object. `none` means there is no audio object. `segmented` means a legacy `/live/` prefix with multiple objects; those recordings remain supported for recovery/retranscription but are not exposed as one playable source.

For a single object the browser calls `GET /api/recordings/{recordingId}/audio`. The route requires a valid Supabase Auth user, queries the recording with both `id` and `user_id`, and returns a 300-second HTTP(S) signed URL only after ownership and eligibility checks. The raw DB `storage_path` is not returned as a separate field or metadata, but the Supabase signed URL contains the encoded object path. Security therefore relies on auth and ownership checks, the private bucket, the signed token and its short expiry rather than path secrecy. Opaque path secrecy would require a media proxy.

`Cache-Control: private, no-store` applies to the JSON API envelope, including error responses, not to the Storage media response or its cache metadata. Uploads currently set Storage `cacheControl` to 3600 seconds. The 300-second signed-token lifetime limits authorization for later URL use; it is not a prohibition on caching audio that was already fetched.

Loading the detail, switching tabs and fetching the signed URL must never create play intent. Only a direct user click on a transcript timestamp or `Otevřít v přepisu` requests playback. If metadata is not ready, the controller may execute that same explicit intent after `loadedmetadata`; this remains click-initiated playback, not autoplay. Transcript-only and segmented recordings still switch tabs and, when a renderable transcript block exists, scroll and highlight evidence without any audio fetch or seek.

When the user records live in the browser:

1. The user selects exactly one mode: `Audio do {efektivní live limit} + live přepis`, `Jen audio do {efektivní live limit}`, or `Jen live přepis`.
2. Audio modes ask for microphone permission once. A session master stream yields isolated archive and Soniox clones; the rotating safety recorder creates its own clone. Provider stop, error, cancel, or restart never owns the archive.
3. Combined and transcript-only request a short-lived Soniox key and display live tokens. Audio-only skips the realtime key/provider and requests async transcription only after confirmed audio upload.
4. Audio modes use the selected 32, 64, or 96 kbit/s archive/safety quality (14.4, 28.8, or 43.2 decimal MB/hour); Soniox encoding is independent. Mode, language, and quality remain locked for the active generation.
5. The archive MediaRecorder, authoritative track mute/unmute/ended/error state, advisory RMS monitor, and provider health are reported separately. Unavailable or suspended Web Audio is monitor-unavailable, not proof of silence.
6. Every 15 seconds the safety recorder finalizes one part, atomically persists it to IndexedDB, then queues bounded idempotent upload without blocking capture. Normal stop awaits the last part/promotion, finalizes the continuous archive, confirms exact metadata, then removes remote safety parts before local cleanup.
7. Reaching the conservative hard-limit estimate stops and finalizes the whole audio generation with reason `audio_limit`; it never discards audio while continuing realtime. Transcript-only is unaffected.
8. If combined realtime becomes terminally unhealthy, confirmed audio remains primary and async fallback starts only after upload, using restart-safe job creation. Reconnecting alone is nonterminal during capture but requires fallback if still unhealthy at stop.
9. The final transcript is persisted after audio finalization. STT failure never removes confirmed audio; if every audio path fails, the latest visible transcript must settle before the recording is marked failed or the UI must truthfully retain unresolved local state.

If the single archive upload fails but every safety part is confirmed remotely, metadata is promoted to segmented storage and segmented async transcription starts. A local-only generation remains a recoverable draft. IndexedDB quota failure downgrades crash protection with a warning while archive recording continues.

Safety parts use exactly `part-000000.webm` or `part-000000.m4a`: lowercase, six digits and zero-based. Every browser formatter and server Storage listing shares one parser/validator. Unrelated objects are ignored, but duplicate indexes, mixed extensions or any gap return safe `409`; accepted parts are always processed in numeric order.

Live language selection is separate from audio retention and speaker identification:

- The supported live options are `auto`, `cs`, `en`, `de`, `es`, `it`, `sk`, `sl`, `hu`, and `pl`.
- `auto` enables Soniox language identification and omits both `language_hints` and `language_hints_strict`.
- A selected language sends one matching `language_hints` value with `language_hints_strict = true`.
- `enable_speaker_diarization` stays enabled in both modes. Language hints are provider guidance/best effort, not an absolute guarantee that every token uses the selected language.
- The app does not cap the rendered speaker list at four; it preserves every provider speaker id, up to the Soniox per-session maximum of 15.
- A realtime result appends only finalized tokens and replaces the current provisional token window. A real SDK reconnect promotes the last provisional window, starts a new session index and offsets its timestamps onto the recording-wide timeline. Returning to a visible tab must not restart a healthy session.
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

`/recordings/new` presents exactly two primary capture cards: live first and file upload second. They are equal desktop columns above 900 px and stack in the same order at 900 px and below. Transcript import is a secondary, default-collapsed disclosure rather than a third primary card. A regular desktop uses `.content-area-document` as its one vertical scroll owner; a short desktop up to 640 px high and mobile use the browser document as the one owner so the sidebar and bottom import controls remain reachable. No mode may add body-plus-content double scroll or horizontal overflow. The upload card keeps one persistent status surface for selected file metadata, the effective limit, transfer progress, finalization, success, cancellation, safe error copy and retry. Drag/drop and the single filtered picker enter the same authenticated serial upload queue; production single-file success still redirects to recording detail. The guarded development fixture may replace only the live and transcript-import presentation slots with inert local controls; production defaults and upload lifecycle remain unchanged.

- `audio/flac`
- `audio/x-flac`
- `audio/m4a`
- `audio/mp4`
- `audio/mp3`
- `audio/mpeg`
- `application/ogg`
- `audio/ogg`
- `audio/vnd.wave`
- `audio/wav`
- `audio/x-wav`
- `audio/webm`
- `audio/x-m4a`
- `video/webm`
- `video/mp4`

The effective manual upload limit is `min(recordings.file_size_limit, optional per-user plan cap)`. The baseline migration uses a `52428800`-byte (50 MiB) bucket limit; the `free` preference adds a 50 MiB cap, `paid` adds a 500 GiB cap and `auto` adds no cap. A preference can only lower the bucket limit, never raise it or authorize Storage. The global project limit cannot be detected safely and is displayed as unknown. Audio paths fail closed when either a positive explicit bucket limit or a non-empty explicit bucket MIME allowlist cannot be read. Live audio requests the selected 32/64/96 kbit/s quality, has a hard limit of `min(effective manual upload limit, 128 MiB)`, stops the whole audio generation at its conservative estimate, and validates the finalized Blob against the full hard limit.

The product accepts the common groups M4A, MP3, WAV, WebM, OGG, FLAC and MP4. The effective format set is their intersection with the runtime Supabase bucket MIME rules; broader bucket entries such as legacy AAC, AIFF, AMR or ASF do not automatically become product upload formats. Browser MIME values are normalized before allowlist validation. Common aliases may map only from an explicit MIME to a canonical type allowed by the bucket. File extensions are picker hints, never an authorization fallback: an empty MIME or `application/octet-stream` is rejected even for `.m4a`. File-size validation accepts the exact effective-limit boundary and rejects only `size > limit`; a concrete `audio/mp4` 33 MiB M4A is valid under a 50 MiB effective limit. The transcription endpoint revalidates the stored MIME before sending a single uploaded object to Soniox; legacy segmented recordings retain their separate compatibility path.

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

System templates are global authoritative bases for a processing type, not user-owned content. For the six quick actions, `prompt_templates.processing_type`, `name` and `output_schema` remain immutable system data. `prompt_template_overrides` stores at most one owner-scoped revisioned `prompt_text` override per base and contains no schema column. Save/reset use `SECURITY INVOKER`, `auth.uid()`, forced RLS and expected revision; reset deactivates the override instead of rewriting the system row. Legacy arbitrary user templates remain stored but are outside this UI phase.

The AI worker resolves the effective prompt server-side, substitutes `{{raw_text}}`, `{{segments}}`, `{{speakers}}`, `{{metadata}}`, and `{{custom_prompt}}`, and keeps compatibility aliases `{{transcript_text}}`, `{{transcript}}`, and `{{transcript_segments}}`. The browser sends only model and processing type, never a prompt id, schema or user id. The resolver always combines effective text with the system `output_schema`. Runtime currently parses JSON when possible and stores parsed output in `ai_outputs.output_json`; strict JSON Schema validation is a future hardening step and must not be claimed as active behavior until implemented.

The system AI outputs use a JSON + markdown contract. JSON is the source of truth for the app and automation; the `markdown` field is the human-readable UI/copy version.

After a JSON AI output is saved into `ai_outputs`, the backend derives normalized workspace rows. Action items and meeting minutes can create `transcript_tasks`, `transcript_decisions`, and `transcript_risks`; timeline processing creates `transcript_chapters`. These tables let the UI show a real checklist, compact decision/risk sections, and persisted content chapters without reparsing markdown on every render. Existing AI output cards remain visible because `ai_outputs` is still the raw provider artifact and fallback. Authenticated users can read their own projection rows and can update only `transcript_tasks.status`; content projection changes are created by server-side AI processing.

System prompts distinguish participant roles when the transcript or metadata supports it. `client_customer` means customer, client, prospect, buyer, or external stakeholder. `delivery_team` means supplier, consultant, developer, implementation partner, account manager, support, or internal delivery team. Numeric diarization labels such as `Speaker 1` are preserved but are not enough to infer the role.

The stable `/templates` workspace is labeled `AI prompty` and renders exactly the six existing quick-action prompts: `summary`, `action_items`, `timeline_chapters`, `meeting_minutes`, `crm_note`, and `follow_up_email`. Each editor keeps the system UUID selected, edits only prompt text, displays output type/schema read-only, and shows `Výchozí` or `Upravený`. `Obnovit výchozí` requires confirmation, deactivates the override and returns the system text without changing historical output attribution.

AI processing lets the user choose one current AI model per run. The model selector includes model purpose, provider and indicative token pricing for `gpt-5.6-sol` (xhigh, $5/$30), `gpt-5.6-terra` (high, $2/$12), `gpt-5.6-luna` (xhigh, $0.20/$1.20) and `gemini-3.6-flash` (thinking medium, $1.50/$7.50) per 1M input/output tokens. The selected model is stored in `ai_processing_jobs.model`, the selected provider in `ai_processing_jobs.provider`, and the effective `reasoning_effort` or `thinking_level` in `ai_processing_jobs.provider_config`. The current catalog does not expose temperature because these model configurations do not use it. Model size and reasoning can affect extraction completeness even when the prompt and JSON schema are identical: smaller, cheaper models may miss details, tasks or evidence. Evidence fields remain required by the contract, but users should review important outputs against the transcript; Sol or Terra are preferred for complex calls. Prices are estimates and provider billing remains authoritative. When an AI run starts, the tab must show a visible running state. The same output type can be started again while an earlier run is still pending, because users may want another pass with different settings.

Each manual run uses a browser-generated UUID as the exact job id and reuses it for one transport retry. The processing route authenticates the owner, returns an existing same-owner/same-transcript identity before charging the in-memory rate limit again, snapshots the effective prompt, inserts a queued job with null `started_at`, registers Next.js `after()` work and returns `202` before provider settlement. The post-response owner atomically claims only queued manual work, checks for an existing raw artifact before provider execution and stores stable safe failure copy. Leaving the detail never aborts the potentially accepted POST; returning reconstructs queued, running, done, failed and derived stalled state from the server.

Recording detail server rendering does not query AI output bodies or normalized projections. AI/timeline/export share one transcript-scoped lazy state. The metadata request is bounded and excludes prompts, provider configuration, transcript content and historical bodies. AI loads only the newest default-open body; older cards load their exact body and rows when expanded. Timeline loads its newest timeline artifact. Transcript-only export remains local and immediate, while recording/workspace/single-AI export hydrates the AI artifacts it actually includes. Polling uses one in-flight request, pauses while hidden, performs one deduplicated focus catch-up, uses 2-second cadence for 30 seconds and 5-second cadence afterward, and stops after terminal state, transcript change, unmount or ten minutes.

Tasks extracted by AI are stored as checklist rows with owner category (`Moje práce`, `Klient`, `Nejasné`), optional owner name, deadline, status and evidence quote. Toggling a task updates `transcript_tasks.status` through a server action and RLS. The AI tab groups checklist rows by owner category, shows evidence quotes inline, and keeps raw markdown artifacts collapsed when normalized rows exist. The markdown output remains available for review/export, but task state belongs to the normalized table.

The prompt workspace uses `template=<system uuid>` for one selected editor. Duplicate, conflicting or unknown values resolve to the list surface. Desktop keeps the list next to the editor; mobile shows either the list or a dedicated editor with Back. Advanced processing type and output-schema fields are closed by default and omitted from submitted `FormData`. While save or reset is pending, every fieldset and prompt navigation are locked so the visible draft cannot diverge from the server snapshot. Validation, stale revision and unexpected failures unlock and keep the exact mounted draft with only a sanitized message.

Every new `ai_processing_jobs` row stores the exact resolved system id, optional override id, source, name, prompt text, system schema and revision before the provider call, with `prompt_snapshot_exact=true`. Migrated historical jobs are explicitly `prompt_snapshot_exact=false`. Resetting or updating a prompt never rewrites prior job snapshots or output attribution.

Settings has one dedicated `autoTimelineAfterTranscription` opt-in, default `false`. Legacy `autoProcessAfterTranscription` and `autoProcessingTypes` remain preserved metadata and never imply consent. After the preference is saved, each newly persisted async, segmented, live or imported transcript generation may create exactly one automatic `timeline_chapters` job using the user's then-current default model and effective timeline prompt. The job snapshots model, provider/reasoning configuration, prompt identity/text/system schema/revision before the provider call. Historical transcripts are not backfilled.

Automatic enqueue happens only after transcript persistence and recording completion persistence succeed. AI failure never rolls back the transcript. One database idempotency digest identifies the persisted generation without transcript text, title, email or user content; bounded attempts and a lease serialize concurrent reconciliation. Opening a completed recording detail performs one owner-authenticated reconcile request for an existing queued, retryable failed or stale job. Successful/terminal jobs do not regenerate after output deletion. There is no Vercel Cron, Supabase Cron or always-on AI worker; the six manual actions and their request/rate-limit contract remain unchanged and share the same provider/persistence service.

The secondary `/ai` archive loads whole generations through explicit RLS joins containing only output payload, processing type, transcript recording id and recording id/title/status. It must not load raw transcript text, segments, speakers, storage paths, provider configuration or provider errors. Canonical single-value URL filters are `type` and `recording`. Active recording links open `/recordings/<id>?tab=ai`; deleted recordings link to `/trash` and show `V koši`. Archive deletion removes a whole generation only. It does not expose deletion of inner e-mail, summary or checklist fragments, and it restores the exact optimistic card with sanitized feedback after an unexpected action rejection. Expected delete redirects preserve both filters and may render only allowlisted `error` codes; duplicate or unknown values are removed without being echoed.

## AI Evidence Navigation

Tasks, decisions and risks make the evidence quote itself clickable when the app can resolve a safe transcript target; they do not add a separate navigation button. The server never trusts milliseconds supplied by the AI provider. It normalizes the quote with NFC, Czech locale case folding, collapsed whitespace and Unicode punctuation removal while preserving accents, symbols and compatibility characters. It searches the full saved Soniox token stream for one exact contiguous whole-token match. Legacy evidence without stored timestamps may navigate through one unique normalized whole-phrase match in rendered speaker blocks or the raw transcript fallback. Repeated, ambiguous, partial, non-contiguous or unmatched quotes remain visible plain text and never create a guessed target.

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

The V1 RPCs `list_own_recordings_v1` and `search_own_recordings_v1` are compatibility-only. The current UI unconditionally uses `list_own_recordings_v2` without `q` and `search_own_recordings_v2` with a non-empty `q`. Both V2 RPCs are `SECURITY INVOKER`, return only the authenticated user's non-deleted recordings and apply the status, client, project, folder and ALL-tag filters before pagination or ranking. Transcript text and metadata use stored `tsvector` columns with GIN indexes. Search returns one winning row per recording with a bounded excerpt, optional safe timestamp and total count; it never returns the complete transcript.

Search results use bounded URL page numbers and RPC `limit/offset`, 25 rows per page. The no-query organization list still uses the stable descending `(created_at, id)` keyset. The service backfill is a third distinct flow and uses ascending transcript-id keyset batches. These pagination contracts must not be combined or described as one mechanism.

`count_own_recording_statuses_v1` returns exact facets across the full current `q`, organization filters and ALL-tag scope. Facets ignore the active `status`, so every state remains directly selectable; `Deleted` is a separate full Trash count and link.

Precise transcript chunks are derived from the same consecutive renderable speaker groups as the UI. If no speaker groups can be rendered, one manual/raw-text fallback chunk without timestamps is used. A database trigger first keeps that raw fallback synchronized in the transcript write transaction; successful server-side indexing then atomically replaces it with precise chunks. If precise replacement fails, the transcript remains saved and searchable through the raw fallback. The user sees the stable nonfatal warning once; the notice removes only its own `warning=transcript_search_index_incomplete` parameter through `history.replaceState`, preserving other query parameters and browser history.

AI outputs can be deleted individually from the recording detail. Deleting an AI output removes stored generated content but keeps the processing job metadata available for usage accounting. Recordings use a two-step delete model: first soft-delete to Trash, then permanent delete from Trash, including the Storage object and cascading DB records. Delete actions must ask for confirmation and then update the visible UI optimistically while the server action finishes.

Settings expose Trash retention as exactly 24 hours, 7 days (`168`) or 30 days (`720`), with `720` as the legacy/invalid fallback. The value applies only to future soft-deletes. On active-to-deleted transition the database snapshots immutable `deleted_at`, `trash_retention_hours` and `purge_after`; restore clears them and a later delete recalculates from the then-current setting. Existing deleted rows keep their truthful historical `deleted_at` and receive a 720-hour deadline. Trash UI displays the automatic deadline, with safe copy for null/pre-migration rows. Manual permanent purge remains independently available after the existing 24-hour safety fence.

The Trash cleanup worker is disabled unless its custom scheduler token is valid and its enable secret is exactly `true`. It claims at most 20 due rows through service-role-only lease RPCs, processes exactly two at once, validates owner-scoped paths and deletes files only through the existing Supabase Storage API. A pre-mutation failure releases a valid claim. Once the first Storage delete is attempted, any remove/list uncertainty or nonempty prefix keeps the claim and blocks restore until a stale retry can take over after the same 15-minute boundary used by manual purge. Claim loss cannot finalize or release another lease. Logs and returned summaries contain counts and stable codes only. The source checkout does not create a schedule, enable cleanup or change Vercel; every target requires its own disabled-first verification and explicit backlog approval.

## Forward Migration Release Boundary

The complete source schema is the ordered chain `20260617000000_initial_schema.sql` -> evidence `20260804100000` -> organization `20260804110000` -> markers `20260804120000` -> transcript search `20260804130000` -> Trash restore and purge safety `20260810005550_restore_recordings_from_trash.sql` -> status filters `20260813000000_add_recording_status_filters.sql` -> prompt overrides and job snapshots `20260813090000_add_prompt_overrides_and_job_snapshots.sql` -> prompt privilege hardening `20260815073029_harden_prompt_override_privileges.sql` -> automatic timeline idempotency `20260827094435_add_automatic_timeline_idempotency.sql` -> Trash retention deadlines `20260827100000_add_trash_retention_deadlines.sql`. The baseline alone is not the complete source of truth.

This public repository is a source contract, not a deployment ledger. Every target is treated as unverified until its actual schema, grants, forced RLS, data invariants and migration history are inspected. Apply only missing migrations in timestamp order and complete a target-specific postflight before deploying the application.

Source tests, `npm run check` and production build do not replace database runtime checks. Each target must verify two-user RLS, auth-user cascade, authenticated GIN `EXPLAIN`, current-vs-old/manual/raw/deleted search behavior, prompt override save/reset/resolve, legacy and new job inserts, exact ACLs and valid indexes. Do not reset production or rewrite legacy migration history merely to resemble the fresh baseline.

Development browser tests must run through `npm run test:e2e`. The outer runner creates one guarded temporary Next workspace under repo `.tmp`, copies only an explicit application allowlist and passes the exact owned path to Playwright. The config rejects direct unguarded Playwright execution, starts its own isolated server with `reuseExistingServer: false`, and cleanup may remove only the validated temp child. The runner does not discover or terminate unrelated processes or listeners.

## Not Yet Implemented

- Webhook or background worker ingestion for automatic Soniox completion.
- Background-safe chunked browser recording for very long mobile sessions.
- Signed upload URL orchestration.

The UI must show these as pending real workflow states, not as fake transcript or AI data.
