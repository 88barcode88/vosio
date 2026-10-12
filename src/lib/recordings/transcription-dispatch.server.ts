import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getServerEnv } from "@/lib/env.server";
import { assertTranscriptionModel, executeTranscriptionWork } from "@/lib/recordings/transcription-worker.server";

const dispatchSchema = z.object({ operationId: z.uuid(), phase: z.string(), pendingAcceptedWork: z.boolean().default(true) });
const inactive = new Set(["completed", "failed", "released", "expired", "manual_required"]);

// Domain-separated per-job authentication needs no new deployment secret and exposes no provider key.
function webhookToken(operationId: string, jobId: string) {
  return createHmac("sha256", getServerEnv().sonioxApiKey).update(`vosio:transcription-webhook:v1:${operationId}:${jobId}`).digest("hex");
}

// Only a configured public deployment origin is sent to Soniox; request headers cannot redirect callbacks.
export function getTranscriptionWebhook(operationId: string, jobId: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return {};
  const origin = new URL(configured);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.hostname === "localhost") return {};
  return { webhook_url: `${origin.origin}/api/jobs/recording-transcription/${operationId}/${jobId}`,
    webhook_auth_header_name: "X-Vosio-Transcription", webhook_auth_header_value: webhookToken(operationId, jobId) };
}

// Verify the exact operation/job capability before allocating an admin client or reading a callback body.
export function verifyTranscriptionWebhook(operationId: string, jobId: string, supplied: string | null) {
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(webhookToken(operationId, jobId)));
}

// Bound dispatch to one accepted operation, preserving DB leases and never resubmitting uncertain POSTs.
export async function runTranscriptionOperation(admin: SupabaseClient, operationId: string, budgetMs = 240_000, waitForWork = true) {
  z.uuid().parse(operationId);
  assertTranscriptionModel();
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const state = await admin.rpc("get_recording_transcription_dispatch_v1", { p_operation_id: operationId });
    if (state.error) throw new Error("Transcription dispatch unavailable");
    const current = dispatchSchema.parse(state.data);
    if (current.operationId !== operationId) throw new Error("Transcription dispatch mismatch");
    if (inactive.has(current.phase)) return current.phase;
    const claimed = await admin.rpc("claim_recording_transcription_work_v2", { p_limit: 1, p_operation_id: operationId });
    if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length > 1) throw new Error("Transcription claim unavailable");
    if (claimed.data.length) {
      const work = claimed.data[0];
      if (work.operation_id !== operationId) throw new Error("Transcription claim mismatch");
      const outcome = await executeTranscriptionWork(admin, work);
      if (!waitForWork) return outcome;
    } else {
      if (current.phase === "uncertain" && !current.pendingAcceptedWork) return "manual_required";
      if (!waitForWork) return "pending";
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, remaining)));
    }
  }
  return "pending";
}
