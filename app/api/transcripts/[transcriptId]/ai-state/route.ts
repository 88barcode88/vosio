import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { ManualAiJobSummary, ManualAiOutputMetadata } from "@/lib/ai/manual-job-state";
import { AI_FAILURE_CODES, type AiFailureCode } from "@/lib/ai/provider-errors";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({ transcriptId: z.uuid() });
const MAX_MANUAL_AI_STATE_ROWS = 50;
const outputOffsetSchema = z.coerce.number().int().safe().nonnegative().multipleOf(MAX_MANUAL_AI_STATE_ROWS);

type RouteContext = { params: Promise<{ transcriptId: string }> };
type OutputMetadataRow = Omit<ManualAiOutputMetadata, "body_loaded" | "processing_type"> & {
  ai_processing_jobs?: { processing_type?: string | null } | Array<{ processing_type?: string | null }> | null;
};

// getJoinedRow unwraps Supabase's to-one relation without trusting its generated shape.
function getJoinedRow<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

// getSafeFailureCode drops any unrecognized historical value at the API boundary.
function getSafeFailureCode(value: unknown): AiFailureCode | null {
  return typeof value === "string" && (AI_FAILURE_CODES as readonly string[]).includes(value)
    ? value as AiFailureCode
    : null;
}

// GET returns bounded owner-scoped manual job summaries and artifact metadata for one transcript.
export async function GET(request: NextRequest, context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);
  if (!params.success) return NextResponse.json({ error: "Přepis nebyl nalezen." }, { status: 404 });
  const parsedOffset = outputOffsetSchema.safeParse(request.nextUrl.searchParams.get("outputOffset") ?? 0);
  if (!parsedOffset.success) return NextResponse.json({ error: "Neplatná stránka AI výstupů." }, { status: 400 });

  const transcriptId = params.data.transcriptId;
  const outputOffset = parsedOffset.data;
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 });

  const { data: transcript } = await supabase.from("transcripts")
    .select("id").eq("id", transcriptId).eq("user_id", user.id).maybeSingle<{ id: string }>();
  if (!transcript) return NextResponse.json({ error: "Přepis nebyl nalezen." }, { status: 404 });

  const [jobsResult, outputsResult] = await Promise.all([
    supabase.from("ai_processing_jobs")
      .select("id,processing_type,model,status,created_at,started_at,completed_at,attempt_count,max_attempts,lease_expires_at,failure_code,retry_after_at")
      .eq("transcript_id", transcriptId).eq("user_id", user.id).eq("execution_mode", "manual")
      .in("status", ["queued", "running", "done", "failed"])
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(MAX_MANUAL_AI_STATE_ROWS).returns<ManualAiJobSummary[]>(),
    supabase.from("ai_outputs")
      .select("id,created_at,processing_job_id,transcript_id,ai_processing_jobs(processing_type)")
      .eq("transcript_id", transcriptId).eq("user_id", user.id)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(outputOffset, outputOffset + MAX_MANUAL_AI_STATE_ROWS).returns<OutputMetadataRow[]>()
  ]);

  if (jobsResult.error || outputsResult.error) {
    return NextResponse.json({ error: "AI stav se nepodařilo načíst." }, { status: 500 });
  }

  const jobs = (jobsResult.data ?? []).map((job) => ({
    ...job,
    failure_code: getSafeFailureCode(job.failure_code)
  }));
  const outputRows = outputsResult.data ?? [];
  const outputs = outputRows.slice(0, MAX_MANUAL_AI_STATE_ROWS).map((output): ManualAiOutputMetadata => ({
    body_loaded: false,
    created_at: output.created_at,
    id: output.id,
    processing_job_id: output.processing_job_id,
    processing_type: getJoinedRow(output.ai_processing_jobs)?.processing_type ?? null,
    transcript_id: output.transcript_id
  }));

  const nextOutputOffset = outputRows.length > MAX_MANUAL_AI_STATE_ROWS
    ? outputOffset + MAX_MANUAL_AI_STATE_ROWS
    : null;

  return NextResponse.json(
    { jobs, nextOutputOffset, outputs },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
