import { describe, expect, it } from "vitest";
import { classifyAutomaticJob } from "@/lib/ai/automatic-job-state";
import { mergeManualAiState, type ManualAiJobSummary } from "@/lib/ai/manual-job-state";

const job = { id: "auto", execution_mode: "automatic", status: "queued", attempt_count: 0, max_attempts: 3,
  created_at: "2026-09-15", lease_expires_at: null } as ManualAiJobSummary;
describe("current automatic metadata", () => {
  it.each(["queued", "failed", "running"] as const)("polls recoverable %s without manual actions", (status) => {
    expect(classifyAutomaticJob({ ...job, status, lease_expires_at: "2026-09-15T10:00:00Z" }, Date.parse("2026-09-15T11:00:00Z")))
      .toMatchObject({ actions: [], poll_eligible: true });
  });
  it.each(["done", "cancelled", "failed"] as const)("stops terminal or exhausted %s", (status) => {
    expect(classifyAutomaticJob({ ...job, status, attempt_count: 3 }).poll_eligible).toBe(false);
  });
  it("does not poll unsafe legacy shape", () => {
    expect(classifyAutomaticJob({ ...job, status: "running" }).poll_eligible).toBe(false);
    expect(classifyAutomaticJob({ ...job, max_attempts: 999 }).poll_eligible).toBe(false);
  });
  it("drops superseded automatic statuses while preserving manual history", () => {
    const prior = { jobs: [job, { ...job, id: "manual", execution_mode: "manual" as const }], outputs: [],
      classifications: [classifyAutomaticJob(job)], automaticGenerationKey: "old" };
    expect(mergeManualAiState(prior, { automaticGenerationKey: "old", jobs: [], outputs: [], classifications: [] }))
      .toMatchObject({ jobs: [{ id: "manual" }], classifications: [], automaticGenerationKey: "old" });
    expect(mergeManualAiState(prior, { automaticGenerationKey: "new", jobs: [], outputs: [], classifications: [] }))
      .toMatchObject({ jobs: [], outputs: [], classifications: [], automaticGenerationKey: "new" });
  });
});
