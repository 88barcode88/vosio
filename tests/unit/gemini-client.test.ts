import { describe, expect, it } from "vitest";
import { buildRecordingChatContext } from "@/lib/ai/chat-context";
import {
  createGeminiChatRequestBody,
  createGeminiGenerationConfig,
  getGeminiOutputTokenCount
} from "@/lib/ai/gemini";

const chatSystemPrompt = "Authoritative rules <transcript>{{raw_text}}</transcript>";

// expectGeminiContentOrder verifies strict role alternation without losing any original message boundary.
function expectGeminiContentOrder(
  body: ReturnType<typeof createGeminiChatRequestBody>,
  expectedTexts: string[]
) {
  expect(body.contents.map((content) => content.role)).toEqual(
    body.contents.map((_, index) => index % 2 === 0 ? "user" : "model")
  );
  expect(body.contents.flatMap((content) => content.parts.map((part) => part.text))).toEqual(expectedTexts);
}

describe("Gemini client generation config", () => {
  it("keeps chat systemInstruction separate and maps assistant history to model role", () => {
    const body = createGeminiChatRequestBody({
      messages: [
        { content: "Transcript data", role: "user" },
        { content: "Prior answer", role: "assistant" }
      ],
      model: "gemini-3.6-flash",
      outputSchema: { type: "object" },
      systemInstruction: "Authoritative rules"
    });

    expect(body.systemInstruction).toEqual({ parts: [{ text: "Authoritative rules" }] });
    expect(body.contents).toEqual([
      { parts: [{ text: "Transcript data" }], role: "user" },
      { parts: [{ text: "Prior answer" }], role: "model" }
    ]);
    expect(body.generationConfig).toHaveProperty("responseJsonSchema", { type: "object" });
  });

  it("coalesces the real no-history transcript and question into one user Content", () => {
    const context = buildRecordingChatContext({
      history: [],
      question: "Co bylo domluveno?",
      rawText: "Termín je pátek.",
      segments: [],
      speakerContext: [],
      speakers: [],
      systemPrompt: chatSystemPrompt
    });
    const body = createGeminiChatRequestBody({
      messages: context.messages,
      model: "gemini-3.6-flash",
      outputSchema: { type: "object" },
      systemInstruction: context.systemInstruction
    });

    expect(body.contents).toHaveLength(1);
    expect(body.contents[0]?.role).toBe("user");
    expect(body.contents[0]?.parts).toHaveLength(2);
    expectGeminiContentOrder(body, context.messages.map((message) => message.content));
    expect(JSON.stringify(body.systemInstruction)).not.toContain("Termín je pátek.");
  });

  it("coalesces real multi-turn context while preserving every text part in order", () => {
    const context = buildRecordingChatContext({
      history: [
        { answerMarkdown: "První odpověď", createdAt: "2026-08-28T10:00:00.000Z", question: "První otázka", status: "completed" },
        { answerMarkdown: "Druhá odpověď", createdAt: "2026-08-28T10:01:00.000Z", question: "Druhá otázka", status: "completed" }
      ],
      question: "Navazující otázka",
      rawText: "Obsah hovoru.",
      segments: [],
      speakerContext: [],
      speakers: [],
      systemPrompt: chatSystemPrompt
    });
    const body = createGeminiChatRequestBody({
      messages: context.messages,
      model: "gemini-3.6-flash",
      outputSchema: { type: "object" },
      systemInstruction: context.systemInstruction
    });

    expect(body.contents.map((content) => content.role)).toEqual(["user", "model", "user", "model", "user"]);
    expect(body.contents[0]?.parts).toHaveLength(2);
    expectGeminiContentOrder(body, context.messages.map((message) => message.content));
  });

  it("uses Gemini 3.6 thinking without deprecated temperature", () => {
    expect(createGeminiGenerationConfig({
      model: "gemini-3.6-flash",
      outputSchema: { type: "object" },
      prompt: "Shrň hovor.",
      temperature: 0.2
    })).toEqual({
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: "medium"
      }
    });
  });

  it("includes thinking tokens in billed output usage", () => {
    expect(getGeminiOutputTokenCount({ candidatesTokenCount: 120, thoughtsTokenCount: 80 })).toBe(200);
    expect(getGeminiOutputTokenCount(undefined)).toBeNull();
  });

  it("honors the persisted thinking snapshot instead of current model metadata", () => {
    expect(createGeminiGenerationConfig({
      model: "gemini-3.6-flash",
      outputSchema: null,
      prompt: "Shrň hovor.",
      temperature: 0.2,
      thinkingLevel: "high"
    })).toHaveProperty("thinkingConfig.thinkingLevel", "high");
    expect(createGeminiGenerationConfig({
      model: "gemini-3.6-flash",
      outputSchema: null,
      prompt: "Shrň hovor.",
      temperature: 0.2,
      thinkingLevel: null
    })).not.toHaveProperty("thinkingConfig");
  });
});
