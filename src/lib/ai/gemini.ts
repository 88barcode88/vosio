import { getGeminiEnv } from "@/lib/env.server";
import type { AiProviderProcessingResult } from "@/lib/ai/common";
import type { RecordingChatMessage, RecordingChatProviderResult } from "@/lib/ai/chat-types";
import { getAiModelOption, supportsModelTemperature } from "@/lib/model-options";
import { classifyGeminiProviderError, SafeAiProviderError } from "@/lib/ai/provider-errors";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    code?: number;
    details?: unknown[];
    message?: string;
    status?: string;
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

type RunGeminiChatInput = {
  messages: RecordingChatMessage[];
  model: string;
  outputSchema: unknown;
  systemInstruction: string;
};

type GeminiChatContent = {
  parts: Array<{ text: string }>;
  role: "model" | "user";
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

// createGeminiChatContents coalesces adjacent roles while preserving each original message as an ordered text part.
function createGeminiChatContents(messages: RecordingChatMessage[]) {
  return messages.reduce<GeminiChatContent[]>((contents, message) => {
    const role = message.role === "assistant" ? "model" : "user";
    const previous = contents.at(-1);

    if (previous?.role === role) {
      return [
        ...contents.slice(0, -1),
        { ...previous, parts: [...previous.parts, { text: message.content }] }
      ];
    }

    return [...contents, { parts: [{ text: message.content }], role }];
  }, []);
}

// createGeminiChatRequestBody keeps systemInstruction authoritative and maps prior assistant turns to model role.
export function createGeminiChatRequestBody(input: RunGeminiChatInput) {
  return {
    contents: createGeminiChatContents(input.messages),
    generationConfig: {
      ...createGeminiGenerationConfig({
        model: input.model,
        outputSchema: input.outputSchema,
        prompt: "",
        temperature: 0.2
      }),
      ...(input.outputSchema ? { responseJsonSchema: input.outputSchema } : {})
    },
    systemInstruction: {
      parts: [{ text: input.systemInstruction }]
    }
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
  let response: Response;
  try {
    response = await fetch(
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
  } catch {
    throw new SafeAiProviderError(classifyGeminiProviderError({ payload: null, status: 0, transportFailure: true }));
  }

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok) {
    throw new SafeAiProviderError(classifyGeminiProviderError({
      payload,
      status: response.status
    }));
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

// runGeminiChat sends one bounded recording conversation through Gemini with a separate system instruction.
export async function runGeminiChat(input: RunGeminiChatInput): Promise<RecordingChatProviderResult> {
  const env = getGeminiEnv();
  const modelPath = encodeURIComponent(input.model);
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelPath}:generateContent?key=${encodeURIComponent(env.geminiApiKey)}`,
      {
        body: JSON.stringify(createGeminiChatRequestBody(input)),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
  } catch {
    throw new Error("Gemini chat request failed.");
  }
  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok) {
    throw new Error("Gemini chat request failed.");
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
