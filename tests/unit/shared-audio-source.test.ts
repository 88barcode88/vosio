// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireSharedAudioSession,
  createSonioxAudioSource
} from "@/lib/live-recording/shared-audio-source";

type TrackFixture = MediaStreamTrack & {
  stop: ReturnType<typeof vi.fn>;
};

// createTrackFixture returns a cloneable EventTarget-backed audio track for ownership tests.
function createTrackFixture(id: string): TrackFixture {
  const track = new EventTarget() as TrackFixture;

  Object.assign(track, {
    id,
    kind: "audio",
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
