// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewRecordingWorkspace } from "@/components/new-recording-workspace";
import { defaultUserSettings } from "@/lib/settings/types";
import type { LiveAudioQuality } from "@/lib/recordings/types";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(async () => ({ data: [], error: null })) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

vi.mock("@/components/persistent-recording-session", () => ({
  PersistentRecorderSlot: ({ liveAudioQuality }: { liveAudioQuality?: string }) => (
    <div data-live-audio-quality={liveAudioQuality} data-testid="real-live-recorder">Live recorder</div>
  )
}));

vi.mock("@/components/recording-upload-form", () => ({
  RecordingUploadForm: () => <div data-testid="real-upload-form">Upload form</div>
}));

vi.mock("@/components/transcript-import-form", () => ({
  TranscriptImportForm: () => <div data-testid="real-transcript-import">Transcript import</div>
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

// renderWorkspace mounts the real page composition with deterministic child boundaries.
async function renderWorkspace(
  liveAudioQuality: LiveAudioQuality = defaultUserSettings.liveAudioQuality,
  inertScope = false
) {
  await act(async () => {
    root.render(
      <NewRecordingWorkspace
        recordingStorageConfig={{
          allowedMimeTypes: ["audio/mpeg"],
          bucketMaxFileSizeBytes: 50 * 1024 * 1024,
          detectedGlobalMaxFileSizeBytes: null,
          maxFileSizeBytes: 50 * 1024 * 1024,
          planMaxFileSizeBytes: null
        }}
        userSettings={{ ...defaultUserSettings, liveAudioQuality }}
        captureSlots={inertScope ? {
          scope: <fieldset data-testid="inert-scope">Soukromá fixture</fieldset>,
          live: <div>Inert live</div>,
          transcriptImport: <div>Inert import</div>
        } : undefined}
      />
    );
  });
}

// Open the opt-in advanced scope so its authorization-dependent effects can mount.
async function openAdvancedScope() {
  await act(async () => {
    const disclosure = container.querySelector<HTMLDetailsElement>(".capture-scope-disclosure")!;
    disclosure.open = true;
    disclosure.dispatchEvent(new Event("toggle"));
    await Promise.resolve();
  });
}

describe("new recording workspace composition", () => {
  it("does not mount recipient RPC effects when the inert scope slot is supplied", async () => {
    await renderWorkspace(defaultUserSettings.liveAudioQuality, true);

    expect(container.querySelector("[data-testid='inert-scope']")).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(container.querySelector(".capture-sharing-note")?.textContent).not.toContain("uloží soukromě");
    await openAdvancedScope();
    expect(container.querySelector("[data-testid='inert-scope']")).not.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("renders exactly two ordered primary capture cards and keeps transcript import secondary", async () => {
    await renderWorkspace();

    const primaryMethods = container.querySelector('[aria-label="Hlavní způsoby pořízení"]');
    const primaryCards = Array.from(
      primaryMethods?.querySelectorAll<HTMLElement>("[data-primary-capture]") ?? []
    );
    expect(primaryMethods?.getAttribute("role")).toBe("group");
    expect(primaryCards).toHaveLength(2);
    expect(primaryCards[0]?.textContent).toContain("Nahrávat live");
    expect(primaryCards[1]?.textContent).toContain("Nahrát soubor");
    expect(container.querySelector("[data-secondary-capture]")?.textContent).toContain("Vložit přepis");
    expect(container.querySelector<HTMLDetailsElement>(".transcript-import-disclosure")?.open).toBe(false);
    expect(container.querySelector('[aria-label="Import hotového přepisu"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Capture console");
  });

  it("uses the actual live, upload and transcript-import component boundaries", async () => {
    await renderWorkspace("high");

    expect(container.querySelector("[data-testid='real-live-recorder']")?.getAttribute("data-live-audio-quality"))
      .toBe("high");
    expect(container.querySelector("[data-testid='real-upload-form']")).not.toBeNull();
    expect(container.querySelector("[data-testid='real-transcript-import']")).not.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    await openAdvancedScope();
    expect(mocks.rpc).toHaveBeenCalledWith("list_confirmed_recording_recipients_v1");
  });

  it("renders storage limits as one compact information row without card children", async () => {
    await renderWorkspace();

    const summary = container.querySelector('[aria-label="Limity úložiště"]');
    expect(summary?.classList.contains("recording-storage-info-row")).toBe(true);
    expect(summary?.querySelectorAll("div")).toHaveLength(0);
    expect(summary?.textContent).toContain("Limit audia");
    expect(summary?.textContent).toContain("Maximální velikost souboru");
    expect(summary?.textContent).not.toMatch(/Bucket recordings|Globální limit|Preference/);
    expect(container.textContent).toContain("Sdílení můžete nastavit v detailu po uložení");
  });
});
