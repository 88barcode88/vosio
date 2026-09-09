import { describe, expect, it, vi } from "vitest";
import { executePersistedAiProcessing } from "@/lib/ai/processing-service.server";

describe("shared AI processing service", () => {
  it("executes the immutable job snapshot and persists provider usage without re-resolving configuration", async () => {
    const runProvider = vi.fn(async (_input: {
      model: string;
      outputSchema: unknown;
      prompt: string;
      provider: "gemini" | "mistral" | "openai";
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
      profileId: "gpt-5.6-terra",
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

  it("resolves the exact API model from the immutable profile snapshot", async () => {
    const runProvider = vi.fn(async () => ({
      inputTokenCount: 1,
      outputText: "ok",
      outputTokenCount: 1,
      providerResponseId: "response"
    }));

    await executePersistedAiProcessing({
      admin: {} as never,
      job: {
        id: "job-id",
        model: "gpt-6-astra-medium",
        outputSchemaSnapshot: null,
        promptTextSnapshot: "{{raw_text}}",
        provider: "openai",
        providerConfig: { provider: "openai", provider_model: "gpt-6-astra", reasoning_effort: "medium" }
      },
      transcript: { id: "transcript-id", rawText: "Text", segments: [], speakers: [], userId: "user-id" }
    }, { persistCompleted: vi.fn(async () => ({})), runProvider });

    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-6-astra",
      profileId: "gpt-6-astra-medium",
      provider: "openai"
    }));
  });

  it("fails closed before dispatch for mismatched provider model snapshots", async () => {
    const runProvider = vi.fn();

    await expect(executePersistedAiProcessing({
      admin: {} as never,
      job: {
        id: "job-id",
        model: "gpt-6-astra-low",
        outputSchemaSnapshot: null,
        promptTextSnapshot: "{{raw_text}}",
        provider: "openai",
        providerConfig: { provider_model: "gpt-6-astra-low" }
      },
      transcript: { id: "transcript-id", rawText: "Text", segments: [], speakers: [], userId: "user-id" }
    }, { persistCompleted: vi.fn(), runProvider })).rejects.toMatchObject({ failureCode: "invalid_model" });
    expect(runProvider).not.toHaveBeenCalled();
  });
});
