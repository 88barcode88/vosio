"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import type { FormEvent } from "react";
import { Pause, Play } from "lucide-react";
import { createPlaybackController } from "@/components/transcript-tabs/playback-controller";
import type { RecordingClientView } from "@/lib/recordings/client-view";

export type RecordingAudioPlayerHandle = {
  seekToMs: (startMs: number, options?: { play?: boolean }) => Promise<void>;
};

type AudioSourceResponse = {
  expiresIn: number;
  mimeType: string;
  url: string;
};

// parseAudioSourceResponse validates the narrow browser-facing signed URL contract.
function parseAudioSourceResponse(value: unknown): AudioSourceResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AudioSourceResponse>;

  if (
    typeof candidate.expiresIn !== "number" ||
    !Number.isFinite(candidate.expiresIn) ||
    candidate.expiresIn <= 0 ||
    typeof candidate.mimeType !== "string" ||
    !candidate.mimeType ||
    candidate.mimeType !== candidate.mimeType.trim() ||
    typeof candidate.url !== "string" ||
    !candidate.url ||
    candidate.url !== candidate.url.trim()
  ) {
    return null;
  }

  try {
    const parsedUrl = new URL(candidate.url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  return candidate as AudioSourceResponse;
}

// cleanupMediaElement stops playback and detaches the previous private media source.
function cleanupMediaElement(
  audio: HTMLAudioElement | null,
  playbackController: ReturnType<typeof createPlaybackController>
) {
  playbackController.reset();

  if (!audio) {
    return;
  }

  try {
    audio.pause();
  } catch {
    // A partially detached media element may reject control calls; source cleanup must continue.
  }
  audio.removeAttribute("src");
  try {
    audio.load();
  } catch {
    // The source is already detached, so a browser-specific load failure is safe to ignore.
  }
}

// RecordingAudioPlayer owns one persistent private source and exposes seek-only imperative control.
export const RecordingAudioPlayer = forwardRef<
  RecordingAudioPlayerHandle,
  { activeRecording: RecordingClientView | null }
>(function RecordingAudioPlayer({ activeRecording }, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const playbackGenerationRef = useRef(0);
  const requestVersionRef = useRef(0);
  const retryUsedRef = useRef(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const playbackController = useMemo(
    () => createPlaybackController(() => audioRef.current),
    []
  );
  const recordingId = activeRecording?.audioAvailability === "single"
    ? activeRecording.id
    : null;

  // requestSignedUrl loads one private source and ignores responses superseded by a newer request.
  const requestSignedUrl = useCallback(async (targetRecordingId: string) => {
    fetchAbortRef.current?.abort();
    const abortController = new AbortController();
    fetchAbortRef.current = abortController;
    const requestVersion = ++requestVersionRef.current;
    setMessage("Načítám audio…");

    try {
      const response = await fetch(`/api/recordings/${targetRecordingId}/audio`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: abortController.signal
      });
      const payload: unknown = await response.json().catch(() => null);
      const source = response.ok ? parseAudioSourceResponse(payload) : null;

      if (requestVersion !== requestVersionRef.current) {
        return;
      }

      if (!source) {
        setAudioUrl(null);
        setMessage("Audio se nepodařilo načíst.");
        return;
      }

      setAudioUrl(source.url);
      setMessage(null);
    } catch {
      if (
        requestVersion === requestVersionRef.current &&
        !abortController.signal.aborted
      ) {
        setAudioUrl(null);
        setMessage("Audio se nepodařilo načíst.");
      }
    } finally {
      if (fetchAbortRef.current === abortController) {
        fetchAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    playbackGenerationRef.current += 1;
    requestVersionRef.current += 1;
    retryUsedRef.current = false;
    playbackController.reset();
    setAudioUrl(null);
    setCurrentSeconds(0);
    setDurationSeconds(0);
    setIsPlaying(false);
    setMessage(null);

    if (recordingId) {
      void requestSignedUrl(recordingId);
    }

    const activeAudio = audioRef.current;

    return () => {
      playbackGenerationRef.current += 1;
      requestVersionRef.current += 1;
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
      cleanupMediaElement(activeAudio, playbackController);
    };
  }, [playbackController, recordingId, requestSignedUrl]);

  // reportPlaybackFailure updates only the recording generation that started the play attempt.
  function reportPlaybackFailure(playbackGeneration: number) {
    if (playbackGeneration === playbackGenerationRef.current) {
      setMessage("Přehrávání se nepodařilo spustit.");
    }
  }

  useImperativeHandle(ref, () => ({
    // seekToMs delegates explicit user navigation to the metadata-aware controller.
    async seekToMs(startMs, options) {
      const playbackGeneration = playbackGenerationRef.current;

      try {
        await playbackController.seekToMs(startMs, options);
      } catch {
        reportPlaybackFailure(playbackGeneration);
        throw new Error("Audio playback failed.");
      }
    }
  }), [playbackController]);

  // handleLoadedMetadata flushes a queued seek without inventing a play request.
  function handleLoadedMetadata() {
    const playbackGeneration = playbackGenerationRef.current;
    const audio = audioRef.current;

    if (audio) {
      setDurationSeconds(Number.isFinite(audio.duration) ? Math.max(0, audio.duration) : 0);
      setCurrentSeconds(Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0);
    }

    void playbackController.flushPendingSeek().catch(() => {
      reportPlaybackFailure(playbackGeneration);
    });
  }

  // togglePlayback changes playback only from the explicit play/pause control.
  async function togglePlayback() {
    const audio = audioRef.current;

    if (!audio || !audioUrl) {
      return;
    }

    if (!audio.paused) {
      audio.pause();
      return;
    }

    const playbackGeneration = playbackGenerationRef.current;

    try {
      await audio.play();
    } catch {
      reportPlaybackFailure(playbackGeneration);
    }
  }

  // handleProgressInput applies every pointer or keyboard seek without changing play state.
  function handleProgressInput(event: FormEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    const requestedSeconds = Number(event.currentTarget.value);

    if (!audio || !Number.isFinite(requestedSeconds)) {
      return;
    }

    const nextSeconds = clampPlayerSeconds(requestedSeconds, durationSeconds);
    audio.currentTime = nextSeconds;
    setCurrentSeconds(nextSeconds);
  }

  const displayedDuration = durationSeconds > 0
    ? durationSeconds
    : Math.max(0, activeRecording?.duration_seconds ?? 0);

  // handleAudioError refreshes an expired private URL at most once per recording.
  function handleAudioError() {
    if (!recordingId || retryUsedRef.current) {
      setMessage("Audio se nepodařilo přehrát.");
      return;
    }

    retryUsedRef.current = true;
    playbackGenerationRef.current += 1;
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    cleanupMediaElement(audioRef.current, playbackController);
    setAudioUrl(null);
    void requestSignedUrl(recordingId);
  }

  if (!recordingId) {
    return null;
  }

  return (
    <section className="recording-audio-player" aria-label="Přehrávač nahrávky">
      <button
        aria-label={isPlaying ? "Pozastavit nahrávku" : "Přehrát nahrávku"}
        className="recording-audio-toggle"
        disabled={!audioUrl}
        onClick={togglePlayback}
        type="button"
      >
        {isPlaying ? <Pause aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
      </button>
      <div className="recording-audio-copy">
        <strong>{activeRecording?.title ?? "Nahrávka"}</strong>
        <span>{formatPlaybackTime(currentSeconds)} / {formatPlaybackTime(displayedDuration)}</span>
      </div>
      <label className="recording-audio-progress">
        <span className="visually-hidden">Pozice přehrávání</span>
        <input
          aria-valuemax={durationSeconds}
          aria-valuemin={0}
          aria-valuenow={currentSeconds}
          aria-valuetext={`${formatPlaybackTime(currentSeconds)} z ${formatPlaybackTime(displayedDuration)}`}
          disabled={!audioUrl || durationSeconds <= 0}
          max={durationSeconds || 1}
          min="0"
          onChange={handleProgressInput}
          onInput={handleProgressInput}
          step="0.01"
          type="range"
          value={Math.min(currentSeconds, durationSeconds || 1)}
        />
      </label>
      <audio
        aria-label={`Audio: ${activeRecording?.title ?? "nahrávka"}`}
        className="recording-audio-element"
        onDurationChange={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        onError={handleAudioError}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={() => setIsPlaying(false)}
        onPlay={() => {
          setIsPlaying(true);
          setMessage(null);
        }}
        onTimeUpdate={(event) => setCurrentSeconds(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
        src={audioUrl ?? undefined}
      />
      <p
        aria-atomic="true"
        aria-live="polite"
        className="recording-audio-player-status"
        role="status"
      >
        {message ?? ""}
      </p>
    </section>
  );
});

// clampPlayerSeconds keeps native range input values inside the current media duration.
function clampPlayerSeconds(seconds: number, duration: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  return duration > 0 ? Math.min(safeSeconds, duration) : safeSeconds;
}

// formatPlaybackTime renders stable tabular player time without locale-dependent hydration output.
function formatPlaybackTime(seconds: number) {
  const totalSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
