import { describe, expect, it, vi } from "vitest";
import { persistCompletedAiProcessing } from "@/lib/ai/process-route-orchestration";

// createAdminMock records the durable write order without contacting Supabase.
function createAdminMock(events: string[]) {
  const rawOutputQuery = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn()
  };
  const jobQuery = {
    eq: vi.fn(),
    update: vi.fn()
  };

  rawOutputQuery.insert.mockReturnValue(rawOutputQuery);
  rawOutputQuery.select.mockReturnValue(rawOutputQuery);
  rawOutputQuery.single.mockImplementation(async () => {
    events.push("raw-output-saved");
    return {
      data: { id: "output-1", output_json: {}, output_text: "raw provider output" },
      error: null
    };
  });
  jobQuery.update.mockReturnValue(jobQuery);
  jobQuery.eq.mockImplementation(async () => {
    events.push("job-done");
    return { error: null };
  });

  const from = vi.fn((tableName: string) => {
    if (tableName === "ai_outputs") {
      return rawOutputQuery;
    }

    if (tableName === "ai_processing_jobs") {
      return jobQuery;
    }

    throw new Error(`Unexpected table ${tableName}`);
  });

  return { admin: { from }, from, jobQuery, rawOutputQuery };
}

describe("process route output orchestration", () => {
  it("uses full saved segments and persists verified structured rows between raw output and job completion", async () => {
    const events: string[] = [];
    const mock = createAdminMock(events);
    const savedTranscriptSegments = [
      { end_ms: 1_000, start_ms: 0, text: "Uvod." },
      { end_ms: 8_400, start_ms: 8_000, text: "Schvalili" },
      { end_ms: 8_900, start_ms: 8_400, text: " jsme termin." }
    ];
    const outputJson = {
      data: {
        decisions: [{
          decision: "Potvrdit termin",
          evidence_end_ms: 99_999,
          evidence_quote: "schvalili jsme termin",
          evidence_start_ms: 99_000
        }]
      }
    };
    const persistStructuredRows = vi.fn(async (_admin, items) => {
      events.push("structured-rows-saved");
      expect(items.decisions[0]).toMatchObject({
        ai_output_id: "output-1",
        evidence_end_ms: 8_900,
        evidence_start_ms: 8_000
      });
    });

    await expect(persistCompletedAiProcessing({
      admin: mock.admin as never,
      inputTokenCount: 120,
      jobId: "job-1",
      outputJson,
      outputText: "raw provider output",
      outputTokenCount: 40,
      transcriptId: "transcript-1",
      transcriptSegments: savedTranscriptSegments,
      userId: "user-1"
    }, { persistStructuredRows })).resolves.toMatchObject({ id: "output-1" });

    expect(events).toEqual(["raw-output-saved", "structured-rows-saved", "job-done"]);
    expect(mock.rawOutputQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      output_json: outputJson,
      output_text: "raw provider output"
    }));
    expect(mock.jobQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });
});
