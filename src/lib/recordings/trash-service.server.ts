import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";

export type ManagedMutationCode = "forbidden" | "conflict" | "invalid_item" | "internal";
export class ManagedMutationError extends Error {
  // Keeps database details out of API responses and redirects.
  constructor(readonly code: ManagedMutationCode) { super(code); }
}

// Maps locked RPC failures without revealing target existence or lineage.
export function managedMutationError(error: { code?: string } | null | undefined) {
  return new ManagedMutationError(error?.code === "42501" ? "forbidden"
    : error?.code === "40001" || error?.code === "55000" ? "conflict"
      : error?.code === "22023" ? "invalid_item" : "internal");
}

// Resolves the safe version then asks the locked RPC to reauthorize the exact state transition.
export async function mutateManagedRecording(supabase: SupabaseClient, recordingId: string, action: "delete" | "restore", retentionHours = 720) {
  const capabilities = await resolveRecordingCapabilities(supabase, recordingId);
  if (!capabilities[action]) throw new ManagedMutationError("forbidden");
  const snapshot = await supabase.rpc("get_accessible_recording_v1", { p_recording_id: recordingId });
  const row = snapshot.data?.[0];
  if (snapshot.error || row?.id !== recordingId || !row.updated_at) throw new ManagedMutationError("forbidden");
  const { data, error } = await supabase.rpc(action === "delete" ? "trash_recording_v1" : "restore_shared_recording_v1", {
    p_recording_id: recordingId, p_expected_updated_at: row.updated_at,
    ...(action === "delete" ? { p_retention_hours: retentionHours } : {})
  });
  if (error) throw managedMutationError(error);
  const validStatus = action === "delete" ? data?.status === "deleted"
    : ["created", "uploading", "uploaded", "transcribing", "completed", "failed"].includes(data?.status);
  if (data?.recordingId !== recordingId || typeof data?.changed !== "boolean" || !validStatus) throw new ManagedMutationError("internal");
}

export const manualPurgeRequestSchema = z.object({
  recordingId: z.uuid(), requestId: z.uuid(), expectedUpdatedAt: z.string().datetime({ offset: true })
});
const receiptSchema = z.object({ operationId: z.uuid(), phase: z.enum(["prepared", "started", "completed", "released", "superseded"]) });
export type ManualPurgeRequest = z.infer<typeof manualPurgeRequestSchema>;

// Replays the durable caller key before authority checks; only DB start can authorize new cleanup.
export async function continueManualPurge(supabase: SupabaseClient, request: ManualPurgeRequest, release = false) {
  if (!manualPurgeRequestSchema.safeParse(request).success) throw new ManagedMutationError("invalid_item");
  if (release) {
    const result = await supabase.rpc("release_recording_purge_request_v1", { p_recording_id: request.recordingId, p_request_id: request.requestId });
    if (result.error) throw managedMutationError(result.error);
    const receipt = receiptSchema.safeParse(result.data);
    if (!receipt.success || receipt.data.phase !== "released") throw new ManagedMutationError("conflict");
    return receipt.data;
  }
  const prepared = await supabase.rpc("prepare_recording_purge_v1", {
    p_recording_id: request.recordingId, p_request_id: request.requestId, p_expected_updated_at: request.expectedUpdatedAt
  });
  if (prepared.error) throw managedMutationError(prepared.error);
  const receipt = receiptSchema.safeParse(prepared.data);
  if (!receipt.success) throw new ManagedMutationError("internal");
  if (receipt.data.phase !== "prepared") {
    if (release && receipt.data.phase === "released") return receipt.data;
    if (release || !["started", "completed"].includes(receipt.data.phase)) throw new ManagedMutationError("conflict");
    return receipt.data;
  }
  const result = await supabase.rpc(release ? "release_recording_purge_v1" : "start_recording_purge_v1", { p_operation_id: receipt.data.operationId });
  if (result.error) throw managedMutationError(result.error);
  const saved = receiptSchema.safeParse(result.data);
  if (!saved.success || saved.data.operationId !== receipt.data.operationId || saved.data.phase !== (release ? "released" : "started") || typeof result.data.changed !== "boolean") throw new ManagedMutationError("internal");
  return saved.data;
}
