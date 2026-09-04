import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({ outputId: z.uuid() });
const querySchema = z.object({ transcriptId: z.uuid() });
type RouteContext = { params: Promise<{ outputId: string }> };

// GET returns one exact owner-scoped AI artifact body plus only its normalized projection rows.
export async function GET(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);
  const query = querySchema.safeParse({ transcriptId: request.nextUrl.searchParams.get("transcriptId") });
  if (!params.success || !query.success) return notFoundResponse();

  const outputId = params.data.outputId;
  const transcriptId = query.data.transcriptId;
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });

  const { data: transcript } = await supabase.from("transcripts")
    .select("id").eq("id", transcriptId).eq("user_id", user.id).maybeSingle<{ id: string }>();
  if (!transcript) return notFoundResponse();

  const { data: output } = await supabase.from("ai_outputs")
    .select("id,created_at,output_json,output_text,processing_job_id,transcript_id,ai_processing_jobs(processing_type)")
    .eq("id", outputId).eq("transcript_id", transcriptId).eq("user_id", user.id).maybeSingle();
  if (!output) return notFoundResponse();

  const [tasks, chapters, decisions, risks] = await Promise.all([
    loadOutputRows(supabase, "transcript_tasks", outputId, transcriptId, user.id),
    loadOutputRows(supabase, "transcript_chapters", outputId, transcriptId, user.id),
    loadOutputRows(supabase, "transcript_decisions", outputId, transcriptId, user.id),
    loadOutputRows(supabase, "transcript_risks", outputId, transcriptId, user.id)
  ]);
  if ([tasks, chapters, decisions, risks].some((result) => result.error)) {
    return NextResponse.json({ error: "AI výstup se nepodařilo načíst." }, { status: 500 });
  }

  const joinedJob = Array.isArray(output.ai_processing_jobs)
    ? output.ai_processing_jobs[0] ?? null
    : output.ai_processing_jobs;
  return NextResponse.json({
    output: {
      created_at: output.created_at,
      id: output.id,
      output_json: output.output_json,
      output_text: output.output_text,
      processing_job_id: output.processing_job_id,
      processing_type: joinedJob?.processing_type ?? null,
      transcript_id: output.transcript_id
    },
    structuredItems: {
      chapters: chapters.data ?? [],
      decisions: decisions.data ?? [],
      risks: risks.data ?? [],
      tasks: tasks.data ?? []
    }
  }, { headers: { "Cache-Control": "private, no-store" } });
}

// loadOutputRows scopes one projection table to the requested artifact, transcript, and owner.
function loadOutputRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName: "transcript_tasks" | "transcript_chapters" | "transcript_decisions" | "transcript_risks",
  outputId: string,
  transcriptId: string,
  userId: string
) {
  return supabase.from(tableName).select("*")
    .eq("ai_output_id", outputId).eq("transcript_id", transcriptId).eq("user_id", userId)
    .order("position", { ascending: true });
}

// notFoundResponse deliberately makes cross-owner and transcript mismatch indistinguishable.
function notFoundResponse() {
  return NextResponse.json({ error: "AI výstup nebyl nalezen." }, { status: 404 });
}
