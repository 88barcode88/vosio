import { describe, expect, it } from "vitest";
import { aiModelOptions, getAiModelOption, supportsModelTemperature } from "@/lib/model-options";
import { getAiOutputMarkdownLines } from "@/components/transcript-tabs/markdown-utils";
import { speakerClassNames } from "@/components/transcript-tabs/constants";

describe("AI display helpers", () => {
  it("renders bold markdown labels as headings instead of raw stars", () => {
    const lines = getAiOutputMarkdownLines({
      created_at: "2026-05-24T00:00:00.000Z",
      id: "output-1",
      output_json: {
        markdown: "**Stručné shrnutí:**\n\nProběhla diskuse.\n\n**Hlavní body:**\n- CRM je aktivní."
      },
      output_text: null,
      processing_job_id: "job-1",
      processing_type: "summary",
      transcript_id: "transcript-1",
      user_id: "user-1"
    });

    expect(lines).toContainEqual({ kind: "heading", text: "Stručné shrnutí" });
    expect(lines).toContainEqual({ kind: "heading", text: "Hlavní body" });
    expect(lines.some((line) => "text" in line && line.text.includes("**"))).toBe(false);
  });

  it("exposes only the requested current AI models", () => {
    expect(aiModelOptions.map((option) => option.id)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gemini-3.6-flash"
    ]);
  });

  it("stores the requested reasoning level with current OpenAI pricing", () => {
    expect(getAiModelOption("gpt-5.6-terra")).toMatchObject({
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 12,
      provider: "openai",
      reasoningEffort: "high",
      supportsTemperature: false
    });
    expect(getAiModelOption("gpt-5.6-luna")).toMatchObject({
      inputUsdPerMillionTokens: 0.2,
      outputUsdPerMillionTokens: 1.2,
      reasoningEffort: "xhigh"
    });
  });

  it("configures Gemini 3.6 Flash with explicit thinking and no deprecated temperature", () => {
    expect(getAiModelOption("gemini-3.6-flash")).toMatchObject({
      geminiThinkingLevel: "medium",
      provider: "gemini",
      supportsTemperature: false
    });
    expect(supportsModelTemperature("gpt-5.6-terra")).toBe(false);
    expect(supportsModelTemperature("gemini-3.6-flash")).toBe(false);
  });

  it("has enough distinct speaker classes before colors repeat for larger meetings", () => {
    expect(speakerClassNames.length).toBeGreaterThanOrEqual(10);
  });
});
