import type { AudioSource, AudioSourceHandlers } from "@soniox/client";

export type SharedAudioLeaseName = "archive" | "soniox";

export type SharedAudioTrackLease = {
  readonly name: SharedAudioLeaseName;
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;
  readonly released: boolean;
  release: () => void;
};

export type SharedAudioSession = {
  readonly masterStream: MediaStream;
  readonly closed: boolean;
  close: () => void;
  lease: (name: SharedAudioLeaseName) => SharedAudioTrackLease;
};

type AcquireSharedAudioSessionOptions = {
  constraints?: MediaTrackConstraints | boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

type SonioxAudioSourceOptions = {
  createMediaRecorder?: (stream: MediaStream) => MediaRecorder;
  timesliceMs?: number;
};

export type SonioxAudioSource = AudioSource & {
  restart: () => void;
};

const DEFAULT_SONIOX_TIMESLICE_MS = 250;

// createSingleTrackStream wraps one owned clone without sharing the master stream object.
function createSingleTrackStream(track: MediaStreamTrack) {
  if (typeof MediaStream === "undefined") {
    throw new Error("MediaStream není v tomto prohlížeči dostupný.");
  }

  return new MediaStream([track]);
}

// acquireSharedAudioSession opens the physical microphone once and owns all session-scoped clones.
export async function acquireSharedAudioSession({
  constraints = true,
  getUserMedia
}: AcquireSharedAudioSessionOptions = {}): Promise<SharedAudioSession> {
  const acquire = getUserMedia
    ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);

  if (!acquire) {
    throw new Error("navigator.mediaDevices.getUserMedia není dostupné.");
  }

  const masterStream = await acquire({ audio: constraints });
  const masterTrack = masterStream.getAudioTracks()[0];

  if (!masterTrack) {
    masterStream.getTracks().forEach((track) => track.stop());
    throw new Error("Mikrofon nevrátil žádnou audio stopu.");
  }

  const leases = new Map<SharedAudioLeaseName, SharedAudioTrackLease>();
  let closed = false;

  // close releases each owned clone before releasing the physical master stream.
  function close() {
    if (closed) {
      return;
    }

    closed = true;
    [...leases.values()].forEach((lease) => lease.release());
    masterStream.getTracks().forEach((track) => track.stop());
  }

  // lease creates one independently stoppable clone for a named capture consumer.
  function lease(name: SharedAudioLeaseName): SharedAudioTrackLease {
    if (closed) {
      throw new Error("Audio session už byla ukončená.");
    }

    if (leases.has(name)) {
      throw new Error(`Audio lease ${name} už existuje.`);
    }

    const track = masterTrack.clone();
    const stream = createSingleTrackStream(track);
    let released = false;
    const ownedLease: SharedAudioTrackLease = {
      name,
      stream,
      track,
      get released() {
        return released;
      },
      release() {
        if (released) {
          return;
        }

        released = true;
        track.stop();
        if (leases.get(name) === ownedLease) {
          leases.delete(name);
        }
      }
    };

    leases.set(name, ownedLease);
    return ownedLease;
  }

  return {
    masterStream,
    get closed() {
      return closed;
    },
    close,
    lease
  };
}

// getRecorderError normalizes browser MediaRecorder error events for Soniox handlers.
function getRecorderError(event: Event) {
  const candidate = event as Event & { error?: unknown; message?: unknown };

  if (candidate.error instanceof Error) {
    return candidate.error;
  }

  return new Error(
    typeof candidate.message === "string" && candidate.message
      ? candidate.message
      : "MediaRecorder error"
  );
}

