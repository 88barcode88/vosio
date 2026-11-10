import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";

const id = z.string().uuid();
const extension = z.string().regex(/^[a-p]{32}$/);
// Stored result of /complete, replayed unchanged for a repeated completion.
export const captureCompletionSchema = z.object({
  requestId: id, status: z.string().min(1).max(40),
  transcription: z.object({ state: z.enum(["queued", "not_started"]), operationId: id.nullable() }).strict()
}).strict();
export type CaptureCompletion = z.infer<typeof captureCompletionSchema>;
// Region and model of the first transcription prepare, reused by every retry because both are part of its idempotency hash.
export const captureTranscriptionConfigSchema = z.object({ region: z.enum(["global", "eu"]), model: z.string().min(1).max(100) }).strict();
export type CaptureTranscriptionConfig = z.infer<typeof captureTranscriptionConfigSchema>;
const bindingSchema = z.object({
  recordingId: id, extensionId: extension, requestId: id, createdGrantId: id.nullable(), createdAt: z.string(),
  completedAt: z.string().nullable(), completion: z.record(z.string(), z.unknown()).nullable(),
  registeredPartCount: z.number().int().min(1).max(1000).nullable(), transcriptionConfig: z.record(z.string(), z.unknown()).nullable()
});
export type CaptureBinding = z.infer<typeof bindingSchema>;

// Call one service-only binding RPC and validate its jsonb result; any database error becomes a generic unavailable error.
async function bindingRpc(name: string, args: Record<string, unknown>): Promise<CaptureBinding | null> {
  const { data, error } = await createAdminClient().rpc(name, args).abortSignal(AbortSignal.timeout(15000));
  if (error) throw Object.assign(new Error("Capture binding unavailable."), { code: error.code });
  if (data === null) return null;
  const parsed = bindingSchema.safeParse(data);
  if (!parsed.success) throw new Error("Capture binding unavailable.");
  return parsed.data;
}

// Bind a just-created own recording to the extension; idempotent by (user, extension, request).
export function recordCaptureBinding(input: { userId: string; extensionId: string; recordingId: string; requestId: string; grantId: string }) {
  return bindingRpc("mcp_capture_binding_record_v1", { p_user_id: input.userId, p_extension_id: input.extensionId, p_recording_id: input.recordingId, p_request_id: input.requestId, p_created_grant_id: input.grantId });
}

// Find the binding for exactly this user, extension and recording; null for unknown and foreign ids alike.
export function getCaptureBindingByRecording(userId: string, extensionId: string, recordingId: string) {
  return bindingRpc("mcp_capture_binding_by_recording_v1", { p_user_id: userId, p_extension_id: extensionId, p_recording_id: recordingId });
}

// Find the binding created for an extension request id (retry after a lost response).
export function getCaptureBindingByRequest(userId: string, extensionId: string, requestId: string) {
  return bindingRpc("mcp_capture_binding_by_request_v1", { p_user_id: userId, p_extension_id: extensionId, p_request_id: requestId });
}

// Mark the upload complete and keep the first completion result (later calls return it unchanged).
export function completeCaptureBinding(userId: string, extensionId: string, recordingId: string, completion: CaptureCompletion) {
  return bindingRpc("mcp_capture_binding_complete_v1", { p_user_id: userId, p_extension_id: extensionId, p_recording_id: recordingId, p_completion: captureCompletionSchema.parse(completion) });
}

// Remember the highest number of parts registered for the recording so /complete can refuse a partial list.
export function recordRegisteredParts(userId: string, extensionId: string, recordingId: string, partCount: number) {
  return bindingRpc("mcp_capture_binding_parts_v1", { p_user_id: userId, p_extension_id: extensionId, p_recording_id: recordingId, p_part_count: partCount });
}

// Pin the region and model of the first transcription prepare; the first stored value wins and is returned in the binding.
export function pinTranscriptionConfig(userId: string, extensionId: string, recordingId: string, config: CaptureTranscriptionConfig) {
  return bindingRpc("mcp_capture_binding_transcription_v1", { p_user_id: userId, p_extension_id: extensionId, p_recording_id: recordingId, p_config: captureTranscriptionConfigSchema.parse(config) });
}

// Read the recordings bucket size limit with the service client; null when unavailable so callers fail closed.
export async function readRecordingsBucketLimit(): Promise<number | null> {
  try {
    const { data, error } = await createAdminClient().storage.getBucket(RECORDINGS_BUCKET);
    const limit = data?.file_size_limit;
    return error || typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0 ? null : limit;
  } catch { return null; }
}
