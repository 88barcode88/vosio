import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertInvitationOrigin } from "@/lib/recording-sharing/invitation-http.server";
import { captureFailure } from "@/lib/recordings/capture-route.server";
import { recoverTranscriptionOperation, TranscriptionRecoveryError, type RecoveryCode } from "@/lib/recordings/transcription-recovery.server";
import { runTranscriptionOperation } from "@/lib/recordings/transcription-dispatch.server";

export const runtime = "nodejs";
export const maxDuration = 300;
const bodySchema = z.object({ operationId: z.uuid(), requestId: z.uuid(), action: z.enum(["resume", "stop"]) }).strict();
const messages: Record<RecoveryCode, string> = {
  provider_authentication: "Soniox odmítl přístup. Zkontrolujte API klíč a region přepisu v nastavení instalace.",
  provider_unavailable: "Soniox se nepodařilo ověřit. Původní pokus zůstává zachovaný; nový přepis se nespustil.",
  provider_processing: "Původní přepis v Sonioxu čeká nebo běží. Použijte Dohledat původní přepis; další placený pokus se nespustil.",
  provider_completed: "Původní přepis už je hotový. Použijte Dohledat původní přepis pro načtení výsledku.",
  submission_pending: "Původní worker nebo zastavení může ještě probíhat. Vyčkejte na dokončení kontroly a zkuste to znovu.",
  lookup_incomplete: "Vyhledání v Sonioxu není úplné. Nový přepis se nespustil; zkuste obnovu znovu.",
  ambiguous_job: "Původní úlohu nelze jednoznačně ověřit. Nový přepis se nespustil.",
  not_found: "Původní úloha se v Sonioxu nenašla. Můžete zastavit starý pokus a spustit nový přepis.",
  state_changed: "Stav přepisu se během obnovy změnil. Zkontrolujte aktuální stav a zkuste to znovu.",
  recovery_unavailable: "Server nemohl načíst podklady pro obnovu přepisu. Zkuste to znovu; pokud chyba trvá, správce musí ověřit migraci obnovy. Nový přepis se nespustil."
};

// Current managers may recover only their latest exact operation; new provider submission is a separate explicit start.
export async function POST(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  const startedAt = Date.now();
  try { assertInvitationOrigin(request); } catch { return captureFailure("42501"); }
  const id = z.uuid().safeParse((await context.params).recordingId);
  const input = bodySchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) return captureFailure("22023");
  const recoveryInput = input.data;
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  const managed = await client.rpc("get_managed_recording_transcription_v1", { p_recording_ids: [id.data] });
  const row = Array.isArray(managed.data) ? managed.data.find(row => row.recording_id === id.data) : null;
  if (managed.error || !row) return captureFailure("42501");
  if (row.operation_id !== input.data.operationId) return captureFailure("40001");
  // Session RPCs accept or release stop intent under fresh manager authority before any provider mutation.
  async function authorize(name: string, snapshot: unknown[]) {
    const authorized = await client.rpc(name, { p_operation_id: recoveryInput.operationId, p_snapshot: snapshot,
      ...(name === "prepare_recording_transcription_stop_v1" ? { p_request_id: recoveryInput.requestId } : {}) });
    if (authorized.error) throw new TranscriptionRecoveryError(authorized.error.code === "55000" ? "submission_pending" : "state_changed");
    if (authorized.data?.operationId !== recoveryInput.operationId || !(authorized.data?.reserved || authorized.data?.resumed)) {
      throw new TranscriptionRecoveryError("state_changed");
    }
  }
  try {
    const result = await recoverTranscriptionOperation(createAdminClient({ fetchTimeoutMs: 15000 }), {
      recordingId: id.data, operationId: input.data.operationId, actorId: auth.data.user.id,
      requestId: input.data.requestId, action: input.data.action
    }, { reserveStop: snapshot => authorize("prepare_recording_transcription_stop_v1", snapshot),
      resume: snapshot => authorize("resume_recording_transcription_stop_v1", snapshot) });
    if (result.stopped) {
      const stopped = await client.rpc("stop_recording_transcription_v1", { p_operation_id: input.data.operationId, p_request_id: input.data.requestId });
      if (stopped.error) return captureFailure(stopped.error.code);
      if (stopped.data?.stopped !== true || stopped.data?.operationId !== input.data.operationId) return captureFailure();
    } else if (input.data.action === "resume" && result.status !== "failed") after(async () => {
      try { await runTranscriptionOperation(createAdminClient({ fetchTimeoutMs: 15000 }), input.data.operationId,
        Math.max(1000, Math.min(240000, 285000 - (Date.now() - startedAt)))); }
      catch { console.error("[Vosio transcription] Recovery continuation unavailable."); }
    });
    return NextResponse.json({ job: { status: result.status }, stopped: result.stopped ?? false,
      message: result.stopped ? "Starý pokus je zastavený. Audio zůstalo uložené; můžete spustit nový přepis."
        : result.status === "failed" ? "Původní pokus skončil. Můžete spustit nový přepis." : "Navazuji na původní přepis. Nová Soniox úloha se nevytvořila." },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TranscriptionRecoveryError) return NextResponse.json({ error: messages[error.code], code: error.code },
      { status: ["provider_authentication", "provider_unavailable", "recovery_unavailable"].includes(error.code) ? 503 : 409, headers: { "Cache-Control": "no-store" } });
    return captureFailure();
  }
}
