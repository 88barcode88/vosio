import { describe, expect, it } from "vitest";
import { createOpenAIRequestBody } from "@/lib/ai/openai";

const baseInput = {
  outputSchema: null,
  prompt: "Summarize this call.",
  temperature: 0.2
};

describe("OpenAI client request body", () => {
  it("omits temperature for GPT-5 reasoning models", () => {
    const body = createOpenAIRequestBody({
      ...baseInput,
      model: "gpt-5.4"
    });

    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps temperature for GPT-4.1 models", () => {
    const body = createOpenAIRequestBody({
      ...baseInput,
      model: "gpt-4.1-mini"
    });

    expect(body).toHaveProperty("temperature", 0.2);
  });
});
