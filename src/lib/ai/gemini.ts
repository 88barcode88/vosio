import { getGeminiEnv } from "@/lib/env.server";
import type { AiProviderProcessingResult } from "@/lib/ai/common";
import { getAiModelOption, supportsModelTemperature } from "@/lib/model-options";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
  responseId?: string;
  usageMetadata?: {
    candidatesTokenCount?: number;
    promptTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

type RunGeminiProcessingInput = {
  model: string;
  outputSchema: unknown;
  prompt: string;
  temperature: number;
  thinkingLevel?: "medium" | "high" | null;
};

// extractGeminiText joins text parts returned by the Gemini generateContent API.
function extractGeminiText(response: GeminiResponse) {
  return (
    response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim() ?? ""
  );
}

// createGeminiGenerationConfig keeps Gemini output aligned with the model and prompt contracts.
export function createGeminiGenerationConfig(input: RunGeminiProcessingInput) {
  const option = getAiModelOption(input.model);
  const thinkingLevel = input.thinkingLevel === undefined
    ? option?.geminiThinkingLevel
    : input.thinkingLevel;

  return {
    responseMimeType: input.outputSchema ? "application/json" : "text/plain",
    ...(thinkingLevel
      ? { thinkingConfig: { thinkingLevel } }
      : {}),
    ...(supportsModelTemperature(input.model) ? { temperature: input.temperature } : {})
  };
}

// getGeminiOutputTokenCount includes billed thinking tokens in the stored output usage.
export function getGeminiOutputTokenCount(usage: GeminiResponse["usageMetadata"]) {
  if (usage?.candidatesTokenCount === undefined && usage?.thoughtsTokenCount === undefined) {
    return null;
  }

  return (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
}

// runGeminiProcessing sends a transcript processing prompt to Google Gemini server-side only.
export async function runGeminiProcessing(input: RunGeminiProcessingInput): Promise<AiProviderProcessingResult> {
  const env = getGeminiEnv();
  const modelPath = encodeURIComponent(input.model);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent?key=${encodeURIComponent(env.geminiApiKey)}`,
    {
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: input.prompt }],
            role: "user"
          }
        ],
        generationConfig: createGeminiGenerationConfig(input)
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    }
  );

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Gemini request failed.");
  }

  if (!payload) {
    throw new Error("Gemini returned an empty response.");
  }

  const text = extractGeminiText(payload);

  if (!text) {
    throw new Error("Gemini returned an empty text response.");
  }

  return {
    inputTokenCount: payload.usageMetadata?.promptTokenCount ?? null,
    outputText: text,
    outputTokenCount: getGeminiOutputTokenCount(payload.usageMetadata),
    providerResponseId: payload.responseId ?? null
  };
}
