import type {
  StructuredAiItems,
  StructuredChapterRow,
  StructuredDecisionRow,
  StructuredRiskRow,
  StructuredTaskRow
} from "@/lib/ai/structured-types";

// dedupeStructuredAiItems collapses repeated AI projection rows from multiple generations for workspace display.
export function dedupeStructuredAiItems(items: StructuredAiItems): StructuredAiItems {
  return {
    chapters: dedupeRows(items.chapters, getChapterDedupeKey, preferNewestRow),
    decisions: dedupeRows(items.decisions, getDecisionDedupeKey, preferNewestRow),
    risks: dedupeRows(items.risks, getRiskDedupeKey, preferNewestRow),
    tasks: dedupeRows(items.tasks, getTaskDedupeKey, preferUsefulTaskRow)
  };
}

// dedupeRows keeps ordering stable after selecting the best row for each normalized key.
function dedupeRows<T extends { created_at?: string; position: number }>(
  rows: T[],
  getKey: (row: T) => string,
  prefer: (current: T, candidate: T) => T
) {
  const byKey = new Map<string, T>();

  rows.forEach((row) => {
    const key = getKey(row);
    const current = byKey.get(key);

    byKey.set(key, current ? prefer(current, row) : row);
  });

  return Array.from(byKey.values()).sort(compareRowsForDisplay);
}

// normalizeDedupeText removes formatting noise so repeated AI generations do not duplicate checklist rows.
function normalizeDedupeText(input: string | null | undefined) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// getTaskDedupeKey identifies equivalent checklist tasks across repeated AI generations.
function getTaskDedupeKey(task: StructuredTaskRow) {
  return [
    task.owner_category,
    normalizeDedupeText(task.title),
    normalizeDedupeText(task.deadline_normalized ?? task.deadline)
  ].join("|");
}

// getChapterDedupeKey identifies repeated content timeline chapters.
function getChapterDedupeKey(chapter: StructuredChapterRow) {
  return [
    normalizeDedupeText(chapter.title),
    normalizeDedupeText(chapter.start_time),
    normalizeDedupeText(chapter.end_time)
  ].join("|");
}

// getDecisionDedupeKey identifies repeated decisions and pending confirmations.
function getDecisionDedupeKey(decision: StructuredDecisionRow) {
  return [
    normalizeDedupeText(decision.title),
    normalizeDedupeText(decision.status),
    normalizeDedupeText(decision.owner_category)
  ].join("|");
}

// getRiskDedupeKey identifies repeated risks and blockers.
function getRiskDedupeKey(risk: StructuredRiskRow) {
  return [
    normalizeDedupeText(risk.title),
    normalizeDedupeText(risk.impact)
  ].join("|");
}

// preferUsefulTaskRow avoids resetting a checked or in-progress task when a later AI run repeats it as new.
function preferUsefulTaskRow(current: StructuredTaskRow, candidate: StructuredTaskRow) {
  const currentRank = getTaskStatusRank(current.status);
  const candidateRank = getTaskStatusRank(candidate.status);

  if (currentRank !== candidateRank) {
    return candidateRank > currentRank ? candidate : current;
  }

  return preferNewestRow(current, candidate);
}

// getTaskStatusRank ranks user-work states above fresh AI-generated new rows.
function getTaskStatusRank(status: StructuredTaskRow["status"]) {
  const ranks: Record<StructuredTaskRow["status"], number> = {
    done: 5,
    ignored: 4,
    in_progress: 3,
    waiting: 2,
    unclear: 1,
    new: 0
  };

  return ranks[status];
}

// preferNewestRow chooses the latest projection row when the business value is otherwise equal.
function preferNewestRow<T extends { created_at?: string }>(current: T, candidate: T) {
  return getCreatedTimestamp(candidate) >= getCreatedTimestamp(current) ? candidate : current;
}

// getCreatedTimestamp converts optional Supabase timestamps into sortable numeric values.
function getCreatedTimestamp(row: { created_at?: string }) {
  return row.created_at ? Date.parse(row.created_at) || 0 : 0;
}

// compareRowsForDisplay keeps newest generated groups first while preserving in-output positions.
function compareRowsForDisplay(left: { created_at?: string; position: number }, right: { created_at?: string; position: number }) {
  const byCreatedAt = getCreatedTimestamp(right) - getCreatedTimestamp(left);

  return byCreatedAt || left.position - right.position;
}
