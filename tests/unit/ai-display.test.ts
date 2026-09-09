import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_MODEL_QUALITY_GUIDANCE,
  aiModelOptions,
  DEFAULT_AI_MODEL_ID,
  getAiModelOption,
  normalizeAiModelId,
  resolveAiModelExecution,
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

  it("preserves the existing profiles and exposes all five new profiles", () => {
    expect(aiModelOptions.map((option) => option.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "gpt-6-astra-low",
      "gpt-6-astra-medium",
      "mistral-small-2603",
      "mistral-large-2512"
    ]);
  });

  it("maps five new profiles onto four exact provider API model ids", () => {
    expect(aiModelOptions.slice(4).map((option) => [option.id, option.provider, option.providerModel])).toEqual([
      ["gemini-3.8-flash", "gemini", "gemini-3.8-flash"],
      ["gpt-6-astra-low", "openai", "gpt-6-astra"],
      ["gpt-6-astra-medium", "openai", "gpt-6-astra"],
      ["mistral-small-2603", "mistral", "mistral-small-2603"],
      ["mistral-large-2512", "mistral", "mistral-large-2512"]
    ]);
    expect(getAiModelOption("gpt-6-astra-low")).toMatchObject({ reasoningEffort: "low" });
    expect(getAiModelOption("gpt-6-astra-medium")).toMatchObject({ reasoningEffort: "medium" });
  });

  it("validates profile/provider/provider-model snapshots and safely supports legacy rows", () => {
    expect(resolveAiModelExecution({
      model: "gpt-6-astra-low",
      provider: "openai",
      providerConfig: { provider: "openai", provider_model: "gpt-6-astra", reasoning_effort: "low" }
    })).toMatchObject({ profileId: "gpt-6-astra-low", provider: "openai", providerModel: "gpt-6-astra" });
    expect(resolveAiModelExecution({
      model: "gpt-5.6-terra",
      provider: "openai",
      providerConfig: { reasoning_effort: "high" }
    })).toMatchObject({ profileId: "gpt-5.6-terra", providerModel: "gpt-5.6-terra" });
    expect(resolveAiModelExecution({
      model: "gpt-6-astra-low",
      provider: "openai",
      providerConfig: { provider_model: "gpt-6-astra-low" }
    })).toBeNull();
    expect(resolveAiModelExecution({
      model: "gpt-6-astra-low",
      provider: "openai",
      providerConfig: { provider_model: "gpt-6-astra", reasoning_effort: "medium" }
    })).toBeNull();
    expect(resolveAiModelExecution({
      model: "mistral-small-2603",
      provider: "unknown",
      providerConfig: {}
    })).toBeNull();
    expect(resolveAiModelExecution({
      model: "mistral-small-2603",
      provider: "mistral",
      providerConfig: []
    })).toBeNull();
  });

  it("stores the requested reasoning level with current OpenAI pricing", () => {
    expect(getAiModelOption("gpt-5.6-sol")).toMatchObject({
      inputUsdPerMillionTokens: 4,
      outputUsdPerMillionTokens: 20,
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

  it("normalizes only the explicit historical model aliases", () => {
    expect(DEFAULT_AI_MODEL_ID).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-4.1-mini")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-4.1-nano")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-5.4")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-5.4-mini")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gpt-5.4-nano")).toBe("gpt-5.6-terra");
    expect(normalizeAiModelId("gemini-3.1-flash-lite")).toBe("gemini-3.6-flash");
    expect(normalizeAiModelId("gemini-3.1-pro-preview")).toBe("gemini-3.6-flash");
    expect(normalizeAiModelId("gemini-3.5-flash")).toBe("gemini-3.6-flash");
    expect(normalizeAiModelId("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(normalizeAiModelId("gpt-6-astra-typo")).toBe("gpt-6-astra-typo");
    expect(normalizeAiModelId("mistral-small-typo")).toBe("mistral-small-typo");
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
