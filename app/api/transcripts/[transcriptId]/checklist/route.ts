import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checklistErrorStatus, checklistReview, checklistSnapshotSchema, snapshotRowCounts } from "@/lib/ai/checklist-delete";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ transcriptId: z.uuid() });
const bodySchema = z.object({ snapshot: checklistSnapshotSchema }).strict();
type Context = { params: Promise<{ transcriptId: string }> };
const headers = { "Cache-Control": "private, no-store" };

// Compares an RPC receipt ID list with the reviewed IDs, ignoring order.
function sameIds(actual: unknown, expected: string[]) {
  return Array.isArray(actual) && actual.length === expected.length
    && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

// Loads a single bounded, locked review covering every task, decision, risk and output of this transcript.
export async function GET(_request: NextRequest, context: Context) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Neplatné ID přepisu." }, { status: 400, headers });
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401, headers });
  try {
    const { data, error } = await client.rpc("get_managed_transcript_checklist_v2", { p_transcript_id: params.data.transcriptId });
    if (error) return NextResponse.json({ error: "Checklist není dostupný. Obnovte rozsah a potvrzení." }, { status: checklistErrorStatus(error.code), headers });
    const snapshot = checklistSnapshotSchema.safeParse(data?.snapshot);
    if (!snapshot.success || snapshot.data.transcriptId !== params.data.transcriptId
      || !Array.isArray(data?.logicalTasks) || data.logicalTasks.length !== snapshot.data.tasks.length
      || !Array.isArray(data?.logicalDecisions) || data.logicalDecisions.length !== snapshot.data.decisions.length
      || !Array.isArray(data?.logicalRisks) || data.logicalRisks.length !== snapshot.data.risks.length) {
      return NextResponse.json({ error: "Checklist se nepodařilo načíst." }, { status: 500, headers });
    }
    return NextResponse.json(checklistReview(snapshot.data, {
      tasks: data.logicalTasks, decisions: data.logicalDecisions, risks: data.logicalRisks
    }), { headers });
  } catch { return NextResponse.json({ error: "Checklist se nepodařilo načíst." }, { status: 500, headers }); }
}

// Removes only the exact reviewed tasks, decisions and risks in one session RPC, with no provider or admin call.
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
    const { data, error } = await client.rpc("delete_managed_transcript_checklist_v2", {
      p_transcript_id: params.data.transcriptId, p_snapshot: body.data.snapshot
    });
    if (error) return NextResponse.json({ error: "Checklist se změnil nebo není dostupný. Obnovte rozsah a potvrzení." }, { status: checklistErrorStatus(error.code), headers });
    const { snapshot } = body.data;
    const expected = { tasks: snapshot.tasks, decisions: snapshot.decisions, risks: snapshot.risks };
    const kinds = Object.keys(expected) as Array<keyof typeof expected>;
    const total = kinds.reduce((sum, kind) => sum + expected[kind].length, 0);
    if (data?.transcriptId !== params.data.transcriptId || data?.deletedCount !== total
      || kinds.some((kind) => !sameIds(data?.[kind], expected[kind].map((row) => row.id)))) {
      return NextResponse.json({ error: "Výsledek smazání se nepodařilo ověřit." }, { status: 409, headers });
    }
    return NextResponse.json({ ok: true, deletedIds: kinds.flatMap((kind) => expected[kind].map((row) => row.id)),
      deletedCounts: snapshotRowCounts(snapshot), suppressionIds: snapshot.outputs.map((output) => output.id),
      deletedCount: data.deletedCount, transcriptId: data.transcriptId }, { headers });
  } catch { return NextResponse.json({ error: "Checklist se nepodařilo smazat." }, { status: 500, headers }); }
}
