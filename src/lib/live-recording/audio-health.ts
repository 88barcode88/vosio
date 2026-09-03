export type LiveAudioTrackHealth = "healthy" | "muted" | "ended";
export type LiveAudioRecorderHealth = "healthy" | "error";
export type LiveAudioSignalHealth = "monitoring" | "near_zero" | "unavailable";

export type LiveAudioHealthSnapshot = {
  recorder: LiveAudioRecorderHealth;
  recorderError: string | null;
  signal: LiveAudioSignalHealth;
  track: LiveAudioTrackHealth;
};

export type LiveAudioHealthMonitor = {
  stop: () => void;
};

export type LiveAudioHealthNotice = {
  message: string;
  tone: "error" | "info" | "warning";
};

type LiveAudioHealthMonitorOptions = {
  createAudioContext?: (() => AudioContext) | null;
  nearZeroDurationMs?: number;
  nearZeroRmsThreshold?: number;
  onChange: (snapshot: LiveAudioHealthSnapshot) => void;
  recorder: MediaRecorder;
  sampleIntervalMs?: number;
  stream: MediaStream;
  track: MediaStreamTrack;
};

const DEFAULT_SAMPLE_INTERVAL_MS = 250;
const DEFAULT_NEAR_ZERO_DURATION_MS = 5_000;
const DEFAULT_NEAR_ZERO_RMS_THRESHOLD = 0.003;

// getLiveAudioHealthNotice maps independent health dimensions to the highest-priority user notice.
export function getLiveAudioHealthNotice(
  snapshot: LiveAudioHealthSnapshot | null
): LiveAudioHealthNotice | null {
  if (!snapshot) {
    return null;
  }

  if (snapshot.recorder === "error") {
    return {
      message: "Ukládání audia selhalo. Live přepis může pokračovat, ale audio soubor nemusí být použitelný.",
      tone: "error"
    };
  }

  if (snapshot.track === "ended") {
    return {
      message: "Audio stopa skončila. Live přepis může pokračovat, ale další zvuk se nemusí uložit.",
      tone: "error"
    };
  }

  if (snapshot.track === "muted") {
    return {
      message: "Mikrofonní stopa je ztlumená. Po obnovení mikrofonu varování zmizí.",
      tone: "warning"
    };
  }

  if (snapshot.signal === "near_zero") {
    return {
      message: "Mikrofon delší dobu vrací téměř nulový signál. Zkontrolujte zařízení; nahrávání pokračuje.",
      tone: "warning"
    };
  }

  if (snapshot.signal === "unavailable") {
    return {
      message: "Kontrola úrovně zvuku není dostupná. Nahrávání pokračuje podle stavu audio stopy a rekordéru.",
      tone: "info"
    };
  }

  return null;
}

// getDefaultAudioContextFactory resolves browser Web Audio without treating absence as silence.
function getDefaultAudioContextFactory(): (() => AudioContext) | null {
  const browserGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextConstructor = browserGlobal.AudioContext ?? browserGlobal.webkitAudioContext;

  return AudioContextConstructor ? () => new AudioContextConstructor() : null;
}

// getRecorderErrorMessage converts browser-specific recorder error events into safe local health text.
function getRecorderErrorMessage(event: Event) {
  const error = (event as Event & { error?: unknown }).error;

  return error instanceof Error && error.message
    ? error.message
    : "MediaRecorder error";
}

// createLiveAudioHealthMonitor observes archive ownership and advisory signal health independently.
export function createLiveAudioHealthMonitor({
  createAudioContext = getDefaultAudioContextFactory(),
  nearZeroDurationMs = DEFAULT_NEAR_ZERO_DURATION_MS,
  nearZeroRmsThreshold = DEFAULT_NEAR_ZERO_RMS_THRESHOLD,
  onChange,
  recorder,
  sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS,
  stream,
  track
}: LiveAudioHealthMonitorOptions): LiveAudioHealthMonitor {
  let snapshot: LiveAudioHealthSnapshot = {
    recorder: "healthy",
    recorderError: null,
    signal: "unavailable",
    track: track.readyState === "ended" ? "ended" : track.muted ? "muted" : "healthy"
  };
  let stopped = false;
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let sampleTimer: ReturnType<typeof setInterval> | null = null;
  let nearZeroStartedAt: number | null = null;

  // publish emits immutable state only when at least one health dimension changed.
  function publish(change: Partial<LiveAudioHealthSnapshot>) {
    if (stopped) {
      return;
    }

    const next = { ...snapshot, ...change };

    if (
      next.recorder === snapshot.recorder
      && next.recorderError === snapshot.recorderError
      && next.signal === snapshot.signal
      && next.track === snapshot.track
    ) {
      return;
    }

    snapshot = next;
    onChange({ ...snapshot });
  }

  // stopSampling prevents suspended or unavailable Web Audio from accumulating false silence time.
  function stopSampling() {
    if (sampleTimer !== null) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }

    nearZeroStartedAt = null;
  }

  // sampleSignal classifies sustained near-zero RMS as advisory while allowing immediate recovery.
  function sampleSignal() {
    if (!analyser || context?.state !== "running") {
      stopSampling();
      publish({ signal: "unavailable" });
      return;
    }

    const frame = new Float32Array(analyser.fftSize);

    analyser.getFloatTimeDomainData(frame);
    const squareSum = frame.reduce((sum, value) => sum + value * value, 0);
    const rms = Math.sqrt(squareSum / Math.max(frame.length, 1));

    if (rms > nearZeroRmsThreshold) {
      nearZeroStartedAt = null;
      publish({ signal: "monitoring" });
      return;
    }

    const now = Date.now();

    nearZeroStartedAt ??= now;
    if (now - nearZeroStartedAt >= nearZeroDurationMs) {
      publish({ signal: "near_zero" });
    }
  }

  // startSampling begins advisory checks only while Web Audio is actually running.
  function startSampling() {
    stopSampling();
    if (!context || context.state !== "running") {
      publish({ signal: "unavailable" });
      return;
    }

    publish({ signal: "monitoring" });
    sampleTimer = setInterval(sampleSignal, sampleIntervalMs);
  }

  const onMute = () => publish({ track: "muted" });
  const onUnmute = () => publish({ track: "healthy" });
  const onEnded = () => publish({ track: "ended" });
  const onRecorderError = (event: Event) => publish({
    recorder: "error",
    recorderError: getRecorderErrorMessage(event)
  });
  const onContextStateChange = () => startSampling();

  track.addEventListener("mute", onMute);
  track.addEventListener("unmute", onUnmute);
  track.addEventListener("ended", onEnded);
  recorder.addEventListener("error", onRecorderError);
  onChange({ ...snapshot });

  if (createAudioContext) {
    try {
      context = createAudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      context.addEventListener("statechange", onContextStateChange);
      startSampling();
    } catch {
      context = null;
      analyser = null;
      source = null;
      publish({ signal: "unavailable" });
    }
  }

  return {
    // stop detaches health observers without stopping any capture track or recorder.
    stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      stopSampling();
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      track.removeEventListener("ended", onEnded);
      recorder.removeEventListener("error", onRecorderError);
      context?.removeEventListener("statechange", onContextStateChange);
      source?.disconnect();
      analyser?.disconnect();
      void context?.close().catch(() => undefined);
      context = null;
      analyser = null;
      source = null;
    }
  };
}
