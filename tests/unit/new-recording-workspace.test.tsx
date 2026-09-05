// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewRecordingWorkspace } from "@/components/new-recording-workspace";
import { defaultUserSettings } from "@/lib/settings/types";
import type { LiveAudioQuality } from "@/lib/recordings/types";

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
  liveAudioQuality: LiveAudioQuality = defaultUserSettings.liveAudioQuality
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
      />
    );
  });
}

describe("new recording workspace composition", () => {
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
  });

  it("renders storage limits as one compact information row without card children", async () => {
    await renderWorkspace();

    const summary = container.querySelector('[aria-label="Limity úložiště"]');
    expect(summary?.classList.contains("recording-storage-info-row")).toBe(true);
    expect(summary?.querySelectorAll("div")).toHaveLength(0);
    expect(summary?.textContent).toContain("Bucket recordings");
    expect(summary?.textContent).toContain("Globální limit");
    expect(summary?.textContent).toContain("Preference");
  });
});
