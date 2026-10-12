import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const captureScopeSchema = z.object({
  projectId: z.uuid().nullable().default(null),
  visibility: z.enum(["private", "project", "selected"]).default("private"),
  recipients: z.array(z.object({ userId: z.uuid(), role: z.enum(["reader", "editor"]) }).strict()).max(100).default([])
}).strict().superRefine((scope, ctx) => {
  if ((scope.visibility === "project" && !scope.projectId)
    || (scope.visibility === "selected" ? scope.recipients.length === 0 : scope.recipients.length !== 0)
    || new Set(scope.recipients.map((r) => r.userId.toLowerCase())).size !== scope.recipients.length) {
    ctx.addIssue({ code: "custom", message: "Neplatný výběr sdílení." });
  }
});
export type CaptureScope = z.infer<typeof captureScopeSchema>;
export type CaptureAttempt = {
  requestId: string;
  scope: CaptureScope;
  recordingId?: string;
  createPayload?: { title: string; source: string };
  captureRevision: number;
  requests: Record<string, { requestId: string; revision: number; payload: CaptureTransition }>;
};
export const lostCaptureAccessMessage = "K této nahrávce už nemáte přístup. Místní obsah zůstává připravený pro uložení nové soukromé kopie.";

export class CaptureError extends Error {
  // Keep database diagnostics out of product copy while retaining a stable decision code.
  constructor(readonly code: string) {
    super(code === "42501" ? lostCaptureAccessMessage : code === "40001"
      ? "Nahrávka se mezitím změnila. Obnovte její stav před dalším uložením."
      : code === "55000" ? "Operaci teď nelze dokončit. Uložený obsah zůstává zachovaný pro obnovu."
        : "Nahrávku se nepodařilo uložit. Zkuste zopakovat stejné uložení.");
  }
}
export const captureStateSchema = z.object({ recordingId: z.uuid(), status: z.string(), captureRevision: z.number().int().nonnegative() });
export const captureReceiptSchema = captureStateSchema.extend({ transcriptId: z.uuid().nullable(), jobId: z.uuid().nullable() });

// Resolve current safe state without exposing owner, storage or provider metadata.
export async function getCaptureState(client: SupabaseClient, recordingId: string) {
  const { data, error } = await client.rpc("get_recording_capture_state_v1", { p_recording_id: recordingId });
  if (error || !data) throw new CaptureError(error?.code ?? "42501");
  return captureStateSchema.parse(data);
}
export type CaptureTransition = {
  transition: "upload_complete" | "capture_failed" | "text_only" | "live_draft" | "live_final" | "import_final" | "recover";
  durationSeconds?: number | null;
  mimeType?: string;
  fileSizeBytes?: number;
  rawText?: string;
  segments?: unknown[];
  speakers?: unknown[];
};

// Freeze the selected scope before the first draft or queued item can start.
export function createCaptureAttempt(scope: CaptureScope = { projectId: null, visibility: "private", recipients: [] }, requestId = crypto.randomUUID()): CaptureAttempt {
  const parsed = captureScopeSchema.parse(scope);
  parsed.recipients.forEach(Object.freeze);
  Object.freeze(parsed.recipients);
  Object.freeze(parsed);
  return { requestId, scope: parsed, captureRevision: 0, requests: {} };
}

// Create through the session contract; technical identity always comes from the database.
export async function createCaptureDraft(client: SupabaseClient, attempt: CaptureAttempt, title: string, source: string): Promise<string> {
  attempt.createPayload ??= { title, source };
  const { data, error } = await client.rpc("create_recording_with_access_v1", {
    p_request_id: attempt.requestId, p_title: attempt.createPayload.title, p_source_type: attempt.createPayload.source,
    p_project_id: attempt.scope.projectId, p_visibility: attempt.scope.visibility, p_recipients: attempt.scope.recipients
  });
  if (error || !z.uuid().safeParse(data).success) throw new CaptureError(error?.code ?? "invalid_response");
  attempt.recordingId = data as string;
  return attempt.recordingId;
}

// Persist one immutable transition attempt and update the local revision only after its receipt.
export async function applyCaptureTransition(client: SupabaseClient, attempt: CaptureAttempt, key: string, payload: CaptureTransition) {
  if (!attempt.recordingId) throw new CaptureError("invalid_recording");
  const request = attempt.requests[key] ??= { requestId: crypto.randomUUID(), revision: attempt.captureRevision, payload: structuredClone(payload) };
  const p = request.payload;
  const { data, error } = await client.rpc("apply_recording_capture_transition_v1", {
    p_recording_id: attempt.recordingId, p_request_id: request.requestId,
    p_expected_capture_revision: request.revision, p_transition: p.transition,
    p_duration_seconds: p.durationSeconds ?? null, p_mime_type: p.mimeType ?? null,
    p_file_size_bytes: p.fileSizeBytes ?? null, p_raw_text: p.rawText ?? null,
    p_segments: p.segments ?? null, p_speakers: p.speakers ?? null
  });
  if (error) throw new CaptureError(error.code ?? "unknown");
  const receipt = captureReceiptSchema.parse(data);
  if (receipt.recordingId !== attempt.recordingId) throw new CaptureError("invalid_response");
  attempt.captureRevision = Math.max(attempt.captureRevision, receipt.captureRevision);
  return receipt;
}
