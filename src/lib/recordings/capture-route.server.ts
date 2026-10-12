import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexCapturedTranscript } from "@/lib/transcripts/capture-index.server";
import { getTranscriptSearchWarningPayload } from "@/lib/transcripts/search-warning";
import { assertInvitationOrigin } from "@/lib/recording-sharing/invitation-http.server";
import { captureReceiptSchema, CaptureError } from "@/lib/recordings/capture";
import { extractTranscriptSpeakerSummaries } from "@/lib/transcripts/speakers";

export const captureRequestSchema = z.object({ requestId: z.uuid(), captureRevision: z.number().int().nonnegative() });
type Context = { params: Promise<{ recordingId: string }> };

// Persist under session authority; only its validated durable receipt may trigger derived service indexing.
export async function runCaptureRoute(request: Request, context: Context, transition: "live_draft" | "live_final" | "recover") {
  try { assertInvitationOrigin(request); } catch { return NextResponse.json({ error: "Požadavek není povolený." }, { status: 403 }); }
  const recording = z.uuid().safeParse((await context.params).recordingId);
  const schema = transition === "recover" ? captureRequestSchema : captureRequestSchema.extend({
    rawText: z.string().max(1_000_000), segments: z.array(z.unknown()).max(200_000).default([]),
    elapsedSeconds: z.number().finite().nonnegative().optional(), audioStorage: z.string().optional()
  });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!recording.success || !parsed.success) return NextResponse.json({ error: "Neplatná data nahrávky." }, { status: 400 });
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  const body = parsed.data;
  const text = "rawText" in body && typeof body.rawText === "string" ? body.rawText : null;
  const segments = "segments" in body && Array.isArray(body.segments) ? body.segments : null;
  const elapsed = "elapsedSeconds" in body && typeof body.elapsedSeconds === "number" ? Math.ceil(body.elapsedSeconds) : null;
  const result = await client.rpc("apply_recording_capture_transition_v1", {
    p_recording_id: recording.data, p_request_id: body.requestId, p_expected_capture_revision: body.captureRevision,
    p_transition: transition, p_duration_seconds: elapsed, p_mime_type: null, p_file_size_bytes: null,
    p_raw_text: text, p_segments: segments, p_speakers: segments === null ? null : extractTranscriptSpeakerSummaries(segments)
  });
  if (result.error) return captureFailure(result.error.code);
  const receipt = captureReceiptSchema.safeParse(result.data);
  if (!receipt.success || receipt.data.recordingId !== recording.data) return captureFailure();
  const index = receipt.data.transcriptId ? await indexCapturedTranscript(createAdminClient(), receipt.data.transcriptId) : { status: "ready" };
  return NextResponse.json({ ...receipt.data, ...getTranscriptSearchWarningPayload(index), ok: true, transcript: { id: receipt.data.transcriptId }, recording: { id: recording.data, status: receipt.data.status, transcriptId: receipt.data.transcriptId } }, { headers: { "Cache-Control": "no-store" } });
}

// Map canonical DB failures without exposing row IDs, provider errors or private taxonomy.
export function captureFailure(code = "unknown") {
  return NextResponse.json({ error: new CaptureError(code).message, code }, { status: code === "42501" ? 403 : code === "22023" ? 400 : ["40001", "55000"].includes(code) ? 409 : 503 });
}
