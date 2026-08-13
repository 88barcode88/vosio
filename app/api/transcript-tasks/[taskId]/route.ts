import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTaskDedupeKey } from "@/lib/ai/structured-dedupe";
import type { StructuredTaskRow } from "@/lib/ai/structured-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({ taskId: z.uuid() });

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

type TaskDeleteCandidate = Pick<
  StructuredTaskRow,
  "deadline" | "deadline_normalized" | "owner_category" | "title" | "transcript_id"
> & { id: string };

// DELETE removes the owned logical task projection while preserving its source AI artifact.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return NextResponse.json({ error: "Neplatné ID úkolu." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin
    .from("transcript_tasks")
    .select("id,transcript_id,owner_category,title,deadline,deadline_normalized")
    .eq("id", params.data.taskId)
    .eq("user_id", user.id)
    .maybeSingle<TaskDeleteCandidate>();

  if (targetError) {
    return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  }

  if (!target) {
    return NextResponse.json({ error: "Úkol nebyl nalezen." }, { status: 404 });
  }

  const { data: transcript, error: transcriptError } = await admin
    .from("transcripts")
    .select("recording_id")
    .eq("id", target.transcript_id)
    .eq("user_id", user.id)
    .maybeSingle<{ recording_id: string }>();

  if (transcriptError || !transcript) {
    return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  }

  const { data: transcripts, error: transcriptsError } = await admin
    .from("transcripts")
    .select("id")
    .eq("recording_id", transcript.recording_id)
    .eq("user_id", user.id)
    .returns<Array<{ id: string }>>();

  if (transcriptsError || !transcripts) {
    return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  }

  const transcriptIds = transcripts.map((row) => row.id);
  const { data: candidates, error: candidatesError } = await admin
    .from("transcript_tasks")
    .select("id,transcript_id,owner_category,title,deadline,deadline_normalized")
    .in("transcript_id", transcriptIds)
    .eq("user_id", user.id)
    .returns<TaskDeleteCandidate[]>();

  if (candidatesError || !candidates) {
    return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  }

  const targetKey = getTaskDedupeKey(target);
  const transcriptIdSet = new Set(transcriptIds);
  const matchingIds = candidates
    .filter((candidate) => (
      transcriptIdSet.has(candidate.transcript_id)
      && getTaskDedupeKey(candidate) === targetKey
    ))
    .map((candidate) => candidate.id)
    .filter((id): id is string => Boolean(id));

  if (!matchingIds.includes(target.id)) {
    return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  }

  const { data: deleted, error: deleteError } = await admin
    .from("transcript_tasks")
    .delete()
    .eq("user_id", user.id)
    .in("id", matchingIds)
    .select("id");

  if (deleteError || !deleted) {
    return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  }

  revalidatePath("/recordings");
  revalidatePath(`/recordings/${transcript.recording_id}`);

  return NextResponse.json({ deleted: deleted.length, ok: true });
}
