import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ManualAiReconciliationStatus =
  | "schedule"
  | "busy"
  | "done"
  | "interrupted"
  | "terminal"
  | "operator_required"
  | "missing";

const SAFE_RESULTS = new Set<ManualAiReconciliationStatus>([
  "schedule", "busy", "done", "interrupted", "terminal", "operator_required", "missing"
]);

// reconcileManualAiJob delegates one exact owner/job transition to the short locked RPC.
export async function reconcileManualAiJob(input: {
  action: "interrupt" | "reconcile";
  admin: SupabaseClient;
  jobId: string;
  transcriptId: string;
  userId: string;
}) {
  const { data, error } = await input.admin.rpc("reconcile_manual_ai_job_v1", {
    p_action: input.action,
    p_job_id: input.jobId,
    p_now: new Date().toISOString(),
    p_transcript_id: input.transcriptId,
    p_user_id: input.userId
  }).returns<Array<{ job_id: string; result: string }>>().single();
  if (error || !data || !SAFE_RESULTS.has(data.result as ManualAiReconciliationStatus)) {
    throw new Error("manual_ai_reconciliation_failed");
  }
  return { jobId: data.job_id, status: data.result as ManualAiReconciliationStatus };
}
