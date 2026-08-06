# Future Platform Roadmap

Status: **PARTIALLY RESOLVED**. The version and release infrastructure is implemented in the local `0.1.2` source release. The Supabase plan/effective-limit preference remains the next `0.1.3` slice. A standalone OpenAI transcription provider is canceled. Local source state does not imply a private/dev push, tag, deploy, or database postflight.

## 1. Supabase Storage plan and effective upload limit

The settings screen should let each user describe their own expectation for the connected Supabase project as:

- `auto` (recommended default),
- `free`,
- `paid`.

This per-user selection is an explanatory preference, not an upload authorization or shared configuration. It does not change Supabase configuration and can only tighten limits. Supabase currently documents a maximum global file-size setting of 50 MB for Free projects and a configurable maximum up to 500 GB for Pro and higher projects. A paid project can still have a much lower global or `recordings` bucket limit.

The application must therefore calculate and display the effective upload limit from the strictest known constraint:

1. detected Supabase project/global limit, when the platform exposes it safely,
2. detected `recordings.file_size_limit`,
3. application policy,
4. the active upload method's technical limit.

If a constraint cannot be detected, it is `unknown`, not unlimited. The existing fail-closed bucket behavior remains authoritative. The UI shows both the selected plan preference and the detected effective limit, including a mismatch warning such as "Paid plan selected, but the recordings bucket is limited to 50 MB." Changing the preference must never silently raise a bucket or production project limit.

Implementation-time references:

- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Supabase pricing](https://supabase.com/pricing)

## 2. Changelog and application version

Verified local `0.1.2` source-release state:

- `package.json` and `package-lock.json` contain version `0.1.2`,
- `CHANGELOG.md` is tracked,
- Settings displays the package-backed application version,
- a private release checklist is present for release preflight.

This local source-release state verifies the release infrastructure only. It does not prove that a private/dev branch was pushed, that a Git tag was created, that an application was deployed, or that any database postflight was run. Those gates are separate and require their own evidence and approval.

Future version changes must continue to:

1. update application-owned version sources together,
2. keep a tracked `CHANGELOG.md` with entries grouped by version and date,
3. use Semantic Versioning,
4. show the package-backed version in Settings/About,
5. run the private release checklist before any separately approved push, tag, deploy, or database postflight.

Historical entries must be derived from Git history and verified behavior. They must not claim features that only exist in plans.

## 3. Standalone OpenAI transcription provider (canceled)

No OpenAI transcription provider, model choice, or adapter will be added. Soniox remains the only asynchronous and realtime transcription provider and the EU provider direction.

This cancellation applies only to speech-to-text transcription. It does not remove or change the existing post-transcription analysis behavior, where OpenAI is the default AI provider and Gemini is optional.

## Delivery boundary

Only the per-user Supabase plan preference and effective upload-limit work remains planned for `0.1.3`. It is not a dependency for the current save-and-collapse, audio/evidence, marker, organization, or search slices. This document does not perform any live Supabase configuration, provider-account, push, tag, deploy, or database mutation.
