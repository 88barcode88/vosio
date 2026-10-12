import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { createSonioxTranscription, getSonioxTranscription, getSonioxTranscript } from "@/lib/soniox/client";
import { extractTranscriptSpeakerSummaries } from "@/lib/transcripts/speakers";
import { indexCapturedTranscript } from "@/lib/transcripts/capture-index.server";
import { getTranscriptionWebhook } from "@/lib/recordings/transcription-dispatch.server";

const providerId = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
const manifestSchema = z.array(z.object({ jobId: z.uuid(), providerJobId: providerId, position: z.number().int().nonnegative(), audioDurationMs: z.number().int().nonnegative().nullable() })).min(1).max(1000);
const workSchema = z.object({
  operation_id: z.uuid(), job_id: z.uuid().nullable(), claim_id: z.uuid(), work_kind: z.enum(["submit", "poll", "finalize"]),
  storage_path: z.string().nullable(), client_reference_id: z.string(), region: z.enum(["global", "eu"]), model: z.string(),
  provider_job_id: providerId.nullable(), manifest: z.unknown()
});
type Work = z.infer<typeof workSchema>;
const observedSchema = z.object({ id: providerId, status: z.enum(["queued", "processing", "completed", "error"]), audio_duration_ms: z.number().int().nonnegative().optional() });

// Reject an unreviewed environment model before allocating or claiming any new provider work.
export function assertTranscriptionModel() {
  const model = getServerEnv().sonioxAsyncModel;
  if (model !== "stt-async-v5") throw new Error("Transcription model configuration requires review");
  return model;
}

// All worker mutations use the exact database-issued operation/job/token tuple.
async function workerRpc(admin: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error("Transcription work could not be settled");
  return data;
}

// Renew only a currently owned lease; consumed or rotated tokens must stop the worker.
async function heartbeat(admin: SupabaseClient, work: Work) {
  const data = await workerRpc(admin, "refresh_recording_transcription_claim_v1", {
    p_operation_id: work.operation_id, p_job_id: work.job_id, p_claim_id: work.claim_id
  });
  if (data !== true) throw new Error("Transcription claim unavailable");
}

// Offset segment timing without mutating the provider token or changing its other fields.
function offsetToken(token: unknown, offset: number) {
  if (!token || typeof token !== "object" || Array.isArray(token)) return token;
  const result = { ...token } as Record<string, unknown>;
  for (const key of ["start_ms", "end_ms"]) if (typeof result[key] === "number") result[key] = result[key] + offset;
  return result;
}

