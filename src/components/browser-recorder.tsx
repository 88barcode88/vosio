"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flag, Mic, Square } from "lucide-react";
import { useRecordingNavigationBlocker } from "@/components/recording-navigation-guard";
import {
  LIVE_RECORDING_AUDIO_BITS_PER_SECOND,
  formatFileSize
} from "@/lib/recordings/types";
import {
  getLiveAudioDiscardEstimateBytes,
  isLiveAudioBlobWithinLimit
} from "@/lib/recordings/live-audio-limit";
import {
  BrowserPermissionResolver,
  SonioxClient,
  type RealtimeToken,
  type Recording
} from "@soniox/client";
import {
  formatElapsedTime,
  getLiveRecordingTitle,
  getLiveAudioFallbackMessage,
  getRecordedFileExtension,
  getRecordingActiveMessage,
  getRealtimeRecordingOptions,
  getRealtimeConfigErrorMessage,
  getRealtimeErrorMessage,
  getRecorderFeedbackAnnouncement,
  getRealtimeStateWarning,
  getRecordingStartErrorMessage,
  getSaveModeLabel,
  getStableLiveCaptionTokens,
  getSupportedMimeType,
  getTokenKey,
  getWakeLockWarning,
  shouldDiscardLiveRecordingAudio,
  stopRealtimeRecording,
  tokensToCaptionBlocks,
  tokensToText,
  type RecorderFeedbackTone
} from "@/components/browser-recorder/helpers";
import { assertDevelopmentRecordingFactoryAllowed } from "@/components/browser-recorder/development-runtime";
import type {
  BrowserRecorderProps,
  LiveCaptionBlock,
  LiveMarkerAttempt,
  LiveMarkerFeedback,
  LiveSaveMode,
  RealtimeConfig,
  RealtimeConfigErrorCode,
  RecorderStatus
} from "@/components/browser-recorder/types";
import {
  getLiveMarkerOffsetMs,
  isLiveMarkerSaveResponse
} from "@/lib/recording-markers/live-marker";
import {
  completeLiveRecordingWithoutAudio,
  completeLiveRecordingUpload,
  createLiveRecordingDraft,
  failLiveRecordingUpload,
  uploadLiveRecording,
  type LiveRecordingDraft
} from "@/lib/recordings/upload";
import { LIVE_RECORDING_AUTOSAVE_INTERVAL_MS } from "@/lib/live-recording/recovery";
import { createClient } from "@/lib/supabase/browser";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE,
  addTranscriptSearchIndexWarningToPath,
  hasTranscriptSearchIndexWarning
} from "@/lib/transcripts/search-warning";
import {
  sonioxRealtimeLanguageOptions,
  type SonioxRealtimeLanguageId
} from "@/lib/soniox/languages";

