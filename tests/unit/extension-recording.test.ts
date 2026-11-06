import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingController, type CaptureBackend, type CaptureStartParams } from "../../extension/src/background/recording.ts";
import { setStore } from "../../extension/src/db/store.ts";
import { SessionRecorder, shouldRotate, type RecorderEnv, type RecorderLike } from "../../extension/src/offscreen/session-recorder.ts";
import { readActiveRecording } from "../../extension/src/shared/storage.ts";
import type { ChunkRecord } from "../../extension/src/shared/types.ts";
import { createMemoryStore, installChrome, installFakeVosio, pairFully, useFastTiming } from "./extension-test-utils";

// Fake MediaRecorder: emits data on demand and fires onstop asynchronously after stop().
class FakeRecorder implements RecorderLike {
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  }
  emit(size: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) });
  }
}

// Builds a recorder environment collecting saved chunks and created recorders.
function makeEnv() {
  const recorders: FakeRecorder[] = [];
  const saved: ChunkRecord[] = [];
  const errors: unknown[] = [];
  let clock = 1000;
  const env: RecorderEnv = {
    createRecorder: () => {
      const recorder = new FakeRecorder();
      recorders.push(recorder);
      return recorder;
    },
    saveChunk: async (chunk) => { saved.push(chunk); },
    now: () => (clock += 5000),
    onError: (error) => errors.push(error)
  };
  return { env, recorders, saved, errors };
}

describe("part rotation (SessionRecorder)", () => {
  it("rotates at 90 % of the part limit", () => {
    expect(shouldRotate(899, 1000)).toBe(false);
    expect(shouldRotate(900, 1000)).toBe(true);
  });

  it("stores every chunk immediately and keeps a small recording in a single part", async () => {
    const { env, recorders, saved } = makeEnv();
    const recorder = new SessionRecorder(env, { sessionId: "s1", maxPartBytes: 1000 });
    recorder.start();
    recorders[0].emit(300);
    await Promise.resolve();
    expect(saved).toHaveLength(1);
    recorders[0].emit(300);
    expect(await recorder.stop()).toBe(1);
    expect(saved.map((chunk) => [chunk.part, chunk.seq])).toEqual([[0, 0], [0, 1]]);
  });

  it("rotates to a new recorder (new part with its own header) when the threshold is reached", async () => {
    const { env, recorders, saved } = makeEnv();
    const recorder = new SessionRecorder(env, { sessionId: "s1", maxPartBytes: 1000 });
    recorder.start();
    recorders[0].emit(400);
    recorders[0].emit(400);
    recorders[0].emit(200);
    await Promise.resolve();
    await Promise.resolve();
    expect(recorders).toHaveLength(2);
    expect(recorders[0].state).toBe("inactive");
    recorders[1].emit(100);
    expect(await recorder.stop()).toBe(2);
    expect(saved.map((chunk) => chunk.part)).toEqual([0, 0, 0, 1]);
    expect(saved.map((chunk) => chunk.seq)).toEqual([0, 1, 2, 3]);
  });

  it("keeps part numbering contiguous when the stop comes right after a rotation", async () => {
    const { env, recorders, saved } = makeEnv();
    const recorder = new SessionRecorder(env, { sessionId: "s1", maxPartBytes: 1000 });
    recorder.start();
    recorders[0].emit(950);
    expect(await recorder.stop()).toBe(1);
    expect(new Set(saved.map((chunk) => chunk.part))).toEqual(new Set([0]));
  });

  it("reports write errors and keeps recording later chunks", async () => {
    const { env, recorders, saved, errors } = makeEnv();
    let calls = 0;
    env.saveChunk = async (chunk) => {
      calls += 1;
      if (calls === 1) throw new Error("quota");
      saved.push(chunk);
    };
    const recorder = new SessionRecorder(env, { sessionId: "s1", maxPartBytes: 100000 });
    recorder.start();
    recorders[0].emit(10);
    recorders[0].emit(10);
    await recorder.stop();
    expect(errors).toHaveLength(1);
    expect(saved).toHaveLength(1);
  });
});

