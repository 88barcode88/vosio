import { z } from "zod";

export const structuredTaskStatusSchema = z.enum([
  "new",
  "in_progress",
  "waiting",
  "done",
  "unclear",
  "ignored"
]);

export type StructuredTaskStatusValue = z.infer<typeof structuredTaskStatusSchema>;

// getNextStructuredTaskStatus returns the checklist toggle target for one structured task row.
export function getNextStructuredTaskStatus(status: StructuredTaskStatusValue) {
  return status === "done" ? "new" : "done";
}
