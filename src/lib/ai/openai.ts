import { getOpenAIEnv } from "@/lib/env.server";
import type { AiProviderProcessingResult } from "@/lib/ai/common";
import type { RecordingChatMessage, RecordingChatProviderResult } from "@/lib/ai/chat-types";
import { getAiModelOption, supportsModelTemperature } from "@/lib/model-options";
import { classifyOpenAIProviderError, SafeAiProviderError } from "@/lib/ai/provider-errors";

type OpenAIResponse = {
  id: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

type RunOpenAIProcessingInput = {
  model: string;
  outputSchema: unknown;
  prompt: string;
  reasoningEffort?: "high" | "xhigh" | null;
  temperature: number;
};

type RunOpenAIChatInput = {
  messages: RecordingChatMessage[];
  model: string;
  outputSchema: unknown;
  systemInstruction: string;
};

// extractOpenAIText reads text from the Responses API convenience and nested outputs.
function extractOpenAIText(response: OpenAIResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter((text): text is string => Boolean(text))
      .join("\n")
      .trim() ?? ""
  );
}

// createTextFormat converts an optional prompt JSON schema into a Responses API format.
function createTextFormat(outputSchema: unknown) {
  if (!outputSchema || typeof outputSchema !== "object") {
    return { type: "text" };
  }

  return {
    description: "Structured Vosio AI extraction output.",
    name: "vosio_ai_output",
    schema: outputSchema,
    strict: false,
    type: "json_schema"
  };
}

// createOpenAIRequestBody builds a Responses API payload and omits unsupported sampling controls.
export function createOpenAIRequestBody(input: RunOpenAIProcessingInput) {
  const option = getAiModelOption(input.model);
  const reasoningEffort = input.reasoningEffort === undefined
    ? option?.reasoningEffort
    : input.reasoningEffort;

  return {
    input: input.prompt,
    model: input.model,
    ...(reasoningEffort
      ? { reasoning: { effort: reasoningEffort } }
      : {}),
    ...(supportsModelTemperature(input.model) ? { temperature: input.temperature } : {}),
    text: {
      format: createTextFormat(input.outputSchema)
    }
  };
}

// createOpenAIChatRequestBody keeps system authority in Responses instructions and data in role-separated input.
export function createOpenAIChatRequestBody(input: RunOpenAIChatInput) {
  const option = getAiModelOption(input.model);

  return {
    input: input.messages,
    instructions: input.systemInstruction,
    model: input.model,
    ...(option?.reasoningEffort
      ? { reasoning: { effort: option.reasoningEffort } }
      : {}),
    text: {
      format: createTextFormat(input.outputSchema)
    }
  };
}

// runOpenAIProcessing sends a transcript processing prompt to OpenAI server-side only.
export async function runOpenAIProcessing(input: RunOpenAIProcessingInput): Promise<AiProviderProcessingResult> {
  const env = getOpenAIEnv();
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify(createOpenAIRequestBody(input)),
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  } catch {
    throw new SafeAiProviderError(classifyOpenAIProviderError({ payload: null, status: 0, transportFailure: true }));
  }

  const payload = (await response.json().catch(() => null)) as
    | OpenAIResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new SafeAiProviderError(classifyOpenAIProviderError({
      payload,
      retryAfter: response.headers.get("Retry-After"),
      status: response.status
    }));
  }

  const openaiResponse = payload as OpenAIResponse;
  const text = extractOpenAIText(openaiResponse);

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return {
    inputTokenCount: openaiResponse.usage?.input_tokens ?? null,
    outputText: text,
    outputTokenCount: openaiResponse.usage?.output_tokens ?? null,
    providerResponseId: openaiResponse.id
  };
}

// runOpenAIChat sends one bounded recording conversation through the server-only Responses API.
export async function runOpenAIChat(input: RunOpenAIChatInput): Promise<RecordingChatProviderResult> {
  const env = getOpenAIEnv();
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify(createOpenAIChatRequestBody(input)),
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  } catch {
    throw new Error("OpenAI chat request failed.");
  }
  const payload = (await response.json().catch(() => null)) as
    | OpenAIResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error("OpenAI chat request failed.");
  }

  const openaiResponse = payload as OpenAIResponse;
  const text = extractOpenAIText(openaiResponse);

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return {
    inputTokenCount: openaiResponse.usage?.input_tokens ?? null,
    outputText: text,
    outputTokenCount: openaiResponse.usage?.output_tokens ?? null,
    providerResponseId: openaiResponse.id
  };
}
