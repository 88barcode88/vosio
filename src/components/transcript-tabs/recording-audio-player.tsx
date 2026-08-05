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

    void playbackController.flushPendingSeek().catch(() => {
      reportPlaybackFailure(playbackGeneration);
    });
  }

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
      <audio
        aria-label={`Audio: ${activeRecording?.title ?? "nahrávka"}`}
        controls
        onError={handleAudioError}
        onLoadedMetadata={handleLoadedMetadata}
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
