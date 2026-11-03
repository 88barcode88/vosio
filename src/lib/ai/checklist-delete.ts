import { z } from "zod";
import { getDecisionDedupeKey, getRiskDedupeKey, getTaskDedupeKey } from "@/lib/ai/structured-dedupe";
import type { StructuredDecisionRow, StructuredRiskRow, StructuredTaskRow } from "@/lib/ai/structured-types";

export const MAX_CHECKLIST_SNAPSHOT_ROWS = 1000;
const versionSchema = z.string().regex(/^\d+$/);
const rowSchema = z.object({ id: z.uuid(), version: versionSchema }).strict();
export const checklistSnapshotSchema = z.object({
  transcriptId: z.uuid(),
  generation: z.string().nullable(),
  transcriptVersion: versionSchema,
  outputs: z.array(rowSchema).max(MAX_CHECKLIST_SNAPSHOT_ROWS),
  tasks: z.array(rowSchema.extend({ updatedAt: z.string(), status: z.enum(["new", "in_progress", "waiting", "done", "unclear", "ignored"]) }))
    .max(MAX_CHECKLIST_SNAPSHOT_ROWS),
  decisions: z.array(rowSchema).max(MAX_CHECKLIST_SNAPSHOT_ROWS),
  risks: z.array(rowSchema).max(MAX_CHECKLIST_SNAPSHOT_ROWS)
}).strict().refine((snapshot) => new Set(snapshot.tasks.map((row) => row.id)).size === snapshot.tasks.length
  && new Set(snapshot.outputs.map((row) => row.id)).size === snapshot.outputs.length
  && new Set(snapshot.decisions.map((row) => row.id)).size === snapshot.decisions.length
  && new Set(snapshot.risks.map((row) => row.id)).size === snapshot.risks.length, "Duplicate snapshot IDs");
export type ChecklistSnapshot = z.infer<typeof checklistSnapshotSchema>;
export type ChecklistCounts = { tasks: number; decisions: number; risks: number };
export type ChecklistReview = { snapshot: ChecklistSnapshot; logicalCounts: ChecklistCounts; rowCount: number };
type LogicalTask = Pick<StructuredTaskRow, "title" | "owner_category" | "deadline" | "deadline_normalized">;
type LogicalDecision = Pick<StructuredDecisionRow, "title" | "status" | "owner_category">;
type LogicalRisk = Pick<StructuredRiskRow, "title" | "impact">;

// Counts raw rows per kind in a reviewed snapshot (tasks, decisions, risks/blockers).
export function snapshotRowCounts(snapshot: ChecklistSnapshot): ChecklistCounts {
  return { tasks: snapshot.tasks.length, decisions: snapshot.decisions.length, risks: snapshot.risks.length };
}

// Uses the existing workspace grouping rules while keeping item text out of the public snapshot.
export function checklistReview(snapshot: ChecklistSnapshot, logical: { tasks: LogicalTask[]; decisions: LogicalDecision[]; risks: LogicalRisk[] }): ChecklistReview {
  const rows = snapshotRowCounts(snapshot);
  return { snapshot, rowCount: rows.tasks + rows.decisions + rows.risks, logicalCounts: {
    tasks: new Set(logical.tasks.map(getTaskDedupeKey)).size,
    decisions: new Set(logical.decisions.map(getDecisionDedupeKey)).size,
    risks: new Set(logical.risks.map(getRiskDedupeKey)).size
  } };
}

// Picks the Czech plural form for 1, 2-4 and 5+ (and 0).
function czechPlural(count: number, one: string, few: string, many: string) {
  return count === 1 ? one : count >= 2 && count <= 4 ? few : many;
}

// Lists only non-zero kinds as Czech text, e.g. "12 úkolů, 3 rozhodnutí a 2 blokery".
export function formatChecklistCounts(counts: ChecklistCounts) {
  const parts = [
    counts.tasks > 0 ? `${counts.tasks} ${czechPlural(counts.tasks, "úkol", "úkoly", "úkolů")}` : null,
    counts.decisions > 0 ? `${counts.decisions} rozhodnutí` : null,
    counts.risks > 0 ? `${counts.risks} ${czechPlural(counts.risks, "bloker", "blokery", "blokerů")}` : null
  ].filter((part): part is string => part !== null);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} a ${parts[parts.length - 1]}` : parts.join("");
}

// Maps narrow SQL errors to safe HTTP responses without exposing database details.
export function checklistErrorStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (["40001", "55000", "54000", "40P01"].includes(code ?? "")) return 409;
  if (code === "22023") return 400;
  return 500;
}
