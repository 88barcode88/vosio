import { describe, expect, it, vi } from "vitest";
import { executePersistedAiProcessing } from "@/lib/ai/processing-service.server";

describe("shared AI processing service", () => {
  it("executes the immutable job snapshot and persists provider usage without re-resolving configuration", async () => {
    const runProvider = vi.fn(async (_input: {
      model: string;
      outputSchema: unknown;
      prompt: string;
      provider: "gemini" | "openai";
      providerConfig: Record<string, unknown>;
      temperature: number;
    }) => ({
      inputTokenCount: 11,
      outputText: '{"chapters":[]}',
      outputTokenCount: 7,
      providerResponseId: "provider-response"
    }));
    const persistCompleted = vi.fn(async () => ({
      id: "output-id",
      output_json: { chapters: [] },
      output_text: '{"chapters":[]}'
    }));

    const output = await executePersistedAiProcessing({
      admin: {} as never,
      job: {
        id: "job-id",
        model: "gpt-5.6-terra",
        outputSchemaSnapshot: { type: "object" },
        promptTextSnapshot: "TIMELINE {{raw_text}} {{metadata}}",
        provider: "openai",
        providerConfig: { reasoning_effort: "high" }
      },
      metadata: { source: "automatic" },
      transcript: {
        id: "transcript-id",
        rawText: "Persisted transcript",
        segments: [],
        speakers: [],
        userId: "user-id"
      }
    }, { persistCompleted, runProvider });

    expect(runProvider).toHaveBeenCalledWith({
      model: "gpt-5.6-terra",
      outputSchema: { type: "object" },
      prompt: expect.stringContaining("TIMELINE Persisted transcript"),
      provider: "openai",
      providerConfig: { reasoning_effort: "high" },
      temperature: 0.2
    });
    expect(runProvider.mock.calls[0]![0].prompt).toContain('"source":"automatic"');
    expect(persistCompleted).toHaveBeenCalledWith(expect.objectContaining({
      inputTokenCount: 11,
      jobId: "job-id",
      outputJson: { chapters: [] },
      outputTokenCount: 7,
      transcriptId: "transcript-id",
      userId: "user-id"
    }));
    expect(output).toEqual(expect.objectContaining({ id: "output-id" }));
  });
});
