import type { SupabaseClient } from "@supabase/supabase-js";
import { buildStructuredAiItems } from "@/lib/ai/structured-items";
import { persistStructuredAiItems } from "@/lib/ai/structured-persistence";
import type { StructuredAiItems } from "@/lib/ai/structured-types";

type PersistStructuredRows = (admin: SupabaseClient, items: StructuredAiItems) => Promise<void>;

export type CompletedAiJobUsage = {
  inputTokenCount: number | null;
  outputTokenCount: number | null;
};

type CompleteJob = (
  admin: SupabaseClient,
  jobId: string,
  usage: CompletedAiJobUsage
) => Promise<void>;

export type ProcessingPersistenceDependencies = {
  completeJob?: CompleteJob;
  persistStructuredRows?: PersistStructuredRows;
};

export type CompletedAiProcessingInput = {
  admin: SupabaseClient;
  inputTokenCount: number | null;
  jobId: string;
  outputJson: unknown;
  outputText: string;
  outputTokenCount: number | null;
  transcriptId: string;
  transcriptSegments: unknown;
  userId: string;
};

// persistCompletedAiProcessing saves raw output, then its derived rows, before marking the job done.
export async function persistCompletedAiProcessing(
  input: CompletedAiProcessingInput,
  dependencies: ProcessingPersistenceDependencies = {}
) {
  const { data: output, error: outputError } = await input.admin
    .from("ai_outputs")
    .insert({
      output_json: input.outputJson,
      output_text: input.outputText,
      processing_job_id: input.jobId,
      transcript_id: input.transcriptId,
      user_id: input.userId
    })
    .select("id,output_text,output_json")
    .single();

  if (outputError || !output) {
    throw new Error("Nepodařilo se uložit AI výstup.");
  }

  if (input.outputJson) {
    const structuredItems = buildStructuredAiItems({
      aiOutputId: output.id,
      processingJobId: input.jobId,
      transcriptId: input.transcriptId,
      transcriptSegments: input.transcriptSegments,
      userId: input.userId
    }, input.outputJson);

    try {
      await (dependencies.persistStructuredRows ?? persistStructuredAiItems)(input.admin, structuredItems);
    } catch (error) {
      if (error instanceof Error) {
        console.error("[Vosio AI structured output]", error.message);
      }
    }
  }

  if (dependencies.completeJob) {
    await dependencies.completeJob(input.admin, input.jobId, {
      inputTokenCount: input.inputTokenCount,
      outputTokenCount: input.outputTokenCount
    });
  } else {
    await input.admin
      .from("ai_processing_jobs")
      .update({
        completed_at: new Date().toISOString(),
        input_token_count: input.inputTokenCount,
        output_token_count: input.outputTokenCount,
        status: "done"
      })
      .eq("id", input.jobId);
  }

  return output;
}
