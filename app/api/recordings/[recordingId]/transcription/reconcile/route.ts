import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertInvitationOrigin } from "@/lib/recording-sharing/invitation-http.server";
import { captureFailure } from "@/lib/recordings/capture-route.server";
import { runTranscriptionOperation } from "@/lib/recordings/transcription-dispatch.server";

export const runtime = "nodejs";
export const maxDuration = 300;

// A current manager may wake only this recording's existing accepted operation, never create a job.
export async function POST(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try { assertInvitationOrigin(request); } catch { return captureFailure("42501"); }
  const id = z.uuid().safeParse((await context.params).recordingId);
  if (!id.success) return captureFailure("22023");
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  const managed = await client.rpc("get_managed_recording_transcription_v1", { p_recording_ids: [id.data] });
  if (managed.error) return captureFailure(managed.error.code);
  const row = Array.isArray(managed.data) ? managed.data.find((r) => r.recording_id === id.data) : null;
  const operationId = z.uuid().safeParse(row?.operation_id);
  if (!operationId.success) return captureFailure("42501");
  if (["started", "accepted", "manual_required"].includes(row.phase)) after(async () => {
    try { await runTranscriptionOperation(createAdminClient(), operationId.data, 1_000, false); }
    catch { console.error("[Vosio transcription] Reconciliation requires recovery."); }
  });
  return NextResponse.json({ ok: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
