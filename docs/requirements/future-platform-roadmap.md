# Future Platform Roadmap

Status: **RESOLVED FOR SOURCE RELEASE 0.1.3**. This document records source behavior only. It does not prove a push, tag, deploy, live Supabase change, database postflight, or provider-account mutation.

## 1. Supabase Storage plan and effective upload limit

The `0.1.3` source implements a per-user `auto`, `free`, or `paid` preference in Supabase Auth metadata. It is not a shared project setting or upload authorization: it does not change billing, a global project limit, or the `recordings` bucket.

At runtime the application reads `recordings.file_size_limit` and calculates the effective upload limit as `min(bucket limit, optional plan cap)`. `free` can lower the limit to 50 MiB and `paid` can lower it to 500 GiB; neither value can raise the bucket limit. The global project limit is not safely detected, so it is represented as `unknown`, never unlimited. Missing or unusable bucket metadata fails closed for audio upload and audio-backed live recording. Live audio has a hard limit of `min(effective upload limit, 128 MiB)`. Its bitrate estimate discards local audio earlier at `hard live limit - min(5% of hard live limit, 2 MiB)`, while the finalized Blob is still validated against the full hard live limit before upload.

Each user can choose a different preference. A team owner must align those preferences manually with the real project configuration.

## 2. Changelog and application version

Version and changelog infrastructure was introduced in the historical local `0.1.2` source release. At that point:

- `package.json` and `package-lock.json` contained version `0.1.2`,
- `CHANGELOG.md` is tracked,
- Settings displays the package-backed application version,
- a private release checklist is present for release preflight.

The current `0.1.3` source advances `package.json`, `package-lock.json`, the package-backed Settings version and `CHANGELOG.md` to `0.1.3`.

This verifies source-release infrastructure only. It does not prove that a branch was pushed, a tag was created, an application was deployed, or a database postflight ran.

## 3. Transcription providers and EU residency

A standalone OpenAI transcription provider is canceled. Soniox remains the only asynchronous and realtime transcription provider. This does not change post-transcription analysis, where OpenAI is the default AI provider and Gemini is optional.

EU residency is conditional, not automatic: it requires a configured Soniox EU project, matching regional key, and EU region endpoints. Source code and this roadmap do not verify any deployed provider configuration.
