// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveAudioHealthMonitor,
  type LiveAudioHealthSnapshot
} from "@/lib/live-recording/audio-health";

type TrackFixture = MediaStreamTrack & {
  readyState: MediaStreamTrackState;
};

// createTrackFixture returns a mutable EventTarget-backed track for health events.
function createTrackFixture(): TrackFixture {
  const track = new EventTarget() as TrackFixture;

  Object.assign(track, { kind: "audio", readyState: "live" });
  return track;
}

// createRecorderFixture returns the event surface used by archive recorder monitoring.
function createRecorderFixture() {
  return new EventTarget() as MediaRecorder;
}

// createAudioContextFixture controls RMS values and browser context state deterministically.
function createAudioContextFixture(initialState: AudioContextState = "running") {
  const contextEvents = new EventTarget();
  let rms = 0.1;
  const analyser = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    fftSize: 0,
    getFloatTimeDomainData(buffer: Float32Array) {
      buffer.fill(rms);
    }
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    addEventListener: contextEvents.addEventListener.bind(contextEvents),
    close: vi.fn().mockResolvedValue(undefined),
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => source),
    get state() {
      return initialState;
    },
    removeEventListener: contextEvents.removeEventListener.bind(contextEvents)
  } as unknown as AudioContext;

  return {
    context,
    dispatchStateChange: () => contextEvents.dispatchEvent(new Event("statechange")),
    setRms: (value: number) => {
      rms = value;
    },
    setState: (value: AudioContextState) => {
      initialState = value;
    }
  };
}

// lastSnapshot reads the most recent immutable health update.
function lastSnapshot(snapshots: LiveAudioHealthSnapshot[]) {
  return snapshots.at(-1)!;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("live audio health monitor", () => {
  it("reports mute, clears it on unmute, and treats ended as authoritative", () => {
    const track = createTrackFixture();
    const recorder = createRecorderFixture();
    const audio = createAudioContextFixture();
    const snapshots: LiveAudioHealthSnapshot[] = [];
    const monitor = createLiveAudioHealthMonitor({
      createAudioContext: () => audio.context,
      onChange: (snapshot) => snapshots.push(snapshot),
      recorder,
      stream: {} as MediaStream,
      track
    });

    track.dispatchEvent(new Event("mute"));
    expect(lastSnapshot(snapshots).track).toBe("muted");
    track.dispatchEvent(new Event("unmute"));
    expect(lastSnapshot(snapshots).track).toBe("healthy");
    Object.defineProperty(track, "readyState", { configurable: true, value: "ended" });
    track.dispatchEvent(new Event("ended"));
    expect(lastSnapshot(snapshots).track).toBe("ended");

    monitor.stop();
  });

  it("reports archive MediaRecorder error independently from provider health", () => {
    const track = createTrackFixture();
    const recorder = createRecorderFixture();
    const audio = createAudioContextFixture();
    const snapshots: LiveAudioHealthSnapshot[] = [];
    const monitor = createLiveAudioHealthMonitor({
      createAudioContext: () => audio.context,
      onChange: (snapshot) => snapshots.push(snapshot),
      recorder,
      stream: {} as MediaStream,
      track
    });

    recorder.dispatchEvent(Object.assign(new Event("error"), { error: new Error("encoder failed") }));

    expect(lastSnapshot(snapshots)).toMatchObject({
      recorder: "error",
      recorderError: "encoder failed",
      track: "healthy"
    });
    monitor.stop();
  });

  it("warns only after sustained near-zero RMS and clears after signal returns", () => {
    const track = createTrackFixture();
    const recorder = createRecorderFixture();
    const audio = createAudioContextFixture();
    const snapshots: LiveAudioHealthSnapshot[] = [];
    const monitor = createLiveAudioHealthMonitor({
      createAudioContext: () => audio.context,
      nearZeroDurationMs: 1_000,
      onChange: (snapshot) => snapshots.push(snapshot),
      recorder,
      sampleIntervalMs: 250,
      stream: {} as MediaStream,
      track
    });

    audio.setRms(0.0001);
    vi.advanceTimersByTime(999);
    expect(lastSnapshot(snapshots).signal).toBe("monitoring");
    vi.advanceTimersByTime(251);
    expect(lastSnapshot(snapshots).signal).toBe("near_zero");
    audio.setRms(0.2);
    vi.advanceTimersByTime(250);
    expect(lastSnapshot(snapshots).signal).toBe("monitoring");

    monitor.stop();
  });

  it.each(["unavailable", "suspended"] as const)(
    "reports %s Web Audio as monitor-unavailable instead of silence",
    (kind) => {
      const track = createTrackFixture();
      const recorder = createRecorderFixture();
      const snapshots: LiveAudioHealthSnapshot[] = [];
      const audio = createAudioContextFixture("suspended");
      const monitor = createLiveAudioHealthMonitor({
        createAudioContext: kind === "unavailable" ? null : () => audio.context,
        onChange: (snapshot) => snapshots.push(snapshot),
        recorder,
        stream: {} as MediaStream,
        track
      });

      vi.advanceTimersByTime(10_000);
      expect(lastSnapshot(snapshots).signal).toBe("unavailable");
      expect(lastSnapshot(snapshots).signal).not.toBe("near_zero");
      monitor.stop();
    }
  );

  it("resumes advisory sampling when a suspended AudioContext becomes running", () => {
    const track = createTrackFixture();
    const recorder = createRecorderFixture();
    const audio = createAudioContextFixture("suspended");
    const snapshots: LiveAudioHealthSnapshot[] = [];
    const monitor = createLiveAudioHealthMonitor({
      createAudioContext: () => audio.context,
      nearZeroDurationMs: 500,
      onChange: (snapshot) => snapshots.push(snapshot),
      recorder,
      sampleIntervalMs: 250,
      stream: {} as MediaStream,
      track
    });

    expect(lastSnapshot(snapshots).signal).toBe("unavailable");
    audio.setRms(0);
    audio.setState("running");
    audio.dispatchStateChange();
    vi.advanceTimersByTime(750);
    expect(lastSnapshot(snapshots).signal).toBe("near_zero");
    monitor.stop();
  });
});