type WakeLockSentinelLike = {
  addEventListener: (type: "release", listener: () => void, options?: AddEventListenerOptions) => void;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

type RecorderFeedback = {
  message: string;
  tone: RecorderFeedbackTone;
};

type RecorderLifecyclePhase = RecorderStatus | "unmounted";

type PendingLiveDraftSession = {
  cleanupScheduled: boolean;
  promise: Promise<LiveRecordingDraft>;
  recording: Recording;
  sessionGeneration: number;
};

type PendingLiveDraftSettlement =
  | { draft: LiveRecordingDraft; kind: "adopted" }
  | { kind: "missing" | "rejected" | "stale" }
  | { kind: "timed_out"; pending: PendingLiveDraftSession };

type SonioxResultSession = {
  recording: Recording;
  sessionGeneration: number;
};

type RecorderStopOwner = {
  recording: Recording | null;
  stopGeneration: number;
};

const LIVE_DRAFT_STOP_WAIT_MS = 5_000;

// BrowserRecorder captures microphone audio and can save audio plus transcript or transcript text only.
export function BrowserRecorder({
  allowTranscriptOnly = false,
  captionMode = false,
  compact = false,
  developmentRecordingFactory,
  maxAudioFileSizeBytes,
  onStatusChange,
  realtimeLanguage = "auto",
  redirectAfterSave,
  realtimeModel = "stt-rt-v5"
}: BrowserRecorderProps) {
  assertDevelopmentRecordingFactoryAllowed(developmentRecordingFactory);
  const router = useRouter();
  const { registerNavigationBlocker } = useRecordingNavigationBlocker();
  const elapsedSecondsRef = useRef(0);
  const audioDiscardedForSizeRef = useRef(false);
  const audioDiscardPromiseRef = useRef<Promise<void> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStartedAtRef = useRef<number | null>(null);
  const liveRecordingContentTypeRef = useRef("audio/webm");
  const liveRecordingDraftRef = useRef<LiveRecordingDraft | null>(null);
  const liveRecordingStartedAtMsRef = useRef<number | null>(null);
  const liveCaptureActiveRef = useRef(false);
  const liveMarkerAttemptRef = useRef<LiveMarkerAttempt | null>(null);
  const liveMarkerRequestInFlightRef = useRef(false);
  const liveMarkerSessionGenerationRef = useRef(0);
  const recordingSessionGenerationRef = useRef(0);
  const recorderLifecyclePhaseRef = useRef<RecorderLifecyclePhase>("idle");
  const pendingLiveDraftSessionRef = useRef<PendingLiveDraftSession | null>(null);
  const sonioxResultSessionRef = useRef<SonioxResultSession | null>(null);
  const recorderStopOwnerRef = useRef<RecorderStopOwner | null>(null);
  const draftAutosaveInFlightRef = useRef(false);
  const lastDraftAutosaveAtRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sonioxRecordingRef = useRef<Recording | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const tokenArrivalTimesRef = useRef<Map<string, number>>(new Map());
  const tokensRef = useRef<Map<string, RealtimeToken>>(new Map());
  const isMountedRef = useRef(true);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockRequestRef = useRef<Promise<boolean> | null>(null);
  const wakeLockRequestGenerationRef = useRef(0);
  const [audioLimitReached, setAudioLimitReached] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveCaptionBlocks, setLiveCaptionBlocks] = useState<LiveCaptionBlock[]>([]);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveMarkerFeedback, setLiveMarkerFeedback] = useState<LiveMarkerFeedback | null>(null);
  const [liveMarkerPending, setLiveMarkerPending] = useState(false);
  const [savedLiveMarkerCount, setSavedLiveMarkerCount] = useState(0);
  const [markerReady, setMarkerReady] = useState(false);
  const [feedback, setFeedback] = useState<RecorderFeedback | null>(null);
  const [realtimeWarning, setRealtimeWarning] = useState<string | null>(null);
  const [selectedRealtimeLanguage, setSelectedRealtimeLanguage] = useState<SonioxRealtimeLanguageId>(realtimeLanguage);
  const [saveMode, setSaveMode] = useState<LiveSaveMode>(
    maxAudioFileSizeBytes === null && allowTranscriptOnly
      ? "transcript_only"
      : "audio_and_transcript"
  );
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [wakeLockWarning, setWakeLockWarning] = useState<string | null>(null);

  // syncSelectedRealtimeLanguage refreshes the per-call choice when the persisted default changes between sessions.
  useEffect(() => {
    if (status === "idle") {
      setSelectedRealtimeLanguage(realtimeLanguage);
    }
  }, [realtimeLanguage, status]);

  // setRecorderFeedback keeps ordinary capture state separate from assertive errors and provider warnings.
  function setRecorderFeedback(message: string, tone: RecorderFeedbackTone = "status") {
    setFeedback({ message, tone });
  }

  // setRecorderPhase synchronizes render state with the callback-safe lifecycle phase.
  function setRecorderPhase(nextPhase: RecorderStatus) {
    recorderLifecyclePhaseRef.current = nextPhase;
    setStatus(nextPhase);
  }

  // isCurrentSonioxSession rejects callbacks from stale, stopped, or unmounted capture sessions.
  function isCurrentSonioxSession(recording: Recording, sessionGeneration: number) {
    const phase = recorderLifecyclePhaseRef.current;

    return isMountedRef.current
      && recording === sonioxRecordingRef.current
      && sessionGeneration === recordingSessionGenerationRef.current
      && (phase === "starting" || phase === "recording");
  }

  // acceptsSonioxResult keeps final stop-time transcript data scoped to its exact provider session.
  function acceptsSonioxResult(recording: Recording, sessionGeneration: number) {
    const session = sonioxResultSessionRef.current;

    return isMountedRef.current
      && session?.recording === recording
      && session.sessionGeneration === sessionGeneration;
  }

  // closeSonioxResultSession stops data acceptance without touching a newer provider session.
  function closeSonioxResultSession(recording: Recording, sessionGeneration: number) {
    const session = sonioxResultSessionRef.current;

    if (
      session?.recording === recording
      && session.sessionGeneration === sessionGeneration
    ) {
      sonioxResultSessionRef.current = null;
    }
  }

  // failLateLiveDraft marks only the abandoned row owned by an expired pending session.
  function failLateLiveDraft(pending: PendingLiveDraftSession) {
    if (pending.cleanupScheduled) {
      return;
    }

    pending.cleanupScheduled = true;
    void pending.promise
      .then((draft) => failLiveRecordingUpload({
        message: "Příprava záznamu nebyla dokončena před ukončením nahrávání.",
        recording: draft
      }))
      .catch(() => undefined);
  }

  // completeLateTranscriptDraft finalizes one timed-out draft from an immutable stop snapshot.
  function completeLateTranscriptDraft(
    pending: PendingLiveDraftSession,
    snapshot: {
      durationSeconds: number;
      rawText: string;
      tokens: RealtimeToken[];
    }
  ) {
    if (pending.cleanupScheduled) {
      return;
    }

    pending.cleanupScheduled = true;
    void pending.promise
      .then(async (draft) => {
        try {
          await completeLiveRecordingWithoutAudio({
            durationSeconds: snapshot.durationSeconds,
            recording: draft
          });
          await saveLiveTranscript(draft.id, snapshot.rawText, snapshot.tokens, "transcript_only");
        } catch (error) {
          await failLiveRecordingUpload({
            message: error instanceof Error
              ? error.message
              : "Pozdní live přepis se nepodařilo dokončit.",
            recording: draft
          });
        }
      })
      .catch(() => undefined);
  }

  // adoptPendingLiveDraftForStop waits briefly for this session's draft, then isolates late cleanup.
  async function adoptPendingLiveDraftForStop({
    recording,
    sessionGeneration,
    stopGeneration
  }: {
    recording: Recording;
    sessionGeneration: number;
    stopGeneration: number;
  }): Promise<PendingLiveDraftSettlement> {
    if (!stillOwnsStop(recording, stopGeneration)) {
      return { kind: "stale" };
    }

    if (liveRecordingDraftRef.current) {
      return { draft: liveRecordingDraftRef.current, kind: "adopted" };
    }

    const pending = pendingLiveDraftSessionRef.current;

    if (
      !pending
      || pending.recording !== recording
      || pending.sessionGeneration !== sessionGeneration
    ) {
      return { kind: "missing" };
    }

    let timeoutId: number | null = null;
    const outcome = await Promise.race([
      pending.promise.then(
        (draft) => ({ draft, kind: "resolved" as const }),
        () => ({ kind: "rejected" as const })
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutId = window.setTimeout(() => resolve({ kind: "timeout" }), LIVE_DRAFT_STOP_WAIT_MS);
      })
    ]);

    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }

    if (pendingLiveDraftSessionRef.current === pending) {
      pendingLiveDraftSessionRef.current = null;
    }

    if (!stillOwnsStop(recording, stopGeneration)) {
      failLateLiveDraft(pending);
      return { kind: "stale" };
    }

    if (outcome.kind === "timeout") {
      return { kind: "timed_out", pending };
    }

    if (outcome.kind === "rejected") {
      return { kind: "rejected" };
    }

    liveRecordingDraftRef.current = outcome.draft;
    return { draft: outcome.draft, kind: "adopted" };
  }

  // establishLiveMarkerClock starts one monotonic marker clock only after capture and draft are both ready.
  function establishLiveMarkerClock(recording: Recording, sessionGeneration: number) {
    if (
      !isCurrentSonioxSession(recording, sessionGeneration)
      || liveRecordingStartedAtMsRef.current !== null
      || !liveCaptureActiveRef.current
      || !liveRecordingDraftRef.current
    ) {
      return;
    }

    liveRecordingStartedAtMsRef.current = performance.now();
    setMarkerReady(true);
  }

  // resetLiveMarkerSession clears marker timing only when a recorder session fully ends or restarts.
  function resetLiveMarkerSession() {
    liveMarkerSessionGenerationRef.current += 1;
    liveCaptureActiveRef.current = false;
    liveMarkerAttemptRef.current = null;
    liveMarkerRequestInFlightRef.current = false;
    liveRecordingStartedAtMsRef.current = null;
    setLiveMarkerFeedback(null);
    setLiveMarkerPending(false);
    setSavedLiveMarkerCount(0);
    setMarkerReady(false);
  }

  // beginRecorderStop synchronously invalidates provider callbacks and marker work before saving.
  function beginRecorderStop(recording: Recording | null) {
    const stopGeneration = recordingSessionGenerationRef.current + 1;

    recordingSessionGenerationRef.current = stopGeneration;
    recorderStopOwnerRef.current = { recording, stopGeneration };
    setRecorderPhase("saving");
    resetLiveMarkerSession();
    return stopGeneration;
  }

  // stillOwnsStop prevents stale or unmounted stop work from touching a newer recorder session.
  function stillOwnsStop(recording: Recording | null, stopGeneration: number) {
    const owner = recorderStopOwnerRef.current;

    return isMountedRef.current
      && owner?.recording === recording
      && owner.stopGeneration === stopGeneration
      && sonioxRecordingRef.current === recording
      && recordingSessionGenerationRef.current === stopGeneration
      && recorderLifecyclePhaseRef.current === "saving";
  }

  // markImportantMoment persists one retry-safe marker without touching capture lifecycle state.
  async function markImportantMoment() {
    if (liveMarkerRequestInFlightRef.current) {
      return;
    }

    const recording = liveRecordingDraftRef.current;
    const startedAtMs = liveRecordingStartedAtMsRef.current;

    if (
      recorderLifecyclePhaseRef.current !== "recording"
      || !liveCaptureActiveRef.current
      || !recording
      || startedAtMs === null
    ) {
      return;
    }

    let attempt = liveMarkerAttemptRef.current;

    if (!attempt) {
      attempt = {
        clientMarkerId: crypto.randomUUID(),
        markerType: "important",
        note: null,
        offsetMs: getLiveMarkerOffsetMs({
          nowMs: performance.now(),
          startedAtMs
        })
      };
      liveMarkerAttemptRef.current = attempt;
    }

    const sessionGeneration = liveMarkerSessionGenerationRef.current;
    const timestamp = formatElapsedTime(Math.floor(attempt.offsetMs / 1000));
    liveMarkerRequestInFlightRef.current = true;
    setLiveMarkerPending(true);
    setLiveMarkerFeedback({
      message: `Ukládám důležitý moment ${timestamp}...`,
      offsetMs: attempt.offsetMs,
      tone: "working"
    });

    try {
      const response = await fetch(`/api/recordings/${recording.id}/markers`, {
        body: JSON.stringify(attempt),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("Marker request failed");
      }

      const payload = await response.json();

      if (!isLiveMarkerSaveResponse(payload, { attempt, recordingId: recording.id })) {
        throw new Error("Marker response is invalid");
      }

      if (
        !isMountedRef.current
        || liveMarkerSessionGenerationRef.current !== sessionGeneration
      ) {
        return;
      }

      liveMarkerAttemptRef.current = null;
      setSavedLiveMarkerCount((count) => count + 1);
      setLiveMarkerFeedback({
        message: `Důležitý moment ${timestamp} je uložený.`,
        offsetMs: attempt.offsetMs,
        tone: "status"
      });
    } catch {
      if (
        isMountedRef.current
        && liveMarkerSessionGenerationRef.current === sessionGeneration
      ) {
        setLiveMarkerFeedback({
          message: `Moment ${timestamp} se nepodařilo uložit. Zkuste to znovu.`,
          offsetMs: attempt.offsetMs,
          tone: "error"
        });
      }
    } finally {
      if (
        isMountedRef.current
        && liveMarkerSessionGenerationRef.current === sessionGeneration
      ) {
        liveMarkerRequestInFlightRef.current = false;
        setLiveMarkerPending(false);
      }
    }
  }

  useEffect(() => {
    if (status === "idle") {
      return;
    }

    return registerNavigationBlocker({ blockInternalNavigation: false });
  }, [registerNavigationBlocker, status]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  // stopTimer clears the live recording timer interval.
  function stopTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // cleanupStream releases microphone tracks after recording stops.
  function cleanupStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // invalidateWakeLockRequest makes any in-flight browser Wake Lock request stale for this recorder session.
  const invalidateWakeLockRequest = useCallback(() => {
    wakeLockRequestGenerationRef.current += 1;
    wakeLockRequestRef.current = null;
  }, []);

  // releaseWakeLock gives back the screen lock when recording stops or unmounts.
  async function releaseWakeLock() {
    const wakeLock = wakeLockRef.current;

    invalidateWakeLockRequest();
    wakeLockRef.current = null;

    if (!wakeLock) {
      return;
    }

    await wakeLock.release().catch(() => undefined);
  }

  // requestWakeLock asks the browser to keep the screen awake during active capture.
  const requestWakeLock = useCallback(async (): Promise<boolean> => {
    const wakeLockApi = (navigator as WakeLockNavigator).wakeLock;

    if (wakeLockRef.current) {
      if (isMountedRef.current) {
        setWakeLockWarning(getWakeLockWarning(true));
      }
      return true;
    }

    if (wakeLockRequestRef.current) {
      return wakeLockRequestRef.current;
    }

    if (!wakeLockApi) {
      if (isMountedRef.current) {
        setWakeLockWarning(getWakeLockWarning(false));
      }
      return false;
    }

    const requestGeneration = wakeLockRequestGenerationRef.current;
    const request = Promise.resolve().then(async () => {
      try {
        const wakeLock = await wakeLockApi.request("screen");

        if (
          !isMountedRef.current ||
          wakeLockRequestGenerationRef.current !== requestGeneration
        ) {
          await wakeLock.release().catch(() => undefined);
          return false;
        }

        wakeLock.addEventListener(
          "release",
          () => {
            if (wakeLockRef.current !== wakeLock) {
              return;
            }

            wakeLockRef.current = null;
            invalidateWakeLockRequest();

            if (isMountedRef.current) {
              setWakeLockWarning(getWakeLockWarning(false));
            }
          },
          { once: true }
        );
        wakeLockRef.current = wakeLock;

        if (isMountedRef.current) {
          setWakeLockWarning(getWakeLockWarning(true));
        }

        return true;
      } catch {
        if (
          isMountedRef.current &&
          wakeLockRequestGenerationRef.current === requestGeneration
        ) {
          setWakeLockWarning(getWakeLockWarning(false));
        }

        return false;
      } finally {
        if (wakeLockRequestRef.current === request) {
          wakeLockRequestRef.current = null;
        }
      }
    });

    wakeLockRequestRef.current = request;
    return request;
  }, [invalidateWakeLockRequest]);

  useEffect(() => {
    // cleanupRecorder releases microphone and realtime resources when capture UI unmounts.
    function cleanupRecorder() {
      isMountedRef.current = false;
      recorderLifecyclePhaseRef.current = "unmounted";
      recordingSessionGenerationRef.current += 1;
      recorderStopOwnerRef.current = null;
      liveMarkerSessionGenerationRef.current += 1;
      liveCaptureActiveRef.current = false;
      liveMarkerAttemptRef.current = null;
      liveMarkerRequestInFlightRef.current = false;
      liveRecordingStartedAtMsRef.current = null;
      sonioxResultSessionRef.current = null;
      const pendingDraft = pendingLiveDraftSessionRef.current;

      pendingLiveDraftSessionRef.current = null;
      if (pendingDraft) {
        failLateLiveDraft(pendingDraft);
      }

      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }

      const recording = sonioxRecordingRef.current;

      sonioxRecordingRef.current = null;
      recording?.cancel();

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const wakeLock = wakeLockRef.current;

      invalidateWakeLockRequest();
      wakeLockRef.current = null;
      void wakeLock?.release().catch(() => undefined);
    }

    isMountedRef.current = true;
    return cleanupRecorder;
  }, [invalidateWakeLockRequest]);

  useEffect(() => {
    // handleVisibilityChange keeps the recording session alive after browser lifecycle changes.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && status === "recording") {
        void requestWakeLock();
        sonioxRecordingRef.current?.reconnect();
        return;
      }

    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [requestWakeLock, status]);

  // fetchRealtimeConfig retrieves a short-lived browser-safe Soniox websocket key.
  async function fetchRealtimeConfig(): Promise<RealtimeConfig> {
    const response = await fetch("/api/soniox/realtime-key", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as
      | (RealtimeConfig & { code?: RealtimeConfigErrorCode; error?: string })
      | null;

    if (!response.ok || !payload?.api_key) {
      throw new Error(getRealtimeConfigErrorMessage(payload?.code));
    }

    return {
      api_key: payload.api_key,
      region: payload.region,
      stt_ws_url: payload.stt_ws_url
    };
  }

  // resetLiveDraftRefs clears transient autosave state between recording sessions.
  function resetLiveDraftRefs() {
    draftAutosaveInFlightRef.current = false;
    lastDraftAutosaveAtRef.current = 0;
  }

  // updateDisplayedLiveCaptions renders delayed caption blocks while keeping the saved transcript complete.
  function updateDisplayedLiveCaptions(nowMs: number) {
    const tokens = [...tokensRef.current.entries()].map(([key, token]) => ({
      ...token,
      received_at_ms: tokenArrivalTimesRef.current.get(key)
    }));

    setLiveCaptionBlocks(tokensToCaptionBlocks(getStableLiveCaptionTokens(tokens, nowMs)));
  }

  // createLocalAudioRecorder builds the single MediaRecorder used for a bounded live audio file.
  function createLocalAudioRecorder(stream: MediaStream) {
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, {
      audioBitsPerSecond: LIVE_RECORDING_AUDIO_BITS_PER_SECOND,
      ...(mimeType ? { mimeType } : {})
    });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current = [...audioChunksRef.current, event.data];
      }
    };

    return recorder;
  }

  // startLocalAudioRecording starts one local audio file for the live session.
  function startLocalAudioRecording() {
    const stream = streamRef.current;

    if (!stream) {
      throw new Error("Mikrofon není připravený pro lokální nahrávání.");
    }

    const recorder = createLocalAudioRecorder(stream);

    audioChunksRef.current = [];
    audioStartedAtRef.current = Date.now();
    mediaRecorderRef.current = recorder;
    recorder.start();
  }

  // getCurrentAudioAgeSeconds returns how long the local audio file has been recording.
  function getCurrentAudioAgeSeconds() {
    if (!audioStartedAtRef.current) {
      return 0;
    }

    return Math.floor((Date.now() - audioStartedAtRef.current) / 1000);
  }

  // discardLocalAudioAfterLimit stops buffering audio while the realtime transcript keeps running.
  async function discardLocalAudioAfterLimit() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording" || audioDiscardedForSizeRef.current) {
      return;
    }

    audioDiscardedForSizeRef.current = true;
    const discard = (async () => {
      try {
        const stopped = new Promise<void>((resolve) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
        });

        recorder.stop();
        await stopped;
        audioChunksRef.current = [];
        audioStartedAtRef.current = null;
        mediaRecorderRef.current = null;
        cleanupStream();
        setAudioLimitReached(true);
      } finally {
        audioDiscardPromiseRef.current = null;
      }
    })();

    audioDiscardPromiseRef.current = discard;
    await discard;
  }

  // createLocalMediaRecorder starts one bounded local audio file alongside live transcription.
  async function createLocalMediaRecorder(
    sonioxRecording: Recording,
    sessionGeneration: number
  ) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    if (!isCurrentSonioxSession(sonioxRecording, sessionGeneration)) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }

    streamRef.current = stream;
    const mimeType = getSupportedMimeType();
    const contentType = mimeType ? mimeType.split(";")[0] ?? "audio/webm" : "audio/webm";
    const draftPromise = createLiveRecordingDraft({
      contentType,
      title: getLiveRecordingTitle("Live nahrávka")
    });
    const pendingDraft = {
      cleanupScheduled: false,
      promise: draftPromise,
      recording: sonioxRecording,
      sessionGeneration
    };

    pendingLiveDraftSessionRef.current = pendingDraft;
    const recording = await draftPromise;

    if (!isCurrentSonioxSession(sonioxRecording, sessionGeneration)) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }

    if (pendingLiveDraftSessionRef.current === pendingDraft) {
      pendingLiveDraftSessionRef.current = null;
    }

    liveRecordingContentTypeRef.current = contentType;
    liveRecordingDraftRef.current = recording;
    establishLiveMarkerClock(sonioxRecording, sessionGeneration);
    audioChunksRef.current = [];
    audioDiscardedForSizeRef.current = false;
    audioDiscardPromiseRef.current = null;
    audioStartedAtRef.current = null;
    startLocalAudioRecording();
    return true;
  }

  // createTranscriptOnlyDraft creates a recoverable text-only live transcript row before capture starts.
  async function createTranscriptOnlyDraft(): Promise<LiveRecordingDraft> {
    const supabase = createClient();
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error("Přihlášení vypršelo. Přihlaste se znovu.");
    }

    const { data: recording, error } = await supabase
      .from("recordings")
      .insert({
        file_size_bytes: 0,
        source_type: "realtime",
        status: "uploading",
        title: getLiveRecordingTitle("Live přepis"),
        user_id: user.id
      })
      .select("id")
      .single();

    if (error || !recording) {
      throw new Error("Nepovedlo se vytvořit záznam live přepisu.");
    }

    return {
      id: recording.id as string,
      storagePrefix: "",
      userId: user.id
    };
  }

  // saveLiveDraft stores partial transcript progress so unfinished live recordings can be recovered.
  async function saveLiveDraft() {
    const recording = liveRecordingDraftRef.current;

    if (!recording || draftAutosaveInFlightRef.current) {
      return;
    }

    const tokens = [...tokensRef.current.values()];
    const rawText = tokensToText(tokens);

    if (!rawText) {
      return;
    }

    draftAutosaveInFlightRef.current = true;

    try {
      const response = await fetch(`/api/recordings/${recording.id}/live-draft`, {
        body: JSON.stringify({
          elapsedSeconds: elapsedSecondsRef.current,
          rawText,
          segments: tokens
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });

      if (!response.ok) {
        throw new Error("Koncept live přepisu se nepodařilo uložit.");
      }

      let payload: unknown = null;

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (hasTranscriptSearchIndexWarning(payload)) {
        setRecorderFeedback(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
      }

      lastDraftAutosaveAtRef.current = Date.now();
    } catch {
      lastDraftAutosaveAtRef.current = Date.now();
    } finally {
      draftAutosaveInFlightRef.current = false;
    }
  }

  // startRecording asks for microphone access and starts live STT with the selected save mode.
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecorderFeedback("Tento prohlížeč neumí nahrávání přes mikrofon.", "error");
      return;
    }

    const selectedSaveMode = saveMode;
    const selectedMaxAudioFileSizeBytes = selectedSaveMode === "audio_and_transcript"
      ? maxAudioFileSizeBytes
      : null;

    if (selectedSaveMode === "audio_and_transcript" && selectedMaxAudioFileSizeBytes === null) {
      setRecorderFeedback("Audio se teď neukládá. Můžete pokračovat jen s přepisem.", "error");
      return;
    }

    const sessionGeneration = recordingSessionGenerationRef.current + 1;
    let recording: Recording | null = null;

    recordingSessionGenerationRef.current = sessionGeneration;
    recorderStopOwnerRef.current = null;
    setRecorderPhase("starting");
    resetLiveMarkerSession();
    const abandonedPendingDraft = pendingLiveDraftSessionRef.current;

    pendingLiveDraftSessionRef.current = null;
    if (abandonedPendingDraft) {
      failLateLiveDraft(abandonedPendingDraft);
    }

    setRecorderFeedback("Připravuji mikrofon a live přepis...", "working");

    try {
      const recordingOptions = getRealtimeRecordingOptions(realtimeModel, selectedRealtimeLanguage);
      recording = developmentRecordingFactory
        ? developmentRecordingFactory(recordingOptions)
        : new SonioxClient({
          config: fetchRealtimeConfig,
          permissions: new BrowserPermissionResolver()
        }).realtime.record(recordingOptions);
      const sessionRecording = recording;

      setElapsedSeconds(0);
      setAudioLimitReached(false);
      elapsedSecondsRef.current = 0;
      setLiveCaptionBlocks([]);
      setLiveTranscript("");
      setRealtimeWarning(null);
      setWakeLockWarning(null);
      tokenArrivalTimesRef.current = new Map();
      tokensRef.current = new Map();
      resetLiveDraftRefs();
      sonioxRecordingRef.current = sessionRecording;
      sonioxResultSessionRef.current = {
        recording: sessionRecording,
        sessionGeneration
      };
      sessionRecording.on("result", (result) => {
        if (!acceptsSonioxResult(sessionRecording, sessionGeneration)) {
          return;
        }

        const nextTokens = new Map(tokensRef.current);
        const now = Date.now();

        result.tokens.forEach((token) => {
          const key = getTokenKey(token);

          if (!tokenArrivalTimesRef.current.has(key)) {
            tokenArrivalTimesRef.current.set(key, now);
          }

          nextTokens.set(key, token);
        });
        tokensRef.current = nextTokens;
        const tokens = [...nextTokens.values()];

        setLiveTranscript(tokensToText(tokens));
        updateDisplayedLiveCaptions(now);
      });
      sessionRecording.on("connected", () => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        setRealtimeWarning(null);
      });
      sessionRecording.on("error", (error) => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        setRealtimeWarning(getRealtimeErrorMessage(error, selectedSaveMode));
      });
      sessionRecording.on("reconnecting", () => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        setRealtimeWarning(getRealtimeStateWarning("reconnecting", selectedSaveMode));
      });
      sessionRecording.on("reconnected", () => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        setRealtimeWarning(null);
      });
      sessionRecording.on("state_change", (update) => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        if (update.new_state === "recording") {
          liveCaptureActiveRef.current = true;
          setRecorderPhase("recording");
          setRealtimeWarning(null);
          establishLiveMarkerClock(sessionRecording, sessionGeneration);
          return;
        }

        if (
          update.new_state === "reconnecting" ||
          update.new_state === "error" ||
          update.new_state === "canceled"
        ) {
          setRealtimeWarning(getRealtimeStateWarning(update.new_state, selectedSaveMode));
        }
      });

      if (selectedSaveMode === "audio_and_transcript") {
        const localRecorderReady = await createLocalMediaRecorder(
          sessionRecording,
          sessionGeneration
        );

        if (!localRecorderReady) {
          return;
        }
      } else {
        const draftPromise = createTranscriptOnlyDraft();
        const pendingDraft = {
          cleanupScheduled: false,
          promise: draftPromise,
          recording: sessionRecording,
          sessionGeneration
        };

        pendingLiveDraftSessionRef.current = pendingDraft;
        const draft = await draftPromise;

        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        if (pendingLiveDraftSessionRef.current === pendingDraft) {
          pendingLiveDraftSessionRef.current = null;
        }

        liveRecordingDraftRef.current = draft;
      }

      establishLiveMarkerClock(sessionRecording, sessionGeneration);
      await requestWakeLock();

      if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
        return;
      }

      setRecorderFeedback(getRecordingActiveMessage(selectedSaveMode, selectedMaxAudioFileSizeBytes));
      setRecorderPhase("recording");
      timerRef.current = window.setInterval(() => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        const now = Date.now();

        updateDisplayedLiveCaptions(now);

        if (now - lastDraftAutosaveAtRef.current >= LIVE_RECORDING_AUTOSAVE_INTERVAL_MS) {
          void saveLiveDraft();
        }

        const discardEstimateBytes = getLiveAudioDiscardEstimateBytes(selectedMaxAudioFileSizeBytes);

        if (
          discardEstimateBytes !== null &&
          !audioDiscardedForSizeRef.current &&
          mediaRecorderRef.current?.state === "recording" &&
          shouldDiscardLiveRecordingAudio(
            mediaRecorderRef.current.audioBitsPerSecond,
            getCurrentAudioAgeSeconds(),
            discardEstimateBytes
          )
        ) {
          void discardLocalAudioAfterLimit();
        }

        setElapsedSeconds((current) => {
          const next = current + 1;

          elapsedSecondsRef.current = next;
          return next;
        });
      }, 1000);
    } catch (error) {
      const message = getRecordingStartErrorMessage(error);
      const phase = recorderLifecyclePhaseRef.current;
      const ownsSession = isMountedRef.current
        && recordingSessionGenerationRef.current === sessionGeneration
        && (recording === null || sonioxRecordingRef.current === recording)
        && (phase === "starting" || phase === "recording");
      const gracefulStopOwnsRecording = recording !== null
        && phase === "saving"
        && sonioxRecordingRef.current === recording;
      const cleanupGeneration = sessionGeneration + 1;

      if (ownsSession) {
        recordingSessionGenerationRef.current = cleanupGeneration;
        recorderLifecyclePhaseRef.current = "idle";

        if (recording) {
          closeSonioxResultSession(recording, sessionGeneration);
        }

        if (sonioxRecordingRef.current === recording) {
          sonioxRecordingRef.current = null;
        }

        const pendingDraft = pendingLiveDraftSessionRef.current;

        if (
          pendingDraft?.recording === recording
          && pendingDraft.sessionGeneration === sessionGeneration
        ) {
          pendingLiveDraftSessionRef.current = null;
        }
      }

      if (!gracefulStopOwnsRecording) {
        try {
          recording?.cancel();
        } catch {
          // The failed provider instance is already unusable; local cleanup still continues.
        }
      }

      if (!ownsSession) {
        return;
      }

      const failedDraft = liveRecordingDraftRef.current;

      await failLiveRecordingUpload({ message, recording: failedDraft });

      if (
        !isMountedRef.current
        || recordingSessionGenerationRef.current !== cleanupGeneration
      ) {
        return;
      }

      setRecorderFeedback(message, "error");
      cleanupStream();
      stopTimer();
      audioChunksRef.current = [];
      audioDiscardedForSizeRef.current = false;
      audioDiscardPromiseRef.current = null;
      audioStartedAtRef.current = null;
      setAudioLimitReached(false);
      setRealtimeWarning(null);
      setWakeLockWarning(null);
      liveRecordingDraftRef.current = null;
      resetLiveMarkerSession();
      resetLiveDraftRefs();
      void releaseWakeLock();
      setRecorderPhase("idle");
    }
  }

  // saveLiveTranscript persists the final realtime transcript under the saved recording.
  async function saveLiveTranscript(
    recordingId: string,
    rawText: string,
    tokens: RealtimeToken[],
    audioStorage:
      | "supabase_recording_segments"
      | "supabase_recording_upload"
      | "transcript_only"
  ) {
    if (!rawText) {
      throw new Error("Live přepis nevrátil žádný text.");
    }

    const response = await fetch(`/api/recordings/${recordingId}/live-transcript`, {
      body: JSON.stringify({ audioStorage, rawText, segments: tokens }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Nahrávka je uložená, ale live přepis se nepodařilo uložit.");
    }

    let payload: unknown = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return hasTranscriptSearchIndexWarning(payload);
  }

  // createTranscriptOnlyRecording stores or completes a recording row without an audio object.
  async function createTranscriptOnlyRecording(
    rawText: string,
    tokens: RealtimeToken[],
    stopRecordingInstance: Recording | null,
    stopGeneration: number
  ) {
    const draft = liveRecordingDraftRef.current;

    if (draft) {
      const hasSearchWarning = await saveLiveTranscript(
        draft.id,
        rawText,
        tokens,
        "transcript_only"
      );

      if (!stillOwnsStop(stopRecordingInstance, stopGeneration)) {
        return null;
      }

      return { hasSearchWarning, recordingId: draft.id };
    }

    if (!stillOwnsStop(stopRecordingInstance, stopGeneration)) {
      return null;
    }

    const supabase = createClient();
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (!stillOwnsStop(stopRecordingInstance, stopGeneration)) {
      return null;
    }

    if (userError || !user) {
      throw new Error("Přihlášení vypršelo. Přihlaste se znovu.");
    }

    const { data: recording, error } = await supabase
      .from("recordings")
      .insert({
        duration_seconds: elapsedSecondsRef.current,
        file_size_bytes: 0,
        source_type: "realtime",
        status: "uploaded",
        title: getLiveRecordingTitle("Live přepis"),
        user_id: user.id
      })
      .select("id")
      .single();

    if (!stillOwnsStop(stopRecordingInstance, stopGeneration)) {
      if (recording && user) {
        await failLiveRecordingUpload({
          message: "Nahrávací relace skončila během vytváření záznamu.",
          recording: {
            id: recording.id as string,
            storagePrefix: "",
            userId: user.id
          }
        });
      }

      return null;
    }

    if (error || !recording) {
      throw new Error("Nepovedlo se vytvořit záznam live přepisu.");
    }

    const hasSearchWarning = await saveLiveTranscript(
      recording.id,
      rawText,
      tokens,
      "transcript_only"
    );

    if (!stillOwnsStop(stopRecordingInstance, stopGeneration)) {
      return null;
    }

    return { hasSearchWarning, recordingId: recording.id as string };
  }

  // navigateAfterSave moves the user to the configured destination after saving a recording.
  function navigateAfterSave(recordingId: string, hasSearchWarning = false) {
    if (redirectAfterSave === "detail") {
      const path = `/recordings/${recordingId}`;
      router.push(hasSearchWarning ? addTranscriptSearchIndexWarningToPath(path) : path);
      return;
    }

    if (redirectAfterSave === "list") {
      router.push(hasSearchWarning
        ? addTranscriptSearchIndexWarningToPath("/recordings")
        : "/recordings");
      return;
    }

    router.refresh();
  }

  // finishTranscriptOnlyRecording stops Soniox and saves only the live transcript text.
  async function finishTranscriptOnlyRecording() {
    const recording = sonioxRecordingRef.current;
    const resultSession = sonioxResultSessionRef.current;
    const stopGeneration = beginRecorderStop(recording);

    setRecorderFeedback("Dokončuji live přepis a ukládám text...", "working");

    try {
      stopTimer();
      await stopRealtimeRecording(recording);

      if (!stillOwnsStop(recording, stopGeneration)) {
        return;
      }

      let draftSettlement: PendingLiveDraftSettlement = liveRecordingDraftRef.current
        ? { draft: liveRecordingDraftRef.current, kind: "adopted" }
        : { kind: "missing" };

      if (recording && resultSession?.recording === recording) {
        closeSonioxResultSession(recording, resultSession.sessionGeneration);
        draftSettlement = await adoptPendingLiveDraftForStop({
          recording,
          sessionGeneration: resultSession.sessionGeneration,
          stopGeneration
        });

        if (!stillOwnsStop(recording, stopGeneration)) {
          return;
        }
      }

      const tokens = [...tokensRef.current.values()].map((token) => ({ ...token }));
      const rawText = tokensToText(tokens);

      if (draftSettlement.kind === "timed_out") {
        if (!stillOwnsStop(recording, stopGeneration)) {
          return;
        }

        if (rawText) {
          completeLateTranscriptDraft(draftSettlement.pending, {
            durationSeconds: elapsedSecondsRef.current,
            rawText,
            tokens
          });
          setRecorderFeedback("Přepis se dokončí na pozadí po připravení záznamu.");
        } else {
          failLateLiveDraft(draftSettlement.pending);
          setRecorderFeedback("Příprava záznamu trvá příliš dlouho.", "error");
        }

        return;
      }

      if (draftSettlement.kind === "stale") {
        return;
      }

      await saveLiveDraft();

      if (!stillOwnsStop(recording, stopGeneration)) {
        return;
      }

      if (!rawText) {
        setRecorderFeedback("Live přepis je prázdný. Není co uložit.", "error");
        return;
      }

      if (!stillOwnsStop(recording, stopGeneration)) {
        return;
      }

      const saveResult = await createTranscriptOnlyRecording(
        rawText,
        tokens,
        recording,
        stopGeneration
      );

      if (!saveResult || !stillOwnsStop(recording, stopGeneration)) {
        return;
      }

      setRecorderFeedback(saveResult.hasSearchWarning
        ? TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
        : "Live přepis je uložený bez audio souboru.");
      navigateAfterSave(saveResult.recordingId, saveResult.hasSearchWarning);
    } catch (error) {
      if (!stillOwnsStop(recording, stopGeneration)) {
        return;
      }

      setRecorderFeedback(error instanceof Error ? error.message : "Live přepis se nepodařilo uložit.", "error");
    } finally {
      if (stillOwnsStop(recording, stopGeneration)) {
        stopTimer();
        if (sonioxRecordingRef.current === recording) {
          sonioxRecordingRef.current = null;
        }

        liveRecordingDraftRef.current = null;
        resetLiveDraftRefs();
        void releaseWakeLock();
        recorderStopOwnerRef.current = null;
        setRecorderPhase("idle");
      }
    }
  }

  // finalizeLocalAudioBlob stops the local recorder and returns its single finalized audio file.
  async function finalizeLocalAudioBlob() {
    if (audioDiscardPromiseRef.current) {
      await audioDiscardPromiseRef.current.catch(() => undefined);
    }

    const recorder = mediaRecorderRef.current;

    if (audioDiscardedForSizeRef.current || !recorder) {
      return null;
    }

    if (recorder.state !== "inactive") {
      const stopped = new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
      });

      recorder.stop();
      await stopped;
    }

    const blob = new Blob(audioChunksRef.current, { type: liveRecordingContentTypeRef.current });

    audioChunksRef.current = [];
    audioStartedAtRef.current = null;

    return blob;
  }

  // stopRecording finalizes the selected live save mode.
  async function stopRecording() {
    if (saveMode === "transcript_only") {
      await finishTranscriptOnlyRecording();
      return;
    }

    const recordingSession = sonioxRecordingRef.current;
    const resultSession = sonioxResultSessionRef.current;
    const stopGeneration = beginRecorderStop(recordingSession);
    let audioUploadCompleted = false;

    stopTimer();

    try {
      setRecorderFeedback("Dokončuji live přepis a ukládám nahrávku...", "working");

      const audioBlob = await finalizeLocalAudioBlob();

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      await stopRealtimeRecording(recordingSession);

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      if (recordingSession && resultSession?.recording === recordingSession) {
        closeSonioxResultSession(recordingSession, resultSession.sessionGeneration);
        const draftSettlement = await adoptPendingLiveDraftForStop({
          recording: recordingSession,
          sessionGeneration: resultSession.sessionGeneration,
          stopGeneration
        });

        if (!stillOwnsStop(recordingSession, stopGeneration)) {
          return;
        }

        if (draftSettlement.kind === "timed_out") {
          failLateLiveDraft(draftSettlement.pending);
        } else if (draftSettlement.kind === "stale") {
          return;
        }
      }

      await saveLiveDraft();

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      const recording = liveRecordingDraftRef.current;

      if (!recording) {
        throw new Error("Záznam live nahrávky nebyl připravený.");
      }

      const tokens = [...tokensRef.current.values()];
      const rawText = tokensToText(tokens);
      const shouldKeepAudio = isLiveAudioBlobWithinLimit(audioBlob, maxAudioFileSizeBytes);
      let audioSaveError: Error | null = null;

      if (shouldKeepAudio && audioBlob && maxAudioFileSizeBytes !== null) {
        try {
          const upload = await uploadLiveRecording({
            blob: audioBlob,
            contentType: liveRecordingContentTypeRef.current,
            extension: getRecordedFileExtension(liveRecordingContentTypeRef.current),
            maxFileSizeBytes: maxAudioFileSizeBytes,
            recording
          });

          if (!stillOwnsStop(recordingSession, stopGeneration)) {
            return;
          }

          if (!upload.storagePath) {
            throw new Error("Nahrávka je prázdná. Zkuste nahrávání spustit znovu.");
          }

          await completeLiveRecordingUpload({
            contentType: liveRecordingContentTypeRef.current,
            durationSeconds: elapsedSecondsRef.current,
            recording,
            storagePath: upload.storagePath,
            totalBytes: upload.bytes
          });

          if (!stillOwnsStop(recordingSession, stopGeneration)) {
            return;
          }

          audioUploadCompleted = true;
        } catch (error) {
          if (!stillOwnsStop(recordingSession, stopGeneration)) {
            return;
          }

          audioSaveError = error instanceof Error ? error : new Error("Audio se nepodařilo uložit.");
        }
      }

      if (!rawText && !audioUploadCompleted) {
        throw audioSaveError ?? new Error("Live přepis je prázdný. Není co uložit.");
      }

      if (!audioUploadCompleted) {
        await completeLiveRecordingWithoutAudio({
          durationSeconds: elapsedSecondsRef.current,
          recording
        });

        if (!stillOwnsStop(recordingSession, stopGeneration)) {
          return;
        }
      }

      if (!rawText) {
        setRecorderFeedback("Audio je uložené, ale live přepis zůstal prázdný.");
        navigateAfterSave(recording.id);
        return;
      }

      const hasSearchWarning = await saveLiveTranscript(
        recording.id,
        rawText,
        tokens,
        audioUploadCompleted ? "supabase_recording_upload" : "transcript_only"
      );

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      setRecorderFeedback(
        hasSearchWarning
          ? TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
          : audioUploadCompleted
          ? "Live nahrávka a přepis jsou uložené."
          : audioSaveError
            ? `Přepis je uložený bez audia. ${audioSaveError.message}`
            : getLiveAudioFallbackMessage({
              audioDiscardedForSize: audioLimitReached || audioDiscardedForSizeRef.current,
              maxAudioFileSizeBytes
            }),
        audioSaveError ? "error" : "status"
      );
      navigateAfterSave(recording.id, hasSearchWarning);
    } catch (error) {
      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      const message = error instanceof Error ? error.message : "Nahrávku se nepodařilo uložit.";

      if (audioUploadCompleted && liveRecordingDraftRef.current) {
        setRecorderFeedback(`${message} Audio je uložené, live přepis můžete zkusit znovu z detailu.`, "error");
        navigateAfterSave(liveRecordingDraftRef.current.id);
        return;
      }

      await failLiveRecordingUpload({ message, recording: liveRecordingDraftRef.current });

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }
      setRecorderFeedback(error instanceof Error ? error.message : "Nahrávku se nepodařilo uložit.", "error");
    } finally {
      if (stillOwnsStop(recordingSession, stopGeneration)) {
        stopTimer();
        audioChunksRef.current = [];
        audioDiscardedForSizeRef.current = false;
        audioDiscardPromiseRef.current = null;
        audioStartedAtRef.current = null;
        setAudioLimitReached(false);
        setRealtimeWarning(null);
        setWakeLockWarning(null);
        resetLiveDraftRefs();
        mediaRecorderRef.current = null;
        liveRecordingDraftRef.current = null;
        if (sonioxRecordingRef.current === recordingSession) {
          sonioxRecordingRef.current = null;
        }

        cleanupStream();
        void releaseWakeLock();
        recorderStopOwnerRef.current = null;
        setRecorderPhase("idle");
      }
    }
  }

  return (
    <div
      aria-busy={status === "starting" || status === "saving"}
      className={compact ? "browser-recorder browser-recorder-compact" : "browser-recorder"}
      data-recording-status={status}
    >
      {compact ? (
        <div className="persistent-recorder-summary">
          <strong>
            {status === "saving"
              ? "Ukládám nahrávku"
              : status === "starting"
                ? "Spouštím nahrávání"
                : "Probíhá nahrávání"}
          </strong>
          <Link data-touch-target="action" href="/recordings/new">Otevřít nahrávání</Link>
        </div>
      ) : null}
      {!compact && status === "idle" ? (
        <label className="live-language-select">
          <span>Jazyk live přepisu</span>
          <select
            aria-label="Jazyk live přepisu"
            onChange={(event) => setSelectedRealtimeLanguage(event.target.value as SonioxRealtimeLanguageId)}
            value={selectedRealtimeLanguage}
          >
            {sonioxRealtimeLanguageOptions.map((language) => (
              <option key={language.id} value={language.id}>{language.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      {allowTranscriptOnly && !compact ? (
        <fieldset className="live-save-mode" disabled={status !== "idle"}>
          <legend>Ukládání</legend>
          {(["audio_and_transcript", "transcript_only"] as const).map((mode) => (
            <label key={mode}>
              <input
                checked={saveMode === mode}
                disabled={mode === "audio_and_transcript" && maxAudioFileSizeBytes === null}
                name="liveSaveMode"
                onChange={() => setSaveMode(mode)}
                type="radio"
                value={mode}
              />
              <span>{getSaveModeLabel(mode, maxAudioFileSizeBytes)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <button
        className={status === "recording" ? "record-button record-button-active" : "record-button"}
        disabled={
          status === "starting" ||
          status === "saving" ||
          (saveMode === "audio_and_transcript" && maxAudioFileSizeBytes === null)
        }
        onClick={status === "recording" ? stopRecording : startRecording}
        type="button"
      >
        {status === "recording" ? <Square size={18} /> : <Mic size={18} />}
        {status === "recording"
          ? "Zastavit"
          : status === "starting"
            ? "Spouštím..."
            : "Nahrávat live"}
      </button>
      <span className="recording-timer">
        {status === "recording" ? (
          <span aria-label="Nahrávání probíhá" className="recording-indicator" role="img" />
        ) : null}
        {formatElapsedTime(elapsedSeconds)}
      </span>
      {status === "recording" ? (
        <div className="live-marker-actions">
          <button
            className="live-marker-button"
            disabled={!markerReady || liveMarkerPending}
            onClick={markImportantMoment}
            type="button"
          >
            <Flag size={16} />
            {liveMarkerPending
              ? "Ukládám moment..."
              : liveMarkerFeedback?.tone === "error"
                ? "Zkusit moment znovu"
                : "Označit moment"}
          </button>
          <span aria-live="polite" className="live-marker-count">
            Označené momenty: {savedLiveMarkerCount}
          </span>
          {liveMarkerFeedback ? (
            <p
              aria-live={liveMarkerFeedback.tone === "error" ? "assertive" : "polite"}
              className="live-marker-feedback"
              role={liveMarkerFeedback.tone === "error" ? "alert" : "status"}
            >
              {liveMarkerFeedback.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {!compact && captionMode ? (
        <div aria-live="polite" className="caption-surface">
          <span>Live titulky</span>
          {liveCaptionBlocks.length > 0 ? (
            <div className="live-caption-list">
              {liveCaptionBlocks.slice(-6).map((block, index) => (
                <article className="live-caption-line" key={`${block.speaker}-${index}-${block.text}`}>
                  <span className={`speaker ${block.speakerClassName}`}>{block.speaker}</span>
                  <p>{block.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <p>{liveTranscript || "Zatím žádný live přepis."}</p>
          )}
        </div>
      ) : !compact && liveTranscript ? (
        <p className="live-recording-text">{liveTranscript}</p>
      ) : null}
      {status === "recording" && audioLimitReached && maxAudioFileSizeBytes !== null ? (
        <p className="recording-state">
          Ukládání audia bylo zastaveno s rezervou před limitem {formatFileSize(maxAudioFileSizeBytes)}. Přepis pokračuje a uloží se bez audia.
        </p>
      ) : null}
      {maxAudioFileSizeBytes === null && !feedback ? (
        <p className="recording-state">
          Audio není dostupné. Live přepis bez audia můžete používat dál.
        </p>
      ) : null}
      {status !== "idle" && wakeLockWarning ? (
        <p className="recording-state" role="alert">{wakeLockWarning}</p>
      ) : null}
      {status !== "idle" && realtimeWarning ? (
        <p className="recording-state" role="alert">{realtimeWarning}</p>
      ) : null}
      {feedback ? (
        <p
          aria-live={getRecorderFeedbackAnnouncement(feedback.tone).ariaLive}
          className="recording-state"
          role={getRecorderFeedbackAnnouncement(feedback.tone).role}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
