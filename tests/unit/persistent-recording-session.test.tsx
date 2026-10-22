// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PersistentRecorderSlot,
  PersistentRecordingSessionProvider,
  RecordingCompletionNotice
} from "@/components/persistent-recording-session";
import type { RecordingCompletion } from "@/components/browser-recorder/types";

const recorderLifecycle = vi.hoisted(() => ({
  mounts: 0,
  nextInstance: 0,
  unmounts: 0
}));

vi.mock("@/components/browser-recorder", async () => {
  const React = await import("react");

  return {
    BrowserRecorder: ({
      compact,
      liveAudioQuality,
      onStatusChange,
      onCompletionChange,
      realtimeLanguage
    }: {
      compact?: boolean;
      liveAudioQuality?: string;
      onStatusChange?: (status: "idle" | "starting" | "recording" | "saving") => void;
      onCompletionChange?: (completion: RecordingCompletion) => void;
      realtimeLanguage?: string;
    }) => {
      const [instance] = React.useState(() => {
        recorderLifecycle.nextInstance += 1;
        return recorderLifecycle.nextInstance;
      });

      React.useEffect(() => {
        recorderLifecycle.mounts += 1;
        return () => {
          recorderLifecycle.unmounts += 1;
        };
      }, []);

      return (
        <div
          data-compact={compact ? "true" : "false"}
          data-instance={instance}
          data-live-audio-quality={liveAudioQuality}
          data-realtime-language={realtimeLanguage}
        >
          <button onClick={() => onStatusChange?.("recording")} type="button">
            Spustit testovací záznam
          </button>
          <button onClick={() => { onStatusChange?.("saving"); onCompletionChange?.({ recordingId: "recording-a", phase: "saving", audioConfirmed: false, message: "Ukládáme audio" }); }} type="button">Uložit testovací záznam</button>
          <button onClick={() => { onCompletionChange?.({ recordingId: "recording-a", phase: "error", audioConfirmed: false, retainLocalData: true, message: "Audio zůstalo k obnovení" }); onStatusChange?.("idle"); }} type="button">Selhání uploadu</button>
        </div>
      );
    }
  };
});

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.replaceChildren();
  recorderLifecycle.mounts = 0;
  recorderLifecycle.nextInstance = 0;
  recorderLifecycle.unmounts = 0;
  vi.restoreAllMocks();
});

const recorderProps = {
  allowTranscriptOnly: true,
  captionMode: true,
  liveAudioQuality: "high" as const,
  maxAudioFileSizeBytes: 128 * 1024 * 1024,
  realtimeLanguage: "de" as const,
  realtimeModel: "stt-rt-v5",
  redirectAfterSave: "detail" as const
};

// renderSession simulates the route-owned recorder slot appearing and disappearing.
function renderSession(showRecorderPage: boolean) {
  return (
    <PersistentRecordingSessionProvider>
      {showRecorderPage ? <PersistentRecorderSlot {...recorderProps} /> : <p>Jiná stránka</p>}
    </PersistentRecordingSessionProvider>
  );
}

describe("persistent recording session", () => {
  it("retains the saving owner and exact-recording feedback after navigating away, including upload failure", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(renderSession(true)));
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Uložit testovací záznam")!.click());
    await act(async () => root.render(<PersistentRecordingSessionProvider>
      <RecordingCompletionNotice recordingId="recording-a" />
      <div data-other-recording><RecordingCompletionNotice recordingId="recording-b" /></div>
    </PersistentRecordingSessionProvider>));
    expect(recorderLifecycle.unmounts).toBe(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Ukládáme audio");
    expect(container.querySelector("[data-other-recording]")?.textContent).toBe("");
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Selhání uploadu")!.click());
    expect(recorderLifecycle.unmounts).toBe(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Audio zůstalo k obnovení");
    expect(container.querySelector('[aria-label="Probíhající nahrávání"]')?.hasAttribute("hidden")).toBe(false);
    expect(container.textContent).not.toContain("Ukládání dokončeno");
    await act(async () => root.unmount());
  });

  it("removes an idle recorder when its capture page disappears", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(renderSession(true)));
    expect(document.querySelector("[data-instance]")).not.toBeNull();

    await act(async () => root.render(renderSession(false)));
    expect(document.querySelector("[data-instance]")).toBeNull();
    expect(recorderLifecycle.unmounts).toBe(1);

    await act(async () => root.unmount());
  });

  it("keeps one recorder instance alive across internal route changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(renderSession(true)));
    const fullRecorder = document.querySelector<HTMLElement>("[data-instance]");
    expect(fullRecorder?.dataset.compact).toBe("false");
    expect(fullRecorder?.dataset.liveAudioQuality).toBe("high");
    expect(fullRecorder?.dataset.realtimeLanguage).toBe("de");
    const instance = fullRecorder?.dataset.instance;

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button")?.click();
    });
    await act(async () => root.render(renderSession(false)));

    const dockedRecorder = document.querySelector<HTMLElement>("[data-instance]");
    const dock = document.querySelector<HTMLElement>('[aria-label="Probíhající nahrávání"]');
    expect(dockedRecorder?.dataset.instance).toBe(instance);
    expect(dockedRecorder?.dataset.compact).toBe("true");
    expect(dock?.dataset.recorderPlacement).toBe("dock");
    expect(dock?.dataset.recordingStatus).toBe("recording");
    expect(recorderLifecycle.mounts).toBe(1);
    expect(recorderLifecycle.unmounts).toBe(0);

    await act(async () => root.render(renderSession(true)));
    const returnedRecorder = document.querySelector<HTMLElement>("[data-instance]");
    expect(returnedRecorder?.dataset.instance).toBe(instance);
    expect(returnedRecorder?.dataset.compact).toBe("false");
    expect(returnedRecorder?.dataset.liveAudioQuality).toBe("high");
    expect(returnedRecorder?.dataset.realtimeLanguage).toBe("de");
    expect(recorderLifecycle.mounts).toBe(1);

    await act(async () => root.unmount());
    expect(recorderLifecycle.unmounts).toBe(1);
  });
});
