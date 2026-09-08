import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMistralChatRequestBody,
  createMistralProcessingRequestBody,
  runMistralChat,
  runMistralProcessing
} from "@/lib/ai/mistral";

vi.mock("@/lib/env.server", () => ({ getMistralEnv: () => ({ mistralApiKey: "test-key" }) }));
afterEach(() => vi.unstubAllGlobals());

describe("Mistral client", () => {
  it("uses exact API model ids and the provider structured-output schema", () => {
    expect(createMistralProcessingRequestBody({
      model: "mistral-small-2603",
      outputSchema: { properties: { data: { type: "object" } }, type: "object" },
      prompt: "Shrň hovor.",
      temperature: 0.2
    })).toMatchObject({
      messages: [{ content: "Shrň hovor.", role: "user" }],
      model: "mistral-small-2603",
      response_format: {
        json_schema: {
          name: "vosio_ai_output",
          schema: { properties: { data: { type: "object" } }, type: "object" }
        },
        type: "json_schema"
      },
      temperature: 0.2
    });
  });

  it("keeps chat system authority separate from transcript messages", () => {
    expect(createMistralChatRequestBody({
      messages: [{ content: "Nedůvěryhodný přepis", role: "user" }],
      model: "mistral-large-2512",
      outputSchema: { type: "object" },
      systemInstruction: "Autoritativní pravidla"
    })).toMatchObject({
      messages: [
        { content: "Autoritativní pravidla", role: "system" },
        { content: "Nedůvěryhodný přepis", role: "user" }
      ],
      model: "mistral-large-2512",
      response_format: { type: "json_schema" }
    });
  });

  it("returns the shared result shape including token usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"data\":{}}" } }],
      id: "mistral-response",
      usage: { completion_tokens: 7, prompt_tokens: 11 }
    }), { status: 200 })));

    await expect(runMistralProcessing({
      model: "mistral-small-2603",
      outputSchema: { type: "object" },
      prompt: "safe",
      temperature: 0.2
    })).resolves.toEqual({
      inputTokenCount: 11,
      outputText: "{\"data\":{}}",
      outputTokenCount: 7,
      providerResponseId: "mistral-response"
    });
  });

  it("classifies provider failures and malformed success payloads without raw messages", async () => {
    const sentinel = "SECRET-SENTINEL-mistral";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "model_not_found",
      message: sentinel
    }), { status: 404 })));
    await expect(runMistralProcessing({ model: "mistral-small-2603", outputSchema: null, prompt: "safe", temperature: 0.2 }))
      .rejects.toMatchObject({ failureCode: "invalid_model" });
    await expect(runMistralChat({ messages: [], model: "mistral-small-2603", outputSchema: null, systemInstruction: "safe" }))
      .rejects.not.toThrow(sentinel);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    await expect(runMistralProcessing({ model: "mistral-small-2603", outputSchema: null, prompt: "safe", temperature: 0.2 }))
      .rejects.toMatchObject({ failureCode: "unknown" });
  });

  it("wraps transport failures without exposing their text", async () => {
    const sentinel = "SECRET-SENTINEL-mistral-transport";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(sentinel)));
    await expect(runMistralProcessing({ model: "mistral-small-2603", outputSchema: null, prompt: "safe", temperature: 0.2 }))
      .rejects.toMatchObject({ failureCode: "provider_unavailable" });
    await expect(runMistralChat({ messages: [], model: "mistral-small-2603", outputSchema: null, systemInstruction: "safe" }))
      .rejects.not.toThrow(sentinel);
  });
});
