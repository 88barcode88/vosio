/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { InstallationStatusDetails, SettingsPanel } from "@/components/settings-panel";
import type { InstallationStatus } from "@/lib/installation-status.server";
import { parseSettingsForm } from "@/lib/settings/form";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";

vi.mock("@/lib/settings/actions", () => ({
  updateUserSettingsAction: vi.fn()
}));

const storageConfig = {
  allowedMimeTypes: ["audio/mpeg"],
  bucketMaxFileSizeBytes: 100 * 1024 * 1024,
  detectedGlobalMaxFileSizeBytes: null,
  maxFileSizeBytes: 50 * 1024 * 1024,
  planMaxFileSizeBytes: 50 * 1024 * 1024
};

const installationStatus = {
  environment: "preview",
  geminiConfigured: false,
  missingRequiredNames: ["OPENAI_API_KEY"],
  ready: false
} satisfies InstallationStatus;

function renderSettings(
  usageState: Parameters<typeof SettingsPanel>[0]["usageState"],
  settings: UserSettings = defaultUserSettings
) {
  return renderToStaticMarkup(
    <SettingsPanel
      installationStatus={installationStatus}
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

    for (const name of ["defaultOpenaiModel", "sonioxRegion", "sonioxRealtimeLanguage", "sonioxRealtimeModel", "supabaseStoragePlan"]) {
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

  it("renders only safe installation state in the technical information content", () => {
    const markup = renderToStaticMarkup(<dl><InstallationStatusDetails status={installationStatus} /></dl>);

    expect(markup).toContain("Preview");
    expect(markup).toContain("Chybí konfigurace");
    expect(markup).toContain("OPENAI_API_KEY");
    expect(markup).toContain("GEMINI_API_KEY (volitelné)");
    expect(markup).not.toContain("test-secret");
  });

  it("renders the saved Soniox region and a persistent EU access warning", () => {
    const markup = renderSettings(
      { error: "Usage se teď nepodařilo načíst.", summary: null },
      { ...defaultUserSettings, sonioxRegion: "eu" }
    );

    expect(markup).toContain('<select name="sonioxRegion"');
    expect(markup).toContain('<option value="eu" selected="">Evropská unie</option>');
    expect(markup).toContain("Soniox EU projekt");
    expect(markup).toContain("odpovídající regionální API klíč");
    expect(markup).toContain('href="mailto:support@soniox.com"');
    expect(markup).toContain('class="settings-region-warning"');
    expect(markup).not.toContain("SONIOX_REGION");
  });

  it("updates the EU warning in both directions without saving the form", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <SettingsPanel
            installationStatus={installationStatus}
            recordingStorageConfig={storageConfig}
            settings={{ ...defaultUserSettings, sonioxRegion: "eu", supabaseStoragePlan: "free" }}
            status={null}
            usageState={{ error: "Usage se teď nepodařilo načíst.", summary: null }}
          />
        );
      });

      const select = container.querySelector<HTMLSelectElement>('select[name="sonioxRegion"]');
      expect(select?.value).toBe("eu");
      expect(container.querySelector(".settings-region-warning")).not.toBeNull();

      await act(async () => {
        select!.value = "global";
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(select?.value).toBe("global");
      expect(container.querySelector(".settings-region-warning")).toBeNull();

      await act(async () => {
        select!.value = "eu";
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(select?.value).toBe("eu");
      expect(container.querySelector(".settings-region-warning")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
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
