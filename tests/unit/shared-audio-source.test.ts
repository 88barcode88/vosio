// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireSharedAudioSession,
  createSonioxAudioSource
} from "@/lib/live-recording/shared-audio-source";

type TrackFixture = MediaStreamTrack & {
  stop: ReturnType<typeof vi.fn>;
};

// createTrackFixture returns an EventTarget-backed media track for ownership tests.
function createTrackFixture(
  id: string,
  kind: "audio" | "video" = "audio",
  displaySurface = kind === "video" ? "browser" : undefined
): TrackFixture {
  const track = new EventTarget() as TrackFixture;

  Object.assign(track, {
    getSettings: vi.fn(() => displaySurface ? { displaySurface } : {}),
    id,
    kind,
    muted: false,
    readyState: "live",
    stop: vi.fn()
  });

  return track;
}

// createMasterStreamFixture exposes distinct clones while retaining the physical master track.
function createMasterStreamFixture() {
  const masterTrack = createTrackFixture("master");
  const clones: TrackFixture[] = [];

  Object.assign(masterTrack, {
    clone: vi.fn(() => {
      const clone = createTrackFixture(`clone-${clones.length + 1}`);
      clones.push(clone);
      return clone;
    })
  });

  const masterStream = {
    getAudioTracks: vi.fn(() => [masterTrack]),
    getTracks: vi.fn(() => [masterTrack])
  } as unknown as MediaStream;

  return { clones, masterStream, masterTrack };
}

// createStreamFixture exposes the supplied raw capture tracks without cloning them.
function createStreamFixture(tracks: TrackFixture[]) {
  return {
    getAudioTracks: vi.fn(() => tracks.filter((track) => track.kind === "audio")),
    getTracks: vi.fn(() => [...tracks])
  } as unknown as MediaStream;
}

class MediaRecorderFixture extends EventTarget {
  static instances: MediaRecorderFixture[] = [];
  audioBitsPerSecond = 64_000;
  state: RecordingState = "inactive";

  // constructor records which isolated stream owns this encoder.
  constructor(public readonly stream: MediaStream) {
    super();
    MediaRecorderFixture.instances.push(this);
  }

  // start marks this encoder active without synthesizing data.
  start() {
    this.state = "recording";
  }

  // stop is idempotent and emits the browser stop event once.
  stop() {
    if (this.state === "inactive") {
      return;
    }

    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }

  // emitData sends one provider chunk through the real dataavailable listener.
  emitData(data: Blob) {
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
  }
}

class MediaStreamFixture {
  // constructor stores the exact cloned tracks assigned to this consumer stream.
  constructor(private readonly tracks: MediaStreamTrack[] = []) {}

  // getAudioTracks returns only tracks owned by this fixture stream.
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  // getTracks returns a defensive copy of this fixture stream's tracks.
  getTracks() {
    return [...this.tracks];
  }
}

beforeEach(() => {
  vi.stubGlobal("MediaStream", MediaStreamFixture);
});

afterEach(() => {
  MediaRecorderFixture.instances = [];
  vi.unstubAllGlobals();
});

