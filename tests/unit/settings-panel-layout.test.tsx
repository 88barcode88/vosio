
/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { InstallationStatusDetails, SettingsPanel } from "@/components/settings-panel";
import type { InstallationStatus } from "@/lib/installation-status.server";
import { parseSettingsForm } from "@/lib/settings/form";
import { createSettingsActionError, type SettingsActionState } from "@/lib/settings/action-state";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";
import { readFileSync } from "node:fs";

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
      accountEmail="user@example.test"
      installationStatus={installationStatus}
      recordingStorageConfig={storageConfig}
      settings={{ ...settings, supabaseStoragePlan: "free" }}
      status={null}
      usageState={usageState}
    />
  );
}

// getAtRuleBlocks isolates matching media blocks without letting assertions spill into later breakpoints.
function getAtRuleBlocks(css: string, header: string) {
  const blocks: string[] = [];
  let searchFrom = 0;

  while (searchFrom < css.length) {
    const start = css.indexOf(header, searchFrom);
    if (start < 0) break;
    const open = css.indexOf("{", start + header.length);
    if (open < 0) break;
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === "{") depth += 1;
      if (css[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push(css.slice(start, cursor));
    searchFrom = cursor;
  }

  return blocks;
}

describe("settings workspace layout", () => {
  it("keeps model guidance beside the selector on desktop and stacks it throughout the mobile shell range", () => {
    const markup = renderSettings({ error: "Usage se teď nepodařilo načíst.", summary: null });
    const formsCss = readFileSync("app/styles/forms-settings-ai.css", "utf8");
    const responsiveCss = readFileSync("app/styles/responsive.css", "utf8");
    const mobileShellCss = getAtRuleBlocks(responsiveCss, "@media (max-width: 900px)").join("\n");

    expect(markup).toContain('class="settings-grid settings-model-row"');
    expect(markup).toContain('<strong id="settings-model-guidance-title">Model a kvalita</strong>');
    expect(markup).not.toMatch(/<button[^>]*>Model a kvalita<\/button>/u);
    expect(markup.indexOf('name="defaultOpenaiModel"')).toBeLessThan(
      markup.indexOf('id="settings-model-guidance-title"')
    );
    expect(formsCss).toMatch(/\.settings-model-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*520px\)\s+minmax\(0,\s*1fr\)/u);
    expect(mobileShellCss).toMatch(/\.settings-model-row\s*\{[^}]*grid-template-columns:\s*1fr/u);
  });

  it("renders account security as a separate non-nested form", () => {
    const markup = renderSettings({ error: "Usage se teď nepodařilo načíst.", summary: null });
    const container = document.createElement("div");
    container.innerHTML = markup;
    const accountForm = container.querySelector<HTMLFormElement>(".account-security-form");
    const settingsForm = container.querySelector<HTMLFormElement>(".settings-form");

    expect(container.querySelectorAll("form")).toHaveLength(2);
    expect(accountForm).not.toBeNull();
    expect(settingsForm?.contains(accountForm)).toBe(false);
    expect(accountForm?.contains(settingsForm ?? null)).toBe(false);
    expect(markup).toContain("user@example.test");
  });

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

    const headings = ["AI a výstupy", "Jazyk a přepis", "Nahrávání", "Úložiště", "Vzhled", "Diagnostika a využití", "Účet"];
    const headingPositions = headings.map((heading) => markup.search(new RegExp(`<h2[^>]*>${heading}</h2>`, "u")));

    expect(headingPositions.every((position) => position >= 0)).toBe(true);
    expect([...headingPositions].sort((left, right) => left - right)).toEqual(headingPositions);
    expect(markup).toContain("Zatím bez usage v tomto měsíci.");
    expect(markup).toContain("Technické informace");
    expect(markup).not.toContain("Globální limit projektu");
  });

  it("shows only runtime-effective preferences as controls and preserves stored-only values as hidden inputs", () => {
    const markup = renderSettings({ error: "Usage se teď nepodařilo načíst.", summary: null });

    for (const name of ["autoTimelineAfterTranscription", "defaultOpenaiModel", "sonioxRegion", "sonioxRealtimeLanguage", "sonioxRealtimeModel", "supabaseStoragePlan"]) {
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
    expect(markup).toContain("Automaticky vytvořit časovou osu po přepisu");
    expect(markup).toContain("Usage se teď nepodařilo načíst.");
    expect(markup).toContain('autoComplete="off"');
  });

  it("renders only safe installation state in the technical information content", () => {
    const markup = renderToStaticMarkup(<dl><InstallationStatusDetails status={installationStatus} /></dl>);

    expect(markup).toContain("Preview");
    expect(markup).toContain("Chybí konfigurace");
    expect(markup).toContain("OPENAI_API_KEY");
    expect(markup).toContain("GEMINI_API_KEY (volitelné)");
    expect(markup).not.toContain("test-secret");
  });

  it("keeps read-only disclosures and theme available when saving is disabled", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <SettingsPanel
          accountEmail="user@example.test"
          disableSave
          installationStatus={installationStatus}
          recordingStorageConfig={storageConfig}
          settings={{ ...defaultUserSettings, supabaseStoragePlan: "free" }}
          status={null}
          usageState={{ error: "Usage se teď nepodařilo načíst.", summary: null }}
        />
      ));

      expect(Array.from(container.querySelectorAll<HTMLSelectElement>("select")).every((select) => select.disabled))
        .toBe(true);
      expect(container.querySelector<HTMLButtonElement>(".settings-save-button")?.disabled).toBe(true);
      const technicalDisclosure = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Technické informace")!;
      const themeToggle = container.querySelector<HTMLButtonElement>(".theme-toggle")!;
      expect(technicalDisclosure.disabled).toBe(false);
      expect(themeToggle.disabled).toBe(false);
      await act(async () => technicalDisclosure.click());
      expect(technicalDisclosure.getAttribute("aria-expanded")).toBe("true");
    } finally {
      await act(async () => root.unmount());
    }
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
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <SettingsPanel
            accountEmail="user@example.test"
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
      expect(container.querySelector(".settings-region-warning")).not.toBeNull();

      await act(async () => {
        select!.value = "eu";
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(select?.value).toBe("eu");
      expect(container.querySelector(".settings-region-warning")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("preserves every visible settings field after failure and across an unrelated rerender", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const saveAction = vi.fn(async (_state, formData: FormData) =>
      createSettingsActionError("save_failed", formData.get("sonioxRegion"))
    );
    const persistedSettings = { ...defaultUserSettings, sonioxRegion: "global" as const, supabaseStoragePlan: "free" as const };
    const renderPanel = (nextSettings: UserSettings = persistedSettings, nextStatus: "saved" | null = null) => (
      <SettingsPanel
        accountEmail="user@example.test"
        installationStatus={installationStatus}
        recordingStorageConfig={storageConfig}
        saveAction={saveAction}
        settings={nextSettings}
        status={nextStatus}
        usageState={{ error: "Usage se teď nepodařilo načíst.", summary: null }}
      />
    );

    try {
      await act(async () => root.render(renderPanel()));
      const draft = {
        defaultOpenaiModel: "gpt-5.6-sol",
        sonioxRealtimeLanguage: "de",
        sonioxRealtimeModel: "stt-rt-v5",
        sonioxRegion: "eu",
        supabaseStoragePlan: "paid"
      };
      await act(async () => {
        for (const [name, value] of Object.entries(draft)) {
          const select = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      const technicalDisclosure = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Technické informace")!;
      await act(async () => technicalDisclosure.click());
      expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Technické informace")
        ?.getAttribute("aria-expanded")).toBe("true");
      container.querySelector<HTMLButtonElement>(".settings-save-button")!.focus();
      await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());

      expect(saveAction).toHaveBeenCalledOnce();
      for (const [name, value] of Object.entries(draft)) {
        expect(saveAction.mock.calls[0]?.[1].get(name)).toBe(value);
        expect(container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)?.value).toBe(value);
      }
      expect(container.querySelector(".settings-alert-error")?.textContent)
        .toContain("Nastavení se nepodařilo uložit");
      expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Technické informace")
        ?.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(container.querySelector(".settings-alert-error"));
      expect(container.querySelector(".settings-region-warning")).not.toBeNull();

      await act(async () => root.render(renderPanel({ ...persistedSettings })));
      for (const [name, value] of Object.entries(draft)) {
        expect(container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)?.value).toBe(value);
      }
      expect(container.querySelector(".settings-alert-error")).not.toBeNull();

      const serverSettings: UserSettings = {
        ...defaultUserSettings,
        defaultOpenaiModel: "gpt-5.6-luna",
        sonioxRealtimeLanguage: "cs",
        sonioxRegion: "global",
        supabaseStoragePlan: "free"
      };
      await act(async () => root.render(renderPanel(serverSettings, "saved")));
      expect(container.querySelector<HTMLSelectElement>('select[name="defaultOpenaiModel"]')?.value)
        .toBe("gpt-5.6-luna");
      expect(container.querySelector<HTMLSelectElement>('select[name="sonioxRealtimeLanguage"]')?.value)
        .toBe("cs");
      expect(container.querySelector<HTMLSelectElement>('select[name="sonioxRegion"]')?.value)
        .toBe("global");
      expect(container.querySelector<HTMLSelectElement>('select[name="supabaseStoragePlan"]')?.value)
        .toBe("free");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("locks the whole settings control group while the action is pending and restores the draft", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);
    let settle!: (state: SettingsActionState) => void;
    const saveAction = vi.fn(() => new Promise<SettingsActionState>((resolve) => { settle = resolve; }));

    try {
      await act(async () => root.render(
        <SettingsPanel
          accountEmail="user@example.test"
          installationStatus={installationStatus}
          recordingStorageConfig={storageConfig}
          saveAction={saveAction}
          settings={{ ...defaultUserSettings, sonioxRegion: "global", supabaseStoragePlan: "free" }}
          status={null}
          usageState={{ error: "Usage se teď nepodařilo načíst.", summary: null }}
        />
      ));
      const region = container.querySelector<HTMLSelectElement>('select[name="sonioxRegion"]')!;
      await act(async () => {
        region.value = "eu";
        region.dispatchEvent(new Event("change", { bubbles: true }));
      });
      act(() => container.querySelector<HTMLFormElement>("form")!.requestSubmit());

      const fieldset = container.querySelector<HTMLFieldSetElement>("fieldset[data-settings-fields]");
      expect(fieldset?.disabled).toBe(true);
      expect(fieldset?.getAttribute("aria-busy")).toBe("true");
      expect(Array.from(container.querySelectorAll<HTMLSelectElement | HTMLButtonElement>(".settings-form select, .settings-form button"))
        .every((control) => control.disabled || control.closest("fieldset")?.disabled)).toBe(true);

      await act(async () => settle(createSettingsActionError("save_failed", "eu")));
      expect(fieldset?.disabled).toBe(false);
      expect(container.querySelector<HTMLSelectElement>('select[name="sonioxRegion"]')?.value).toBe("eu");
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
