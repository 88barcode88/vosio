import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCaptureState, CaptureError } from "@/lib/recordings/capture";
import { captureFailure } from "@/lib/recordings/capture-route.server";
import { assertTranscriptionModel } from "@/lib/recordings/transcription-worker.server";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { assertInvitationOrigin } from "@/lib/recording-sharing/invitation-http.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTranscriptionOperation } from "@/lib/recordings/transcription-dispatch.server";
import { getTranscriptionRecoverySnapshot } from "@/lib/recordings/transcription-recovery.server";

export const runtime = "nodejs";
export const maxDuration = 300;

type Context = { params: Promise<{ recordingId: string }> };
const requestSchema = z.object({ requestId: z.uuid(), captureRevision: z.number().int().nonnegative(), purpose: z.enum(["capture", "retry", "retranscribe"]) }).strict();
const operationSchema = z.object({ operationId: z.uuid(), phase: z.string() });

// Authorize and durably start only through session RPCs; provider calls belong exclusively to the service worker.
export async function POST(request: Request, context: Context) {
  try { assertInvitationOrigin(request); } catch { return NextResponse.json({ error: "Požadavek není povolený." }, { status: 403 }); }
  const id = z.uuid().safeParse((await context.params).recordingId);
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return captureFailure("22023");
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  try {
    const model = assertTranscriptionModel();
    const prepared = await client.rpc("prepare_recording_transcription_v1", {
      p_recording_id: id.data, p_request_id: body.data.requestId, p_expected_capture_revision: body.data.captureRevision,
      p_region: getUserSettingsFromMetadata(auth.data.user.user_metadata).sonioxRegion, p_model: model, p_purpose: body.data.purpose
    });
    if (prepared.error) return captureFailure(prepared.error.code);
    const operation = operationSchema.parse(prepared.data);
    const started = await client.rpc("start_recording_transcription_v1", { p_operation_id: operation.operationId });
    if (started.error) return captureFailure(started.error.code);
    const receipt = operationSchema.parse(started.data);
    if (receipt.operationId !== operation.operationId) return captureFailure();
    if (["started", "accepted"].includes(receipt.phase)) after(async () => {
      try { await runTranscriptionOperation(createAdminClient(), receipt.operationId); }
      catch { console.error("[Vosio transcription] Background dispatch requires recovery."); }
    });
    return NextResponse.json({ operation: receipt, job: { status: receipt.phase === "completed" ? "done" : receipt.phase === "failed" ? "failed" : "queued" } }, { headers: { "Cache-Control": "no-store" } });
  } catch { return captureFailure(); }
}

// User polling reads only safe current state and manager enrichment; it never continues a provider job.
export async function GET(_request: Request, context: Context) {
  const id = z.uuid().safeParse((await context.params).recordingId);
  if (!id.success) return captureFailure("22023");
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  try {
    const state = await getCaptureState(client, id.data);
    const managed = await client.rpc("get_managed_recording_transcription_v1", { p_recording_ids: [id.data] });
    if (managed.error) return captureFailure(managed.error.code);
    const operation = Array.isArray(managed.data) ? managed.data.find((r: { recording_id: string }) => r.recording_id === id.data) : null;
    const status = operation?.phase === "manual_required" ? "manual_required"
      : state.status === "completed" ? "done" : state.status === "failed" ? "failed"
        : operation?.phase === "started" || operation?.phase === "prepared" ? "queued" : state.status === "transcribing" ? "running" : "queued";
    let failureCode: string | null = null;
    if (operation && status === "failed") {
      const snapshot = await getTranscriptionRecoverySnapshot(createAdminClient({ fetchTimeoutMs: 15000 }), id.data, operation.operation_id).catch(() => null);
      const code = snapshot?.work.find(part => part.phase === "failed")?.error_code;
      if (typeof code === "string" && ["provider_authentication", "provider_configuration", "audio_unavailable", "submission_rejected", "rate_limited", "user_stopped"].includes(code)) failureCode = code;
    }
    return NextResponse.json({ state, operation: operation ?? null, canRecover: Boolean(operation), job: { status, failureCode } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return captureFailure(error instanceof CaptureError ? error.code : undefined); }
}
