import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import { getAccessibleOutputTypes } from "@/lib/ai/queries";
import { structuredColumns } from "@/lib/ai/structured-queries";

const routeParamsSchema = z.object({ outputId: z.uuid() });
const querySchema = z.object({ transcriptId: z.uuid() });
type RouteContext = { params: Promise<{ outputId: string }> };

// GET returns one exact currently readable artifact and its safe projections, never personal job state.
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
    .select("id,recording_id").eq("id", transcriptId).maybeSingle<{ id: string; recording_id: string }>();
  if (!transcript) return notFoundResponse();
  if (!(await resolveRecordingCapabilities(supabase, transcript.recording_id)).read) return notFoundResponse();

  const { data: output } = await supabase.from("ai_outputs")
    .select("id,created_at,output_json,output_text,processing_job_id,transcript_id")
    .eq("id", outputId).eq("transcript_id", transcriptId).maybeSingle();
  if (!output) return notFoundResponse();

  const [tasks, chapters, decisions, risks] = await Promise.all([
    loadOutputRows(supabase, "transcript_tasks", outputId, transcriptId),
    loadOutputRows(supabase, "transcript_chapters", outputId, transcriptId),
    loadOutputRows(supabase, "transcript_decisions", outputId, transcriptId),
    loadOutputRows(supabase, "transcript_risks", outputId, transcriptId)
  ]);
  if ([tasks, chapters, decisions, risks].some((result) => result.error)) {
    return NextResponse.json({ error: "AI výstup se nepodařilo načíst." }, { status: 500 });
  }

  const types = await getAccessibleOutputTypes(supabase, [output]);
  return NextResponse.json({
    output: {
      created_at: output.created_at,
      id: output.id,
      output_json: output.output_json,
      output_text: output.output_text,
      processing_job_id: output.processing_job_id,
      processing_type: types.get(output.id) ?? null,
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

// loadOutputRows scopes safe projection columns to the exact RLS-readable artifact and transcript.
function loadOutputRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName: "transcript_tasks" | "transcript_chapters" | "transcript_decisions" | "transcript_risks",
  outputId: string,
  transcriptId: string
) {
  return supabase.from(tableName).select(structuredColumns[tableName])
    .eq("ai_output_id", outputId).eq("transcript_id", transcriptId)
    .order("position", { ascending: true });
}

// notFoundResponse deliberately makes cross-owner and transcript mismatch indistinguishable.
function notFoundResponse() {
  return NextResponse.json({ error: "AI výstup nebyl nalezen." }, { status: 404 });
}
