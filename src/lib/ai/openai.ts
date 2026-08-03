import { getOpenAIEnv } from "@/lib/env.server";
import type { AiProviderProcessingResult } from "@/lib/ai/common";
import { getAiModelOption, supportsModelTemperature } from "@/lib/model-options";

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
  temperature: number;
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

  return {
    input: input.prompt,
    model: input.model,
    ...(option?.reasoningEffort
      ? { reasoning: { effort: option.reasoningEffort } }
      : {}),
    ...(supportsModelTemperature(input.model) ? { temperature: input.temperature } : {}),
    text: {
      format: createTextFormat(input.outputSchema)
    }
  };
}

// runOpenAIProcessing sends a transcript processing prompt to OpenAI server-side only.
export async function runOpenAIProcessing(input: RunOpenAIProcessingInput): Promise<AiProviderProcessingResult> {
  const env = getOpenAIEnv();
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify(createOpenAIRequestBody(input)),
    headers: {
      Authorization: `Bearer ${env.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  const payload = (await response.json().catch(() => null)) as
    | OpenAIResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message =
      payload &&
      "error" in payload &&
      typeof payload.error?.message === "string"
        ? payload.error.message
        : "OpenAI request failed.";
    throw new Error(message);
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
