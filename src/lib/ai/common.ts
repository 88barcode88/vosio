export type AiProviderProcessingResult = {
  inputTokenCount: number | null;
  outputText: string;
  outputTokenCount: number | null;
  providerResponseId: string | null;
};

// parsePossibleJson returns parsed JSON for structured AI outputs when available.
export function parsePossibleJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