describe("recording state machine (RecordingController)", () => {
  let backend: CaptureBackend & { started: CaptureStartParams[]; live: string | null; micAvailable: boolean; failStart: string | null };
  let controller: RecordingController;
  let store: ReturnType<typeof createMemoryStore>;
  let kicks = 0;

  beforeEach(async () => {
    const chromeStub = installChrome();
    installFakeVosio(chromeStub);
    store = createMemoryStore();
    setStore(store);
    await useFastTiming();
    backend = {
      started: [],
      live: null,
      micAvailable: true,
      failStart: null,
      async start(params) {
        if (this.failStart) return { ok: false, micAvailable: false, error: this.failStart };
        this.started.push(params);
        this.live = params.sessionId;
        return { ok: true, micAvailable: this.micAvailable };
      },
      stop: vi.fn(async () => undefined),
      status: async () => backend.live,
      close: vi.fn(async () => { backend.live = null; })
    };
    kicks = 0;
    controller = new RecordingController({ backend, getConfig: async () => ({ audioBitsPerSecond: 32000, maxPartBytes: 5000, mimeType: "audio/webm", recorderMimeType: "audio/webm;codecs=opus", storage: { apiKey: "k" }, webOrigin: "https://w", account: { email: "a@b.c" } }), onChange: () => undefined, kickUpload: () => { kicks += 1; } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setStore(null);
  });

  // Starts a Meet recording on tab 7.
  const startMeet = (extra: Partial<Parameters<RecordingController["start"]>[0]> = {}) =>
    controller.start({ tabId: 7, streamId: "stream-1", tabTitle: "Standup", tabUrl: "https://meet.google.com/abc-defg-hij", platform: "meet", platformLabel: "Google Meet", ...extra });

  // Adds an audio chunk of a session to the store.
  const addChunk = (sessionId: string, part: number, seq: number, t: number, size = 100) => store.addChunk({ sessionId, part, seq, t, blob: new Blob([new Uint8Array(size)]) });

  it("refuses to start while unpaired and leaves nothing behind", async () => {
    const result = await startMeet();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("není spárované");
    expect(store.sessions.size).toBe(0);
    expect(backend.started).toHaveLength(0);
  });

  it("starts with the server config (bitrate, part limit) and persists the active recording", async () => {
    await pairFully();
    expect(await startMeet()).toEqual({ ok: true });
    expect(backend.started[0]).toMatchObject({ streamId: "stream-1", audioBitsPerSecond: 32000, maxPartBytes: 5000 });
    const active = await readActiveRecording();
    expect(active).toMatchObject({ tabId: 7, platform: "meet", micAvailable: true });
    expect(store.sessions.get(active!.sessionId)?.status).toBe("recording");
  });

  it("flags a missing microphone", async () => {
    await pairFully();
    backend.micAvailable = false;
    await startMeet();
    expect((await readActiveRecording())?.micAvailable).toBe(false);
  });

  it("allows only one recording at a time and can replace it on request", async () => {
    await pairFully();
    await startMeet();
    const first = (await readActiveRecording())!.sessionId;
    await addChunk(first, 0, 0, Date.now() + 1000);
    const second = await startMeet({ tabId: 9, streamId: "stream-2" });
    expect(second.ok).toBe(false);
    expect(second.error).toContain("jiná nahrávka");
    expect(backend.started).toHaveLength(1);

    const replaced = await startMeet({ tabId: 9, streamId: "stream-2", replaceExisting: true });
    expect(replaced.ok).toBe(true);
    expect(store.sessions.get(first)?.status).toBe("queued");
    expect((await readActiveRecording())?.tabId).toBe(9);
  });

  it("stops: titles the recording in local time, persists request ids and queues the upload", async () => {
    await pairFully();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 6, 14, 5, 0));
    await startMeet();
    const id = (await readActiveRecording())!.sessionId;
    await addChunk(id, 0, 0, Date.now() + 1000);
    vi.setSystemTime(new Date(2026, 10, 6, 14, 35, 0));
    const session = await controller.stop("manual");
    expect(session).toMatchObject({ title: "Google Meet – 06.11.2026 14:05", status: "queued", durationSeconds: 1800, partCount: 1 });
    expect(session?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session?.completeRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session?.requestId).not.toBe(session?.completeRequestId);
    expect(await readActiveRecording()).toBeNull();
    expect(kicks).toBe(1);
    expect(backend.stop).toHaveBeenCalled();
    expect(backend.close).toHaveBeenCalled();
  });

  it("drops a recording that captured no audio instead of uploading it", async () => {
    await pairFully();
    await startMeet();
    expect(await controller.stop("manual")).toBeNull();
    expect(store.sessions.size).toBe(0);
    expect(kicks).toBe(0);
  });

  it("reports a failed capture start and cleans up", async () => {
    await pairFully();
    backend.failStart = "Zvuk karty se nepodařilo zachytit.";
    const result = await startMeet();
    expect(result).toEqual({ ok: false, error: "Zvuk karty se nepodařilo zachytit." });
    expect(store.sessions.size).toBe(0);
    expect(await readActiveRecording()).toBeNull();
  });

  it("auto-stops on tab close, URL leaving the meeting, leaving the call and ended capture; ignores unrelated events", async () => {
    await pairFully();
    const cases: Array<[string, (id: string) => Promise<void>]> = [
      ["tab closed", () => controller.handleTabRemoved(7)],
      ["url left", () => controller.handleUrlChange(7, "https://meet.google.com/landing")],
      ["left call", () => controller.handleLeftCall(7)],
      ["capture ended", (id) => controller.handleCaptureEnded(id)]
    ];
    for (const [, trigger] of cases) {
      await startMeet();
      const id = (await readActiveRecording())!.sessionId;
      await addChunk(id, 0, 0, Date.now() + 1000);
      await controller.handleTabRemoved(99);
      await controller.handleUrlChange(7, "https://meet.google.com/abc-defg-hij#x");
      await controller.handleLeftCall(99);
      await controller.handleCaptureEnded("someone-else");
      expect(await readActiveRecording()).not.toBeNull();
      await trigger(id);
      expect(await readActiveRecording()).toBeNull();
      expect(store.sessions.get(id)?.status).toBe("queued");
    }
  });

  it("recovers an orphaned session after a crash: chunks become a pending recording with duration from the last chunk", async () => {
    await pairFully();
    const startedAt = Date.now() - 600_000;
    await store.putSession({ id: "orphan", platform: "teams", platformLabel: "Microsoft Teams", startedAt, endedAt: null, status: "recording", title: null, requestId: null, completeRequestId: null, durationSeconds: null, partCount: 0, recordingId: null, captureRevision: null, accountEmail: null, attempts: 0, nextAttemptAt: null, lastError: null, uploadedParts: [], detailUrl: null });
    await addChunk("orphan", 0, 0, startedAt + 5000);
    await addChunk("orphan", 0, 1, startedAt + 300_000);
    const recovered = await controller.recover();
    expect(recovered).toHaveLength(1);
    expect(store.sessions.get("orphan")).toMatchObject({ status: "queued", durationSeconds: 300, partCount: 1 });
    expect(kicks).toBe(1);
  });

  it("keeps a recording that is still running in the offscreen document (worker restart) and drops empty orphans", async () => {
    await pairFully();
    await startMeet();
    const live = (await readActiveRecording())!.sessionId;
    await store.putSession({ id: "empty", platform: "meet", platformLabel: "Google Meet", startedAt: 1, endedAt: null, status: "recording", title: null, requestId: null, completeRequestId: null, durationSeconds: null, partCount: 0, recordingId: null, captureRevision: null, accountEmail: null, attempts: 0, nextAttemptAt: null, lastError: null, uploadedParts: [], detailUrl: null });
    expect(await controller.recover()).toEqual([]);
    expect((await readActiveRecording())?.sessionId).toBe(live);
    backend.live = null;
    await controller.recover();
    expect(await readActiveRecording()).toBeNull();
    expect(store.sessions.has("empty")).toBe(false);
  });
});
