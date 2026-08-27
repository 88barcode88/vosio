import { describe, expect, it } from "vitest";
import { createGeminiGenerationConfig, getGeminiOutputTokenCount } from "@/lib/ai/gemini";

describe("Gemini client generation config", () => {
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
