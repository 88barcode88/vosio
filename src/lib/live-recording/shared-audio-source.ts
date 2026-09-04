import type { AudioSource, AudioSourceHandlers } from "@soniox/client";

export type SharedAudioLeaseName = "archive" | "soniox";
export type LiveAudioCaptureMode = "microphone" | "microphone_and_tab";
export type SharedAudioInputName = "microphone" | "shared_tab";

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
  onSourceEnded: (listener: (source: SharedAudioInputName) => void) => () => void;
  onSourceMuted: (
    listener: (source: SharedAudioInputName, muted: boolean) => void
  ) => () => void;
};

type AcquireSharedAudioSessionOptions = {
  captureMode?: LiveAudioCaptureMode;
  constraints?: MediaTrackConstraints | boolean;
  createAudioMixer?: () => SharedAudioMixer;
  getDisplayMedia?: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

type SharedAudioMixer = {
  close: () => void;
  mix: (microphoneStream: MediaStream, displayStream: MediaStream) => MediaStream;
  ready: Promise<void>;
};

type SonioxAudioSourceOptions = {
  createMediaRecorder?: (stream: MediaStream) => MediaRecorder;
  timesliceMs?: number;
};

export type SonioxAudioSource = AudioSource & {
  restart: () => void;
};

const DEFAULT_SONIOX_TIMESLICE_MS = 250;

const TAB_AUDIO_CAPTURE_CONSTRAINTS = {
  audio: {
    suppressLocalAudioPlayback: false
  },
  video: {
    displaySurface: "browser",
    frameRate: { max: 5 },
    height: { max: 180 },
    width: { max: 320 }
  },
  preferCurrentTab: false,
  selfBrowserSurface: "exclude",
  surfaceSwitching: "include",
  systemAudio: "exclude"
} as unknown as DisplayMediaStreamOptions;

// createSingleTrackStream wraps one owned clone without sharing the master stream object.
function createSingleTrackStream(track: MediaStreamTrack) {
  if (typeof MediaStream === "undefined") {
    throw new Error("MediaStream není v tomto prohlížeči dostupný.");
  }

  return new MediaStream([track]);
}

// stopStreams releases every unique raw track owned by one capture attempt.
function stopStreams(streams: Array<MediaStream | null | undefined>) {
  const stopped = new Set<MediaStreamTrack>();

  streams.forEach((stream) => {
    stream?.getTracks().forEach((track) => {
      if (!stopped.has(track)) {
        stopped.add(track);
        track.stop();
      }
    });
  });
}

// createBrowserAudioMixer combines microphone and shared-tab audio into one owned stream.
function createBrowserAudioMixer(): SharedAudioMixer {
  if (typeof AudioContext === "undefined") {
    throw new Error("Míchání mikrofonu a zvuku karty není v tomto prohlížeči dostupné.");
  }

  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const sources: MediaStreamAudioSourceNode[] = [];
  let closed = false;
  const ready = context.state === "running"
    ? Promise.resolve()
    : context.resume().then(() => {
        if (context.state !== "running") {
          throw new Error("Míchání zvuku se nepodařilo aktivovat.");
        }
      }).catch(() => {
        throw new Error("Míchání zvuku se nepodařilo aktivovat.");
      });

  return {
    // mix connects both live inputs to the same destination track.
    mix(microphoneStream, displayStream) {
      const microphoneSource = context.createMediaStreamSource(microphoneStream);
      const displaySource = context.createMediaStreamSource(displayStream);

      microphoneSource.connect(destination);
      displaySource.connect(destination);
      sources.push(microphoneSource, displaySource);
      return destination.stream;
    },

    // close disconnects the graph and releases its browser audio context.
    close() {
      if (closed) {
        return;
      }

      closed = true;
      sources.forEach((source) => source.disconnect());
      void context.close();
    },
    ready
  };
}

// acquireSharedAudioSession opens one source topology and owns all raw tracks and consumer clones.
export async function acquireSharedAudioSession({
  captureMode = "microphone",
  constraints = true,
  createAudioMixer: createMixer = createBrowserAudioMixer,
  getDisplayMedia,
  getUserMedia
}: AcquireSharedAudioSessionOptions = {}): Promise<SharedAudioSession> {
  const acquire = getUserMedia
    ?? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);

  if (!acquire) {
    throw new Error("navigator.mediaDevices.getUserMedia není dostupné.");
  }

  let mixer: SharedAudioMixer | null = null;
  let microphoneStream: MediaStream | null = null;
  let displayStream: MediaStream | null = null;
  let masterStream: MediaStream;

  if (captureMode === "microphone_and_tab") {
    const acquireDisplay = getDisplayMedia
      ?? navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);

    if (!acquireDisplay) {
      throw new Error("Sdílení zvuku karty není v tomto prohlížeči dostupné.");
    }

    mixer = createMixer();
    void mixer.ready.catch(() => undefined);

    try {
      displayStream = await acquireDisplay(TAB_AUDIO_CAPTURE_CONSTRAINTS);
      const displayAudioTrack = displayStream.getAudioTracks()[0];
      const displayVideoTrack = displayStream.getTracks().find((track) => track.kind === "video");

      if (!displayAudioTrack) {
        throw new Error(
          "Vybraná karta nesdílí zvuk. Zvolte kartu Google Meet a zapněte Sdílet také zvuk karty."
        );
      }
      if (!displayVideoTrack || displayVideoTrack.getSettings().displaySurface !== "browser") {
        throw new Error(
          "Vybraný zdroj není karta prohlížeče. Zvolte přímo kartu Google Meet se zapnutým sdílením zvuku."
        );
      }

      microphoneStream = await acquire({ audio: constraints });
      const microphoneTrack = microphoneStream.getAudioTracks()[0];

      if (!microphoneTrack) {
        throw new Error("Mikrofon nevrátil žádnou audio stopu.");
      }
      await mixer.ready;
      if (displayAudioTrack.readyState === "ended" || displayVideoTrack.readyState === "ended") {
        throw new Error(
          "Sdílení zvuku karty skončilo před spuštěním nahrávání. Vyberte kartu znovu."
        );
      }
      if (microphoneTrack.readyState === "ended") {
        throw new Error("Mikrofon se odpojil před spuštěním nahrávání.");
      }

      masterStream = mixer.mix(microphoneStream, displayStream);
    } catch (error) {
      stopStreams([microphoneStream, displayStream]);
      mixer.close();
      if (
        !displayStream
        && error instanceof Error
        && (error.name === "AbortError" || error.name === "NotAllowedError")
      ) {
        throw new Error(
          "Sdílení zvuku karty nebylo potvrzené. Vyberte kartu Google Meet a ponechte zapnuté Sdílet také zvuk karty."
        );
      }
      throw error;
    }
  } else {
    microphoneStream = await acquire({ audio: constraints });
    masterStream = microphoneStream;
  }

  const masterTrack = masterStream.getAudioTracks()[0];

  if (!masterTrack) {
    stopStreams([masterStream, microphoneStream, displayStream]);
    mixer?.close();
    throw new Error("Mikrofon nevrátil žádnou audio stopu.");
  }

  const leases = new Map<SharedAudioLeaseName, SharedAudioTrackLease>();
  const endedInputs = new Set<SharedAudioInputName>();
  const mutedInputs = new Set<SharedAudioInputName>();
  const sourceEndedListeners = new Set<(source: SharedAudioInputName) => void>();
  const sourceMutedListeners = new Set<(
    source: SharedAudioInputName,
    muted: boolean
  ) => void>();
  const sourceTrackCleanups: Array<() => void> = [];
  let closed = false;

  // bindSourceTrack reports unexpected raw-input loss independently from the mixed output track.
  function bindSourceTrack(track: MediaStreamTrack | undefined, source: SharedAudioInputName) {
    if (!track) {
      return;
    }

    const listener = () => {
      if (closed || endedInputs.has(source)) {
        return;
      }

      endedInputs.add(source);
      sourceEndedListeners.forEach((notify) => notify(source));
    };

    track.addEventListener("ended", listener);
    sourceTrackCleanups.push(() => track.removeEventListener("ended", listener));
  }

  // bindSourceMuteTrack reports temporary loss and recovery for each raw audio input.
  function bindSourceMuteTrack(track: MediaStreamTrack | undefined, source: SharedAudioInputName) {
    if (!track) {
      return;
    }

    if (track.muted) {
      mutedInputs.add(source);
    }
    const onMute = () => {
      if (closed || mutedInputs.has(source)) {
        return;
      }

      mutedInputs.add(source);
      sourceMutedListeners.forEach((notify) => notify(source, true));
    };
    const onUnmute = () => {
      if (closed || !mutedInputs.delete(source)) {
        return;
      }

      sourceMutedListeners.forEach((notify) => notify(source, false));
    };

    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    sourceTrackCleanups.push(() => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
    });
  }

  const microphoneTrack = microphoneStream.getAudioTracks()[0];

  bindSourceTrack(microphoneTrack, "microphone");
  bindSourceMuteTrack(microphoneTrack, "microphone");
  if (captureMode === "microphone_and_tab") {
    const displayAudioTrack = displayStream?.getAudioTracks()[0];

    bindSourceTrack(displayAudioTrack, "shared_tab");
    bindSourceMuteTrack(displayAudioTrack, "shared_tab");
    bindSourceTrack(displayStream?.getTracks().find((track) => track.kind === "video"), "shared_tab");
  }

  // close releases each owned clone before releasing the physical master stream.
  function close() {
    if (closed) {
      return;
    }

    closed = true;
    sourceTrackCleanups.forEach((cleanup) => cleanup());
    sourceTrackCleanups.length = 0;
    sourceEndedListeners.clear();
    sourceMutedListeners.clear();
    [...leases.values()].forEach((lease) => lease.release());
    stopStreams([masterStream, microphoneStream, displayStream]);
    mixer?.close();
  }

  // onSourceEnded subscribes to raw microphone or shared-tab loss and replays an already-ended input.
  function onSourceEnded(listener: (source: SharedAudioInputName) => void) {
    if (closed) {
      return () => undefined;
    }

    sourceEndedListeners.add(listener);
    endedInputs.forEach((source) => listener(source));
    return () => sourceEndedListeners.delete(listener);
  }

  // onSourceMuted subscribes to raw input mute changes and replays currently muted inputs.
  function onSourceMuted(listener: (source: SharedAudioInputName, muted: boolean) => void) {
    if (closed) {
      return () => undefined;
    }

    sourceMutedListeners.add(listener);
    mutedInputs.forEach((source) => listener(source, true));
    return () => sourceMutedListeners.delete(listener);
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
    lease,
    onSourceEnded,
    onSourceMuted
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
