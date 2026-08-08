import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_MODEL_QUALITY_GUIDANCE,
  aiModelOptions,
  DEFAULT_AI_MODEL_ID,
  getAiModelOption,
  normalizeAiModelId,
  supportsModelTemperature
} from "@/lib/model-options";
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
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gemini-3.6-flash"
    ]);
  });

  it("stores the requested reasoning level with current OpenAI pricing", () => {
    expect(getAiModelOption("gpt-5.6-sol")).toMatchObject({
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
      provider: "openai",
      reasoningEffort: "xhigh",
      supportsTemperature: false
    });
    expect(getAiModelOption("gpt-5.6-terra")).toMatchObject({
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 12,
      price: "$2.00 input / $12.00 output za 1M tokenů",
      provider: "openai",
      reasoningEffort: "high",
      supportsTemperature: false
    });
    expect(getAiModelOption("gpt-5.6-luna")).toMatchObject({
      inputUsdPerMillionTokens: 0.2,
      outputUsdPerMillionTokens: 1.2,
      price: "$0.20 input / $1.20 output za 1M tokenů",
      reasoningEffort: "xhigh"
    });
  });

  it("keeps Terra as the default and normalizes legacy OpenAI models to it", () => {
    expect(DEFAULT_AI_MODEL_ID).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-4.1-mini")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-5.4")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-5.4-mini")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-5.6-sol")).toBe("gpt-5.6-sol");
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

  it("keeps model-quality guidance shared across settings and the recording AI panel", () => {
    expect(AI_MODEL_QUALITY_GUIDANCE).toContain(
      "Menším a levnějším modelům může uniknout více detailů, úkolů nebo důkazů"
    );
    expect(readFileSync("src/components/settings-panel.tsx", "utf8")).toContain("AI_MODEL_QUALITY_GUIDANCE");
    expect(readFileSync("src/components/transcript-tabs/ai-processing-content.tsx", "utf8"))
      .toContain("AI_MODEL_QUALITY_GUIDANCE");
  });

  it("wraps model-quality guidance onto its own row in the recording AI panel", () => {
    const styles = readFileSync("app/styles/timeline-ai-output.css", "utf8");

    expect(styles).toMatch(/\.ai-tab-actions-title\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
    expect(styles).toMatch(/\.ai-tab-actions-title small\s*\{[\s\S]*?flex-basis:\s*100%;/);
  });

  it("has enough distinct speaker classes before colors repeat for larger meetings", () => {
    expect(speakerClassNames.length).toBeGreaterThanOrEqual(10);
  });
});
