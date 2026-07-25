import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredAiItems } from "@/lib/ai/structured-types";

// persistStructuredAiItems stores derived workspace rows while keeping ai_outputs as the raw source.
export async function persistStructuredAiItems(supabase: SupabaseClient, items: StructuredAiItems) {
  const aiOutputId = getAiOutputId(items);

  if (!aiOutputId) {
    return;
  }

  await Promise.all([
    replaceRows(supabase, "transcript_tasks", aiOutputId, items.tasks),
    replaceRows(supabase, "transcript_chapters", aiOutputId, items.chapters),
    replaceRows(supabase, "transcript_decisions", aiOutputId, items.decisions),
    replaceRows(supabase, "transcript_risks", aiOutputId, items.risks)
  ]);
}

// getAiOutputId reads the shared source output id from the first derived row set.
function getAiOutputId(items: StructuredAiItems) {
  return items.tasks[0]?.ai_output_id
    ?? items.chapters[0]?.ai_output_id
    ?? items.decisions[0]?.ai_output_id
    ?? items.risks[0]?.ai_output_id
    ?? null;
}

// replaceRows rewrites one structured projection for a single saved AI output.
async function replaceRows(
  supabase: SupabaseClient,
  tableName: "transcript_tasks" | "transcript_chapters" | "transcript_decisions" | "transcript_risks",
  aiOutputId: string,
  rows: unknown[]
) {
  const { error: deleteError } = await supabase
    .from(tableName)
    .delete()
    .eq("ai_output_id", aiOutputId);

  if (deleteError) {
    throw new Error(`Unable to clear structured AI rows in ${tableName}: ${deleteError.message}`);
  }

  if (rows.length === 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from(tableName)
    .insert(rows);

  if (insertError) {
    throw new Error(`Unable to store structured AI rows in ${tableName}: ${insertError.message}`);
  }
}