// createSonioxAudioSource encodes only the Soniox clone and preserves archive/master ownership.
export function createSonioxAudioSource(
  lease: SharedAudioTrackLease,
  {
    createMediaRecorder = (stream) => new MediaRecorder(stream),
    timesliceMs = DEFAULT_SONIOX_TIMESLICE_MS
  }: SonioxAudioSourceOptions = {}
): SonioxAudioSource {
  let recorder: MediaRecorder | null = null;
  let handlers: AudioSourceHandlers | null = null;
  let generation = 0;
  let removeTrackListeners: (() => void) | null = null;

  // detachRecorder removes callbacks from a superseded encoder before it can affect a restart.
  function detachRecorder(target: MediaRecorder) {
    const bindings = recorderBindings.get(target);

    if (!bindings) {
      return;
    }

    target.removeEventListener("dataavailable", bindings.onData);
    target.removeEventListener("error", bindings.onError);
    recorderBindings.delete(target);
  }

  const recorderBindings = new WeakMap<MediaRecorder, {
    onData: EventListener;
    onError: EventListener;
  }>();

  // stopRecorderForRestart invalidates old chunks and stops only the superseded Soniox encoder.
  function stopRecorderForRestart() {
    const target = recorder;

    if (!target) {
      return;
    }

    recorder = null;
    detachRecorder(target);
    if (target.state !== "inactive") {
      target.stop();
    }
  }

  // startRecorder creates a new container stream whose first chunk includes fresh headers.
  function startRecorder(activeHandlers: AudioSourceHandlers, activeGeneration: number) {
    if (lease.released || lease.track.readyState === "ended") {
      throw new Error("Soniox audio stopa už není dostupná.");
    }

    const nextRecorder = createMediaRecorder(lease.stream);
    const onData: EventListener = (event) => {
      const data = (event as BlobEvent).data;

      if (!data || data.size === 0) {
        return;
      }

      void data.arrayBuffer().then(
        (chunk) => {
          if (
            generation === activeGeneration
            && recorder === nextRecorder
            && handlers === activeHandlers
          ) {
            activeHandlers.onData(chunk);
          }
        },
        (error: unknown) => {
          if (
            generation === activeGeneration
            && recorder === nextRecorder
            && handlers === activeHandlers
          ) {
            activeHandlers.onError(error instanceof Error ? error : new Error(String(error)));
          }
        }
      );
    };
    const onError: EventListener = (event) => {
      if (
        generation === activeGeneration
        && recorder === nextRecorder
        && handlers === activeHandlers
      ) {
        activeHandlers.onError(getRecorderError(event));
      }
    };

    recorderBindings.set(nextRecorder, { onData, onError });
    nextRecorder.addEventListener("dataavailable", onData);
    nextRecorder.addEventListener("error", onError);
    recorder = nextRecorder;
    nextRecorder.start(timesliceMs);
  }

  // bindTrackListeners forwards mute state without transferring ownership of the Soniox clone.
  function bindTrackListeners(activeHandlers: AudioSourceHandlers, activeGeneration: number) {
    const onMute = () => {
      if (generation === activeGeneration && handlers === activeHandlers) {
        activeHandlers.onMuted?.();
      }
    };
    const onUnmute = () => {
      if (generation === activeGeneration && handlers === activeHandlers) {
        activeHandlers.onUnmuted?.();
      }
    };

    lease.track.addEventListener("mute", onMute);
    lease.track.addEventListener("unmute", onUnmute);
    removeTrackListeners = () => {
      lease.track.removeEventListener("mute", onMute);
      lease.track.removeEventListener("unmute", onUnmute);
    };
  }

  // unbindTrackListeners removes only listeners installed by this Soniox source instance.
  function unbindTrackListeners() {
    removeTrackListeners?.();
    removeTrackListeners = null;
  }

  return {
    // start attaches handlers before the first encoded Soniox chunk can flow.
    async start(nextHandlers) {
      generation += 1;
      stopRecorderForRestart();
      unbindTrackListeners();
      handlers = nextHandlers;
      bindTrackListeners(nextHandlers, generation);

      try {
        startRecorder(nextHandlers, generation);
      } catch (error) {
        stopRecorderForRestart();
        handlers = null;
        unbindTrackListeners();
        throw error;
      }
    },

    // stop is idempotent and stops only Soniox encoding, never master or archive tracks.
    stop() {
      const target = recorder;

      if (!target) {
        unbindTrackListeners();
        handlers = null;
        return;
      }

      recorder = null;
      if (target.state !== "inactive") {
        target.addEventListener("stop", () => detachRecorder(target), { once: true });
        target.stop();
      } else {
        detachRecorder(target);
      }
      unbindTrackListeners();
      handlers = null;
    },

    // restart replaces only the Soniox encoder so reconnect begins with fresh container headers.
    restart() {
      const activeHandlers = handlers;

      if (!activeHandlers || lease.released || lease.track.readyState === "ended") {
        return;
      }

      generation += 1;
      stopRecorderForRestart();
      unbindTrackListeners();
      bindTrackListeners(activeHandlers, generation);
      try {
        startRecorder(activeHandlers, generation);
      } catch (error) {
        stopRecorderForRestart();
        handlers = null;
        unbindTrackListeners();
        throw error;
      }
    }
  };
}
