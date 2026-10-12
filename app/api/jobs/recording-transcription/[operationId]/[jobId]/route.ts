import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTranscriptionOperation, verifyTranscriptionWebhook } from "@/lib/recordings/transcription-dispatch.server";
import { invitationBody } from "@/lib/recording-sharing/invitation-http.server";

export const runtime = "nodejs";
export const maxDuration = 300;
const callback = z.object({ id: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/), status: z.enum(["completed", "error"]) }).strict();

// A per-job callback can advance only frozen matching custody; status/text always come from provider GET.
export async function POST(request: Request, context: { params: Promise<{ operationId: string; jobId: string }> }) {
  const ids = z.object({ operationId: z.uuid(), jobId: z.uuid() }).safeParse(await context.params);
  if (!ids.success) return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  try {
    if (!verifyTranscriptionWebhook(ids.data.operationId, ids.data.jobId, request.headers.get("X-Vosio-Transcription"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = callback.safeParse(await invitationBody(request as Parameters<typeof invitationBody>[0]));
    if (!body.success) return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
    const admin = createAdminClient();
    const verified = await admin.rpc("get_recording_transcription_dispatch_v1", {
      p_operation_id: ids.data.operationId, p_job_id: ids.data.jobId, p_provider_job_id: body.data.id
    });
    if (verified.error) return NextResponse.json({ error: "Callback not ready" }, { status: 503 });
    const phase = await runTranscriptionOperation(admin, ids.data.operationId);
    return NextResponse.json({ ok: true }, { status: phase === "pending" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Callback unavailable" }, { status: 503 }); }
}
