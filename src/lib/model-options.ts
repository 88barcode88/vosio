export type AiProviderId = "openai" | "gemini";

export type AiModelOption = {
  description: string;
  geminiThinkingLevel?: "medium" | "high";
  id: string;
  inputUsdPerMillionTokens: number;
  label: string;
  outputUsdPerMillionTokens: number;
  price: string;
  provider: AiProviderId;
  reasoningEffort?: "high" | "xhigh";
  supportsTemperature?: boolean;
};

export const DEFAULT_AI_MODEL_ID = "gpt-5.6-terra";
export const DEFAULT_GEMINI_MODEL_ID = "gemini-3.6-flash";

// AI_MODEL_QUALITY_GUIDANCE explains the practical quality and review tradeoff shared by AI surfaces.
export const AI_MODEL_QUALITY_GUIDANCE =
  "Silnější modely obvykle zachytí více souvislostí. Menším a levnějším modelům může uniknout více detailů, úkolů nebo důkazů; žádný model nezaručuje úplnost.";

export const aiModelIds = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gemini-3.6-flash"
] as const;

export const aiModelOptions = [
  {
    description: "Nejsilnější GPT-5.6 model pro nejnáročnější zápisy, důkazy a práci s dlouhým přepisem; používá reasoning XHigh.",
    id: "gpt-5.6-sol",
    inputUsdPerMillionTokens: 5,
    label: "GPT-5.6 Sol · XHigh",
    outputUsdPerMillionTokens: 30,
    price: "$5.00 input / $30.00 output za 1M tokenů",
    provider: "openai",
    reasoningEffort: "xhigh",
    supportsTemperature: false
  },
  {
    description: "Vyvážený GPT-5.6 model pro kvalitní zápisy a složitější práci s dlouhými přepisy; používá reasoning High.",
    id: "gpt-5.6-terra",
    inputUsdPerMillionTokens: 2.5,
    label: "GPT-5.6 Terra · High",
    outputUsdPerMillionTokens: 15,
    price: "$2.50 input / $15.00 output za 1M tokenů",
    provider: "openai",
    reasoningEffort: "high",
    supportsTemperature: false
  },
  {
    description: "Úsporný GPT-5.6 model pro strukturované výstupy a vysoký objem; používá reasoning XHigh.",
    id: "gpt-5.6-luna",
    inputUsdPerMillionTokens: 1,
    label: "GPT-5.6 Luna · XHigh",
    outputUsdPerMillionTokens: 6,
    price: "$1.00 input / $6.00 output za 1M tokenů",
    provider: "openai",
    reasoningEffort: "xhigh",
    supportsTemperature: false
  },
  {
    description: "Rychlý Google model s explicitním thinking Medium pro vícekrokové zápisy a strukturované výstupy.",
    geminiThinkingLevel: "medium",
    id: "gemini-3.6-flash",
    inputUsdPerMillionTokens: 1.5,
    label: "Gemini 3.6 Flash · Thinking",
    outputUsdPerMillionTokens: 7.5,
    price: "$1.50 input / $7.50 output za 1M tokenů",
    provider: "gemini",
    supportsTemperature: false
  }
] satisfies AiModelOption[];

export const openAiModelOptions = aiModelOptions.filter((option) => option.provider === "openai");

export const sonioxRealtimeModelOptions = [
  {
    description: "Aktuální Soniox realtime STT model pro živé titulky, nízkou latenci a diarizaci mluvčích.",
    id: "stt-rt-v5",
    label: "Soniox realtime v5",
    price: "Soniox účtuje STT zvlášť podle jejich aktuálního API ceníku."
  }
] as const;

export const sonioxRealtimeModelIds = ["stt-rt-v5"] as const;

// normalizeAiModelId upgrades removed picker values while preserving the selected provider family.
export function normalizeAiModelId(value: unknown) {
  if (typeof value === "string" && aiModelIds.includes(value as (typeof aiModelIds)[number])) {
    return value;
  }

  return typeof value === "string" && value.startsWith("gemini-")
    ? DEFAULT_GEMINI_MODEL_ID
    : DEFAULT_AI_MODEL_ID;
}

// getAiModelOption finds known model metadata for routing, price display and usage estimates.
export function getAiModelOption(modelId: string) {
  return aiModelOptions.find((option) => option.id === modelId) ?? null;
}

// getAiModelDescription returns provider-aware UI copy for a selected model.
export function getAiModelDescription(modelId: string) {
  const option = getAiModelOption(modelId);

  return option ? `${option.description} ${option.price}` : "Cena podle aktuálního ceníku providera.";
}

// supportsModelTemperature tells UI and provider callers whether sampling temperature should be sent.
export function supportsModelTemperature(modelId: string) {
  const option = getAiModelOption(modelId);

  return option?.supportsTemperature ?? !modelId.startsWith("gpt-5");
}

export type OpenAiModelId = (typeof openAiModelOptions)[number]["id"];
export type SonioxRealtimeModelId = (typeof sonioxRealtimeModelOptions)[number]["id"];
