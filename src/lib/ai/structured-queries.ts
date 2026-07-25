import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StructuredAiItems,
  StructuredChapterRow,
  StructuredDecisionRow,
  StructuredRiskRow,
  StructuredTaskRow
} from "@/lib/ai/structured-types";
import { dedupeStructuredAiItems } from "@/lib/ai/structured-dedupe";

// getEmptyStructuredAiItems returns the neutral query result for pages without transcripts.
export function getEmptyStructuredAiItems(): StructuredAiItems {
  return {
    chapters: [],
    decisions: [],
    risks: [],
    tasks: []
  };
}

// listStructuredAiItemsForTranscripts loads normalized AI projections for recording detail pages.
export async function listStructuredAiItemsForTranscripts(
  supabase: SupabaseClient,
  transcriptIds: string[]
): Promise<StructuredAiItems> {
  if (transcriptIds.length === 0) {
    return getEmptyStructuredAiItems();
  }

  const [tasks, chapters, decisions, risks] = await Promise.all([
    selectStructuredRows<StructuredTaskRow>(supabase, "transcript_tasks", transcriptIds),
    selectStructuredRows<StructuredChapterRow>(supabase, "transcript_chapters", transcriptIds),
    selectStructuredRows<StructuredDecisionRow>(supabase, "transcript_decisions", transcriptIds),
    selectStructuredRows<StructuredRiskRow>(supabase, "transcript_risks", transcriptIds)
  ]);

  return dedupeStructuredAiItems({ chapters, decisions, risks, tasks });
}

// selectStructuredRows reads one structured AI table through RLS and preserves display order.
async function selectStructuredRows<T>(
  supabase: SupabaseClient,
  tableName: "transcript_tasks" | "transcript_chapters" | "transcript_decisions" | "transcript_risks",
  transcriptIds: string[]
): Promise<T[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .in("transcript_id", transcriptIds)
    .order("position", { ascending: true })
    .returns<T[]>();

  if (error) {
    throw new Error(`Unable to load structured AI rows from ${tableName}: ${error.message}`);
  }

  return data ?? [];
}
