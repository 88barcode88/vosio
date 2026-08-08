export const sonioxRealtimeLanguageIds = [
  "auto",
  "cs",
  "en",
  "de",
  "es",
  "it",
  "sk",
  "sl",
  "hu",
  "pl"
] as const;

export type SonioxRealtimeLanguageId = (typeof sonioxRealtimeLanguageIds)[number];

export const sonioxRealtimeLanguageOptions: ReadonlyArray<{
  id: SonioxRealtimeLanguageId;
  label: string;
}> = [
  { id: "auto", label: "Automaticky" },
  { id: "cs", label: "Čeština" },
  { id: "en", label: "Angličtina" },
  { id: "de", label: "Němčina" },
  { id: "es", label: "Španělština" },
  { id: "it", label: "Italština" },
  { id: "sk", label: "Slovenština" },
  { id: "sl", label: "Slovinština" },
  { id: "hu", label: "Maďarština" },
  { id: "pl", label: "Polština" }
] as const;

// getSonioxRealtimeLanguageConfig maps the selected live language to provider hints.
export function getSonioxRealtimeLanguageConfig(language: SonioxRealtimeLanguageId) {
  if (language === "auto") {
    return { enable_language_identification: true };
  }

  return {
    enable_language_identification: true,
    language_hints: [language],
    language_hints_strict: true
  };
}
