import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { aiReasoningEfforts, resolveAiModelExecution, resolveNewAiModelSelection } from "@/lib/model-options";
import { createOpenAIChatRequestBody, createOpenAIRequestBody } from "@/lib/ai/openai";
import { createGeminiChatRequestBody, createGeminiGenerationConfig } from "@/lib/ai/gemini";
import { createMistralChatRequestBody } from "@/lib/ai/mistral";
import { executePersistedAiProcessing } from "@/lib/ai/processing-service.server";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { parseSettingsForm } from "@/lib/settings/form";

describe("future AI model contract", () => {
  it.each(aiReasoningEfforts)("dispatches exact Sol/Astra effort %s without temperature", (reasoningEffort) => {
    for (const model of ["gpt-6.1-sol", "gpt-6-astra"]) {
      expect(resolveNewAiModelSelection(model, reasoningEffort)?.reasoningEffort).toBe(reasoningEffort);
      for (const body of [
        createOpenAIRequestBody({ model, reasoningEffort, outputSchema: null, prompt: "safe", temperature: 0.3 }),
        createOpenAIChatRequestBody({ model, reasoningEffort, outputSchema: null, messages: [], systemInstruction: "safe" })
      ]) {
        expect(body).toHaveProperty("reasoning.effort", reasoningEffort);
        expect(body).not.toHaveProperty("temperature");
      }
    }
  });

  it("maps only future preferences and preserves exact legacy execution", () => {
    expect(getUserSettingsFromMetadata({ vosio_settings: { defaultOpenaiModel: "gpt-6-astra-low" } }))
      .toMatchObject({ defaultOpenaiModel: "gpt-6-astra", defaultReasoningEffort: "low", aiTemperature: 0.3 });
    expect(resolveNewAiModelSelection("gpt-6-astra-low")).toBeNull();
    expect(resolveAiModelExecution({ model: "gpt-6-astra-low", provider: "openai", providerConfig: { reasoning_effort: "low" } }))
      .toMatchObject({ profileId: "gpt-6-astra-low", providerModel: "gpt-6-astra" });
    expect(resolveAiModelExecution({ model: "gemini-3.8-flash", provider: "gemini", providerConfig: {} })?.option.supportsTemperature).toBe(false);
    expect(resolveAiModelExecution({ model: "gemini-3.8-flash", provider: "gemini", providerConfig: { temperature: 0.3, sampling_temperature_supported: true } })?.option.supportsTemperature).toBe(true);
  });

  it("stores validated default effort and fixes future sampling to 0.3", () => {
    const form = new FormData();
    form.set("defaultOpenaiModel", "gpt-6.1-sol");
    form.set("defaultReasoningEffort", "max");
    form.set("aiTemperature", "0.7");
    expect(parseSettingsForm(form)).toMatchObject({ defaultReasoningEffort: "max", aiTemperature: 0.3 });
    form.set("defaultReasoningEffort", "ultra");
    expect(() => parseSettingsForm(form)).toThrow();
  });

  it("uses 0.3 in new Gemini/Mistral chat and keeps legacy Gemini sampling absent", () => {
    const input = { model: "gemini-3.8-flash", outputSchema: null, messages: [], systemInstruction: "safe" };
    expect(createGeminiChatRequestBody(input)).toHaveProperty("generationConfig.temperature", 0.3);
    expect(createMistralChatRequestBody({ ...input, model: "mistral-small-2603" })).toHaveProperty("temperature", 0.3);
    expect(createGeminiGenerationConfig({ model: input.model, outputSchema: null, prompt: "safe", temperature: 0.7, supportsTemperature: false })).not.toHaveProperty("temperature");
  });

  it.each([0.3, 0.7])("executes pinned temperature %s rather than worker fallback", async (temperature) => {
    const runProvider = vi.fn(async () => ({ inputTokenCount: 1, outputText: "OK", outputTokenCount: 1, providerResponseId: null }));
    await executePersistedAiProcessing({ admin: {} as never, temperature: 0.2,
      job: { id: "job", model: "mistral-small-2603", provider: "mistral", providerConfig: { temperature }, promptTextSnapshot: "{{raw_text}}", outputSchemaSnapshot: null },
      transcript: { id: "t", rawText: "safe", segments: [], speakers: [], userId: "u" }
    }, { runProvider, persistCompleted: async () => ({}) });
    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({ temperature }));
  });

  it("adds future completion and chat snapshots without rewriting accepted data", () => {
    const sql = readFileSync("supabase/migrations/20261003020000_future_ai_model_selection.sql", "utf8");
    expect(sql).toContain("create or replace function public.mark_capture_timeline_consent_v1()");
    expect(sql).toContain("'low','medium','high','xhigh','max'");
    expect(sql).toContain("'temperature',0.3");
    expect(sql).toContain("'sampling_temperature_supported',true");
    expect(sql).toContain("on conflict(transcript_id) do nothing");
    expect(sql).toContain("add column provider_config jsonb");
    expect(sql).not.toMatch(/update\s+public\.(?:ai_processing_jobs|automatic_timeline_intents|capture_timeline_snapshots|transcript_chat_turns)/i);
  });
});
