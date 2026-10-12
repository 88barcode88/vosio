import { createClient } from "@/lib/supabase/browser";
import { createCaptureAttempt, getCaptureState, captureReceiptSchema, CaptureError } from "@/lib/recordings/capture";
import type { LiveRecordingDraft } from "@/lib/recordings/upload";
import { hasTranscriptSearchIndexWarning, TRANSCRIPT_SEARCH_INDEX_WARNING } from "@/lib/transcripts/search-warning";

import { queueLiveCapture } from "@/lib/recordings/live-capture-queue";

// Serialize autosave/final requests per persistent session and retain exact payload after uncertain transport.
export async function sendLiveCapture(recording: LiveRecordingDraft, kind: "live_draft" | "live_final", payload: { rawText: string; segments: unknown[]; elapsedSeconds?: number }) {
  const capture = recording.capture ??= createCaptureAttempt();
  capture.recordingId = recording.id;
  return queueLiveCapture(capture, async () => {
    if (!capture.requests[kind]) {
      capture.captureRevision = (await getCaptureState(createClient(), recording.id)).captureRevision;
      capture.requests[kind] = { requestId: crypto.randomUUID(), revision: capture.captureRevision,
        payload: { transition: kind, rawText: payload.rawText, segments: structuredClone(payload.segments), durationSeconds: payload.elapsedSeconds } };
    }
    const pending = capture.requests[kind];
    const response = await fetch(`/api/recordings/${recording.id}/${kind === "live_draft" ? "live-draft" : "live-transcript"}`, {
      method: kind === "live_draft" ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: pending.requestId, captureRevision: pending.revision,
        rawText: pending.payload.rawText, segments: pending.payload.segments, elapsedSeconds: pending.payload.durationSeconds })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new CaptureError(body?.code ?? "unknown");
    const result = captureReceiptSchema.parse(body);
    if (result.recordingId !== recording.id) throw new CaptureError("invalid_response");
    capture.captureRevision = Math.max(capture.captureRevision, result.captureRevision);
    if (kind === "live_draft") delete capture.requests[kind];
    return { ...result, ...(hasTranscriptSearchIndexWarning(body) ? { warnings: [TRANSCRIPT_SEARCH_INDEX_WARNING] } : {}) };
  });
}
