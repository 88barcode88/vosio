import { describe, expect, it } from "vitest";
import { createOpenAIRequestBody } from "@/lib/ai/openai";

const baseInput = {
  outputSchema: null,
  prompt: "Summarize this call.",
  temperature: 0.2
};

describe("OpenAI client request body", () => {
  it("sends Terra with high reasoning and omits temperature", () => {
    const body = createOpenAIRequestBody({
      ...baseInput,
      model: "gpt-5.6-terra"
    });

    expect(body).not.toHaveProperty("temperature");
    expect(body).toHaveProperty("reasoning.effort", "high");
  });

  it("sends Luna with xhigh reasoning and omits temperature", () => {
    const body = createOpenAIRequestBody({
      ...baseInput,
      model: "gpt-5.6-luna"
    });

    expect(body).not.toHaveProperty("temperature");
    expect(body).toHaveProperty("reasoning.effort", "xhigh");
  });

  it("sends Sol with xhigh reasoning and omits temperature", () => {
    const body = createOpenAIRequestBody({
      ...baseInput,
      model: "gpt-5.6-sol"
    });

    expect(body).not.toHaveProperty("temperature");
    expect(body).toHaveProperty("reasoning.effort", "xhigh");
  });
});
