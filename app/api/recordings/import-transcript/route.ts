import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { captureScopeSchema, createCaptureAttempt, createCaptureDraft, applyCaptureTransition, CaptureError } from "@/lib/recordings/capture";
import { captureFailure } from "@/lib/recordings/capture-route.server";
import { assertInvitationOrigin } from "@/lib/recording-sharing/invitation-http.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexCapturedTranscript } from "@/lib/transcripts/capture-index.server";
import { getTranscriptSearchWarningPayload } from "@/lib/transcripts/search-warning";
import { extractImportedTranscriptFromFile } from "@/lib/transcripts/import-file";
import { getImportedTranscriptValidationError, normalizeImportedTranscriptText, normalizeImportedTranscriptTitle } from "@/lib/transcripts/manual-import";

export const runtime = "nodejs";
const inputSchema = z.object({ requestId: z.uuid(), transitionRequestId: z.uuid(), scope: captureScopeSchema, title: z.string().optional(), rawText: z.string() });

// Parse file/text import with the caller's preallocated immutable scope and request identifiers.
async function parseImport(request: NextRequest) {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) return inputSchema.parse(await request.json());
  const form = await request.formData();
  const file = form.get("transcriptFile");
  const rawText = file instanceof File && file.size > 0 ? await extractImportedTranscriptFromFile(file) : String(form.get("rawText") ?? "");
  return inputSchema.parse({ requestId: form.get("requestId"), transitionRequestId: form.get("transitionRequestId"), scope: JSON.parse(String(form.get("scope") ?? "{}")), title: String(form.get("title") ?? "") || (file instanceof File ? file.name.replace(/\.[^.]+$/, "") : ""), rawText });
}

// Import creates exactly one scoped draft and finalizes through an idempotent session transaction.
export async function POST(request: NextRequest) {
  try { assertInvitationOrigin(request); } catch { return NextResponse.json({ error: "Požadavek není povolený." }, { status: 403 }); }
  let body: z.infer<typeof inputSchema>;
  try { body = await parseImport(request); } catch { return NextResponse.json({ error: "Neplatná data přepisu." }, { status: 400 }); }
  const text = normalizeImportedTranscriptText(body.rawText);
  const validation = getImportedTranscriptValidationError(text);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  try {
    const attempt = createCaptureAttempt(body.scope, body.requestId);
    const id = await createCaptureDraft(client, attempt, normalizeImportedTranscriptTitle(body.title), "realtime");
    attempt.requests.final = { requestId: body.transitionRequestId, revision: 0, payload: { transition: "import_final", rawText: text, segments: [], speakers: [] } };
    const receipt = await applyCaptureTransition(client, attempt, "final", attempt.requests.final.payload);
    const index = receipt.transcriptId ? await indexCapturedTranscript(createAdminClient(), receipt.transcriptId) : { status: "ready" };
    return NextResponse.json({ recordingId: id, transcriptId: receipt.transcriptId, ...getTranscriptSearchWarningPayload(index) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return captureFailure(error instanceof CaptureError ? error.code : undefined); }
}
