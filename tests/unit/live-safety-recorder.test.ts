import { describe, expect, it, vi } from "vitest";
import { createRotatingSafetyRecorder } from "@/lib/live-recording/rotating-safety-recorder";

class FakeMediaRecorder extends EventTarget {
  readonly mimeType: string;
  state: RecordingState = "inactive";

  // constructor records the immutable MIME selected for this complete part.
  constructor(mimeType: string) {
    super();
    this.mimeType = mimeType;
  }

  // start opens one independent part recording.
  start() {
    this.state = "recording";
  }

  // stop emits the final boundary and no data remains pending afterward.
  stop() {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }

  // emitData simulates browser data without declaring the part finalized.
  emitData(blob: Blob) {
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: blob }));
  }
}

// settleQueuedWork lets async stop/finalization callbacks finish without a real timer.
async function settleQueuedWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("rotating live safety recorder", () => {
  it("persists only fully stopped parts and owns only its cloned stream", async () => {
    const stopTrack = vi.fn();
    const clone = { getTracks: () => [{ stop: stopTrack }] };
    const source = { clone: vi.fn(() => clone) };
    const recorders: FakeMediaRecorder[] = [];
    const timers: Array<() => void> = [];
    const finalized = vi.fn(async () => undefined);
    let now = 1_000;
    const controller = createRotatingSafetyRecorder({
      clearTimer: vi.fn(),
      createRecorder: (_stream, options) => {
        const recorder = new FakeMediaRecorder(options.mimeType ?? "");
        recorders.push(recorder);
        return recorder as unknown as MediaRecorder;
      },
      mimeType: "audio/webm;codecs=opus",
      now: () => now,
      onPartFinalized: finalized,
      partDurationMs: 5_000,
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      stream: source as unknown as MediaStream
    });

    controller.start();
    recorders[0]?.emitData(new Blob(["first"], { type: "audio/webm" }));
    expect(finalized).not.toHaveBeenCalled();

    now = 6_000;
    timers[0]?.();
    await settleQueuedWork();

    expect(finalized).toHaveBeenCalledWith(expect.objectContaining({
      index: 0,
      name: "part-000000.webm",
      offsetMs: 0,
      size: 5
    }));
    expect(recorders).toHaveLength(2);
    expect(source.clone).toHaveBeenCalledOnce();

    recorders[1]?.emitData(new Blob(["second"], { type: "audio/webm" }));
    now = 11_000;
    await Promise.all([controller.stop(), controller.stop()]);

    expect(finalized).toHaveBeenCalledTimes(2);
    expect(finalized).toHaveBeenLastCalledWith(expect.objectContaining({
      index: 1,
      name: "part-000001.webm",
      offsetMs: 5_000,
      size: 6
    }));
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("rejects an unsupported finalized MIME before starting", () => {
    expect(() => createRotatingSafetyRecorder({
      mimeType: "audio/ogg",
      onPartFinalized: vi.fn(),
      partDurationMs: 5_000,
      stream: { clone: vi.fn() } as unknown as MediaStream
    })).toThrow("Podporovaný bezpečnostní formát je pouze WebM nebo M4A.");
  });
});
