// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AudioSource, RecordOptions, Recording } from "@soniox/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRecorder } from "@/components/browser-recorder";

const recordingId = "12a31215-9b8f-4c68-9e2f-89f4d31f96b0";

const mocks = vi.hoisted(() => ({
  completeLiveRecordingUpload: vi.fn(),
  completeLiveRecordingWithoutAudio: vi.fn(),
  cleanupDurableSafetyGeneration: vi.fn(),
  createBrowserClient: vi.fn(),
  createIndexedDbDurableAudioRepository: vi.fn(),
  createLiveRecordingDraft: vi.fn(),
  failLiveRecordingUpload: vi.fn(),
  fetch: vi.fn(),
  persistDurableSafetyPart: vi.fn(),
  promoteDurableSafetyParts: vi.fn(),
  realtimeRecord: vi.fn(),
  repositoryDeleteGeneration: vi.fn(),
  repositoryListForOwner: vi.fn(),
  repositoryMarkUploaded: vi.fn(),
  repositoryPut: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
  uploadLiveRecording: vi.fn(),
  uploadLiveRecordingPart: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush, refresh: mocks.routerRefresh })
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}));

vi.mock("@/components/recording-navigation-guard", () => ({
  useRecordingNavigationBlocker: () => ({ registerNavigationBlocker: vi.fn(() => vi.fn()) })
}));

vi.mock("@soniox/client", () => ({
  BrowserPermissionResolver: class BrowserPermissionResolver {},
  SonioxClient: class SonioxClient {
    realtime = { record: mocks.realtimeRecord };
  }
}));

vi.mock("@/lib/recordings/upload", () => ({
  completeLiveRecordingUpload: mocks.completeLiveRecordingUpload,
  completeLiveRecordingWithoutAudio: mocks.completeLiveRecordingWithoutAudio,
  createLiveRecordingDraft: mocks.createLiveRecordingDraft,
  failLiveRecordingUpload: mocks.failLiveRecordingUpload,
  getLiveRecordingStoragePrefix: (userId: string, id: string) => `${userId}/${id}/live/`,
  uploadLiveRecording: mocks.uploadLiveRecording,
  uploadLiveRecordingPart: mocks.uploadLiveRecordingPart
}));

vi.mock("@/lib/live-recording/durable-audio", () => ({
  cleanupDurableSafetyGeneration: mocks.cleanupDurableSafetyGeneration,
  createIndexedDbDurableAudioRepository: mocks.createIndexedDbDurableAudioRepository,
  persistDurableSafetyPart: mocks.persistDurableSafetyPart,
  promoteDurableSafetyParts: mocks.promoteDurableSafetyParts
}));

vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.createBrowserClient }));

class MediaStreamFixture {
  // constructor stores the tracks owned by this capture consumer.
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  // clone gives the safety primitive its separately owned stream and track.
  clone() {
    return new MediaStreamFixture(this.tracks.map((track) => track.clone()));
  }

  // getAudioTracks returns the fixture's audio tracks.
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  // getTracks returns a defensive track list for cleanup.
  getTracks() {
    return [...this.tracks];
  }
}

class MediaRecorderFixture {
  static instances: MediaRecorderFixture[] = [];
  static isTypeSupported = vi.fn(() => true);
  audioBitsPerSecond = 128_000;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  state: "inactive" | "recording" = "inactive";
  private readonly listeners = new Map<string, EventListener[]>();

  // constructor records each isolated stream and its requested encoder options.
  constructor(
    public readonly stream: MediaStream,
    public readonly options: MediaRecorderOptions = {}
  ) {
    MediaRecorderFixture.instances.push(this);
  }

  // start marks this encoder active.
  start() {
    this.state = "recording";
  }

  // stop marks this encoder inactive and delivers its terminal event.
  stop() {
    if (this.state === "inactive") {
      return;
    }

    this.state = "inactive";
    const event = new Event("stop");
    this.listeners.get("stop")?.forEach((listener) => listener(event));
  }

  // addEventListener registers one recorder callback.
  addEventListener(eventName: string, listener: EventListener) {
    this.listeners.set(eventName, [...(this.listeners.get(eventName) ?? []), listener]);
  }

  // removeEventListener removes one recorder callback by identity.
  removeEventListener(eventName: string, listener: EventListener) {
    this.listeners.set(
      eventName,
      (this.listeners.get(eventName) ?? []).filter((candidate) => candidate !== listener)
    );
  }

