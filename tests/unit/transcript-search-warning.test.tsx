// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRecordingRecoveryPanel } from "@/components/live-recording-recovery-panel";
import { TranscriptImportForm } from "@/components/transcript-import-form";
import { TranscriptSearchWarningNotice } from "@/components/transcript-search-warning-notice";
import { TranscriptionControls } from "@/components/transcription-controls";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING,
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE,
  addTranscriptSearchIndexWarningToPath,
  hasTranscriptSearchIndexWarning,
  isTranscriptSearchIndexWarningCode
} from "@/lib/transcripts/search-warning";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// renderClient mounts one warning consumer under the real React client lifecycle.
async function renderClient(component: React.ReactNode) {
  await act(async () => {
    root?.render(component);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  navigationMocks.push.mockReset();
  navigationMocks.refresh.mockReset();
  window.history.replaceState(null, "", "/");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transcript search warning contract", () => {
  it("recognizes only the stable code while tolerating unknown warning values", () => {
    expect(hasTranscriptSearchIndexWarning({
      warnings: ["future_warning", TRANSCRIPT_SEARCH_INDEX_WARNING, { future: true }]
    })).toBe(true);
    expect(hasTranscriptSearchIndexWarning({ warnings: ["future_warning"] })).toBe(false);
    expect(hasTranscriptSearchIndexWarning({ warnings: "future_warning" })).toBe(false);
    expect(isTranscriptSearchIndexWarningCode(["future_warning", TRANSCRIPT_SEARCH_INDEX_WARNING]))
      .toBe(true);
    expect(addTranscriptSearchIndexWarningToPath("/recordings/abc?tab=transcript#speaker"))
      .toBe(`/recordings/abc?tab=transcript&warning=${TRANSCRIPT_SEARCH_INDEX_WARNING}#speaker`);
  });

  it("renders the fallback as an accessible nonfatal status", async () => {
    await renderClient(createElement(TranscriptSearchWarningNotice));

    const notice = container?.querySelector('[role="status"]');
    expect(notice?.getAttribute("aria-live")).toBe("polite");
    expect(notice?.textContent).toBe(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
  });

  it("shows the known warning once and removes only its exact URL value", async () => {
    const historyState = { navigation: "preserved" };
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    window.history.replaceState(
      historyState,
      "",
      `/recordings/abc?tag=one&warning=${TRANSCRIPT_SEARCH_INDEX_WARNING}`
        + "&tag=two&warning=future_warning&q=ahoj#speaker-1"
    );

    await renderClient(createElement(TranscriptSearchWarningNotice));

    expect(container?.querySelector('[role="status"]')?.textContent)
      .toBe(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
    expect(window.location.pathname).toBe("/recordings/abc");
    expect(window.location.hash).toBe("#speaker-1");
    expect(new URLSearchParams(window.location.search).getAll("tag")).toEqual(["one", "two"]);
    expect(new URLSearchParams(window.location.search).getAll("warning")).toEqual(["future_warning"]);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("ahoj");
    expect(window.history.state).toEqual(historyState);

    await act(async () => root?.unmount());
    root = createRoot(container as HTMLDivElement);
    await renderClient(createElement(TranscriptSearchWarningNotice));
    expect(replaceStateSpy).toHaveBeenCalledTimes(2);
  });

  it("does not display or remove an unknown warning on a refreshed render", async () => {
    window.history.replaceState(
      { navigation: "unknown" },
      "",
      "/recordings/abc?warning=future_warning&tag=one&tag=two#keep"
    );
    const warningValues = new URLSearchParams(window.location.search).getAll("warning");

    await renderClient(isTranscriptSearchIndexWarningCode(warningValues)
      ? createElement(TranscriptSearchWarningNotice)
      : null);

    expect(container?.querySelector('[role="status"]')).toBeNull();
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe("/recordings/abc?warning=future_warning&tag=one&tag=two#keep");
    expect(window.history.state).toEqual({ navigation: "unknown" });
  });

  it("does not show the consumed warning again after a refresh-style remount", async () => {
    window.history.replaceState(
      null,
      "",
      `/recordings/abc?warning=${TRANSCRIPT_SEARCH_INDEX_WARNING}`
    );
    await renderClient(createElement(TranscriptSearchWarningNotice));
    expect(container?.querySelector('[role="status"]')).not.toBeNull();

    await act(async () => root?.unmount());
    root = createRoot(container as HTMLDivElement);
    const refreshedWarnings = new URLSearchParams(window.location.search).getAll("warning");
    await renderClient(isTranscriptSearchIndexWarningCode(refreshedWarnings)
      ? createElement(TranscriptSearchWarningNotice)
      : null);

    expect(container?.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps an imported transcript successful and carries its warning to the detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        recordingId: "recording-1",
        warnings: ["future_warning", TRANSCRIPT_SEARCH_INDEX_WARNING]
      }),
      ok: true
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderClient(createElement(TranscriptImportForm));
    const form = container?.querySelector("form");
    const textarea = container?.querySelector<HTMLTextAreaElement>('textarea[name="rawText"]');

    if (textarea) textarea.value = "Uložený přepis";
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.querySelector('[role="status"]')?.textContent)
      .toBe(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
    expect(navigationMocks.push).toHaveBeenCalledWith(
      `/recordings/recording-1?warning=${TRANSCRIPT_SEARCH_INDEX_WARNING}`
    );
  });

  it("keeps recovery successful and carries the warning to the recovered recording", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          recordings: [{
            created_at: "2026-08-05T10:00:00.000Z",
            duration_seconds: 12,
            id: "recording-2",
            segment_count: 0,
            storage_bytes: 0,
            title: "Obnovitelný call",
            transcript_chars: 25
          }]
        }),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ warnings: [TRANSCRIPT_SEARCH_INDEX_WARNING] }),
        ok: true
      });
    vi.stubGlobal("fetch", fetchMock);
    await renderClient(createElement(LiveRecordingRecoveryPanel));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const button = container?.querySelector<HTMLButtonElement>("button");

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.querySelector('[role="status"]')?.textContent)
      .toBe(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
    expect(navigationMocks.push).toHaveBeenCalledWith(
      `/recordings/recording-2?warning=${TRANSCRIPT_SEARCH_INDEX_WARNING}`
    );
    expect(navigationMocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps completed transcription status and shows the nonfatal fallback warning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        job: { status: "done" },
        warnings: [TRANSCRIPT_SEARCH_INDEX_WARNING, "future_warning"]
      }),
      ok: true
    }));
    await renderClient(createElement(TranscriptionControls, {
      recordingId: "recording-3",
      recordingStatus: "transcribing",
      storedAudioMode: "single"
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Stav Soniox jobu: hotovo.");
    expect(container?.querySelector('[role="status"]')?.textContent)
      .toBe(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
    expect(navigationMocks.refresh).toHaveBeenCalled();
  });

  it("checks immediately after returning to the tab and clears a stale lookup error", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          error: "Nahrávku se teď nepodařilo načíst. Zkuste kontrolu znovu."
        }),
        ok: false
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ job: { status: "done" }, transcript: { id: "transcript-4" } }),
        ok: true
      });
    vi.stubGlobal("fetch", fetchMock);

    await renderClient(createElement(TranscriptionControls, {
      recordingId: "recording-4",
      recordingStatus: "transcribing",
      storedAudioMode: "single"
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toContain("Nahrávku se teď nepodařilo načíst");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container?.textContent).not.toContain("Nahrávku se teď nepodařilo načíst");
    expect(container?.textContent).toContain("Přepis je hotový");
    expect(navigationMocks.refresh).toHaveBeenCalled();
  });
});
