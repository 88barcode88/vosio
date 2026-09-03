// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRecorder } from "@/components/browser-recorder";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING,
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
} from "@/lib/transcripts/search-warning";

const clientMarkerId = "6bd31215-9b8f-4c68-9e2f-89f4d31f96b1";
const recordingId = "5ad31215-9b8f-4c68-9e2f-89f4d31f96b0";

const mocks = vi.hoisted(() => ({
  completeLiveRecordingUpload: vi.fn(),
  completeLiveRecordingWithoutAudio: vi.fn(),
  createBrowserClient: vi.fn(),
  createLiveRecordingDraft: vi.fn(),
  failLiveRecordingUpload: vi.fn(),
  fetch: vi.fn(),
  randomUUID: vi.fn(),
  realtimeRecord: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  uploadLiveRecording: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    refresh: mocks.routerRefresh
  })
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}));

vi.mock("@/components/recording-navigation-guard", () => ({
  useRecordingNavigationBlocker: () => ({
    registerNavigationBlocker: vi.fn(() => vi.fn())
  })
}));

vi.mock("@soniox/client", () => ({
  BrowserPermissionResolver: class BrowserPermissionResolver {},
  SonioxClient: class SonioxClient {
    realtime = {
      record: mocks.realtimeRecord
    };
  }
}));

vi.mock("@/lib/recordings/upload", () => ({
  completeLiveRecordingWithoutAudio: mocks.completeLiveRecordingWithoutAudio,
  completeLiveRecordingUpload: mocks.completeLiveRecordingUpload,
  createLiveRecordingDraft: mocks.createLiveRecordingDraft,
  failLiveRecordingUpload: mocks.failLiveRecordingUpload,
  uploadLiveRecording: mocks.uploadLiveRecording
}));

vi.mock("@/lib/supabase/browser", () => ({
  createClient: mocks.createBrowserClient
}));

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

// createDeferred gives lifecycle tests control over the draft persistence boundary.
function createDeferred<T>(): Deferred<T> {
  let reject!: Deferred<T>["reject"];
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

// createDraftClientMock provides the authenticated transcript-only draft insert chain.
function createDraftClientMock(draftResult: Promise<{
  data: { id: string } | null;
  error: { message: string } | null;
}>) {
  const single = vi.fn(() => draftResult);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn((tableName: string) => {
    if (tableName !== "recordings") {
      throw new Error(`Unexpected table: ${tableName}`);
    }

    return { insert };
  });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: { id: "8dd31215-9b8f-4c68-9e2f-89f4d31f96b3" } },
    error: null
  });

  return {
    client: { auth: { getUser }, from },
    from,
    getUser,
    insert,
    select,
    single
  };
}

// createRealtimeRecordingMock captures Soniox event handlers without opening a websocket.
function createRealtimeRecordingMock() {
  const handlers = new Map<string, (value: never) => void>();
  const recording = {
    cancel: vi.fn(),
    on: vi.fn((eventName: string, handler: (value: never) => void) => {
      handlers.set(eventName, handler);
    }),
    reconnect: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined)
  };

  return { handlers, recording };
}

// installMediaRecorderMock exposes the draft-to-local-recorder boundary without real media devices.
function installMediaRecorderMock() {
  class MediaRecorderMock {
    static instances: MediaRecorderMock[] = [];
    static isTypeSupported = vi.fn(() => true);
    audioBitsPerSecond = 128_000;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    state: "inactive" | "recording" = "inactive";
    private readonly listeners = new Map<string, EventListener[]>();

    // constructor records the isolated stream assigned to this synthetic encoder.
    constructor(public readonly stream: MediaStream) {
      MediaRecorderMock.instances.push(this);
    }

    // start marks this synthetic encoder active.
    start() {
      this.state = "recording";
    }

    // stop marks this encoder inactive and delivers its terminal event.
    stop() {
      this.state = "inactive";
      const event = new Event("stop");

      this.listeners.get("stop")?.forEach((listener) => listener(event));
    }

    // addEventListener stores source listeners using the browser EventListener contract.
    addEventListener(eventName: string, listener: EventListener) {
      this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener]);
    }

    // removeEventListener detaches only the requested listener identity.
    removeEventListener(eventName: string, listener: EventListener) {
      this.listeners.set(
        eventName,
        (this.listeners.get(eventName) ?? []).filter((candidate) => candidate !== listener)
      );
    }

    // emitData sends a Blob through property and event listeners like MediaRecorder.
    emitData(data: Blob) {
      const event = Object.assign(new Event("dataavailable"), { data });

      this.ondataavailable?.({ data });
      this.listeners.get("dataavailable")?.forEach((listener) => listener(event));
    }
  }

  vi.stubGlobal("MediaRecorder", MediaRecorderMock);
  return MediaRecorderMock;
}