  // emitData sends one encoded chunk through both MediaRecorder callback styles.
  emitData(data: Blob) {
    const event = Object.assign(new Event("dataavailable"), { data });
    this.ondataavailable?.({ data });
    this.listeners.get("dataavailable")?.forEach((listener) => listener(event));
  }
}

// createMasterStream returns one cloneable physical microphone fixture.
function createMasterStream() {
  const createTrack = () => Object.assign(new EventTarget(), {
    clone: vi.fn(),
    kind: "audio",
    muted: false,
    readyState: "live",
    stop: vi.fn()
  }) as unknown as MediaStreamTrack;
  const master = createTrack();
  vi.mocked(master.clone).mockImplementation(createTrack);
  return new MediaStreamFixture([master]) as unknown as MediaStream;
}

// createProviderRecording exposes deterministic Soniox lifecycle callbacks.
function createProviderRecording() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const recording = {
    cancel: vi.fn(),
    on: vi.fn((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return recording;
    }),
    reconnect: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined)
  };

  return {
    // emit drives one provider event through BrowserRecorder's registered callback.
    emit(eventName: string, payload: unknown) {
      handlers.get(eventName)?.(payload);
    },
    recording: recording as unknown as Recording
  };
}

// createDraftClient provides the authenticated insert chain used by transcript-only capture.
function createDraftClient() {
  const single = vi.fn().mockResolvedValue({ data: { id: recordingId }, error: null });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  const getUser = vi.fn().mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null
  });

  return { auth: { getUser }, from };
}

// createProviderFactory drives the production custom AudioSource through a fake Soniox Recording.
function createProviderFactory(provider: ReturnType<typeof createProviderRecording>) {
  return vi.fn((options: RecordOptions) => {
    const source = options.source as AudioSource & { restart?: () => void };

    void source.start({ onData: vi.fn(), onError: vi.fn() });
    vi.mocked(provider.recording.reconnect).mockImplementation(() => source.restart?.());
    vi.mocked(provider.recording.cancel).mockImplementation(() => source.stop());
    vi.mocked(provider.recording.stop).mockImplementation(async () => source.stop());
    return provider.recording;
  });
}

// flushPromises crosses the recorder's acquisition, draft, and save promise boundaries.
async function flushPromises(count = 8) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

