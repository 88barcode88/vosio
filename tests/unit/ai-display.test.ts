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

  it("keeps Gemini models available for provider routing", () => {
    expect(getAiModelOption("gemini-3.5-flash")?.provider).toBe("gemini");
    expect(aiModelOptions.some((option) => option.id === "gemini-3.1-flash-lite")).toBe(true);
    expect(aiModelOptions.some((option) => option.id === "gemini-3.1-pro-preview")).toBe(true);
  });

  it("keeps GPT-5.4 available with OpenAI pricing metadata", () => {
    expect(getAiModelOption("gpt-5.4")).toMatchObject({
      inputUsdPerMillionTokens: 2.5,
      outputUsdPerMillionTokens: 15,
      provider: "openai",
      supportsTemperature: false
    });
  });

  it("does not expose temperature controls for GPT-5 reasoning models", () => {
    expect(supportsModelTemperature("gpt-5.4")).toBe(false);
    expect(supportsModelTemperature("gpt-4.1-mini")).toBe(true);
  });

  it("has enough distinct speaker classes before colors repeat for larger meetings", () => {
    expect(speakerClassNames.length).toBeGreaterThanOrEqual(10);
  });
});