class MediaStreamMock {
  // constructor stores only the tracks owned by this synthetic stream.
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  // clone gives the rotating safety recorder its own stream and tracks.
  clone() {
    return new MediaStreamMock(this.tracks.map((track) => track.clone()));
  }

  // getAudioTracks returns the audio tracks for master acquisition.
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  // getTracks returns a defensive copy for cleanup assertions.
  getTracks() {
    return [...this.tracks];
  }
}

// createSharedMediaStreamMock provides one master track with independently stoppable clones.
function createSharedMediaStreamMock() {
  const createTrack = () => Object.assign(new EventTarget(), {
    clone: vi.fn(),
    kind: "audio",
    muted: false,
    readyState: "live",
    stop: vi.fn()
  }) as unknown as MediaStreamTrack;
  const masterTrack = createTrack();

  vi.mocked(masterTrack.clone).mockImplementation(createTrack);
  return new MediaStreamMock([masterTrack]) as unknown as MediaStream;
}

// createSavedMarkerResponse returns the exact successful route payload for one attempt.
function createSavedMarkerResponse({
  id,
  offsetMs
}: {
  id: string;
  offsetMs: number;
}) {
  return {
    json: vi.fn().mockResolvedValue({
      marker: {
        client_marker_id: id,
        marker_type: "important",
        note: null,
        offset_ms: offsetMs,
        recording_id: recordingId
      }
    }),
    ok: true
  };
}

// findButton locates a recorder action by its rendered accessible text.
function findButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes(label));
}

// renderRecorder keeps the same component instance while switching full and compact layouts.
async function renderRecorder(
  compact = false,
  redirectAfterSave?: "detail" | "list"
) {
  await act(async () => {
    root?.render(
      <BrowserRecorder
        allowTranscriptOnly
        compact={compact}
        maxAudioFileSizeBytes={null}
        redirectAfterSave={redirectAfterSave}
      />
    );
  });
}

