export type AiProviderId = "openai" | "gemini";

export type AiModelOption = {
  description: string;
  id: string;
  inputUsdPerMillionTokens: number;
  label: string;
  outputUsdPerMillionTokens: number;
  price: string;
  provider: AiProviderId;
  supportsTemperature?: boolean;
};

export const aiModelOptions = [
  {
    description: "Silnější OpenAI model pro složitější zápisy, delší call kontext a náročnější rozhodování.",
    id: "gpt-5.4",
    inputUsdPerMillionTokens: 2.5,
    label: "GPT-5.4",
    outputUsdPerMillionTokens: 15,
    price: "$2.50 input / $15.00 output za 1M tokenů",
    provider: "openai",
    supportsTemperature: false
  },
  {
    description: "Vyvážený levnější model pro shrnutí, úkoly a CRM poznámky.",
    id: "gpt-4.1-mini",
    inputUsdPerMillionTokens: 0.4,
    label: "GPT-4.1 mini",
    outputUsdPerMillionTokens: 1.6,
    price: "$0.40 input / $1.60 output za 1M tokenů",
    provider: "openai"
  },
  {
    description: "Nejlevnější GPT-4.1 varianta pro jednoduché strukturované výstupy.",
    id: "gpt-4.1-nano",
    inputUsdPerMillionTokens: 0.1,
    label: "GPT-4.1 nano",
    outputUsdPerMillionTokens: 0.4,
    price: "$0.10 input / $0.40 output za 1M tokenů",
    provider: "openai"
  },
  {
    description: "Novější mini model pro kvalitnější zápisy a delší kontext za nízkou cenu.",
    id: "gpt-5.4-mini",
    inputUsdPerMillionTokens: 0.75,
    label: "GPT-5.4 mini",
    outputUsdPerMillionTokens: 4.5,
    price: "$0.75 input / $4.50 output za 1M tokenů",
    provider: "openai",
    supportsTemperature: false
  },
  {
    description: "Nejlevnější GPT-5.4 varianta pro rychlé a levné extrakce.",
    id: "gpt-5.4-nano",
    inputUsdPerMillionTokens: 0.2,
    label: "GPT-5.4 nano",
    outputUsdPerMillionTokens: 1.25,
    price: "$0.20 input / $1.25 output za 1M tokenů",
    provider: "openai",
    supportsTemperature: false
  },
  {
    description: "Google model pro rychlé výstupy s vyšší kvalitou a grounding ekosystémem.",
    id: "gemini-3.5-flash",
    inputUsdPerMillionTokens: 1.5,
    label: "Gemini 3.5 Flash",
    outputUsdPerMillionTokens: 9,
    price: "$1.50 input / $9.00 output za 1M tokenů",
    provider: "gemini"
  },
  {
    description: "Nejlevnější Gemini volba pro jednoduché extrakce, překlady a vysoký objem.",
    id: "gemini-3.1-flash-lite",
    inputUsdPerMillionTokens: 0.25,
    label: "Gemini 3.1 Flash-Lite",
    outputUsdPerMillionTokens: 1.5,
    price: "$0.25 input / $1.50 output za 1M tokenů",
    provider: "gemini"
  },
  {
    description: "Preview Gemini Pro pro složitější zápisy; cena platí pro prompty do 200k tokenů.",
    id: "gemini-3.1-pro-preview",
    inputUsdPerMillionTokens: 2,
    label: "Gemini 3.1 Pro Preview",
    outputUsdPerMillionTokens: 12,
    price: "$2.00 input / $12.00 output za 1M tokenů",
    provider: "gemini"
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
