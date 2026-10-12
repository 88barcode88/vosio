import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { deleteSonioxTranscription, getSonioxTranscription, listSonioxTranscriptions, SonioxRequestError } from "@/lib/soniox/client";

const uuid = z.uuid();
const providerId = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
const operationSchema = z.object({ id: uuid, recording_id: uuid, phase: z.string(), region: z.enum(["global", "eu"]), model: z.string(), created_at: z.string(), started_at: z.string(), finalize_attempt_count: z.number().int() });
const workSchema = z.object({ job_id: uuid, phase: z.string(), position: z.number().int(), provider_job_id: providerId.nullable(), storage_path: z.string(), claim_id: uuid.nullable(), submission_claim_id: uuid.nullable(), claimed_at: z.string().nullable(), poll_attempt_count: z.number().int(), error_code: z.string().nullable().optional() });
const snapshotSchema = z.object({ operation: operationSchema, work: z.array(workSchema).min(1).max(1000) });
const providerSchema = z.object({ id: providerId, status: z.enum(["queued", "processing", "completed", "error"]), client_reference_id: uuid, model: z.string(), audio_url: z.url(), created_at: z.string() });
type Work = z.infer<typeof workSchema>;
type Provider = z.infer<typeof providerSchema>;
export type RecoveryResult = { status: "queued" | "running" | "failed"; stopped?: boolean };
export type RecoveryCode = "provider_authentication" | "provider_unavailable" | "provider_processing" | "provider_completed" | "submission_pending" | "lookup_incomplete" | "ambiguous_job" | "not_found" | "state_changed" | "recovery_unavailable";

export class TranscriptionRecoveryError extends Error {
  // Expose only fixed recovery outcomes, never provider messages or temporary audio URLs.
  constructor(public readonly code: RecoveryCode) { super("Transcription recovery could not be confirmed"); }
}

// Hash metadata-only evidence; provider credentials, text and Storage URLs never enter the proof.
function evidence(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

// Keep original identity, region/model and the exact frozen audio object together before binding or deleting a job.
function verifyProvider(raw: unknown, work: Work, operation: z.infer<typeof operationSchema>): Provider {
  const parsed = providerSchema.safeParse(raw);
  if (!parsed.success) throw new TranscriptionRecoveryError("ambiguous_job");
  const provider = parsed.data;
  const audio = new URL(provider.audio_url);
  if (provider.client_reference_id !== work.job_id || provider.model !== operation.model
    || audio.origin !== new URL(getServerEnv().supabaseUrl).origin
    || decodeURIComponent(audio.pathname) !== `/storage/v1/object/sign/recordings/${work.storage_path}`
    || !Number.isFinite(Date.parse(provider.created_at)) || Date.parse(provider.created_at) < Date.parse(operation.created_at) - 60_000) {
    throw new TranscriptionRecoveryError("ambiguous_job");
  }
  return provider;
}

// Translate only provider boundary diagnostics into user-safe recovery errors.
function providerFailure(error: unknown): never {
  if (error instanceof TranscriptionRecoveryError) throw error;
  throw new TranscriptionRecoveryError(error instanceof SonioxRequestError && [401, 403].includes(error.status)
    ? "provider_authentication" : "provider_unavailable");
}

// Use the service-only RPC because private capture tables deny direct SELECT even to service_role.
export async function getTranscriptionRecoverySnapshot(admin: SupabaseClient, recordingId: string, operationId: string) {
  const result = await admin.rpc("get_recording_transcription_recovery_v1", { p_operation_id: operationId, p_recording_id: recordingId });
  if (result.error) throw new TranscriptionRecoveryError("recovery_unavailable");
  const parsed = snapshotSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.operation.id !== operationId || parsed.data.operation.recording_id !== recordingId) {
    throw new TranscriptionRecoveryError("state_changed");
  }
  return parsed.data;
}

