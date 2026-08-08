// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecordingAudioPlayer,
  type RecordingAudioPlayerHandle
} from "@/components/transcript-tabs/recording-audio-player";
import type { RecordingClientView } from "@/lib/recordings/client-view";

let container: HTMLDivElement | null;
let root: Root | null;
let fetchMock: ReturnType<typeof vi.fn>;
let loadMock: ReturnType<typeof vi.spyOn>;
let pauseMock: ReturnType<typeof vi.spyOn>;

// createRecordingView builds safe player props without a private Storage locator.
function createRecordingView(
  audioAvailability: RecordingClientView["audioAvailability"] = "single",
  id = "11111111-1111-4111-8111-111111111111"
): RecordingClientView {
  return {
    audioAvailability,
    created_at: "2026-08-05T08:00:00.000Z",
    duration_seconds: 60,
    file_size_bytes: 1024,
    id,
    mime_type: "audio/webm",
    source_type: "upload",
    status: "completed",
    title: "Bezpečný call",
    updated_at: "2026-08-05T08:01:00.000Z"
  };
}

// createAudioResponse mimics the narrow private route success contract.
function createAudioResponse(url: string) {
  return new Response(JSON.stringify({
    expiresIn: 300,
    mimeType: "audio/webm",
    url
  }), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

// createDeferred exposes response ordering for stale-request race coverage.
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  loadMock = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  pauseMock = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recording audio player", () => {
  it.each(["none", "segmented"] as const)(
    "renders nothing and does not fetch for %s recordings",
    async (availability) => {
    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView(availability)
    })));

    expect(container?.querySelector("audio")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("fetches only the private audio route and never plays during background loading", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(createAudioResponse("https://signed.example/first"));

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView()
    })));

    await vi.waitFor(() => {
      expect(container?.querySelector("audio")?.getAttribute("src"))
        .toBe("https://signed.example/first");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recordings/11111111-1111-4111-8111-111111111111/audio",
      {
        cache: "no-store",
        credentials: "same-origin",
        signal: expect.any(AbortSignal)
      }
    );
    expect(play).not.toHaveBeenCalled();
    expect(container?.innerHTML).not.toContain("storage_path");
  });

  it("queues the imperative seek until metadata and plays only when explicitly requested", async () => {
    const playerRef = createRef<RecordingAudioPlayerHandle>();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(createAudioResponse("https://signed.example/audio"));

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView(),
      ref: playerRef
    })));
    const audio = container?.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
    Object.defineProperty(audio, "readyState", { configurable: true, value: 0 });

    await act(async () => playerRef.current?.seekToMs(12_000, { play: true }));
    expect(audio.currentTime).toBe(0);
    expect(play).not.toHaveBeenCalled();

    Object.defineProperty(audio, "readyState", { configurable: true, value: 1 });
    await act(async () => {
      audio.dispatchEvent(new Event("loadedmetadata"));
      await Promise.resolve();
    });

    expect(audio.currentTime).toBe(10);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("shows an immediate play rejection in the persistent live status", async () => {
    const playerRef = createRef<RecordingAudioPlayerHandle>();
    vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValue(new Error("browser playback detail"));
    fetchMock.mockResolvedValue(createAudioResponse("https://signed.example/audio"));

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView(),
      ref: playerRef
    })));
    const audio = container?.querySelector("audio") as HTMLAudioElement;
    const status = container?.querySelector('[role="status"]');

    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.hasAttribute("hidden")).toBe(false);
    expect(status?.getAttribute("style")).toBeNull();

    Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
    Object.defineProperty(audio, "readyState", { configurable: true, value: 1 });
    let immediateError: unknown;
    await act(async () => {
      try {
        await playerRef.current?.seekToMs(1_000, { play: true });
      } catch (error) {
        immediateError = error;
      }
    });
    expect(immediateError).toEqual(new Error("Audio playback failed."));
    expect(status?.textContent).toBe("Přehrávání se nepodařilo spustit.");
  });

  it("does not let a late play rejection from recording A overwrite recording B status", async () => {
    const playerRef = createRef<RecordingAudioPlayerHandle>();
    const deferredPlay = createDeferred<void>();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(deferredPlay.promise);
    fetchMock.mockResolvedValue(createAudioResponse("https://signed.example/audio"));

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView("single", "11111111-1111-4111-8111-111111111111"),
      ref: playerRef
    })));
    await vi.waitFor(() => {
      expect(container?.querySelector("audio")?.getAttribute("src"))
        .toBe("https://signed.example/audio");
    });
    const audio = container?.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
    Object.defineProperty(audio, "readyState", { configurable: true, value: 1 });
    let seekPromise!: Promise<void>;

    act(() => {
      seekPromise = playerRef.current?.seekToMs(1_000, { play: true }) as Promise<void>;
    });
    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView("single", "22222222-2222-4222-8222-222222222222"),
      ref: playerRef
    })));
    await act(async () => {
      deferredPlay.reject(new Error("late recording A rejection"));
      await seekPromise.catch(() => undefined);
    });

    expect(container?.querySelector('[role="status"]')?.textContent)
      .not.toBe("Přehrávání se nepodařilo spustit.");
  });

  it("keeps the empty persistent status in the accessibility tree", async () => {
    fetchMock.mockResolvedValue(createAudioResponse("https://signed.example/audio"));
    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView()
    })));
    await vi.waitFor(() => {
      expect(container?.querySelector('[role="status"]')?.textContent).toBe("");
    });
    const status = container?.querySelector('[role="status"]');
    const transcriptCss = readFileSync(join(process.cwd(), "app/styles/transcript.css"), "utf8");

    expect(status).not.toBeNull();
    expect(status?.hasAttribute("hidden")).toBe(false);
    expect(status?.getAttribute("style")).toBeNull();
    expect(transcriptCss).not.toContain(".recording-audio-player-status:empty");
  });

  it("keeps every detail tab bounded above the persistent audio player", () => {
    const transcriptCss = readFileSync(join(process.cwd(), "app/styles/transcript.css"), "utf8");
    const responsiveCss = readFileSync(join(process.cwd(), "app/styles/responsive.css"), "utf8");
    const tabPanelBlock = transcriptCss.match(/\.tab-panel\s*\{([^}]*)\}/)?.[1] ?? "";
    const responsiveTabPanelBlock = responsiveCss.match(/\.tab-panel\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(tabPanelBlock).toMatch(/display:\s*flex;/);
    expect(tabPanelBlock).toMatch(/flex-direction:\s*column;/);
    expect(tabPanelBlock).toMatch(/min-height:\s*0;/);
    expect(tabPanelBlock).not.toMatch(/height:\s*100%;/);
    expect(transcriptCss).toContain(".tab-panel > * {");
    expect(transcriptCss).toContain("flex: 1 1 auto;");
    expect(transcriptCss).toContain("grid-template-rows: auto minmax(0, 1fr);");
    expect(transcriptCss).toMatch(/\.transcript-table-scroll\s*\{[\s\S]*max-height:\s*none;/);
    expect(responsiveCss).toMatch(/\.transcript-table-scroll\s*\{[\s\S]*max-height:\s*52vh;/);
    expect(responsiveTabPanelBlock).toMatch(/height:\s*auto;/);
    expect(responsiveTabPanelBlock).toMatch(/overflow:\s*visible;/);
  });

  it("settles a queued play rejection and keeps its failure visible", async () => {
    const playerRef = createRef<RecordingAudioPlayerHandle>();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValue(new Error("queued browser playback detail"));
    fetchMock.mockResolvedValue(createAudioResponse("https://signed.example/audio"));

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView(),
      ref: playerRef
    })));
    const audio = container?.querySelector("audio") as HTMLAudioElement;
    const status = container?.querySelector('[role="status"]');

    Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
    Object.defineProperty(audio, "readyState", { configurable: true, value: 0 });
    await playerRef.current?.seekToMs(2_000, { play: true });
    Object.defineProperty(audio, "readyState", { configurable: true, value: 1 });
    await act(async () => {
      audio.dispatchEvent(new Event("loadedmetadata"));
      await Promise.resolve();
    });

    expect(play).toHaveBeenCalledTimes(1);
    expect(status?.textContent).toBe("Přehrávání se nepodařilo spustit.");
  });

  it("refreshes an expired media URL once and does not loop on repeated errors", async () => {
    fetchMock
      .mockResolvedValueOnce(createAudioResponse("https://signed.example/first"))
      .mockResolvedValueOnce(createAudioResponse("https://signed.example/second"));

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView()
    })));
    await vi.waitFor(() => {
      expect(container?.querySelector("audio")?.getAttribute("src"))
        .toBe("https://signed.example/first");
    });

    const audio = container?.querySelector("audio") as HTMLAudioElement;
    await act(async () => audio.dispatchEvent(new Event("error")));
    await vi.waitFor(() => {
      expect(audio.getAttribute("src")).toBe("https://signed.example/second");
    });
    expect(pauseMock).toHaveBeenCalled();
    expect(loadMock).toHaveBeenCalled();

    await act(async () => audio.dispatchEvent(new Event("error")));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight fetch before retrying", async () => {
    const pendingResponse = createDeferred<Response>();
    fetchMock
      .mockReturnValueOnce(pendingResponse.promise)
      .mockResolvedValueOnce(createAudioResponse("https://signed.example/retry"));

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView()
    })));
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    const audio = container?.querySelector("audio") as HTMLAudioElement;

    await act(async () => audio.dispatchEvent(new Event("error")));

    expect(firstSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale signed URL response after the active recording changes", async () => {
    const firstResponse = createDeferred<Response>();
    const secondResponse = createDeferred<Response>();
    fetchMock
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView("single", "11111111-1111-4111-8111-111111111111")
    })));
    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView("single", "22222222-2222-4222-8222-222222222222")
    })));
    const firstSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);

    await act(async () => secondResponse.resolve(createAudioResponse("https://signed.example/new")));
    await vi.waitFor(() => {
      expect(container?.querySelector("audio")?.getAttribute("src"))
        .toBe("https://signed.example/new");
    });
    await act(async () => firstResponse.resolve(createAudioResponse("https://signed.example/stale")));

    expect(container?.querySelector("audio")?.getAttribute("src"))
      .toBe("https://signed.example/new");
    expect(pauseMock).toHaveBeenCalled();
    expect(loadMock).toHaveBeenCalled();
  });

  it("stops and detaches an old single-object source before loading another recording", async () => {
    const secondResponse = createDeferred<Response>();
    fetchMock
      .mockResolvedValueOnce(createAudioResponse("https://signed.example/old"))
      .mockReturnValueOnce(secondResponse.promise);

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView("single", "11111111-1111-4111-8111-111111111111")
    })));
    await vi.waitFor(() => {
      expect(container?.querySelector("audio")?.getAttribute("src"))
        .toBe("https://signed.example/old");
    });
    const oldAudio = container?.querySelector("audio") as HTMLAudioElement;
    pauseMock.mockClear();
    loadMock.mockClear();

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView("single", "22222222-2222-4222-8222-222222222222")
    })));

    expect(pauseMock).toHaveBeenCalled();
    expect(loadMock).toHaveBeenCalled();
    expect(oldAudio.hasAttribute("src")).toBe(false);
  });

  it("stops and clears the old media element on unmount", async () => {
    fetchMock.mockResolvedValue(createAudioResponse("https://signed.example/audio"));
    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView()
    })));
    await vi.waitFor(() => {
      expect(container?.querySelector("audio")?.getAttribute("src"))
        .toBe("https://signed.example/audio");
    });
    const audio = container?.querySelector("audio") as HTMLAudioElement;

    await act(async () => root?.unmount());
    root = null;

    expect(pauseMock).toHaveBeenCalled();
    expect(loadMock).toHaveBeenCalled();
    expect(audio.hasAttribute("src")).toBe(false);
  });

  it("aborts an in-flight signed URL request on unmount", async () => {
    const pendingResponse = createDeferred<Response>();
    fetchMock.mockReturnValue(pendingResponse.promise);
    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView()
    })));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;

    await act(async () => root?.unmount());
    root = null;

    expect(signal.aborted).toBe(true);
  });

  it.each([
    { expiresIn: 0, mimeType: "audio/webm", url: "https://signed.example/audio" },
    { expiresIn: Number.NaN, mimeType: "audio/webm", url: "https://signed.example/audio" },
    { expiresIn: Number.POSITIVE_INFINITY, mimeType: "audio/webm", url: "https://signed.example/audio" },
    { expiresIn: 300, mimeType: "", url: "https://signed.example/audio" },
    { expiresIn: 300, mimeType: " audio/webm ", url: "https://signed.example/audio" },
    { expiresIn: 300, mimeType: "audio/webm", url: "ftp://signed.example/audio" }
  ])("rejects malformed private route payload %#", async (payload) => {
    fetchMock.mockResolvedValue({
      json: vi.fn().mockResolvedValue(payload),
      ok: true
    });

    await act(async () => root?.render(createElement(RecordingAudioPlayer, {
      activeRecording: createRecordingView()
    })));

    await vi.waitFor(() => {
      expect(container?.querySelector('[role="status"]')?.textContent)
        .toBe("Audio se nepodařilo načíst.");
    });
    expect(container?.querySelector("audio")?.hasAttribute("src")).toBe(false);
  });
});
