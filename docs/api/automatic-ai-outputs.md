# Automatic AI outputs

Source contract: `20260915170017_add_automatic_ai_outputs.sql`. Database apply, concurrent postflight and application publication are separate operator gates; none is proved by local unit tests.

Source migration SHA-256: `e8ec184ed987ab9e00504b8fb13a45fbb5740c46e620e681f427aba71d407bb3`. Recompute and review after any migration edit.

## Consent and completion

`vosio_settings.automaticOutputTypes` defaults to `[]` and accepts summary, action_items, meeting_minutes, crm_note and follow_up_email. Existing explicit `autoTimelineAfterTranscription` controls timeline independently. Dormant flags never enable paid work. Unknown models fail closed. All-off still records completion identity but performs no prompt lookup or automatic job creation.

Regular and segmented transcription, live transcript, imported text and recovered text use `complete_transcript_generation_v2`. The same transcript lock arbitrates new/same/legacy generations and snapshots every selected system prompt plus the owner's active override in canonical order. An error rolls back the entire completion, including `recordings.completed`. Partial drafts and audio-only recovery do not schedule AI. Repeated completion cannot reinterpret current settings; historical generations are not backfilled.

The existing intent table expands with processing type and completion generation. Timeline digest, v1 names, signatures and results remain compatible; v1 wrappers can schedule only timeline. Enqueue v2 derives the immutable job from a current owner-scoped intent. Jobs remain unique by intent digest and outputs unique by processing job. Existing historical snapshot text/digests are preserved.

## Execution, atomic publication and local state

Routes enqueue up to six independent jobs, then use `after()` for concurrent provider work. Failure of one type does not suppress siblings. Provider requests have a 240 second abort timeout; route budget is 300 seconds and lease 900 seconds. The host must support Next `after()`; process termination may interrupt execution. Durable intents and bounded attempts permit subsequent explicit detail recovery, not guaranteed provider-side exactly-once billing.

`publish_automatic_ai_output_v2` locks transcript then job and validates generation, automatic mode, owner, intent/type and an unexpired exact lease before any write. Server-side `buildStructuredAiItems` reserves an output UUID and derives projections; the RPC validates every output/job/transcript/user link. Raw output, projections, usage and done settlement commit together. Publication/SQL projection failure rolls everything back; unsupported JSON can legitimately produce raw-only output. Duplicate success returns the existing owner-consistent output. Manual persistence and manual cleanup do not use this strategy.

Owner-authenticated `POST /api/transcripts/{id}/automatic-timeline` remains the recovery URL and now restores all current persisted types. It accepts no model, prompt, provider or selected-type request payload. Auth/ownership checks precede admin access. `GET /api/transcripts/{id}/ai-state` never calls a provider or creates intents: it returns 50 manual summaries plus separately bounded six current automatic summaries, explicit execution modes and safe classifications. Automatic classifications have no manual actions. AI/Timeline refresh metadata after enqueue and locally hydrate successful output bodies/projections while eligible siblings continue polling; terminal work stops polling. Existing cadence, hidden/offline pause, in-flight deduplication, drafts, loaded bodies and transcript generation fence remain intact.

## Ordered operator verification (no Docker)

1. Capture target-specific function definitions/signatures, table constraints, indexes, forced RLS, ACLs, legacy job distributions, duplicate intent keys/outputs and active leases. Do not log transcript/prompt bodies. Never run blind `supabase db push`; remote history may differ from actual schema.
2. Independently review the exact migration and runner. Record `Get-FileHash supabase/migrations/20260915170017_add_automatic_ai_outputs.sql -Algorithm SHA256`. Pass that exact reviewed hash below. Recalculate and re-review after any SQL change.
3. Supply the existing Management API token using `SUPABASE_ACCESS_TOKEN` (or existing `SUPABASE_VOSIO_TOKEN`) and the exact approved project ref using `SUPABASE_EXPECTED_PROJECT_REF`. Use Node `--use-system-ca` where required. Never disable TLS verification. Runner also requires matching `--target`, `--migration-sha256`, explicit approval flag and a new unique manifest path.

```powershell
node --use-system-ca scripts/verify-automatic-ai-outputs.mjs --mode rehearse --target <approved-project-ref> --migration-sha256 <reviewed-sha256> --manifest .tmp/automatic-ai-rehearsal-<unique-run>.json --approved-synthetic-db-verification
```

Rehearsal submits the exact migration plus sequential synthetic assertions in one transaction ending in rollback. It checks six-type uniqueness, independent owner snapshots, repeat/all-off decisions, lease/generation rejection, publication and missing-prompt rollback. The missing-prompt fixture temporarily changes only SELECT visibility and invocation grants inside that rollback transaction; it never edits system prompt rows. After rollback the runner compares function/table/column/constraint/index/policy/ACL/RLS catalog fingerprints and verifies zero synthetic rows. Rehearsal proves no inter-session concurrency.

4. Apply the exact reviewed additive migration transactionally on the approved target, preserving old application compatibility. Verify v1 calls and catalog/ACL/index invariants. Keep the old app serving during the following postflight.

```powershell
node --use-system-ca scripts/verify-automatic-ai-outputs.mjs --mode concurrency --target <approved-project-ref> --migration-sha256 <reviewed-sha256> --manifest .tmp/automatic-ai-concurrency-<unique-run>.json --approved-synthetic-db-verification
```

This commits only new synthetic users, recordings, transcripts and overrides with exact manifest IDs. Two independent Management API sessions must exhibit observed PostgreSQL lock waits for competing completion, duplicate claim, lease transfer versus stale publication and new generation versus stale publication. Projection SQL failure must preserve zero outputs and running status. No provider request or historical manual job mutation is part of this test. `finally` waits for outstanding sessions, removes exact synthetic fixtures and verifies zero leftovers. Do not interpret a timeout or single-session rehearsal as a concurrency pass.

5. Only after concurrent assertions, exact cleanup and postflight pass may the new application be published. Record migration hash, target, commands, results and app publication/deployment separately in the operator receipt.

## Interrupted proof and rollback

New runs use exclusive manifest creation and never overwrite prior cleanup identity. Preserve the manifest on interruption or failed cleanup. Use the same target and manifest with `--mode cleanup` and the same explicit approval/hash arguments. Cleanup validates the manifest and synthetic title/email ownership before deleting exact fixture rows; never substitute broad title/prefix predicates or existing user IDs.

Before apply, failure changes no live schema. Transactional apply failure rolls back. After additive apply, retain compatible schema if a postflight/application problem occurs, repair within scope and rerun only invalidated checks. Roll back application code separately if needed. Never drop intent/job history, erase consent, deduplicate production outputs or claim the schema was un-applied without an explicit separate operation.