// Execute one claimed unit; no branch can automatically repeat a provider POST.
export async function executeTranscriptionWork(admin: SupabaseClient, raw: unknown) {
  const work = workSchema.parse(raw);
  if (work.model !== assertTranscriptionModel()) throw new Error("Frozen transcription model mismatch");
  const exact = { p_operation_id: work.operation_id, p_job_id: work.job_id, p_claim_id: work.claim_id };
  if (work.work_kind === "submit") {
    if (!work.job_id || !work.storage_path || work.client_reference_id !== work.job_id || work.provider_job_id !== null) throw new Error("Invalid submission claim");
    let providerRequestStarted = false;
    let beforeRequestCode = "audio_unavailable";
    try {
      const { data, error } = await admin.storage.from("recordings").createSignedUrl(work.storage_path, 7200);
      if (error || !data?.signedUrl) throw new Error("Audio unavailable");
      await heartbeat(admin, work);
      beforeRequestCode = "provider_configuration";
      const input = {
        audioUrl: data.signedUrl, clientReferenceId: work.client_reference_id, region: work.region,
        webhook: getTranscriptionWebhook(work.operation_id, work.job_id),
        options: { model: work.model, enable_language_identification: true, enable_speaker_diarization: true, language_hints: ["cs"] }
      };
      providerRequestStarted = true;
      const submitted = observedSchema.parse(await createSonioxTranscription(input));
      await workerRpc(admin, "accept_recording_provider_job_v1", { ...exact, p_provider_job_id: submitted.id });
      return "accepted";
    } catch (error) {
      const status = error instanceof Error && error.name === "SonioxRequestError" && "status" in error ? error.status : null;
      const rejected = typeof status === "number" && [400, 401, 403, 404, 413, 422, 429].includes(status);
      if (!providerRequestStarted || rejected) {
        const code = !providerRequestStarted ? beforeRequestCode : status === 401 || status === 403 ? "provider_authentication"
          : status === 429 ? "rate_limited" : "submission_rejected";
        await workerRpc(admin, "fail_recording_submission_v1", { ...exact, p_error_code: code });
        return "failed";
      }
      // A timeout, server error or malformed success can still represent an accepted POST; never repeat it.
      await workerRpc(admin, "mark_recording_submission_uncertain_v1", exact).catch(() => undefined);
      return "manual_required";
    }
  }
  if (work.work_kind === "poll") {
    if (!work.job_id || !work.provider_job_id || work.storage_path !== null) throw new Error("Invalid polling claim");
    await heartbeat(admin, work);
    const observed = observedSchema.parse(await getSonioxTranscription(work.region, work.provider_job_id));
    if (observed.id !== work.provider_job_id) throw new Error("Provider observation mismatch");
    const status = { queued: "queued", processing: "running", completed: "done", error: "failed" }[observed.status];
    await workerRpc(admin, "settle_recording_provider_job_v1", { ...exact, p_status: status, p_audio_duration_ms: observed.audio_duration_ms ?? null });
    return status; // Every observation consumed this token; discovery must issue the next one.
  }
  if (work.job_id !== null || work.storage_path !== null) throw new Error("Invalid finalization claim");
  const manifest = manifestSchema.parse(work.manifest);
  if (manifest.some((part, index) => part.position !== index)
    || new Set(manifest.map((p) => p.jobId)).size !== manifest.length
    || new Set(manifest.map((p) => p.providerJobId)).size !== manifest.length) throw new Error("Invalid finalization manifest");
  const texts: string[] = [];
  const tokens: unknown[] = [];
  let offsetMs = 0;
  let durationKnown = true;
  for (const part of manifest) {
    await heartbeat(admin, work);
    const transcript = z.object({ id: providerId, text: z.string(), tokens: z.array(z.unknown()) }).parse(await getSonioxTranscript(work.region, part.providerJobId));
    if (transcript.id !== part.providerJobId) throw new Error("Provider result mismatch");
    texts.push(transcript.text);
    tokens.push(...transcript.tokens.map((token) => offsetToken(token, offsetMs)));
    if (part.audioDurationMs === null) durationKnown = false;
    offsetMs += part.audioDurationMs ?? 0;
  }
  await heartbeat(admin, work);
  const receipt = z.object({ operationId: z.uuid(), phase: z.literal("completed"), transcriptId: z.uuid() }).parse(await workerRpc(admin, "finalize_recording_transcription_v1", {
    p_operation_id: work.operation_id, p_claim_id: work.claim_id,
    p_raw_text: texts.join("\n\n"), p_segments: tokens, p_speakers: extractTranscriptSpeakerSummaries(tokens),
    p_duration_seconds: durationKnown ? Math.ceil(offsetMs / 1000) : null
  }));
  if (receipt.operationId !== work.operation_id) throw new Error("Finalization receipt mismatch");
  await indexCapturedTranscript(admin, receipt.transcriptId);
  return "completed";
}

// Discover bounded durable work independently of browser polling, after expiring only prepared reservations.
export async function discoverTranscriptionWork(admin: SupabaseClient) {
  assertTranscriptionModel();
  const pendingIndexes = z.array(z.object({ transcript_id: z.uuid() })).max(5).parse(await workerRpc(admin, "claim_pending_capture_indexes_v1", { p_limit: 5 }));
  const indexes = await Promise.all(pendingIndexes.map((row) => indexCapturedTranscript(admin, row.transcript_id)));
  const expired = await workerRpc(admin, "expire_prepared_recording_transcriptions_v1", { p_limit: 5 });
  const rows = z.array(workSchema).max(5).parse(await workerRpc(admin, "claim_recording_transcription_work_v1", { p_limit: 5 }));
  const results = await Promise.all(rows.map(async (work) => {
    try { return { operationId: work.operation_id, outcome: await executeTranscriptionWork(admin, work) }; }
    catch { return { operationId: work.operation_id, outcome: "retry_discovery" }; }
  }));
  if (results.some((r) => r.outcome === "manual_required")) console.error("[Vosio transcription] Operator verification required.");
  return { expired, results, indexed: indexes.filter((index) => index.status === "ready").length };
}
