import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiOutputRow, AiOutputView } from "@/lib/ai/types";
import { fetchAllRows } from "@/lib/supabase/pagination";

type AiOutputJoinRow = AiOutputRow & {
  ai_processing_jobs?: {
    processing_type?: string | null;
  } | null;
};

// listAiOutputs loads saved AI outputs for the current user through Supabase RLS.
export async function listAiOutputs(supabase: SupabaseClient) {
  const outputs = await fetchAllRows<AiOutputJoinRow>("Unable to load AI outputs", (from, to) =>
    supabase
      .from("ai_outputs")
      .select(
        "id,created_at,output_json,output_text,processing_job_id,transcript_id,user_id,ai_processing_jobs(processing_type)"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<AiOutputJoinRow[]>()
  );

  return outputs.map((output): AiOutputView => ({
    ...output,
    processing_type: output.ai_processing_jobs?.processing_type ?? null
  }));
}

// listAiOutputsForTranscripts loads AI outputs only for transcript ids visible on a detail page.
export async function listAiOutputsForTranscripts(supabase: SupabaseClient, transcriptIds: string[]) {
  if (transcriptIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("ai_outputs")
    .select(
      "id,created_at,output_json,output_text,processing_job_id,transcript_id,user_id,ai_processing_jobs(processing_type)"
    )
    .in("transcript_id", transcriptIds)
    .order("created_at", { ascending: false })
    .returns<AiOutputJoinRow[]>();

  if (error) {
    throw new Error(`Unable to load recording AI outputs: ${error.message}`);
  }

  return (data ?? []).map((output): AiOutputView => ({
    ...output,
    processing_type: output.ai_processing_jobs?.processing_type ?? null
  }));
}
