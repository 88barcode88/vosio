import { describe, expect, it } from "vitest";
import {
  summarizeAiUsageRows,
  summarizeRecordingUsageRows,
  summarizeSonioxUsageRows,
  type AiUsageRow,
  type RecordingUsageRow,
  type TranscriptionUsageRow
} from "@/lib/usage/summary";

const createdAt = "2026-05-24T10:00:00.000Z";

describe("usage summary calculations", () => {
  it.each([
    ["gpt-5.6-sol", 35],
    ["gpt-5.6-terra", 17.5],
    ["gpt-5.6-luna", 7]
  ])("prices %s from the current catalog", (model, expectedCost) => {
    const summary = summarizeAiUsageRows([{
      created_at: createdAt,
      input_token_count: 1_000_000,
      model,
      output_token_count: 1_000_000,
      status: "done"
    }]);

    expect(summary.estimatedCostUsd).toBe(expectedCost);
  });

  it("prices known AI models and reports missing usage metadata", () => {
    const rows: AiUsageRow[] = [
      {
        created_at: createdAt,
        input_token_count: 1000,
        model: "gpt-4.1-mini",
        output_token_count: 500,
        status: "done"
      },
      {
        created_at: createdAt,
        input_token_count: null,
        model: "custom-model",
        output_token_count: null,
        status: "done"
      }
    ];

    const summary = summarizeAiUsageRows(rows);

    expect(summary.jobCount).toBe(2);
    expect(summary.inputTokens).toBe(1000);
    expect(summary.outputTokens).toBe(500);
    expect(summary.jobsMissingTokenUsage).toBe(1);
    expect(summary.estimatedCostUsd).toBeCloseTo(0.0012, 8);
    expect(summary.unpricedModelIds).toEqual(["custom-model"]);
  });

  it("keeps deleted recordings in month usage counts and tracks metadata coverage", () => {
    const rows: RecordingUsageRow[] = [
      {
        created_at: createdAt,
        duration_seconds: 120,
        file_size_bytes: 2048,
        id: "recording-1",
        status: "completed"
      },
      {
        created_at: createdAt,
        duration_seconds: null,
        file_size_bytes: null,
        id: "recording-2",
        status: "deleted"
      }
    ];

    const summary = summarizeRecordingUsageRows(rows);

    expect(summary.count).toBe(2);
    expect(summary.deletedCount).toBe(1);
    expect(summary.totalDurationSeconds).toBe(120);
    expect(summary.totalFileSizeBytes).toBe(2048);
    expect(summary.withDurationCount).toBe(1);
    expect(summary.withFileSizeCount).toBe(1);
  });

  it("estimates Soniox async and realtime cost only for jobs with known duration", () => {
    const jobs: TranscriptionUsageRow[] = [
      {
        created_at: createdAt,
        mode: "async",
        provider: "soniox",
        recording_id: "recording-1",
        status: "done"
      },
      {
        created_at: createdAt,
        mode: "realtime",
        provider: "soniox",
        recording_id: "recording-2",
        status: "done"
      },
      {
        created_at: createdAt,
        mode: "async",
        provider: "soniox",
        recording_id: "recording-3",
        status: "done"
      }
    ];
    const recordings: RecordingUsageRow[] = [
      {
        created_at: createdAt,
        duration_seconds: 3600,
        file_size_bytes: 2048,
        id: "recording-1",
        status: "completed"
      },
      {
        created_at: createdAt,
        duration_seconds: 1800,
        file_size_bytes: 1024,
        id: "recording-2",
        status: "completed"
      }
    ];

    const summary = summarizeSonioxUsageRows(jobs, recordings);

    expect(summary.jobCount).toBe(3);
    expect(summary.jobsWithDurationCount).toBe(2);
    expect(summary.jobsMissingDurationCount).toBe(1);
    expect(summary.asyncEstimatedCostUsd).toBeCloseTo(0.1, 8);
    expect(summary.realtimeEstimatedCostUsd).toBeCloseTo(0.06, 8);
    expect(summary.estimatedCostUsd).toBeCloseTo(0.16, 8);
  });
});
