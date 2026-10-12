import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StructuredAiItems,
  StructuredChapterRow,
  StructuredDecisionRow,
  StructuredRiskRow,
  StructuredTaskRow
} from "@/lib/ai/structured-types";
import { dedupeStructuredAiItems } from "@/lib/ai/structured-dedupe";
import { fetchAllRows } from "@/lib/supabase/pagination";

const sharedColumns = "id,ai_output_id,transcript_id,processing_job_id,position,title,source_type,raw_item,created_at,updated_at";
const evidenceColumns = "evidence_quote,evidence_start_ms,evidence_end_ms";
export const structuredColumns = {
  transcript_tasks: `${sharedColumns},${evidenceColumns},deadline,deadline_confidence,deadline_normalized,description,owner_category,owner_name,status`,
  transcript_chapters: `${sharedColumns},confidence,dominant_roles,end_time,speakers,start_time,summary,topics`,
  transcript_decisions: `${sharedColumns},${evidenceColumns},owner_category,owner_role,status`,
  transcript_risks: `${sharedColumns},${evidenceColumns},impact,mitigation,owner_category,owner_role`
};

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
  return fetchAllRows<T>(`Unable to load structured AI rows from ${tableName}`, (from, to) => supabase
    .from(tableName)
    .select(structuredColumns[tableName])
    .in("transcript_id", transcriptIds)
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
    .returns<T[]>());
}