// Read or cancel an existing operation only; this path can never submit new paid work.
export async function recoverTranscriptionOperation(admin: SupabaseClient, input: {
  recordingId: string; operationId: string; actorId: string; requestId: string; action: "resume" | "stop";
}, authorization: { reserveStop: (snapshot: unknown[]) => Promise<void>; resume: (snapshot: unknown[]) => Promise<void> }): Promise<RecoveryResult> {
  const signal = AbortSignal.timeout(60_000);
  const { operation, work } = await getTranscriptionRecoverySnapshot(admin, input.recordingId, input.operationId);
  const snapshot = work.map(part => [part.job_id, part.phase, part.provider_job_id, part.claim_id, part.submission_claim_id]);
  if (operation.phase === "failed") return { status: "failed" };
  if (!["started", "accepted", "uncertain"].includes(operation.phase)) throw new TranscriptionRecoveryError("state_changed");
  const unknown = work.filter(part => ["submitting", "uncertain"].includes(part.phase) && !part.provider_job_id);
  const found = new Map<string, Provider>();
  let complete = unknown.length === 0;
  try {
    if (unknown.length) {
      const wanted = new Set(unknown.map(part => part.job_id));
      const cursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        signal.throwIfAborted();
        const response = await listSonioxTranscriptions(operation.region, cursor, signal);
        if (!Array.isArray(response.transcriptions) || response.transcriptions.length > 1000) throw new TranscriptionRecoveryError("lookup_incomplete");
        for (const raw of response.transcriptions) {
          if (!raw.client_reference_id || !wanted.has(raw.client_reference_id)) continue;
          const part = unknown.find(part => part.job_id === raw.client_reference_id)!;
          if (found.has(part.job_id)) throw new TranscriptionRecoveryError("ambiguous_job");
          found.set(part.job_id, verifyProvider(raw, part, operation));
        }
        if (response.next_page_cursor === null) { complete = true; break; }
        if (typeof response.next_page_cursor !== "string" || !response.next_page_cursor || cursors.has(response.next_page_cursor)) throw new TranscriptionRecoveryError("lookup_incomplete");
        cursors.add(response.next_page_cursor); cursor = response.next_page_cursor;
      }
      if (!complete) throw new TranscriptionRecoveryError("lookup_incomplete");
    }
    for (const part of work.filter(part => part.phase === "accepted")) {
      if (!part.provider_job_id) throw new TranscriptionRecoveryError("state_changed");
      let raw;
      try { signal.throwIfAborted(); raw = await getSonioxTranscription(operation.region, part.provider_job_id, signal); }
      catch (error) {
        if (error instanceof SonioxRequestError && error.status === 404 && input.action === "stop") continue;
        throw error;
      }
      const provider = verifyProvider(raw, part, operation);
      if (provider.id !== part.provider_job_id) throw new TranscriptionRecoveryError("ambiguous_job");
      found.set(part.job_id, provider);
    }
    if (input.action === "resume") {
      if (unknown.some(part => !found.has(part.job_id))) throw new TranscriptionRecoveryError("not_found");
      signal.throwIfAborted();
      await authorization.resume(snapshot);
      for (const part of unknown) {
        signal.throwIfAborted();
        const provider = found.get(part.job_id)!;
        const result = await admin.rpc("resolve_uncertain_recording_job_v1", {
          p_operation_id: operation.id, p_job_id: part.job_id, p_resolution: "bind_verified",
          p_evidence_sha256: evidence({ job: part.job_id, provider: provider.id, status: provider.status }), p_provider_job_id: provider.id
        });
        if (result.error) throw new TranscriptionRecoveryError("state_changed");
        if (Date.parse(operation.started_at) <= Date.now() - 7 * 86400000) {
          const renewed = await admin.rpc("resolve_uncertain_recording_job_v1", {
            p_operation_id: operation.id, p_job_id: part.job_id, p_resolution: "resume_poll",
            p_evidence_sha256: evidence({ job: part.job_id, provider: provider.id, request: input.requestId }), p_provider_job_id: null
          });
          if (renewed.error) throw new TranscriptionRecoveryError("state_changed");
        }
      }
      for (const part of work.filter(part => part.phase === "accepted")) {
        signal.throwIfAborted();
        if (part.poll_attempt_count < 5 && Date.parse(operation.started_at) > Date.now() - 7 * 86400000) continue;
        const result = await admin.rpc("resolve_uncertain_recording_job_v1", {
          p_operation_id: operation.id, p_job_id: part.job_id, p_resolution: "resume_poll",
          p_evidence_sha256: evidence({ job: part.job_id, provider: found.get(part.job_id)!.id, request: input.requestId }), p_provider_job_id: null
        });
        if (result.error) throw new TranscriptionRecoveryError("state_changed");
      }
      if (work.every(part => part.phase === "done") && (operation.finalize_attempt_count >= 5 || Date.parse(operation.started_at) <= Date.now() - 7 * 86400000)) {
        const result = await admin.rpc("resolve_uncertain_recording_job_v1", {
          p_operation_id: operation.id, p_job_id: work[0].job_id, p_resolution: "resume_finalize",
          p_evidence_sha256: evidence({ operation: operation.id, request: input.requestId }), p_provider_job_id: null
        });
        if (result.error) throw new TranscriptionRecoveryError("state_changed");
      }
      return { status: Array.from(found.values()).some(provider => provider.status === "processing") ? "running" : "queued" };
    }
    if (unknown.some(part => part.claimed_at && Date.parse(part.claimed_at) > Date.now() - 15 * 60_000)) throw new TranscriptionRecoveryError("submission_pending");
    if (Array.from(found.values()).some(provider => ["queued", "processing"].includes(provider.status))) throw new TranscriptionRecoveryError("provider_processing");
    if (work.every(part => part.phase === "done") || Array.from(found.values()).some(provider => provider.status === "completed")) throw new TranscriptionRecoveryError("provider_completed");
    signal.throwIfAborted();
    await authorization.reserveStop(snapshot);
    const confirmed: Array<{ job: string; provider: string | null; absent: boolean }> = [];
    for (const part of work) {
      signal.throwIfAborted();
      const provider = found.get(part.job_id);
      if (provider) {
        await deleteSonioxTranscription(operation.region, provider.id, signal);
        try { await getSonioxTranscription(operation.region, provider.id, signal); throw new TranscriptionRecoveryError("provider_unavailable"); }
        catch (error) { if (!(error instanceof SonioxRequestError && error.status === 404)) throw error; }
      }
      confirmed.push({ job: part.job_id, provider: provider?.id ?? part.provider_job_id, absent: !provider });
    }
    signal.throwIfAborted();
    const verified = await admin.rpc("verify_recording_transcription_stop_v1", {
      p_operation_id: operation.id, p_actor_id: input.actorId, p_request_id: input.requestId, p_snapshot: snapshot,
      p_evidence_sha256: evidence({ operation: operation.id, region: operation.region, complete, confirmed })
    });
    if (verified.error || verified.data?.verified !== true) throw new TranscriptionRecoveryError("state_changed");
    return { status: "failed", stopped: true };
  } catch (error) { return providerFailure(error); }
}
