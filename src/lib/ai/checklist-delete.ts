import { z } from "zod";
import { getTaskDedupeKey } from "@/lib/ai/structured-dedupe";
import type { StructuredTaskRow } from "@/lib/ai/structured-types";

export const MAX_CHECKLIST_SNAPSHOT_ROWS = 1000;
const versionSchema = z.string().regex(/^\d+$/);
const rowSchema = z.object({ id: z.uuid(), version: versionSchema }).strict();
export const checklistSnapshotSchema = z.object({
  transcriptId: z.uuid(),
  generation: z.string().nullable(),
  transcriptVersion: versionSchema,
  outputs: z.array(rowSchema).max(MAX_CHECKLIST_SNAPSHOT_ROWS),
  tasks: z.array(rowSchema.extend({ updatedAt: z.string(), status: z.enum(["new", "in_progress", "waiting", "done", "unclear", "ignored"]) }))
    .max(MAX_CHECKLIST_SNAPSHOT_ROWS)
}).strict().refine((snapshot) => new Set(snapshot.tasks.map((row) => row.id)).size === snapshot.tasks.length
  && new Set(snapshot.outputs.map((row) => row.id)).size === snapshot.outputs.length, "Duplicate snapshot IDs");
export type ChecklistSnapshot = z.infer<typeof checklistSnapshotSchema>;
export type ChecklistReview = { snapshot: ChecklistSnapshot; logicalCount: number; rowCount: number };
type LogicalTask = Pick<StructuredTaskRow, "title" | "owner_category" | "deadline" | "deadline_normalized">;

// Uses the existing workspace grouping rule while keeping task text out of the public snapshot.
export function checklistReview(snapshot: ChecklistSnapshot, tasks: LogicalTask[]): ChecklistReview {
  return { snapshot, rowCount: snapshot.tasks.length, logicalCount: new Set(tasks.map(getTaskDedupeKey)).size };
}

// Maps narrow SQL errors to safe HTTP responses without exposing database details.
export function checklistErrorStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (["40001", "55000", "54000", "40P01"].includes(code ?? "")) return 409;
  if (code === "22023") return 400;
  return 500;
}
