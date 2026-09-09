import "server-only";
import { getMistralEnv } from "@/lib/env.server";
import type { AiProviderProcessingResult } from "@/lib/ai/common";
import type { RecordingChatMessage, RecordingChatProviderResult } from "@/lib/ai/chat-types";
import { classifyMistralProviderError, SafeAiProviderError } from "@/lib/ai/provider-errors";

type MistralResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  id?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
  };
};

type RunMistralProcessingInput = {
  model: string;
  outputSchema: unknown;
  prompt: string;
  temperature: number;
};

type RunMistralChatInput = {
  messages: RecordingChatMessage[];
  model: string;
  outputSchema: unknown;
  systemInstruction: string;
};

// createMistralResponseFormat binds supported structured requests to the authoritative JSON schema.
function createMistralResponseFormat(outputSchema: unknown) {
  if (!outputSchema || typeof outputSchema !== "object") {
    return { type: "text" };
  }

  return {
    json_schema: {
      description: "Structured Vosio AI extraction output.",
      name: "vosio_ai_output",
      schema: outputSchema,
      strict: false
    },
    type: "json_schema"
  };
}

// createMistralProcessingRequestBody builds one non-streaming Chat Completions request.
export function createMistralProcessingRequestBody(input: RunMistralProcessingInput) {
  return {
    messages: [{ content: input.prompt, role: "user" as const }],
    model: input.model,
    response_format: createMistralResponseFormat(input.outputSchema),
    temperature: input.temperature
  };
}

// createMistralChatRequestBody keeps authoritative rules in a distinct system message.
export function createMistralChatRequestBody(input: RunMistralChatInput) {
  return {
    messages: [
      { content: input.systemInstruction, role: "system" as const },
      ...input.messages
    ],
    model: input.model,
    response_format: createMistralResponseFormat(input.outputSchema)
  };
}

// extractMistralResult accepts only the documented text and usage result shape.
function extractMistralResult(payload: MistralResponse | null): RecordingChatProviderResult {
  const outputText = payload?.choices?.[0]?.message?.content?.trim() ?? "";

  if (!outputText) {
    throw new SafeAiProviderError({ failureCode: "unknown", retryAfterAt: null });
  }

  return {
    inputTokenCount: payload?.usage?.prompt_tokens ?? null,
    outputText,
    outputTokenCount: payload?.usage?.completion_tokens ?? null,
    providerResponseId: payload?.id ?? null
  };
}

// requestMistral sends a server-only provider request and normalizes every failure without raw detail.
async function requestMistral(body: unknown) {
  const env = getMistralEnv();
  let response: Response;

  try {
    response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${env.mistralApiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  } catch {
    throw new SafeAiProviderError(classifyMistralProviderError({ payload: null, status: 0, transportFailure: true }));
  }

  const payload = await response.json().catch(() => null) as MistralResponse | Record<string, unknown> | null;

  if (!response.ok) {
    throw new SafeAiProviderError(classifyMistralProviderError({
      payload,
      retryAfter: response.headers.get("Retry-After"),
      status: response.status
    }));
  }

  if (!payload) {
    throw new SafeAiProviderError({ failureCode: "unknown", retryAfterAt: null });
  }

  return extractMistralResult(payload as MistralResponse);
}

// runMistralProcessing sends one transcript processing request through the paid server-side API.
export function runMistralProcessing(input: RunMistralProcessingInput): Promise<AiProviderProcessingResult> {
  return requestMistral(createMistralProcessingRequestBody(input));
}

// runMistralChat sends one bounded recording conversation through the paid server-side API.
export function runMistralChat(input: RunMistralChatInput): Promise<RecordingChatProviderResult> {
  return requestMistral(createMistralChatRequestBody(input));
}
