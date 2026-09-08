export type AiProviderId = "openai" | "gemini" | "mistral";

export type AiModelOption = {
  description: string;
  geminiThinkingLevel?: "medium" | "high";
  id: string;
  inputUsdPerMillionTokens: number;
  label: string;
  outputUsdPerMillionTokens: number;
  price: string;
  provider: AiProviderId;
  providerModel: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
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
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gpt-6-astra-low",
  "gpt-6-astra-medium",
  "mistral-small-2603",
  "mistral-large-2512"
] as const;

export const aiModelOptions = [
  {
    description: "Nejsilnější GPT-5.6 model pro nejnáročnější zápisy, důkazy a práci s dlouhým přepisem; používá reasoning XHigh.",
    id: "gpt-5.6-sol",
    inputUsdPerMillionTokens: 4,
    label: "GPT-5.6 Sol · XHigh",
    outputUsdPerMillionTokens: 20,
    price: "$4.00 input / $20.00 output za 1M tokenů",
    provider: "openai",
    providerModel: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    supportsTemperature: false
  },
  {
    description: "Vyvážený GPT-5.6 model pro kvalitní zápisy a složitější práci s dlouhými přepisy; používá reasoning High.",
    id: "gpt-5.6-terra",
    inputUsdPerMillionTokens: 2,
    label: "GPT-5.6 Terra · High",
    outputUsdPerMillionTokens: 12,
    price: "$2.00 input / $12.00 output za 1M tokenů",
    provider: "openai",
    providerModel: "gpt-5.6-terra",
    reasoningEffort: "high",
    supportsTemperature: false
  },
  {
    description: "Úsporný GPT-5.6 model pro strukturované výstupy a vysoký objem; používá reasoning XHigh.",
    id: "gpt-5.6-luna",
    inputUsdPerMillionTokens: 0.2,
    label: "GPT-5.6 Luna · XHigh",
    outputUsdPerMillionTokens: 1.2,
    price: "$0.20 input / $1.20 output za 1M tokenů",
    provider: "openai",
    providerModel: "gpt-5.6-luna",
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
    providerModel: "gemini-3.6-flash",
    supportsTemperature: false
  },
  {
    description: "Aktuální rychlý Google model pro složitější zápisy a strukturované výstupy; používá thinking Medium.",
    geminiThinkingLevel: "medium",
    id: "gemini-3.8-flash",
    inputUsdPerMillionTokens: 0.75,
    label: "Gemini 3.8 Flash · Thinking Medium",
    outputUsdPerMillionTokens: 3.75,
    price: "$0.75 input / $3.75 output za 1M tokenů (zaváděcí cena do 31. 12. 2026)",
    provider: "gemini",
    providerModel: "gemini-3.8-flash",
    supportsTemperature: false
  },
  {
    description: "Nejsilnější OpenAI model s nižším reasoning úsilím pro rychlejší náročné zápisy.",
    id: "gpt-6-astra-low",
    inputUsdPerMillionTokens: 10,
    label: "GPT-6 Astra · Low",
    outputUsdPerMillionTokens: 50,
    price: "$10.00 input / $50.00 output za 1M tokenů",
    provider: "openai",
    providerModel: "gpt-6-astra",
    reasoningEffort: "low",
    supportsTemperature: false
  },
  {
    description: "Nejsilnější OpenAI model s vyváženým reasoning úsilím pro důležité a složité hovory.",
    id: "gpt-6-astra-medium",
    inputUsdPerMillionTokens: 10,
    label: "GPT-6 Astra · Medium",
    outputUsdPerMillionTokens: 50,
    price: "$10.00 input / $50.00 output za 1M tokenů",
    provider: "openai",
    providerModel: "gpt-6-astra",
    reasoningEffort: "medium",
    supportsTemperature: false
  },
  {
    description: "Úsporný Mistral model pro rychlé strukturované zápisy a větší objem hovorů.",
    id: "mistral-small-2603",
    inputUsdPerMillionTokens: 0.15,
    label: "Mistral Small 4",
    outputUsdPerMillionTokens: 0.6,
    price: "$0.15 input / $0.60 output za 1M tokenů",
    provider: "mistral",
    providerModel: "mistral-small-2603",
    supportsTemperature: true
  },
  {
    description: "Výkonný Mistral model pro složitější zápisy a práci s rozsáhlým kontextem.",
    id: "mistral-large-2512",
    inputUsdPerMillionTokens: 0.5,
    label: "Mistral Large 3",
    outputUsdPerMillionTokens: 1.5,
    price: "$0.50 input / $1.50 output za 1M tokenů",
    provider: "mistral",
    providerModel: "mistral-large-2512",
    supportsTemperature: true
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

const legacyAiModelAliases: Readonly<Record<string, (typeof aiModelIds)[number]>> = {
  "gemini-3.1-flash-lite": DEFAULT_GEMINI_MODEL_ID,
  "gemini-3.1-pro-preview": DEFAULT_GEMINI_MODEL_ID,
  "gemini-3.5-flash": DEFAULT_GEMINI_MODEL_ID,
  "gpt-4.1-mini": DEFAULT_AI_MODEL_ID,
  "gpt-4.1-nano": DEFAULT_AI_MODEL_ID,
  "gpt-5.4": DEFAULT_AI_MODEL_ID,
  "gpt-5.4-mini": DEFAULT_AI_MODEL_ID,
  "gpt-5.4-nano": DEFAULT_AI_MODEL_ID
};

// normalizeAiModelId upgrades only explicitly known legacy picker values and leaves unknown input invalid.
export function normalizeAiModelId(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  return aiModelIds.includes(value as (typeof aiModelIds)[number])
    ? value
    : legacyAiModelAliases[value] ?? value;
}

// getAiModelOption finds known model metadata for routing, price display and usage estimates.
export function getAiModelOption(modelId: string) {
  return aiModelOptions.find((option) => option.id === modelId) ?? null;
}

export type ResolvedAiModelExecution = {
  option: AiModelOption;
  profileId: string;
  provider: AiProviderId;
  providerModel: string;
};

// resolveAiModelExecution validates a durable profile/provider snapshot and resolves its exact API model.
export function resolveAiModelExecution(input: {
  model: string;
  provider: unknown;
  providerConfig: unknown;
}): ResolvedAiModelExecution | null {
  const option = getAiModelOption(input.model);

  if (!option || input.provider !== option.provider) {
    return null;
  }

  if (!input.providerConfig || typeof input.providerConfig !== "object" || Array.isArray(input.providerConfig)) {
    return null;
  }

  const providerConfig = input.providerConfig as Record<string, unknown>;
  const snapshottedProvider = providerConfig.provider;
  const snapshottedProviderModel = providerConfig.provider_model;
  const snapshottedReasoning = providerConfig.reasoning_effort;
  const snapshottedThinking = providerConfig.thinking_level;

  if (snapshottedProvider !== undefined && snapshottedProvider !== option.provider) {
    return null;
  }

  if (snapshottedProviderModel !== undefined && snapshottedProviderModel !== option.providerModel) {
    return null;
  }

  if (snapshottedReasoning !== undefined && snapshottedReasoning !== null && snapshottedReasoning !== option.reasoningEffort) {
    return null;
  }

  if (snapshottedThinking !== undefined && snapshottedThinking !== null && snapshottedThinking !== option.geminiThinkingLevel) {
    return null;
  }

  return {
    option,
    profileId: option.id,
    provider: option.provider,
    providerModel: option.providerModel
  };
}

// getAiModelDescription returns provider-aware UI copy for a selected model.
export function getAiModelDescription(modelId: string) {
  const option = getAiModelOption(modelId);

  return option ? `${option.description} ${option.price}` : "Cena podle aktuálního ceníku providera.";
}

// supportsModelTemperature tells UI and provider callers whether sampling temperature should be sent.
export function supportsModelTemperature(modelId: string) {
  const option = getAiModelOption(modelId)
    ?? aiModelOptions.find((candidate) => candidate.providerModel === modelId)
    ?? null;

  return option?.supportsTemperature ?? !modelId.startsWith("gpt-5");
}

export type OpenAiModelId = (typeof openAiModelOptions)[number]["id"];
export type SonioxRealtimeModelId = (typeof sonioxRealtimeModelOptions)[number]["id"];
