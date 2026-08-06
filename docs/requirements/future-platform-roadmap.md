# Future Platform Roadmap

Status: **DEFERRED**. This document records approved follow-up work only. None of the settings, providers, release metadata, or limits below are implemented by this document.

## 1. Supabase Storage plan and effective upload limit

The settings screen should eventually let an administrator describe the connected Supabase project as:

- `auto` (recommended default),
- `free`,
- `paid`.

This selection is an explanatory hint, not an upload authorization. Supabase currently documents a maximum global file-size setting of 50 MB for Free projects and a configurable maximum up to 500 GB for Pro and higher projects. A paid project can still have a much lower global or `recordings` bucket limit.

The application must therefore calculate and display the effective upload limit from the strictest known constraint:

1. detected Supabase project/global limit, when the platform exposes it safely,
2. detected `recordings.file_size_limit`,
3. application policy,
4. the active upload method's technical limit.

If a constraint cannot be detected, it is `unknown`, not unlimited. The existing fail-closed bucket behavior remains authoritative. The UI shows both the selected plan hint and the detected effective limit, including a mismatch warning such as "Paid plan selected, but the recordings bucket is limited to 50 MB." Changing the hint must never silently raise a bucket or production project limit.

Implementation-time references:

- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Supabase pricing](https://supabase.com/pricing)

## 2. Changelog and application version

Current verified repository state on 5 August 2026:

- `package.json` contains version `0.1.0`,
- the repository has no Git tags,
- the product decision is to designate the current Git baseline as version `0.1.2` when versioning work is implemented.

The current package version must not be changed as part of unrelated feature work. The future versioning slice will:

1. set all application-owned version sources to `0.1.2`,
2. create a tracked `CHANGELOG.md` with entries grouped by version and date,
3. use Semantic Versioning for later releases,
4. show the application version in Settings/About,
5. add a documented release checklist and, once approved, a matching Git tag,
6. keep the version/changelog update in a separate release commit after the feature commits it describes.

Historical entries must be derived from Git history and verified behavior. They must not claim features that only exist in plans.

## 3. Optional OpenAI transcription provider

Soniox remains the default provider and the realtime transcription path. A future batch-transcription provider adapter may add OpenAI choices:

- `gpt-4o-transcribe` for the quality-oriented option,
- `gpt-4o-mini-transcribe` for the cost/speed-oriented option,
- `gpt-4o-transcribe-diarize` only if its speaker and timestamp output satisfies the workspace contract.

The implementation must keep provider credentials server-side and normalize all provider results into the existing transcript, segment, speaker, timestamp, job-state, and usage contracts. Before implementation, re-verify current model availability, file/request limits, timestamp and diarization support, pricing, retention/privacy terms, and regional availability in official provider documentation.

The provider slice must define retry and timeout behavior, idempotency, cost visibility, unsupported-file handling, provider-specific failures, and a safe fallback. A provider failure must never silently switch providers and create an unexpected charge. Unit, route, normalization, ownership, failure, and end-to-end tests are required.

## Delivery boundary

These three items belong to a later implementation plan. They are not dependencies for the current save-and-collapse, audio/evidence, marker, organization, or search slices. No live Supabase configuration, provider account, API key, package version, or Git tag is changed now.
