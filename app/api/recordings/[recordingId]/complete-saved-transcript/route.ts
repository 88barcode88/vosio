import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertInvitationOrigin } from "@/lib/recording-sharing/invitation-http.server";
import { captureReceiptSchema } from "@/lib/recordings/capture";
import { captureFailure, captureRequestSchema } from "@/lib/recordings/capture-route.server";

// Confirm only the saved server transcript through the session's atomic authority/CAS contract.
export async function POST(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try { assertInvitationOrigin(request); } catch { return captureFailure("42501"); }
  const id = z.uuid().safeParse((await context.params).recordingId);
  const body = captureRequestSchema.strict().safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return captureFailure("22023");
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  const result = await client.rpc("complete_saved_recording_transcript_v1", {
    p_recording_id: id.data, p_request_id: body.data.requestId, p_expected_capture_revision: body.data.captureRevision
  });
  if (result.error) return captureFailure(result.error.code);
  const receipt = captureReceiptSchema.safeParse(result.data);
  if (!receipt.success || receipt.data.recordingId !== id.data || receipt.data.status !== "completed"
    || !receipt.data.transcriptId || receipt.data.jobId !== null) return captureFailure();
  return NextResponse.json({ recording: { id: id.data }, receipt: receipt.data }, { headers: { "Cache-Control": "no-store" } });
}
