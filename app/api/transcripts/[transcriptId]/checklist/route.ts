import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checklistErrorStatus, checklistReview, checklistSnapshotSchema } from "@/lib/ai/checklist-delete";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ transcriptId: z.uuid() });
const bodySchema = z.object({ snapshot: checklistSnapshotSchema }).strict();
type Context = { params: Promise<{ transcriptId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Loads a single bounded, locked review covering every task/output for this transcript.
export async function GET(_request: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Neplatné ID přepisu." }, { status: 400, headers });
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401, headers });
  try {
    const { data, error } = await client.rpc("get_managed_transcript_checklist_v1", { p_transcript_id: params.data.transcriptId });
    if (error) return NextResponse.json({ error: "Checklist není dostupný. Obnovte rozsah a potvrzení." }, { status: checklistErrorStatus(error.code), headers });
    const snapshot = checklistSnapshotSchema.safeParse(data?.snapshot);
    if (!snapshot.success || snapshot.data.transcriptId !== params.data.transcriptId
      || !Array.isArray(data?.logicalTasks) || data.logicalTasks.length !== snapshot.data.tasks.length) {
      return NextResponse.json({ error: "Checklist se nepodařilo načíst." }, { status: 500, headers });
    }
    return NextResponse.json(checklistReview(snapshot.data, data.logicalTasks), { headers });
  } catch { return NextResponse.json({ error: "Checklist se nepodařilo načíst." }, { status: 500, headers }); }
}

// Removes only the exact reviewed checklist in one session RPC, with no provider or admin call.
export async function DELETE(request: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success || body.data.snapshot.transcriptId !== params.data.transcriptId) {
    return NextResponse.json({ error: "Neplatný snapshot checklistu." }, { status: 400, headers });
  }
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401, headers });
  try {
    const { data, error } = await client.rpc("delete_managed_transcript_checklist_v1", {
      p_transcript_id: params.data.transcriptId, p_snapshot: body.data.snapshot
    });
    if (error) return NextResponse.json({ error: "Checklist se změnil nebo není dostupný. Obnovte rozsah a potvrzení." }, { status: checklistErrorStatus(error.code), headers });
    const expected = body.data.snapshot.tasks.map((task) => task.id).sort();
    if (data?.transcriptId !== params.data.transcriptId || data?.deletedCount !== expected.length
      || !Array.isArray(data?.deletedIds) || JSON.stringify([...data.deletedIds].sort()) !== JSON.stringify(expected)) {
      return NextResponse.json({ error: "Výsledek smazání se nepodařilo ověřit." }, { status: 409, headers });
    }
    return NextResponse.json({ ok: true, deletedIds: data.deletedIds, suppressionIds: body.data.snapshot.outputs.map((output) => output.id),
      deletedCount: data.deletedCount, transcriptId: data.transcriptId }, { headers });
  } catch { return NextResponse.json({ error: "Checklist se nepodařilo smazat." }, { status: 500, headers }); }
}