// findMode returns one rendered live-mode radio by its stable value.
function findMode(value: string) {
  return document.querySelector<HTMLInputElement>(`input[name="liveSaveMode"][value="${value}"]`);
}

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("MediaStream", MediaStreamFixture);
  vi.stubGlobal("MediaRecorder", MediaRecorderFixture);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(createMasterStream()) }
  });
  mocks.createLiveRecordingDraft.mockResolvedValue({
    id: recordingId,
    storagePrefix: `user-1/${recordingId}/live/`,
    userId: "user-1"
  });
  mocks.uploadLiveRecording.mockResolvedValue({
    bytes: 32,
    storagePath: "live/archive.webm"
  });
  mocks.completeLiveRecordingUpload.mockResolvedValue(undefined);
  mocks.cleanupDurableSafetyGeneration.mockResolvedValue(undefined);
  mocks.createIndexedDbDurableAudioRepository.mockReturnValue({
    deleteGeneration: mocks.repositoryDeleteGeneration,
    listForOwner: mocks.repositoryListForOwner,
    markUploaded: mocks.repositoryMarkUploaded,
    put: mocks.repositoryPut
  });
  mocks.persistDurableSafetyPart.mockImplementation(async ({ generationId, ownerId, part, recordingId }) => ({
    ...part,
    createdAt: "2026-09-03T00:00:00.000Z",
    generationId,
    key: `${ownerId}/${recordingId}/${generationId}/${part.index}`,
    ownerId,
    recordingId,
    uploadedAt: null
  }));
  mocks.promoteDurableSafetyParts.mockResolvedValue({ failed: [], promoted: [] });
  mocks.uploadLiveRecordingPart.mockResolvedValue({
    bytes: 6,
    reused: false,
    storagePath: `user-1/${recordingId}/live/part-000000.webm`
  });
  mocks.fetch.mockResolvedValue({ json: vi.fn().mockResolvedValue({}), ok: true });
  MediaRecorderFixture.instances = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BrowserRecorder modes", () => {
  it("applies selected archive bitrate without changing Soniox encoding", async () => {
    const provider = createProviderRecording();
    const qualityProps = { liveAudioQuality: "high" as const };
    mocks.realtimeRecord.mockImplementation(createProviderFactory(provider));

    await act(async () => {
      root?.render(
        <BrowserRecorder
          {...qualityProps}
          allowTranscriptOnly
          maxAudioFileSizeBytes={50 * 1024 * 1024}
        />
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
    });

    expect(MediaRecorderFixture.instances[0]?.options.audioBitsPerSecond).toBe(96_000);
    expect(MediaRecorderFixture.instances[1]?.options.audioBitsPerSecond).not.toBe(96_000);
    expect(MediaRecorderFixture.instances[2]?.options.audioBitsPerSecond).toBe(96_000);
  });

  it("owns the audio-limit stop instead of discarding archive capture and continuing", async () => {
    const provider = createProviderRecording();
    mocks.realtimeRecord.mockImplementation(createProviderFactory(provider));

    await act(async () => {
      root?.render(<BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={10_000} />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
      provider.emit("state_change", { new_state: "recording" });
    });

    MediaRecorderFixture.instances[0]?.emitData(new Blob(["archive"], { type: "audio/webm" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await flushPromises(20);
    });

    expect(mocks.completeLiveRecordingUpload).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-recording-status]")?.getAttribute("data-recording-status"))
      .toBe("idle");
  });

  it("persists the final safety part before archive upload and cleans it only after metadata", async () => {
    const events: string[] = [];
    mocks.persistDurableSafetyPart.mockImplementation(async (input) => {
      events.push("persist-safety");
      return {
        ...input.part,
        createdAt: "2026-09-03T00:00:00.000Z",
        generationId: input.generationId,
        key: `${input.ownerId}/${input.recordingId}/${input.generationId}/${input.part.index}`,
        ownerId: input.ownerId,
        recordingId: input.recordingId,
        uploadedAt: null
      };
    });
    mocks.uploadLiveRecording.mockImplementation(async () => {
      events.push("upload-archive");
      return { bytes: 32, storagePath: "live/archive.webm" };
    });
    mocks.completeLiveRecordingUpload.mockImplementation(async () => {
      events.push("confirm-metadata");
    });
    mocks.cleanupDurableSafetyGeneration.mockImplementation(async () => {
      events.push("cleanup-safety");
    });

    await act(async () => {
      root?.render(<BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />);
    });
    await act(async () => findMode("audio_only")?.click());
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
    });

    MediaRecorderFixture.instances[0]?.emitData(new Blob(["archive"], { type: "audio/webm" }));
    MediaRecorderFixture.instances[1]?.emitData(new Blob(["safety"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(18);
    });

    expect(events).toEqual([
      "persist-safety",
      "upload-archive",
      "confirm-metadata",
      "cleanup-safety"
    ]);
  });

  it("promotes complete safety parts when archive upload fails and starts segmented transcription", async () => {
    const provider = createProviderRecording();
    mocks.realtimeRecord.mockImplementation(createProviderFactory(provider));
    mocks.uploadLiveRecording.mockRejectedValue(new Error("archive failed"));
    mocks.promoteDurableSafetyParts.mockImplementation(async ({ uploadPart }) => {
      const durablePart = await mocks.persistDurableSafetyPart.mock.results.at(-1)?.value;
      await uploadPart(durablePart);
      return { failed: [], promoted: [durablePart.key] };
    });

    await act(async () => {
      root?.render(<BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
      provider.emit("state_change", { new_state: "recording" });
      provider.emit("result", {
        tokens: [{ end_ms: 500, is_final: true, start_ms: 0, text: "Hotový text." }]
      });
    });

    MediaRecorderFixture.instances[0]?.emitData(new Blob(["archive"], { type: "audio/webm" }));
    MediaRecorderFixture.instances[2]?.emitData(new Blob(["safety"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(24);
    });

    expect(mocks.uploadLiveRecordingPart).toHaveBeenCalledOnce();
    expect(mocks.completeLiveRecordingUpload).toHaveBeenCalledWith(expect.objectContaining({
      storagePath: `user-1/${recordingId}/live/`
    }));
    const liveTranscriptCall = mocks.fetch.mock.calls.find(([url]) => (
      String(url).endsWith(`/api/recordings/${recordingId}/live-transcript`)
    ));
    expect(JSON.parse(String(liveTranscriptCall?.[1]?.body))).toEqual(expect.objectContaining({
      audioStorage: "supabase_recording_segments"
    }));
    expect(mocks.fetch.mock.calls.some(([url]) => (
      String(url).endsWith(`/api/recordings/${recordingId}/transcription?restart=1`)
    ))).toBe(true);
  });

  it("leaves a complete local safety set recoverable when server promotion fails", async () => {
    mocks.uploadLiveRecording.mockRejectedValue(new Error("archive failed"));
    mocks.promoteDurableSafetyParts.mockImplementation(async () => {
      const durablePart = await mocks.persistDurableSafetyPart.mock.results.at(-1)?.value;
      return { failed: [durablePart.key], promoted: [] };
    });

    await act(async () => {
      root?.render(<BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />);
    });
    await act(async () => findMode("audio_only")?.click());
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
    });

    MediaRecorderFixture.instances[0]?.emitData(new Blob(["archive"], { type: "audio/webm" }));
    MediaRecorderFixture.instances[1]?.emitData(new Blob(["safety"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(24);
    });

    expect(mocks.completeLiveRecordingUpload).not.toHaveBeenCalled();
    expect(mocks.completeLiveRecordingWithoutAudio).not.toHaveBeenCalled();
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
    expect(container.textContent).toContain("obnovení");
  });

  it("preserves the transcript draft and marks failed when no audio path survives", async () => {
    const provider = createProviderRecording();
    mocks.realtimeRecord.mockImplementation(createProviderFactory(provider));
    mocks.persistDurableSafetyPart.mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    mocks.uploadLiveRecording.mockRejectedValue(new Error("archive failed"));

    await act(async () => {
      root?.render(<BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />);
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
      provider.emit("state_change", { new_state: "recording" });
      provider.emit("result", {
        tokens: [{ end_ms: 500, is_final: true, start_ms: 0, text: "Zachovaný koncept." }]
      });
    });

    MediaRecorderFixture.instances[0]?.emitData(new Blob(["archive"], { type: "audio/webm" }));
    MediaRecorderFixture.instances[2]?.emitData(new Blob(["safety"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(24);
    });

    expect(mocks.fetch.mock.calls.some(([url]) => (
      String(url).endsWith(`/api/recordings/${recordingId}/live-draft`)
    ))).toBe(true);
    expect(mocks.failLiveRecordingUpload).toHaveBeenCalledOnce();
    expect(mocks.completeLiveRecordingWithoutAudio).not.toHaveBeenCalled();
  });

  it("downgrades quota-backed crash protection while the continuous archive keeps recording", async () => {
    mocks.persistDurableSafetyPart.mockRejectedValue(new DOMException("quota", "QuotaExceededError"));

    await act(async () => {
      root?.render(<BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />);
    });
    await act(async () => findMode("audio_only")?.click());
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
    });

    const archiveRecorder = MediaRecorderFixture.instances[0]!;
    archiveRecorder.emitData(new Blob(["archive"], { type: "audio/webm" }));
    MediaRecorderFixture.instances[1]?.emitData(new Blob(["safety"], { type: "audio/webm" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await flushPromises(12);
    });

    expect(archiveRecorder.state).toBe("recording");
    expect(container.textContent).toContain("Ochrana proti pádu");
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(18);
    });

    expect(mocks.completeLiveRecordingUpload).toHaveBeenCalledOnce();
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
  });

  it("defaults to combined and disables both audio modes when Storage is unavailable", async () => {
    await act(async () => {
      root?.render(
        <BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />
      );
    });

    expect(findMode("audio_and_live_transcript")?.checked).toBe(true);
    expect(findMode("audio_only")?.disabled).toBe(false);
    expect(findMode("live_transcript_only")?.disabled).toBe(false);

    await act(async () => root?.unmount());
    root = createRoot(container);
    await act(async () => {
      root?.render(<BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={null} />);
    });

    expect(findMode("audio_and_live_transcript")?.disabled).toBe(true);
    expect(findMode("audio_only")?.disabled).toBe(true);
    expect(findMode("live_transcript_only")?.checked).toBe(true);
  });

  it("records audio-only without Soniox and requests async transcription after upload", async () => {
    const events: string[] = [];
    mocks.uploadLiveRecording.mockImplementation(async () => {
      events.push("upload");
      return { bytes: 32, storagePath: "live/archive.webm" };
    });
    mocks.completeLiveRecordingUpload.mockImplementation(async () => {
      events.push("complete-upload");
    });
    mocks.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith(`/api/recordings/${recordingId}/transcription`)) {
        events.push("async-transcription");
      }
      return { json: vi.fn().mockResolvedValue({}), ok: true };
    });

    await act(async () => {
      root?.render(
        <BrowserRecorder
          allowTranscriptOnly
          maxAudioFileSizeBytes={50 * 1024 * 1024}
        />
      );
    });
    await act(async () => findMode("audio_only")?.click());
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
    });

    expect(mocks.realtimeRecord).not.toHaveBeenCalled();
    expect(document.querySelector("[data-recording-status]")?.getAttribute("data-recording-status"))
      .toBe("recording");
    expect(document.querySelector<HTMLButtonElement>(".live-marker-button")?.disabled).toBe(false);
    expect(findMode("audio_only")?.closest("fieldset")?.hasAttribute("disabled")).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(document.querySelector(".recording-timer")?.textContent).toContain("00:01");

    const archiveRecorder = MediaRecorderFixture.instances[0]!;
    archiveRecorder.emitData(new Blob(["archive"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(12);
    });

    expect(events).toEqual(["upload", "complete-upload", "async-transcription"]);
  });

  it("uploads combined audio before partial live text and terminal-provider fallback", async () => {
    const events: string[] = [];
    const provider = createProviderRecording();
    const providerFactory = createProviderFactory(provider);
    mocks.realtimeRecord.mockImplementation(providerFactory);
    mocks.uploadLiveRecording.mockImplementation(async () => {
      events.push("upload");
      return { bytes: 32, storagePath: "live/archive.webm" };
    });
    mocks.completeLiveRecordingUpload.mockImplementation(async () => {
      events.push("complete-upload");
    });
    mocks.fetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith(`/api/recordings/${recordingId}/live-transcript`)) {
        events.push("live-transcript");
      }
      if (path.endsWith(`/api/recordings/${recordingId}/transcription?restart=1`)) {
        events.push("async-transcription");
      }
      return { json: vi.fn().mockResolvedValue({}), ok: true };
    });

    await act(async () => {
      root?.render(
        <BrowserRecorder
          allowTranscriptOnly
          maxAudioFileSizeBytes={50 * 1024 * 1024}
        />
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
      provider.emit("state_change", { new_state: "recording" });
      provider.emit("result", {
        tokens: [{ end_ms: 500, is_final: false, start_ms: 0, text: "Částečný text." }]
      });
      provider.emit("error", new Error("provider ended"));
    });

    const archiveRecorder = MediaRecorderFixture.instances[0]!;
    archiveRecorder.emitData(new Blob(["archive"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(14);
    });

    expect(events).toEqual([
      "upload",
      "complete-upload",
      "live-transcript",
      "async-transcription"
    ]);
  });

  it("continues capture while reconnecting and falls back at stop if provider stays unhealthy", async () => {
    const provider = createProviderRecording();
    const providerFactory = createProviderFactory(provider);
    mocks.realtimeRecord.mockImplementation(providerFactory);

    await act(async () => {
      root?.render(
        <BrowserRecorder
          allowTranscriptOnly
          maxAudioFileSizeBytes={50 * 1024 * 1024}
        />
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
      provider.emit("state_change", { new_state: "recording" });
      provider.emit("reconnecting", {});
      provider.emit("result", {
        tokens: [{ end_ms: 500, is_final: true, start_ms: 0, text: "Hotový text." }]
      });
    });

    const archiveRecorder = MediaRecorderFixture.instances[0]!;
    archiveRecorder.emitData(new Blob(["archive"], { type: "audio/webm" }));
    expect(archiveRecorder.state).toBe("recording");
    expect(mocks.fetch.mock.calls.some(([url]) => (
      String(url).includes(`/api/recordings/${recordingId}/transcription`)
    ))).toBe(false);

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(14);
    });

    expect(mocks.fetch.mock.calls.filter(([url]) => (
      String(url).endsWith(`/api/recordings/${recordingId}/transcription?restart=1`)
    ))).toHaveLength(1);
  });

  it("does not request duplicate async transcription after reconnecting recovers", async () => {
    const provider = createProviderRecording();
    mocks.realtimeRecord.mockImplementation(createProviderFactory(provider));

    await act(async () => {
      root?.render(
        <BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
      provider.emit("state_change", { new_state: "recording" });
      provider.emit("reconnecting", {});
      provider.emit("reconnected", {});
      provider.emit("result", {
        tokens: [{ end_ms: 500, is_final: true, start_ms: 0, text: "Hotový text." }]
      });
    });

    MediaRecorderFixture.instances[0]?.emitData(new Blob(["archive"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(14);
    });

    expect(mocks.fetch.mock.calls.some(([url]) => (
      String(url).includes(`/api/recordings/${recordingId}/transcription`)
    ))).toBe(false);
  });

  it.each([
    { finalText: false, trigger: "start_failed" },
    { finalText: true, trigger: "canceled" },
    { finalText: true, trigger: "unhealthy_stop" },
    { finalText: false, trigger: "empty_final_text" }
  ] as const)("requests one fallback after upload for $trigger", async ({ finalText, trigger }) => {
    const provider = createProviderRecording();

    if (trigger === "start_failed") {
      mocks.realtimeRecord.mockImplementation(() => {
        throw new Error("provider start failed");
      });
    } else {
      mocks.realtimeRecord.mockImplementation(createProviderFactory(provider));
    }

    await act(async () => {
      root?.render(
        <BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();

      if (trigger !== "start_failed") {
        provider.emit("state_change", { new_state: "recording" });
      }
      if (finalText) {
        provider.emit("result", {
          tokens: [{ end_ms: 500, is_final: false, start_ms: 0, text: "Částečný text." }]
        });
      }
      if (trigger === "canceled") {
        provider.recording.cancel();
        provider.emit("state_change", { new_state: "canceled" });
      }
      if (trigger === "unhealthy_stop") {
        vi.mocked(provider.recording.stop).mockRejectedValueOnce(new Error("stop failed"));
      }
    });

    const archiveRecorder = MediaRecorderFixture.instances[0]!;
    archiveRecorder.emitData(new Blob(["archive"], { type: "audio/webm" }));
    expect(archiveRecorder.state).toBe("recording");

    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(14);
    });

    const expectedAsyncPath = finalText
      ? `/api/recordings/${recordingId}/transcription?restart=1`
      : `/api/recordings/${recordingId}/transcription`;
    const asyncCalls = mocks.fetch.mock.calls.filter(([url]) => String(url).endsWith(expectedAsyncPath));
    const asyncCallIndex = mocks.fetch.mock.calls.findIndex(([url]) => (
      String(url).endsWith(expectedAsyncPath)
    ));

    expect(asyncCalls).toHaveLength(1);
    expect(mocks.uploadLiveRecording).toHaveBeenCalledOnce();
    expect(mocks.completeLiveRecordingUpload.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.fetch.mock.invocationCallOrder[asyncCallIndex] ?? 0);
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
  });

  it("keeps transcript-only on realtime without archive upload or async fallback", async () => {
    const provider = createProviderRecording();
    mocks.createBrowserClient.mockReturnValue(createDraftClient());
    mocks.realtimeRecord.mockImplementation(createProviderFactory(provider));

    await act(async () => {
      root?.render(
        <BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />
      );
    });
    await act(async () => findMode("live_transcript_only")?.click());
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
      provider.emit("state_change", { new_state: "recording" });
      provider.emit("result", {
        tokens: [{ end_ms: 500, is_final: true, start_ms: 0, text: "Live text." }]
      });
    });

    expect(MediaRecorderFixture.instances).toHaveLength(1);
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(14);
    });

    expect(mocks.uploadLiveRecording).not.toHaveBeenCalled();
    expect(mocks.completeLiveRecordingUpload).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.some(([url]) => (
      String(url).endsWith(`/api/recordings/${recordingId}/live-transcript`)
    ))).toBe(true);
    expect(mocks.fetch.mock.calls.some(([url]) => (
      String(url).endsWith(`/api/recordings/${recordingId}/transcription`)
    ))).toBe(false);
  });

  it("retains uploaded audio and exposes retry guidance when async transcription fails", async () => {
    mocks.fetch.mockImplementation(async (url) => ({
      json: vi.fn().mockResolvedValue({}),
      ok: !String(url).endsWith(`/api/recordings/${recordingId}/transcription`)
    }));

    await act(async () => {
      root?.render(
        <BrowserRecorder allowTranscriptOnly maxAudioFileSizeBytes={50 * 1024 * 1024} />
      );
    });
    await act(async () => findMode("audio_only")?.click());
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises();
    });

    MediaRecorderFixture.instances[0]?.emitData(new Blob(["archive"], { type: "audio/webm" }));
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".record-button")?.click();
      await flushPromises(14);
    });

    expect(mocks.completeLiveRecordingUpload).toHaveBeenCalledOnce();
    expect(mocks.failLiveRecordingUpload).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Můžete ho zkusit znovu z detailu nahrávky");
    expect(mocks.routerRefresh).toHaveBeenCalledOnce();
  });
});