// flushRecorderStart crosses the shared microphone acquisition promise before provider events fire.
async function flushRecorderStart() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// startReadyRecorder crosses Soniox active state and the persisted live-draft boundary.
async function startReadyRecorder(redirectAfterSave?: "detail" | "list") {
  const draft = createDeferred<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>();
  const draftClient = createDraftClientMock(draft.promise);
  const realtime = createRealtimeRecordingMock();
  const performanceNow = vi.spyOn(performance, "now").mockReturnValue(5_000);
  mocks.createBrowserClient.mockReturnValue(draftClient.client);
  mocks.realtimeRecord.mockReturnValue(realtime.recording);

  await renderRecorder(false, redirectAfterSave);
  await act(async () => {
    findButton("Nahrávat live")?.click();
    await flushRecorderStart();
  });
  await act(async () => {
    realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    draft.resolve({ data: { id: recordingId }, error: null });
    await Promise.resolve();
  });

  return { draftClient, performanceNow, realtime };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  mocks.completeLiveRecordingUpload.mockReset();
  mocks.completeLiveRecordingWithoutAudio.mockReset();
  mocks.createBrowserClient.mockReset();
  mocks.createLiveRecordingDraft.mockReset();
  mocks.failLiveRecordingUpload.mockReset();
  mocks.fetch.mockReset();
  mocks.randomUUID.mockReset();
  mocks.realtimeRecord.mockReset();
  mocks.routerPush.mockReset();
  mocks.routerRefresh.mockReset();
  mocks.uploadLiveRecording.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("crypto", { randomUUID: mocks.randomUUID });
  vi.stubGlobal("MediaStream", MediaStreamMock);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(createSharedMediaStreamMock()) }
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }

  root = null;
  container = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrowserRecorder live markers", () => {
  it("does not restart a healthy Soniox session when the tab becomes visible", async () => {
    const { realtime } = await startReadyRecorder();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(realtime.recording.reconnect).not.toHaveBeenCalled();
  });

  it("keeps an early visual recording state disabled until the live draft exists", async () => {
    const draft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const draftClient = createDraftClientMock(draft.promise);
    const realtime = createRealtimeRecordingMock();
    mocks.createBrowserClient.mockReturnValue(draftClient.client);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);
    vi.spyOn(performance, "now").mockReturnValue(5_000);

    await act(async () => {
      root?.render(
        <BrowserRecorder
          allowTranscriptOnly
          maxAudioFileSizeBytes={null}
        />
      );
    });
    expect(document.querySelector(".live-marker-button")).toBeNull();

    await act(async () => {
      findButton("Nahrávat live")?.click();
      await Promise.resolve();
    });
    expect(document.querySelector(".live-marker-button")).toBeNull();

    await act(async () => {
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });

    expect(findButton("Zastavit")?.disabled).toBe(false);
    expect(findButton("Označit moment")?.disabled).toBe(true);

    await act(async () => {
      draft.resolve({ data: { id: "5ad31215-9b8f-4c68-9e2f-89f4d31f96b0" }, error: null });
      await Promise.resolve();
    });

    expect(findButton("Označit moment")?.disabled).toBe(false);
  });

  it("ignores a late recording event after stopping has entered saving", async () => {
    const { realtime } = await startReadyRecorder();
    const stop = createDeferred<void>();
    realtime.recording.stop.mockReturnValueOnce(stop.promise);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
    });

    expect(document.querySelector(".live-marker-button")).toBeNull();

    await act(async () => {
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });

    expect(document.querySelector(".live-marker-button")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".record-button")?.disabled).toBe(true);

    await act(async () => {
      stop.resolve();
      await Promise.resolve();
    });
  });

  it("starts the marker clock once when the draft exists before capture becomes active", async () => {
    const draftClient = createDraftClientMock(Promise.resolve({
      data: { id: recordingId },
      error: null
    }));
    const realtime = createRealtimeRecordingMock();
    const performanceNow = vi.spyOn(performance, "now").mockReturnValue(5_000);
    mocks.createBrowserClient.mockReturnValue(draftClient.client);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);

    await renderRecorder();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(true);

    performanceNow.mockReturnValue(7_000);
    await act(async () => {
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(false);

    performanceNow.mockReturnValue(9_000);
    await act(async () => {
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });

    performanceNow.mockReturnValue(19_000);
    mocks.randomUUID.mockReturnValue(clientMarkerId);
    mocks.fetch.mockResolvedValue(createSavedMarkerResponse({
      id: clientMarkerId,
      offsetMs: 12_000
    }));
    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 0");
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".live-marker-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1]?.body as string).offsetMs).toBe(12_000);
    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 1");
  });

  it("counts only a validated retry response after a failed marker save", async () => {
    const { realtime } = await startReadyRecorder();
    mocks.randomUUID.mockReturnValue(clientMarkerId);
    mocks.fetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(createSavedMarkerResponse({
        id: clientMarkerId,
        offsetMs: 0
      }));

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".live-marker-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 0");
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.textContent)
      .toContain("Zkusit moment znovu");

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".live-marker-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 1");
    expect(realtime.recording.cancel).not.toHaveBeenCalled();
  });

  it("resets the saved marker count when a new recording session starts", async () => {
    const firstSession = await startReadyRecorder();
    mocks.randomUUID.mockReturnValue(clientMarkerId);
    mocks.fetch.mockResolvedValue(createSavedMarkerResponse({
      id: clientMarkerId,
      offsetMs: 0
    }));

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".live-marker-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 1");

    const nextDraft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const nextRealtime = createRealtimeRecordingMock();
    mocks.createBrowserClient.mockReturnValue(createDraftClientMock(nextDraft.promise).client);
    mocks.realtimeRecord.mockReturnValue(nextRealtime.recording);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      nextRealtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
      nextDraft.resolve({ data: { id: recordingId }, error: null });
      await Promise.resolve();
    });

    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 0");
    expect(firstSession.realtime.recording.cancel).not.toHaveBeenCalled();
  });

  it("ignores an old failed session event before the next capture becomes active", async () => {
    const failedDraft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const nextDraft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const oldRealtime = createRealtimeRecordingMock();
    const nextRealtime = createRealtimeRecordingMock();
    mocks.createBrowserClient
      .mockReturnValueOnce(createDraftClientMock(failedDraft.promise).client)
      .mockReturnValueOnce(createDraftClientMock(nextDraft.promise).client);
    mocks.realtimeRecord
      .mockReturnValueOnce(oldRealtime.recording)
      .mockReturnValueOnce(nextRealtime.recording);
    vi.spyOn(performance, "now").mockReturnValue(5_000);

    await renderRecorder();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      failedDraft.reject(new Error("draft failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(oldRealtime.recording.cancel).toHaveBeenCalledOnce();

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      nextDraft.resolve({ data: { id: recordingId }, error: null });
      await Promise.resolve();
    });

    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(true);

    await act(async () => {
      oldRealtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });

    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(true);

    await act(async () => {
      nextRealtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(false);
    expect(nextRealtime.recording.cancel).not.toHaveBeenCalled();
  });

  it("waits for the audio draft boundary before enabling a live marker", async () => {
    const draft = createDeferred<{
      id: string;
      storagePrefix: string;
      userId: string;
    }>();
    const realtime = createRealtimeRecordingMock();
    const stream = createSharedMediaStreamMock();
    const MediaRecorderMock = installMediaRecorderMock();
    mocks.createLiveRecordingDraft.mockReturnValue(draft.promise);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream as never);
    vi.spyOn(performance, "now").mockReturnValue(5_000);

    await act(async () => {
      root?.render(<BrowserRecorder maxAudioFileSizeBytes={50_000_000} />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushRecorderStart();
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });

    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(true);

    await act(async () => {
      draft.resolve({ id: recordingId, storagePrefix: "live", userId: "user-1" });
      await Promise.resolve();
    });

    expect(MediaRecorderMock.isTypeSupported).toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(mocks.realtimeRecord.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      source: expect.objectContaining({
        restart: expect.any(Function),
        start: expect.any(Function),
        stop: expect.any(Function)
      })
    }));
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(false);
  });

  it("releases a stale microphone acquisition without starting Soniox", async () => {
    const acquisition = createDeferred<MediaStream>();
    const stream = createSharedMediaStreamMock();
    const masterTrack = stream.getAudioTracks()[0]!;

    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(acquisition.promise);
    await renderRecorder();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
    });
    await act(async () => root?.unmount());
    root = null;

    await act(async () => {
      acquisition.resolve(stream);
      await flushRecorderStart();
    });

    expect(masterTrack.stop).toHaveBeenCalledOnce();
    expect(mocks.realtimeRecord).not.toHaveBeenCalled();
  });

  it("keeps an isolated archive nonempty through Soniox restart and cancellation", async () => {
    const realtime = createRealtimeRecordingMock();
    const MediaRecorderMock = installMediaRecorderMock();

    mocks.createLiveRecordingDraft.mockResolvedValue({
      id: recordingId,
      storagePrefix: "live",
      userId: "user-1"
    });
    mocks.realtimeRecord.mockImplementation((options) => {
      const source = options.source as {
        restart: () => void;
        start: (handlers: {
          onData: (chunk: ArrayBuffer) => void;
          onError: (error: Error) => void;
        }) => Promise<void>;
        stop: () => void;
      };

      void source.start({ onData: vi.fn(), onError: vi.fn() });
      realtime.recording.reconnect.mockImplementation(() => source.restart());
      realtime.recording.cancel.mockImplementation(() => source.stop());
      realtime.recording.stop.mockImplementation(async () => source.stop());
      return realtime.recording;
    });
    mocks.uploadLiveRecording.mockResolvedValue({ bytes: 24, storagePath: "live/archive.webm" });
    mocks.completeLiveRecordingUpload.mockResolvedValue(undefined);

    await act(async () => {
      root?.render(<BrowserRecorder maxAudioFileSizeBytes={50_000_000} />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushRecorderStart();
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
      await Promise.resolve();
    });

    expect(MediaRecorderMock.instances).toHaveLength(3);
    const archiveRecorder = MediaRecorderMock.instances[0]!;
    const initialSonioxRecorder = MediaRecorderMock.instances[1]!;
    const safetyRecorder = MediaRecorderMock.instances[2]!;

    expect(initialSonioxRecorder.stream.getAudioTracks()[0])
      .not.toBe(archiveRecorder.stream.getAudioTracks()[0]);
    expect(safetyRecorder.stream.getAudioTracks()[0])
      .not.toBe(archiveRecorder.stream.getAudioTracks()[0]);

    realtime.recording.reconnect();
    realtime.recording.reconnect();
    realtime.recording.reconnect();
    realtime.recording.cancel();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(archiveRecorder.state).toBe("recording");
    expect(MediaRecorderMock.instances).toHaveLength(6);
    expect(safetyRecorder.state).toBe("recording");
    expect(MediaRecorderMock.instances
      .filter((_, index) => [1, 3, 4, 5].includes(index))
      .every((recorder) => recorder.state === "inactive"))
      .toBe(true);

    archiveRecorder.emitData(new Blob(["archive-still-recording"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const uploadedBlob = mocks.uploadLiveRecording.mock.calls[0]?.[0]?.blob as Blob;

    expect(uploadedBlob.type).toBe("audio/webm");
    expect(uploadedBlob.size).toBeGreaterThan(0);
  });

  it("ignores a marker response that settles after stop and a new session", async () => {
    const markerResponse = createDeferred<ReturnType<typeof createSavedMarkerResponse>>();
    const firstSession = await startReadyRecorder();
    mocks.randomUUID.mockReturnValue(clientMarkerId);
    mocks.fetch.mockReturnValueOnce(markerResponse.promise);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".live-marker-button")?.click();
      await Promise.resolve();
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const nextDraft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const nextRealtime = createRealtimeRecordingMock();
    mocks.createBrowserClient.mockReturnValue(createDraftClientMock(nextDraft.promise).client);
    mocks.realtimeRecord.mockReturnValue(nextRealtime.recording);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushRecorderStart();
      nextRealtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
      nextDraft.resolve({
        data: { id: "8cd31215-9b8f-4c68-9e2f-89f4d31f96b4" },
        error: null
      });
      await Promise.resolve();
    });

    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 0");

    await act(async () => {
      markerResponse.resolve(createSavedMarkerResponse({ id: clientMarkerId, offsetMs: 0 }));
      await Promise.resolve();
    });

    expect(document.querySelector(".live-marker-feedback")).toBeNull();
    expect(document.querySelector(".live-marker-count")?.textContent)
      .toContain("Označené momenty: 0");
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(false);
    expect(firstSession.realtime.recording.cancel).not.toHaveBeenCalled();
  });

  it("persists final Soniox result data emitted during graceful stop and ignores later data", async () => {
    const { realtime } = await startReadyRecorder();
    const stop = createDeferred<void>();
    realtime.recording.stop.mockReturnValueOnce(stop.promise);
    mocks.fetch.mockResolvedValue({ json: vi.fn(), ok: true });

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      realtime.handlers.get("result")?.({
        tokens: [{ end_ms: 900, speaker: 0, start_ms: 0, text: "Závěr hovoru." }]
      } as never);
      await Promise.resolve();
    });

    await act(async () => {
      stop.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const transcriptCall = mocks.fetch.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/recordings/${recordingId}/live-transcript`)
    );
    expect(JSON.parse(transcriptCall?.[1]?.body as string)).toMatchObject({
      rawText: "Závěr hovoru.",
      segments: [expect.objectContaining({ text: "Závěr hovoru." })]
    });

    await act(async () => {
      realtime.handlers.get("result")?.({
        tokens: [{ end_ms: 1_500, speaker: 0, start_ms: 1_000, text: " Pozdní data." }]
      } as never);
    });

    expect(document.querySelector(".live-recording-text")?.textContent).toBe("Závěr hovoru.");
  });

  it("keeps live draft and final saves successful while exposing the search fallback", async () => {
    const { realtime } = await startReadyRecorder("detail");
    mocks.fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ warnings: [TRANSCRIPT_SEARCH_INDEX_WARNING] }),
      ok: true
    });

    await act(async () => {
      realtime.handlers.get("result")?.({
        tokens: [{ end_ms: 900, speaker: 0, start_ms: 0, text: "Uložený závěr." }]
      } as never);
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetch.mock.calls.some(([url]) =>
      String(url).endsWith(`/api/recordings/${recordingId}/live-draft`)
    )).toBe(true);
    expect(mocks.fetch.mock.calls.some(([url]) =>
      String(url).endsWith(`/api/recordings/${recordingId}/live-transcript`)
    )).toBe(true);
    expect(Array.from(document.querySelectorAll('[role="status"]')).some((element) => (
      element.textContent === TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
    ))).toBe(true);
    expect(mocks.routerPush).toHaveBeenCalledWith(
      `/recordings/${recordingId}?warning=${TRANSCRIPT_SEARCH_INDEX_WARNING}`
    );
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
  });

  it("adopts an audio draft that resolves after stop invalidates the active phase", async () => {
    const draft = createDeferred<{
      id: string;
      storagePrefix: string;
      userId: string;
    }>();
    const lateDraft = { id: recordingId, storagePrefix: "live", userId: "user-1" };
    const realtime = createRealtimeRecordingMock();
    const stream = createSharedMediaStreamMock();
    installMediaRecorderMock();
    mocks.createLiveRecordingDraft.mockReturnValue(draft.promise);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);
    mocks.fetch.mockResolvedValue({ json: vi.fn(), ok: true });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream as never);

    await act(async () => {
      root?.render(<BrowserRecorder maxAudioFileSizeBytes={50_000_000} />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await Promise.resolve();
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
      realtime.handlers.get("result")?.({
        tokens: [{ end_ms: 500, speaker: 0, start_ms: 0, text: "Audio závěr." }]
      } as never);
    });
    expect(mocks.createLiveRecordingDraft).toHaveBeenCalledOnce();

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      draft.resolve(lateDraft);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.completeLiveRecordingWithoutAudio).not.toHaveBeenCalled();
    expect(mocks.failLiveRecordingUpload).toHaveBeenCalledWith(expect.objectContaining({
      recording: lateDraft
    }));
    expect(mocks.fetch.mock.calls.some(([url]) =>
      String(url).endsWith(`/api/recordings/${recordingId}/live-draft`)
    )).toBe(true);
  });

  it("times out a pending transcript draft and fails only its exact late row", async () => {
    const draft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const draftClient = createDraftClientMock(draft.promise);
    const realtime = createRealtimeRecordingMock();
    mocks.createBrowserClient.mockReturnValue(draftClient.client);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);

    await renderRecorder();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushRecorderStart();
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(draftClient.insert).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLButtonElement>(".record-button")?.disabled).toBe(false);

    await act(async () => {
      draft.resolve({ data: { id: recordingId }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.failLiveRecordingUpload).toHaveBeenCalledWith({
      message: expect.stringContaining("Příprava záznamu"),
      recording: {
        id: recordingId,
        storagePrefix: "",
        userId: "8dd31215-9b8f-4c68-9e2f-89f4d31f96b3"
      }
    });
    expect(mocks.failLiveRecordingUpload).toHaveBeenCalledOnce();
    expect(draftClient.insert).toHaveBeenCalledOnce();
  });

  it("completes one timed-out transcript draft later without creating a fallback row", async () => {
    const draft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const draftClient = createDraftClientMock(draft.promise);
    const realtime = createRealtimeRecordingMock();
    mocks.createBrowserClient.mockReturnValue(draftClient.client);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);
    mocks.fetch.mockResolvedValue({ json: vi.fn(), ok: true });

    await renderRecorder();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushRecorderStart();
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
      realtime.handlers.get("result")?.({
        tokens: [{ end_ms: 800, speaker: 0, start_ms: 0, text: "Čekající přepis." }]
      } as never);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
    });

    expect(draftClient.insert).toHaveBeenCalledOnce();
    expect(mocks.createBrowserClient).toHaveBeenCalledOnce();

    const nextRecordingId = "acd31215-9b8f-4c68-9e2f-89f4d31f96b6";
    const nextRealtime = createRealtimeRecordingMock();
    mocks.createBrowserClient.mockReturnValue(createDraftClientMock(Promise.resolve({
      data: { id: nextRecordingId },
      error: null
    })).client);
    mocks.realtimeRecord.mockReturnValue(nextRealtime.recording);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushRecorderStart();
      nextRealtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(false);

    await act(async () => {
      draft.resolve({ data: { id: recordingId }, error: null });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.completeLiveRecordingWithoutAudio).toHaveBeenCalledWith({
      durationSeconds: 0,
      recording: {
        id: recordingId,
        storagePrefix: "",
        userId: "8dd31215-9b8f-4c68-9e2f-89f4d31f96b3"
      }
    });
    expect(mocks.completeLiveRecordingWithoutAudio).toHaveBeenCalledOnce();
    const transcriptCallIndex = mocks.fetch.mock.calls.findIndex(([url]) =>
      String(url).endsWith(`/api/recordings/${recordingId}/live-transcript`)
    );
    const transcriptCall = mocks.fetch.mock.calls[transcriptCallIndex];
    expect(mocks.completeLiveRecordingWithoutAudio.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.fetch.mock.invocationCallOrder[transcriptCallIndex] ?? 0);
    expect(JSON.parse(transcriptCall?.[1]?.body as string).rawText).toBe("Čekající přepis.");
    expect(mocks.createBrowserClient).toHaveBeenCalledTimes(2);
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
    expect(nextRealtime.recording.cancel).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(false);
  });

  it("does not cancel graceful stop when a pending draft rejects and final data arrives", async () => {
    const draft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const stop = createDeferred<void>();
    const realtime = createRealtimeRecordingMock();
    const fallbackRecordingId = "9cd31215-9b8f-4c68-9e2f-89f4d31f96b5";
    mocks.createBrowserClient
      .mockReturnValueOnce(createDraftClientMock(draft.promise).client)
      .mockReturnValueOnce(createDraftClientMock(Promise.resolve({
        data: { id: fallbackRecordingId },
        error: null
      })).client);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);
    mocks.fetch.mockResolvedValue({ json: vi.fn(), ok: true });
    realtime.recording.stop.mockReturnValueOnce(stop.promise);

    await renderRecorder();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushRecorderStart();
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      draft.reject(new Error("draft insert rejected"));
      realtime.handlers.get("result")?.({
        tokens: [{ end_ms: 700, speaker: 0, start_ms: 0, text: "Finální věta." }]
      } as never);
      await Promise.resolve();
    });

    expect(realtime.recording.cancel).not.toHaveBeenCalled();

    await act(async () => {
      stop.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector<HTMLButtonElement>(".record-button")?.disabled).toBe(false);
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
    expect(realtime.recording.cancel).not.toHaveBeenCalled();
    const transcriptCall = mocks.fetch.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/recordings/${fallbackRecordingId}/live-transcript`)
    );
    expect(JSON.parse(transcriptCall?.[1]?.body as string).rawText).toBe("Finální věta.");
  });

  it("does no persistence or navigation after unmount during stop with an existing draft", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { realtime } = await startReadyRecorder();
    const stop = createDeferred<void>();
    realtime.recording.stop.mockReturnValueOnce(stop.promise);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
    });
    await act(async () => root?.unmount());
    root = null;

    await act(async () => {
      stop.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.uploadLiveRecording).not.toHaveBeenCalled();
    expect(mocks.completeLiveRecordingUpload).not.toHaveBeenCalled();
    expect(mocks.completeLiveRecordingWithoutAudio).not.toHaveBeenCalled();
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("cleans one exact pending draft after unmount without fallback or newer work", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const draft = createDeferred<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>();
    const draftClient = createDraftClientMock(draft.promise);
    const realtime = createRealtimeRecordingMock();
    const stop = createDeferred<void>();
    mocks.createBrowserClient.mockReturnValue(draftClient.client);
    mocks.realtimeRecord.mockReturnValue(realtime.recording);
    realtime.recording.stop.mockReturnValueOnce(stop.promise);

    await renderRecorder();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
      realtime.handlers.get("state_change")?.({ new_state: "recording" } as never);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await Promise.resolve();
    });
    await act(async () => root?.unmount());
    root = null;

    await act(async () => {
      draft.resolve({ data: { id: recordingId }, error: null });
      stop.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.failLiveRecordingUpload).toHaveBeenCalledOnce();
    expect(mocks.failLiveRecordingUpload).toHaveBeenCalledWith({
      message: expect.stringContaining("Příprava záznamu"),
      recording: {
        id: recordingId,
        storagePrefix: "",
        userId: "8dd31215-9b8f-4c68-9e2f-89f4d31f96b3"
      }
    });
    expect(draftClient.insert).toHaveBeenCalledOnce();
    expect(mocks.createBrowserClient).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.uploadLiveRecording).not.toHaveBeenCalled();
    expect(mocks.completeLiveRecordingUpload).not.toHaveBeenCalled();
    expect(mocks.completeLiveRecordingWithoutAudio).not.toHaveBeenCalled();
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(mocks.routerRefresh).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("isolates a rejected marker request from the active recorder", async () => {
    const { performanceNow, realtime } = await startReadyRecorder();
    performanceNow.mockReturnValue(18_765.9);
    mocks.randomUUID.mockReturnValue(clientMarkerId);
    mocks.fetch.mockRejectedValue(new Error("marker network failure"));

    await act(async () => {
      findButton("Označit moment")?.click();
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(findButton("Zastavit")?.disabled).toBe(false);
    expect(findButton("Zkusit moment znovu")?.disabled).toBe(false);
    expect(document.querySelector(".live-marker-feedback[role='alert']")?.textContent)
      .toContain("nepodařilo");
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
    expect(realtime.recording.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["non-2xx response", () => ({ json: vi.fn(), ok: false })],
    ["invalid response", () => ({ json: vi.fn().mockResolvedValue({ marker: null }), ok: true })],
    ["response exception", () => ({ json: vi.fn().mockRejectedValue(new Error("invalid JSON")), ok: true })]
  ])("keeps capture active after a marker %s", async (_label, createResponse) => {
    const { performanceNow, realtime } = await startReadyRecorder();
    performanceNow.mockReturnValue(18_765.9);
    mocks.randomUUID.mockReturnValue(clientMarkerId);
    mocks.fetch.mockResolvedValue(createResponse());

    await act(async () => {
      findButton("Označit moment")?.click();
      await Promise.resolve();
    });

    expect(findButton("Zastavit")?.disabled).toBe(false);
    expect(findButton("Zkusit moment znovu")?.disabled).toBe(false);
    expect(document.querySelector(".live-marker-feedback[role='alert']")?.textContent)
      .toContain("nepodařilo");
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
    expect(realtime.recording.cancel).not.toHaveBeenCalled();
  });

  it("preserves one attempt across compact retry and creates a new attempt after success", async () => {
    const secondMarkerId = "7cd31215-9b8f-4c68-9e2f-89f4d31f96b2";
    const firstRequest = createDeferred<never>();
    const { performanceNow, realtime } = await startReadyRecorder();
    performanceNow.mockReturnValue(18_765.9);
    mocks.randomUUID
      .mockReturnValueOnce(clientMarkerId)
      .mockReturnValueOnce(secondMarkerId);
    mocks.fetch.mockReturnValueOnce(firstRequest.promise);

    const markerButton = findButton("Označit moment");
    await act(async () => {
      markerButton?.click();
      markerButton?.click();
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.randomUUID).toHaveBeenCalledOnce();
    expect(findButton("Ukládám moment")?.disabled).toBe(true);
    expect(document.querySelector(".live-marker-feedback[role='status']")?.textContent)
      .toContain("00:13");
    const firstPayload = JSON.parse(mocks.fetch.mock.calls[0]?.[1]?.body as string);
    expect(firstPayload).toEqual({
      clientMarkerId,
      markerType: "important",
      note: null,
      offsetMs: 13_766
    });

    await act(async () => {
      firstRequest.reject(new Error("first attempt failed"));
      await Promise.resolve();
    });
    expect(findButton("Zkusit moment znovu")?.disabled).toBe(false);

    await renderRecorder(true);
    expect(findButton("Zkusit moment znovu")?.disabled).toBe(false);
    expect(realtime.recording.cancel).not.toHaveBeenCalled();

    performanceNow.mockReturnValue(25_000);
    mocks.fetch.mockResolvedValueOnce(createSavedMarkerResponse({
      id: clientMarkerId,
      offsetMs: 13_766
    }));
    await act(async () => {
      findButton("Zkusit moment znovu")?.click();
      await Promise.resolve();
    });

    expect(mocks.randomUUID).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.fetch.mock.calls[1]?.[1]?.body as string)).toEqual(firstPayload);
    expect(document.querySelector(".live-marker-feedback[role='status']")?.textContent)
      .toContain("uložený");

    await renderRecorder(false);
    performanceNow.mockReturnValue(30_000);
    mocks.fetch.mockResolvedValueOnce(createSavedMarkerResponse({
      id: secondMarkerId,
      offsetMs: 25_000
    }));
    await act(async () => {
      findButton("Označit moment")?.click();
      await Promise.resolve();
    });

    expect(mocks.randomUUID).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.fetch.mock.calls[2]?.[1]?.body as string)).toEqual({
      clientMarkerId: secondMarkerId,
      markerType: "important",
      note: null,
      offsetMs: 25_000
    });
    expect(findButton("Zastavit")?.disabled).toBe(false);
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    root = null;
    expect(realtime.recording.cancel).toHaveBeenCalledOnce();
  });
});
