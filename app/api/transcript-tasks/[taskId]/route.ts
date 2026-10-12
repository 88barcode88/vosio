import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTaskDedupeKey } from "@/lib/ai/structured-dedupe";
import type { StructuredTaskRow } from "@/lib/ai/structured-types";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { managedMutationError } from "@/lib/recordings/trash-service.server";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({ taskId: z.uuid() });

type RouteContext = {
  params: Promise<{ taskId: string }>;
};

type TaskDeleteCandidate = Pick<
  StructuredTaskRow,
  "deadline" | "deadline_normalized" | "owner_category" | "title" | "transcript_id"
> & { id: string; updated_at: string };

// Deletes one logical task snapshot atomically under current recording-manager authority.
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

  try {
  const { data: target, error: targetError } = await supabase.from("transcript_tasks")
    .select("id,transcript_id,owner_category,title,deadline,deadline_normalized,updated_at")
    .eq("id", params.data.taskId).maybeSingle<TaskDeleteCandidate>();
  if (targetError) return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  if (!target) return NextResponse.json({ error: "Úkol není dostupný." }, { status: 403 });
  const { data: transcript, error: transcriptError } = await supabase.from("transcripts")
    .select("recording_id").eq("id", target.transcript_id).maybeSingle<{ recording_id: string }>();
  if (transcriptError) return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 });
  if (!transcript || !(await resolveRecordingCapabilities(supabase, transcript.recording_id)).delete) {
    return NextResponse.json({ error: "Smazání není povoleno." }, { status: 403 });
  }
  const candidates = await fetchAllRows<TaskDeleteCandidate>("Unable to load task group", (from, to) => supabase
    .from("transcript_tasks").select("id,transcript_id,owner_category,title,deadline,deadline_normalized,updated_at,transcripts!inner(recording_id)")
    .eq("transcripts.recording_id", transcript.recording_id).order("id").range(from, to));
  const targetKey = getTaskDedupeKey(target);
  const matchingIds = [...new Set(candidates.filter((candidate) => getTaskDedupeKey(candidate) === targetKey).map((candidate) => candidate.id))];
  if (!matchingIds.includes(target.id) || matchingIds.length > 1000) {
    return NextResponse.json({ error: "Úkoly se změnily nebo je skupina příliš velká." }, { status: 409 });
  }
  const { data, error } = await supabase.rpc("delete_managed_transcript_task_group_v1", {
    p_task_id: target.id, p_expected_updated_at: target.updated_at, p_task_ids: matchingIds
  });
  if (error) {
    const code = managedMutationError(error).code;
    return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: code === "forbidden" ? 403 : code === "conflict" ? 409 : code === "invalid_item" ? 400 : 500 });
  }
  if (data?.recordingId !== transcript.recording_id || data?.deletedCount !== matchingIds.length) {
    return NextResponse.json({ error: "Úkoly se změnily." }, { status: 409 });
  }

  revalidatePath("/recordings");
  revalidatePath(`/recordings/${transcript.recording_id}`);

  return NextResponse.json({ deleted: data.deletedCount, ok: true });
  } catch { return NextResponse.json({ error: "Úkol se nepodařilo smazat." }, { status: 500 }); }
}
