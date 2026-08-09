// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewRecordingWorkspace } from "@/components/new-recording-workspace";

vi.mock("@/components/persistent-recording-session", () => ({
  PersistentRecorderSlot: () => <div data-testid="real-live-recorder">Live recorder</div>
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
async function renderWorkspace() {
  await act(async () => {
    root.render(
      <NewRecordingWorkspace
        recordingStorageConfig={{
          bucketMaxFileSizeBytes: 50 * 1024 * 1024,
          detectedGlobalMaxFileSizeBytes: null,
          maxFileSizeBytes: 50 * 1024 * 1024,
          planMaxFileSizeBytes: null
        }}
      />
    );
  });
}

describe("new recording workspace composition", () => {
  it("renders exactly two ordered primary capture cards and keeps transcript import secondary", async () => {
    await renderWorkspace();

    const primaryCards = Array.from(container.querySelectorAll<HTMLElement>("[data-primary-capture]"));
    expect(primaryCards).toHaveLength(2);
    expect(primaryCards[0]?.textContent).toContain("Nahrávat live");
    expect(primaryCards[1]?.textContent).toContain("Nahrát soubor");
    expect(container.querySelector("[data-secondary-capture]")?.textContent).toContain("Vložit přepis");
    expect(container.querySelector<HTMLDetailsElement>(".transcript-import-disclosure")?.open).toBe(false);
    expect(container.textContent).not.toContain("Capture console");
  });

  it("uses the actual live, upload and transcript-import component boundaries", async () => {
    await renderWorkspace();

    expect(container.querySelector("[data-testid='real-live-recorder']")).not.toBeNull();
    expect(container.querySelector("[data-testid='real-upload-form']")).not.toBeNull();
    expect(container.querySelector("[data-testid='real-transcript-import']")).not.toBeNull();
  });
});
