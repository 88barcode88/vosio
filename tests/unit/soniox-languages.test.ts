import { describe, expect, it } from "vitest";

import {
  getSonioxRealtimeLanguageConfig,
  sonioxRealtimeLanguageOptions
} from "@/lib/soniox/languages";

describe("Soniox realtime language catalog", () => {
  it("keeps the requested option order and labels", () => {
    expect(sonioxRealtimeLanguageOptions).toEqual([
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
    ]);
  });

  it("maps automatic detection without language hints", () => {
    expect(getSonioxRealtimeLanguageConfig("auto")).toEqual({
      enable_language_identification: true
    });
  });

  it("maps a selected language to one strict hint", () => {
    expect(getSonioxRealtimeLanguageConfig("cs")).toEqual({
      enable_language_identification: true,
      language_hints: ["cs"],
      language_hints_strict: true
    });
  });
});