describe("shared live audio source", () => {
  it("acquires one master microphone and returns isolated named clone leases", async () => {
    const fixture = createMasterStreamFixture();
    const getUserMedia = vi.fn().mockResolvedValue(fixture.masterStream);
    const session = await acquireSharedAudioSession({ getUserMedia });
    const archive = session.lease("archive");
    const soniox = session.lease("soniox");

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(archive.track).not.toBe(soniox.track);
    expect(archive.track).not.toBe(fixture.masterTrack);
    expect(soniox.track).not.toBe(fixture.masterTrack);
    expect(archive.name).toBe("archive");
    expect(soniox.name).toBe("soniox");

    archive.release();
    archive.release();
    expect(archive.track.stop).toHaveBeenCalledOnce();
    expect(soniox.track.stop).not.toHaveBeenCalled();
    expect(fixture.masterTrack.stop).not.toHaveBeenCalled();

    session.close();
    session.close();
    expect(soniox.track.stop).toHaveBeenCalledOnce();
    expect(fixture.masterTrack.stop).toHaveBeenCalledOnce();
  });

  it("mixes microphone and selected tab audio into one leased master stream", async () => {
    const microphoneTrack = createTrackFixture("microphone");
    const tabAudioTrack = createTrackFixture("tab-audio");
    const tabVideoTrack = createTrackFixture("tab-video", "video");
    const microphoneStream = createStreamFixture([microphoneTrack]);
    const displayStream = createStreamFixture([tabAudioTrack, tabVideoTrack]);
    const mixed = createMasterStreamFixture();
    const events: string[] = [];
    const mixer = {
      mix: vi.fn(() => {
        events.push("mix");
        return mixed.masterStream;
      }),
      close: vi.fn(),
      ready: Promise.resolve()
    };
    const getDisplayMedia = vi.fn((_constraints: DisplayMediaStreamOptions) => {
      events.push("display");
      return Promise.resolve(displayStream);
    });
    const getUserMedia = vi.fn(() => {
      events.push("microphone");
      return Promise.resolve(microphoneStream);
    });
    const createAudioMixer = vi.fn(() => {
      events.push("mixer");
      return mixer;
    });

    const session = await acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer,
      getDisplayMedia,
      getUserMedia
    });
    const archive = session.lease("archive");
    const soniox = session.lease("soniox");

    expect(events).toEqual(["mixer", "display", "microphone", "mix"]);
    expect(getDisplayMedia).toHaveBeenCalledOnce();
    expect(getDisplayMedia.mock.calls[0]?.[0]).toMatchObject({
      audio: { suppressLocalAudioPlayback: false },
      video: { displaySurface: "browser" }
    });
    expect(mixer.mix).toHaveBeenCalledWith(microphoneStream, displayStream);
    expect(archive.track).not.toBe(soniox.track);
    expect(archive.track).not.toBe(microphoneTrack);
    expect(archive.track).not.toBe(tabAudioTrack);

    session.close();
    expect(archive.track.stop).toHaveBeenCalledOnce();
    expect(soniox.track.stop).toHaveBeenCalledOnce();
    expect(microphoneTrack.stop).toHaveBeenCalledOnce();
    expect(tabAudioTrack.stop).toHaveBeenCalledOnce();
    expect(tabVideoTrack.stop).toHaveBeenCalledOnce();
    expect(mixed.masterTrack.stop).toHaveBeenCalledOnce();
    expect(mixer.close).toHaveBeenCalledOnce();
  });

  it("rejects a selected tab without shared audio before acquiring the microphone", async () => {
    const tabVideoTrack = createTrackFixture("tab-video", "video");
    const displayStream = createStreamFixture([tabVideoTrack]);
    const mixer = { mix: vi.fn(), close: vi.fn(), ready: Promise.resolve() };
    const getUserMedia = vi.fn();

    await expect(acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => mixer,
      getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
      getUserMedia
    })).rejects.toThrow(/Sdílet také zvuk karty/u);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(tabVideoTrack.stop).toHaveBeenCalledOnce();
    expect(mixer.close).toHaveBeenCalledOnce();
  });

  it("rejects a non-tab surface even when it exposes system audio", async () => {
    const systemAudioTrack = createTrackFixture("system-audio");
    const windowVideoTrack = createTrackFixture("window-video", "video", "window");
    const displayStream = createStreamFixture([systemAudioTrack, windowVideoTrack]);
    const mixer = { mix: vi.fn(), close: vi.fn(), ready: Promise.resolve() };
    const getUserMedia = vi.fn();

    await expect(acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => mixer,
      getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
      getUserMedia
    })).rejects.toThrow(/přímo kartu/u);

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(systemAudioTrack.stop).toHaveBeenCalledOnce();
    expect(windowVideoTrack.stop).toHaveBeenCalledOnce();
  });

  it("turns a canceled tab picker into an actionable safe error", async () => {
    const pickerError = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    const mixer = { mix: vi.fn(), close: vi.fn(), ready: Promise.resolve() };

    await expect(acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => mixer,
      getDisplayMedia: vi.fn().mockRejectedValue(pickerError),
      getUserMedia: vi.fn()
    })).rejects.toThrow(/Sdílení zvuku karty nebylo potvrzené/u);

    expect(mixer.close).toHaveBeenCalledOnce();
  });

  it("cleans the selected tab when microphone acquisition fails", async () => {
    const tabAudioTrack = createTrackFixture("tab-audio");
    const tabVideoTrack = createTrackFixture("tab-video", "video");
    const displayStream = createStreamFixture([tabAudioTrack, tabVideoTrack]);
    const mixer = { mix: vi.fn(), close: vi.fn(), ready: Promise.resolve() };

    await expect(acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => mixer,
      getDisplayMedia: vi.fn().mockResolvedValue(displayStream),
      getUserMedia: vi.fn().mockRejectedValue(new Error("microphone denied"))
    })).rejects.toThrow("microphone denied");

    expect(tabAudioTrack.stop).toHaveBeenCalledOnce();
    expect(tabVideoTrack.stop).toHaveBeenCalledOnce();
    expect(mixer.close).toHaveBeenCalledOnce();
  });

  it("fails closed when the selected tab ends while microphone permission is pending", async () => {
    const tabAudioTrack = createTrackFixture("tab-audio");
    const tabVideoTrack = createTrackFixture("tab-video", "video");
    const microphoneTrack = createTrackFixture("microphone");
    let resolveMicrophone!: (stream: MediaStream) => void;
    const microphonePromise = new Promise<MediaStream>((resolve) => {
      resolveMicrophone = resolve;
    });
    const mixer = { mix: vi.fn(), close: vi.fn(), ready: Promise.resolve() };
    const acquisition = acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => mixer,
      getDisplayMedia: vi.fn().mockResolvedValue(createStreamFixture([tabAudioTrack, tabVideoTrack])),
      getUserMedia: vi.fn(() => microphonePromise)
    });

    await Promise.resolve();
    Object.assign(tabAudioTrack, { readyState: "ended" });
    resolveMicrophone(createStreamFixture([microphoneTrack]));

    await expect(acquisition).rejects.toThrow(/sdílení zvuku karty skončilo/ui);
    expect(mixer.mix).not.toHaveBeenCalled();
    expect(microphoneTrack.stop).toHaveBeenCalledOnce();
    expect(tabAudioTrack.stop).toHaveBeenCalledOnce();
  });

  it("fails closed when the Web Audio mixer cannot reach running state", async () => {
    const tabAudioTrack = createTrackFixture("tab-audio");
    const tabVideoTrack = createTrackFixture("tab-video", "video");
    const microphoneTrack = createTrackFixture("microphone");
    const mixer = {
      close: vi.fn(),
      mix: vi.fn(),
      ready: Promise.reject(new Error("Míchání zvuku se nepodařilo aktivovat."))
    };

    await expect(acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => mixer,
      getDisplayMedia: vi.fn().mockResolvedValue(createStreamFixture([tabAudioTrack, tabVideoTrack])),
      getUserMedia: vi.fn().mockResolvedValue(createStreamFixture([microphoneTrack]))
    })).rejects.toThrow(/Míchání zvuku/u);

    expect(mixer.mix).not.toHaveBeenCalled();
    expect(microphoneTrack.stop).toHaveBeenCalledOnce();
    expect(tabAudioTrack.stop).toHaveBeenCalledOnce();
    expect(mixer.close).toHaveBeenCalledOnce();
  });

  it("reports an ended raw input once and suppresses shutdown events", async () => {
    const microphoneTrack = createTrackFixture("microphone");
    const tabAudioTrack = createTrackFixture("tab-audio");
    const tabVideoTrack = createTrackFixture("tab-video", "video");
    const mixed = createMasterStreamFixture();
    const session = await acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => ({
        close: vi.fn(),
        mix: () => mixed.masterStream,
        ready: Promise.resolve()
      }),
      getDisplayMedia: vi.fn().mockResolvedValue(createStreamFixture([tabAudioTrack, tabVideoTrack])),
      getUserMedia: vi.fn().mockResolvedValue(createStreamFixture([microphoneTrack]))
    });
    const onSourceEnded = vi.fn();

    session.onSourceEnded(onSourceEnded);
    tabVideoTrack.dispatchEvent(new Event("ended"));
    tabAudioTrack.dispatchEvent(new Event("ended"));

    expect(onSourceEnded).toHaveBeenCalledOnce();
    expect(onSourceEnded).toHaveBeenCalledWith("shared_tab");

    session.close();
    microphoneTrack.dispatchEvent(new Event("ended"));
    expect(onSourceEnded).toHaveBeenCalledOnce();
  });

  it("reports independent raw input mute and unmute state", async () => {
    const microphoneTrack = createTrackFixture("microphone");
    const tabAudioTrack = createTrackFixture("tab-audio");
    const tabVideoTrack = createTrackFixture("tab-video", "video");
    const mixed = createMasterStreamFixture();
    const session = await acquireSharedAudioSession({
      captureMode: "microphone_and_tab",
      createAudioMixer: () => ({
        close: vi.fn(),
        mix: () => mixed.masterStream,
        ready: Promise.resolve()
      }),
      getDisplayMedia: vi.fn().mockResolvedValue(createStreamFixture([tabAudioTrack, tabVideoTrack])),
      getUserMedia: vi.fn().mockResolvedValue(createStreamFixture([microphoneTrack]))
    });
    const onSourceMuted = vi.fn();

    session.onSourceMuted(onSourceMuted);
    tabAudioTrack.dispatchEvent(new Event("mute"));
    microphoneTrack.dispatchEvent(new Event("mute"));
    tabAudioTrack.dispatchEvent(new Event("unmute"));

    expect(onSourceMuted.mock.calls).toEqual([
      ["shared_tab", true],
      ["microphone", true],
      ["shared_tab", false]
    ]);
    session.close();
  });

  it("rejects duplicate active lease names", async () => {
    const fixture = createMasterStreamFixture();
    const session = await acquireSharedAudioSession({
      getUserMedia: vi.fn().mockResolvedValue(fixture.masterStream)
    });

    session.lease("archive");
    expect(() => session.lease("archive")).toThrow(/archive/u);
    session.close();
  });

  it("restarts Soniox with a fresh encoder and ignores stale chunk settlement", async () => {
    const fixture = createMasterStreamFixture();
    const session = await acquireSharedAudioSession({
      getUserMedia: vi.fn().mockResolvedValue(fixture.masterStream)
    });
    const archive = session.lease("archive");
    const soniox = session.lease("soniox");
    const source = createSonioxAudioSource(soniox, {
      createMediaRecorder: (stream) => new MediaRecorderFixture(stream) as unknown as MediaRecorder,
      timesliceMs: 250
    });
    const delivered: string[] = [];
    const onMuted = vi.fn();
    let resolveOldChunk!: (value: ArrayBuffer) => void;
    const oldChunk = new Blob(["old"]);

    vi.spyOn(oldChunk, "arrayBuffer").mockReturnValue(new Promise((resolve) => {
      resolveOldChunk = resolve;
    }));

    await source.start({
      onData: (chunk) => delivered.push(new TextDecoder().decode(chunk)),
      onError: vi.fn(),
      onMuted
    });
    const firstRecorder = MediaRecorderFixture.instances[0]!;
    soniox.track.dispatchEvent(new Event("mute"));
    firstRecorder.emitData(oldChunk);
    source.restart();
    const secondRecorder = MediaRecorderFixture.instances[1]!;
    soniox.track.dispatchEvent(new Event("mute"));
    secondRecorder.emitData(new Blob(["fresh-header"]));
    await Promise.resolve();
    await Promise.resolve();
    resolveOldChunk(new TextEncoder().encode("old").buffer);
    await Promise.resolve();

    expect(firstRecorder.state).toBe("inactive");
    expect(secondRecorder.state).toBe("recording");
    expect(delivered).toEqual(["fresh-header"]);
    expect(onMuted).toHaveBeenCalledTimes(2);
    expect(archive.track.stop).not.toHaveBeenCalled();
    expect(fixture.masterTrack.stop).not.toHaveBeenCalled();

    source.stop();
    source.stop();
    soniox.track.dispatchEvent(new Event("mute"));
    expect(secondRecorder.state).toBe("inactive");
    expect(onMuted).toHaveBeenCalledTimes(2);
    expect(archive.track.stop).not.toHaveBeenCalled();
    expect(fixture.masterTrack.stop).not.toHaveBeenCalled();
    session.close();
  });

  it("keeps archive recording alive after injected Soniox cancellation", async () => {
    const fixture = createMasterStreamFixture();
    const session = await acquireSharedAudioSession({
      getUserMedia: vi.fn().mockResolvedValue(fixture.masterStream)
    });
    const archive = session.lease("archive");
    const soniox = session.lease("soniox");
    const archiveRecorder = new MediaRecorderFixture(archive.stream);
    const source = createSonioxAudioSource(soniox, {
      createMediaRecorder: (stream) => new MediaRecorderFixture(stream) as unknown as MediaRecorder
    });
    const archiveChunks: Blob[] = [];

    archiveRecorder.addEventListener("dataavailable", (event) => {
      archiveChunks.push((event as BlobEvent).data);
    });
    archiveRecorder.start();
    await source.start({ onData: vi.fn(), onError: vi.fn() });
    source.stop();
    archiveRecorder.emitData(new Blob(["playable archive"], { type: "audio/webm" }));

    expect(archiveRecorder.state).toBe("recording");
    expect(archive.track.stop).not.toHaveBeenCalled();
    expect(new Blob(archiveChunks, { type: "audio/webm" }).size).toBeGreaterThan(0);
    session.close();
  });
});
