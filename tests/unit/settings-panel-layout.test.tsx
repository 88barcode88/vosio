/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings-panel";
import { parseSettingsForm } from "@/lib/settings/form";
import { defaultUserSettings } from "@/lib/settings/types";

vi.mock("@/lib/settings/actions", () => ({
  updateUserSettingsAction: vi.fn()
}));

const storageConfig = {
  bucketMaxFileSizeBytes: 100 * 1024 * 1024,
  detectedGlobalMaxFileSizeBytes: null,
  maxFileSizeBytes: 50 * 1024 * 1024,
  planMaxFileSizeBytes: 50 * 1024 * 1024
};

function renderSettings(
  usageState: Parameters<typeof SettingsPanel>[0]["usageState"],
  settings = defaultUserSettings
) {
  return renderToStaticMarkup(
    <SettingsPanel
      recordingStorageConfig={storageConfig}
      settings={{ ...settings, supabaseStoragePlan: "free" }}
      status={null}
      usageState={usageState}
    />
  );
}

describe("settings workspace layout", () => {
  it("orders the working settings as one document and keeps technical details closed by default", () => {
    const markup = renderSettings({
      error: null,
      summary: {
        ai: {
          estimatedCostUsd: 0,
          inputTokens: 0,
          jobCount: 0,
          jobsMissingTokenUsage: 0,
          modelBreakdown: [],
          outputTokens: 0,
          unpricedModelIds: []
        },
        period: { endIso: "2026-09-01T00:00:00.000Z", startIso: "2026-08-01T00:00:00.000Z" },
        recordings: {
          count: 0,
          deletedCount: 0,
          totalDurationSeconds: null,
          totalFileSizeBytes: null,
          withDurationCount: 0,
          withFileSizeCount: 0
        },
        soniox: {
          asyncDurationSeconds: 0,
          asyncEstimatedCostUsd: 0,
          billableDurationSeconds: 0,
          estimatedCostUsd: 0,
          jobCount: 0,
          jobsMissingDurationCount: 0,
          jobsWithDurationCount: 0,
          realtimeDurationSeconds: 0,
          realtimeEstimatedCostUsd: 0
        }
      }
    });

    const headings = ["AI a výstupy", "Jazyk a přepis", "Nahrávání", "Úložiště", "Vzhled", "Diagnostika a využití"];
    const headingPositions = headings.map((heading) => markup.search(new RegExp(`<h2[^>]*>${heading}</h2>`, "u")));

    expect(headingPositions.every((position) => position >= 0)).toBe(true);
    expect([...headingPositions].sort((left, right) => left - right)).toEqual(headingPositions);
    expect(markup).toContain("Zatím bez usage v tomto měsíci.");
    expect(markup).toContain("Technické informace");
    expect(markup).not.toContain("Globální limit projektu");
  });

  it("shows only runtime-effective preferences as controls and preserves stored-only values as hidden inputs", () => {
    const markup = renderSettings({ error: "Usage se teď nepodařilo načíst.", summary: null });

    for (const name of ["defaultOpenaiModel", "sonioxRealtimeLanguage", "sonioxRealtimeModel", "supabaseStoragePlan"]) {
      expect(markup).toContain(`name="${name}"`);
    }
    for (const name of [
      "aiTemperature",
      "audioRetentionPolicy",
      "autoProcessAfterTranscription",
      "autoProcessingTypes",
      "outputLanguage"
    ]) {
      expect(markup).toMatch(new RegExp(`<input[^>]+name="${name}"[^>]+type="hidden"|<input[^>]+type="hidden"[^>]+name="${name}"`, "u"));
      expect(markup).not.toContain(`<select name="${name}"`);
    }
    expect(markup).toContain("Některé dříve uložené preference zatím aplikace nepoužívá.");
    expect(markup).toContain("Usage se teď nepodařilo načíst.");
  });

  it("marks partial usage totals as incomplete and keeps exact coverage in a closed disclosure", () => {
    const markup = renderSettings({
      error: null,
      summary: {
        ai: {
          estimatedCostUsd: 0.00001,
          inputTokens: 2_000,
          jobCount: 4,
          jobsMissingTokenUsage: 1,
          modelBreakdown: [],
          outputTokens: 500,
          unpricedModelIds: ["custom-model"]
        },
        period: { endIso: "2026-09-01T00:00:00.000Z", startIso: "2026-08-01T00:00:00.000Z" },
        recordings: {
          count: 5,
          deletedCount: 1,
          totalDurationSeconds: 3_600,
          totalFileSizeBytes: 10 * 1024 * 1024,
          withDurationCount: 3,
          withFileSizeCount: 2
        },
        soniox: {
          asyncDurationSeconds: 3_600,
          asyncEstimatedCostUsd: 0.1,
          billableDurationSeconds: 3_600,
          estimatedCostUsd: 0.1,
          jobCount: 3,
          jobsMissingDurationCount: 1,
          jobsWithDurationCount: 2,
          realtimeDurationSeconds: 0,
          realtimeEstimatedCostUsd: 0
        }
      }
    });

    expect(markup).toContain("Neúplná data");
    expect(markup).toContain("&lt;$0.0001");
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).toContain("Více informací");
    expect(markup).toContain("3 z 5 nahrávek má uloženou délku");
    expect(markup).toContain("2 z 5 nahrávek má uloženou velikost");
    expect(markup).toContain("AI joby bez uložených tokenů: 1");
    expect(markup).toContain("custom-model");
    expect(markup).toContain("Soniox joby bez známé délky: 1");
  });

  it("renders an explicit collection sentinel when stored processing types are empty", () => {
    const markup = renderSettings(
      { error: "Usage se teď nepodařilo načíst.", summary: null },
      { ...defaultUserSettings, autoProcessingTypes: [] }
    );

    expect(markup).toContain("name=\"autoProcessingTypesPresent\"");
    expect(markup).not.toContain("name=\"autoProcessingTypes\"");

    const container = document.createElement("div");
    container.innerHTML = markup;
    const form = container.querySelector("form");

    expect(form).not.toBeNull();
    expect(parseSettingsForm(new FormData(form!)).autoProcessingTypes).toEqual([]);
  });
});
