"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flag, Mic, Square } from "lucide-react";
import { useRecordingNavigationBlocker } from "@/components/recording-navigation-guard";
import {
  liveAudioQualityOptions
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
  getPersistedLiveTranscriptAudioStorage,
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
  liveModeStoresAudio,
  liveModeUsesRealtime,
  mergeRealtimeResultTokens,
  promoteRealtimePartialTokens,
  shouldStopLiveRecordingAtAudioLimit,
  stopRealtimeRecording,
  tokensToCaptionBlocks,
  tokensToText,
  type StoredRealtimeToken,
  type RecorderFeedbackTone
} from "@/components/browser-recorder/helpers";
import { assertDevelopmentRecordingFactoryAllowed } from "@/components/browser-recorder/development-runtime";
import type {
  BrowserRecorderProps,
  LiveCaptionBlock,
  LiveMarkerAttempt,
  LiveMarkerFeedback,
  LiveProviderFallbackReason,
  LiveSaveMode,
  RealtimeConfig,
  RealtimeConfigError,
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
  removeRemoteDurableSafetyGeneration,
  uploadLiveRecording,
  uploadLiveRecordingPart,
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
import {
  createLiveAudioHealthMonitor,
  getLiveAudioHealthNotice,
  type LiveAudioHealthMonitor,
  type LiveAudioHealthSnapshot
} from "@/lib/live-recording/audio-health";
import {
  acquireSharedAudioSession,
  createSonioxAudioSource,
  type SharedAudioSession,
  type SharedAudioTrackLease,
  type SonioxAudioSource
} from "@/lib/live-recording/shared-audio-source";
import {
  cleanupDurableSafetyGeneration,
  createIndexedDbDurableAudioRepository,
  persistDurableSafetyPart,
  resumeDurableSafetyPartsForOwner,
  type DurableAudioPartRecord,
  type DurableAudioRepository,
  type DurableSafetyManifest
} from "@/lib/live-recording/durable-audio";
import {
  createRotatingSafetyRecorder,
  type FinalizedSafetyPart
} from "@/lib/live-recording/rotating-safety-recorder";

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
  sessionGeneration: number;
};

type PendingLiveDraftSave = {
  promise: Promise<"failed" | "saved">;
  recordingId: string;
  sessionGeneration: number;
};

type FinalLiveDraftPersistOutcome = "empty" | "failed" | "saved" | "stale";

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

type SafetyAudioSession = {
  captureGeneration: number;
  controller: ReturnType<typeof createRotatingSafetyRecorder>;
  durableParts: DurableAudioPartRecord[];
  finalizedParts: FinalizedSafetyPart[];
  generationId: string;
  latestManifest: DurableSafetyManifest | null;
  persistenceFailed: boolean;
  promotionQueue: Promise<void>;
  recording: LiveRecordingDraft;
  repository: DurableAudioRepository;
};

const LIVE_DRAFT_STOP_WAIT_MS = 5_000;
const LIVE_SAFETY_PART_DURATION_MS = 15_000;

// BrowserRecorder captures microphone audio and can save audio plus transcript or transcript text only.
export function BrowserRecorder({
  allowTranscriptOnly = false,
  captionMode = false,
  compact = false,
  developmentRecordingFactory,
  liveAudioQuality = "standard",
  maxAudioFileSizeBytes,
  onAudioHealthChange,
  onStatusChange,
  realtimeLanguage = "auto",
  redirectAfterSave,
  realtimeModel = "stt-rt-v5"
}: BrowserRecorderProps) {
  assertDevelopmentRecordingFactoryAllowed(developmentRecordingFactory);
  const router = useRouter();
  const { registerNavigationBlocker } = useRecordingNavigationBlocker();
  const elapsedSecondsRef = useRef(0);
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
  const pendingLiveDraftSaveRef = useRef<PendingLiveDraftSave | null>(null);
  const lastDraftAutosaveAtRef = useRef(0);
  const archiveAudioLeaseRef = useRef<SharedAudioTrackLease | null>(null);
  const audioHealthChangeCallbackRef = useRef(onAudioHealthChange);
  const audioHealthMonitorRef = useRef<LiveAudioHealthMonitor | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const safetyAudioSessionRef = useRef<SafetyAudioSession | null>(null);
  const sharedAudioSessionRef = useRef<SharedAudioSession | null>(null);
  const sonioxAudioSourceRef = useRef<SonioxAudioSource | null>(null);
  const sonioxRecordingRef = useRef<Recording | null>(null);
  const timerRef = useRef<number | null>(null);
  const tokenArrivalTimesRef = useRef<Map<string, number>>(new Map());
  const finalTokensRef = useRef<StoredRealtimeToken[]>([]);
  const partialTokensRef = useRef<StoredRealtimeToken[]>([]);
  const tokensRef = useRef<StoredRealtimeToken[]>([]);
  const realtimeSessionIndexRef = useRef(0);
  const realtimeSessionOffsetMsRef = useRef(0);
  const pendingRealtimeSessionOffsetMsRef = useRef<number | null>(null);
  const providerConnectionHealthRef = useRef<"healthy" | "reconnecting">("healthy");
  const providerFallbackReasonRef = useRef<LiveProviderFallbackReason | null>(null);
  const isMountedRef = useRef(true);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockRequestRef = useRef<Promise<boolean> | null>(null);
  const wakeLockRequestGenerationRef = useRef(0);
  const [audioHealth, setAudioHealth] = useState<LiveAudioHealthSnapshot | null>(null);
  const [durabilityWarning, setDurabilityWarning] = useState<string | null>(null);
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
      ? "live_transcript_only"
      : "audio_and_live_transcript"
  );
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [wakeLockWarning, setWakeLockWarning] = useState<string | null>(null);

  audioHealthChangeCallbackRef.current = onAudioHealthChange;

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

  // isCurrentStartSession rejects stale microphone acquisition before a Soniox recording exists.
  function isCurrentStartSession(sessionGeneration: number) {
    return isMountedRef.current
      && recordingSessionGenerationRef.current === sessionGeneration
      && recorderLifecyclePhaseRef.current === "starting";
  }

  // isCurrentCaptureSession keeps audio-owned lifecycle work independent from Soniox presence.
  function isCurrentCaptureSession(sessionGeneration: number) {
    const phase = recorderLifecyclePhaseRef.current;

    return isMountedRef.current
      && sessionGeneration === recordingSessionGenerationRef.current
      && (phase === "starting" || phase === "recording");
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
    recording: Recording | null;
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
  function establishLiveMarkerClock(sessionGeneration: number) {
    if (
      !isCurrentCaptureSession(sessionGeneration)
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

  // cleanupAudioSession releases only the addressed session and cannot tear down a newer capture.
  const cleanupAudioSession = useCallback((session: SharedAudioSession | null) => {
    if (!session) {
      return;
    }

    if (sharedAudioSessionRef.current === session) {
      audioHealthMonitorRef.current?.stop();
      audioHealthMonitorRef.current = null;
      archiveAudioLeaseRef.current = null;
      sonioxAudioSourceRef.current?.stop();
      sonioxAudioSourceRef.current = null;
      sharedAudioSessionRef.current = null;
      if (isMountedRef.current) {
        setAudioHealth(null);
      }
      audioHealthChangeCallbackRef.current?.(null);
    }

    session.close();
  }, []);

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

      const safetySession = safetyAudioSessionRef.current;

      safetyAudioSessionRef.current = null;
      void safetySession?.controller.stop().catch(() => undefined);

      const audioSession = sharedAudioSessionRef.current;

      cleanupAudioSession(audioSession);

      const wakeLock = wakeLockRef.current;

      invalidateWakeLockRequest();
      wakeLockRef.current = null;
      void wakeLock?.release().catch(() => undefined);
    }

    isMountedRef.current = true;
    return cleanupRecorder;
  }, [cleanupAudioSession, invalidateWakeLockRequest]);

  useEffect(() => {
    // handleVisibilityChange reacquires Wake Lock without restarting a healthy Soniox session.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && status === "recording") {
        void requestWakeLock();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [requestWakeLock, status]);

  // fetchRealtimeConfig retrieves a short-lived browser-safe Soniox websocket key.
  async function fetchRealtimeConfig(): Promise<RealtimeConfig> {
    const response = await fetch("/api/soniox/realtime-key", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as
      | (RealtimeConfig & RealtimeConfigError)
      | null;

    if (!response.ok || !payload?.api_key) {
      throw new Error(getRealtimeConfigErrorMessage(payload?.code, payload?.request_id));
    }

    return {
      api_key: payload.api_key,
      region: payload.region,
      stt_ws_url: payload.stt_ws_url
    };
  }

  // resetLiveDraftRefs clears transient autosave state between recording sessions.
  function resetLiveDraftRefs() {
    pendingLiveDraftSaveRef.current = null;
    lastDraftAutosaveAtRef.current = 0;
  }

  // updateDisplayedLiveCaptions renders delayed caption blocks while keeping the saved transcript complete.
  function updateDisplayedLiveCaptions(nowMs: number) {
    const tokens = tokensRef.current.map((token) => ({
      ...token,
      received_at_ms: tokenArrivalTimesRef.current.get(getTokenKey(token))
    }));

    setLiveCaptionBlocks(tokensToCaptionBlocks(getStableLiveCaptionTokens(tokens, nowMs)));
  }

  // createLocalAudioRecorder builds the continuous archive encoder at the session-locked quality.
  function createLocalAudioRecorder(stream: MediaStream, audioBitsPerSecond: number) {
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, {
      audioBitsPerSecond,
      ...(mimeType ? { mimeType } : {})
    });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current = [...audioChunksRef.current, event.data];
      }
    };

    return recorder;
  }

  // startLocalAudioRecording starts archive encoding and independent health checks on its clone.
  function startLocalAudioRecording(
    lease: SharedAudioTrackLease,
    sessionGeneration: number,
    audioBitsPerSecond: number
  ) {
    const recorder = createLocalAudioRecorder(lease.stream, audioBitsPerSecond);
    const monitor = createLiveAudioHealthMonitor({
      onChange: (snapshot) => {
        if (!isCurrentCaptureSession(sessionGeneration)) {
          return;
        }

        setAudioHealth(snapshot);
        audioHealthChangeCallbackRef.current?.(snapshot);
      },
      recorder,
      stream: lease.stream,
      track: lease.track
    });

    audioChunksRef.current = [];
    audioStartedAtRef.current = Date.now();
    archiveAudioLeaseRef.current = lease;
    audioHealthMonitorRef.current = monitor;
    mediaRecorderRef.current = recorder;

    try {
      recorder.start();
    } catch (error) {
      monitor.stop();
      audioHealthMonitorRef.current = null;
      mediaRecorderRef.current = null;
      throw error;
    }
  }

  // getCurrentAudioAgeSeconds returns how long the local audio file has been recording.
  function getCurrentAudioAgeSeconds() {
    if (!audioStartedAtRef.current) {
      return 0;
    }

    return Math.floor((Date.now() - audioStartedAtRef.current) / 1000);
  }

  // ownsSafetyAudioSession accepts work only from the active capture or its generation-owned stop.
  function ownsSafetyAudioSession(session: SafetyAudioSession) {
    const phase = recorderLifecyclePhaseRef.current;
    const expectedGeneration = phase === "saving"
      ? session.captureGeneration + 1
      : session.captureGeneration;

    return isMountedRef.current
      && safetyAudioSessionRef.current === session
      && recordingSessionGenerationRef.current === expectedGeneration
      && (phase === "starting" || phase === "recording" || phase === "saving");
  }

  // isSafetyAudioPartOwnedBySession rejects rows from another recording or retry generation.
  function isSafetyAudioPartOwnedBySession(
    session: SafetyAudioSession,
    part: DurableAudioPartRecord
  ) {
    return part.ownerId === session.recording.userId
      && part.recordingId === session.recording.id
      && part.generationId === session.generationId
      && session.durableParts.some((candidate) => candidate.key === part.key);
  }

  // createSafetyGenerationRepository limits owner-wide recovery helpers to one live generation.
  function createSafetyGenerationRepository(session: SafetyAudioSession): DurableAudioRepository {
    return {
      // deleteGeneration delegates only the exact session identity.
      async deleteGeneration(ownerId, recordingId, generationId) {
        if (
          ownerId !== session.recording.userId
          || recordingId !== session.recording.id
          || generationId !== session.generationId
        ) {
          throw new Error("Bezpečnostní části patří jiné nahrávací relaci.");
        }

        await session.repository.deleteGeneration(ownerId, recordingId, generationId);
      },

      // listForOwner exposes only rows owned by this exact recording generation.
      async listForOwner(ownerId) {
        if (ownerId !== session.recording.userId) {
          return [];
        }

        const rows = await session.repository.listForOwner(ownerId);
        return rows.filter((part) => (
          part.recordingId === session.recording.id
          && part.generationId === session.generationId
        ));
      },

      // markUploaded accepts only a durable row already attached to this session.
      async markUploaded(key, uploadedAt) {
        const part = session.durableParts.find((candidate) => candidate.key === key);

        if (!part || !isSafetyAudioPartOwnedBySession(session, part)) {
          throw new Error("Bezpečnostní část patří jiné nahrávací relaci.");
        }

        await session.repository.markUploaded(key, uploadedAt);
      },

      // put accepts only a fully scoped row for this session.
      async put(record) {
        if (!isSafetyAudioPartOwnedBySession(session, record)) {
          throw new Error("Bezpečnostní část patří jiné nahrávací relaci.");
        }

        await session.repository.put(record);
      }
    };
  }

  // getCurrentSafetyManifest returns only a fully uploaded exact-generation manifest.
  function getCurrentSafetyManifest(session: SafetyAudioSession) {
    const manifest = session.latestManifest;
    const expectedKeys = new Set(session.durableParts.map((part) => part.key));

    if (!manifest) {
      return null;
    }

    const manifestKeys = new Set(manifest.parts.map((part) => part.key));

    if (
      manifest.ownerId !== session.recording.userId
      || manifest.recordingId !== session.recording.id
      || manifest.generationId !== session.generationId
      || manifest.partCount !== expectedKeys.size
      || manifest.pendingPartCount !== 0
      || manifest.parts.length !== expectedKeys.size
      || manifestKeys.size !== expectedKeys.size
      || manifest.parts.some((part) => (
        part.uploadedAt === null
        || !expectedKeys.has(part.key)
        || !isSafetyAudioPartOwnedBySession(session, part)
      ))
    ) {
      return null;
    }

    return manifest;
  }

  // queueSafetyAudioPromotion serializes durable promotion without delaying recorder rotation.
  function queueSafetyAudioPromotion(
    session: SafetyAudioSession,
    maxFileSizeBytes: number
  ) {
    const scopedRepository = createSafetyGenerationRepository(session);
    const nextPromotion = session.promotionQueue.then(async () => {
      if (!ownsSafetyAudioSession(session)) {
        return;
      }

      const promotion = await resumeDurableSafetyPartsForOwner({
        maxConcurrent: 2,
        ownerId: session.recording.userId,
        repository: scopedRepository,
        uploadPart: async (part) => {
          if (!ownsSafetyAudioSession(session) || !isSafetyAudioPartOwnedBySession(session, part)) {
            throw new Error("Bezpečnostní část patří ukončené nahrávací relaci.");
          }

          await uploadLiveRecordingPart({
            blob: part.blob,
            contentType: part.mimeType,
            maxFileSizeBytes,
            partIndex: part.index,
            recording: session.recording
          });
        }
      });

      if (!ownsSafetyAudioSession(session)) {
        return;
      }

      session.latestManifest = promotion.manifests.find((manifest) => (
        manifest.ownerId === session.recording.userId
        && manifest.recordingId === session.recording.id
        && manifest.generationId === session.generationId
      )) ?? null;
      const currentKeys = new Set(session.durableParts.map((part) => part.key));
      const currentFailed = promotion.failed.some((key) => currentKeys.has(key));

      if (currentFailed || (session.latestManifest?.pendingPartCount ?? 0) > 0) {
        setDurabilityWarning(
          "Bezpečnostní část se nepodařilo odeslat. Zůstává uložená pro pozdější obnovení a hlavní audio pokračuje."
        );
      } else if (!session.persistenceFailed) {
        setDurabilityWarning(null);
      }
    }).catch(() => {
      if (ownsSafetyAudioSession(session)) {
        setDurabilityWarning(
          "Bezpečnostní část se nepodařilo odeslat. Zůstává uložená pro pozdější obnovení a hlavní audio pokračuje."
        );
      }
    });

    session.promotionQueue = nextPromotion;
  }

  // startSafetyAudioRecording rotates an isolated master clone and durably commits every complete part.
  function startSafetyAudioRecording(
    masterStream: MediaStream,
    recording: LiveRecordingDraft,
    sessionGeneration: number,
    audioBitsPerSecond: number,
    mimeType: string,
    maxFileSizeBytes: number
  ) {
    const repository = createIndexedDbDurableAudioRepository();
    let safetySession: SafetyAudioSession | null = null;
    const controller = createRotatingSafetyRecorder({
      createRecorder: (stream, options) => new MediaRecorder(stream, {
        ...options,
        audioBitsPerSecond
      }),
      mimeType,
      onPartFinalized: async (part) => {
        const session = safetySession;

        if (!session) {
          return;
        }

        session.finalizedParts.push(part);

        try {
          const durablePart = await persistDurableSafetyPart({
            generationId: session.generationId,
            ownerId: recording.userId,
            part,
            recordingId: recording.id,
            repository
          });
          session.durableParts.push(durablePart);
          queueSafetyAudioPromotion(session, maxFileSizeBytes);
        } catch {
          session.persistenceFailed = true;
          if (safetyAudioSessionRef.current === session && isMountedRef.current) {
            setDurabilityWarning(
              "Ochrana proti pádu pro tuto nahrávku není dostupná. Hlavní audio se dál ukládá."
            );
          }
        }
      },
      partDurationMs: LIVE_SAFETY_PART_DURATION_MS,
      stream: masterStream
    });

    safetySession = {
      captureGeneration: sessionGeneration,
      controller,
      durableParts: [],
      finalizedParts: [],
      generationId: crypto.randomUUID(),
      latestManifest: null,
      persistenceFailed: false,
      promotionQueue: Promise.resolve(),
      recording,
      repository
    };
    safetyAudioSessionRef.current = safetySession;
    controller.start();
  }

  // createLocalMediaRecorder starts one bounded local audio file alongside live transcription.
  async function createLocalMediaRecorder(
    sessionGeneration: number,
    archiveLease: SharedAudioTrackLease,
    masterStream: MediaStream,
    audioBitsPerSecond: number,
    maxFileSizeBytes: number
  ) {
    if (!isCurrentCaptureSession(sessionGeneration)) {
      return false;
    }

    const mimeType = getSupportedMimeType();
    const contentType = mimeType ? mimeType.split(";")[0] ?? "audio/webm" : "audio/webm";
    liveRecordingContentTypeRef.current = contentType;
    audioChunksRef.current = [];
    audioStartedAtRef.current = null;
    startLocalAudioRecording(archiveLease, sessionGeneration, audioBitsPerSecond);
    liveCaptureActiveRef.current = true;
    setRecorderPhase("recording");
    const draftPromise = createLiveRecordingDraft({
      contentType,
      title: getLiveRecordingTitle("Live nahrávka")
    });
    const pendingDraft = {
      cleanupScheduled: false,
      promise: draftPromise,
      sessionGeneration
    };

    pendingLiveDraftSessionRef.current = pendingDraft;
    const recording = await draftPromise;

    if (!isCurrentCaptureSession(sessionGeneration)) {
      return false;
    }

    if (pendingLiveDraftSessionRef.current === pendingDraft) {
      pendingLiveDraftSessionRef.current = null;
    }

    liveRecordingDraftRef.current = recording;
    try {
      startSafetyAudioRecording(
        masterStream,
        recording,
        sessionGeneration,
        audioBitsPerSecond,
        contentType,
        maxFileSizeBytes
      );
    } catch {
      setDurabilityWarning(
        "Ochrana proti pádu pro tuto nahrávku není dostupná. Hlavní audio se dál ukládá."
      );
    }
    establishLiveMarkerClock(sessionGeneration);
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

  // persistLiveDraftSnapshot sends one immutable transcript snapshot and reports search-index warnings.
  async function persistLiveDraftSnapshot(
    recording: LiveRecordingDraft,
    snapshot: { elapsedSeconds: number; rawText: string; tokens: RealtimeToken[] }
  ) {
    const response = await fetch(`/api/recordings/${recording.id}/live-draft`, {
      body: JSON.stringify({
        elapsedSeconds: snapshot.elapsedSeconds,
        rawText: snapshot.rawText,
        segments: snapshot.tokens
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

    return hasTranscriptSearchIndexWarning(payload);
  }

  // saveLiveDraft coalesces periodic autosaves while retaining their explicit settlement promise.
  async function saveLiveDraft() {
    const recording = liveRecordingDraftRef.current;

    if (!recording) {
      return "failed" as const;
    }

    const existing = pendingLiveDraftSaveRef.current;
    if (existing?.recordingId === recording.id) {
      return existing.promise;
    }

    const tokens = [...tokensRef.current];
    const rawText = tokensToText(tokens);

    if (!rawText) {
      return "saved" as const;
    }

    const sessionGeneration = recordingSessionGenerationRef.current;
    const promise = (async (): Promise<"failed" | "saved"> => {
      try {
        const hasSearchWarning = await persistLiveDraftSnapshot(recording, {
          elapsedSeconds: elapsedSecondsRef.current,
          rawText,
          tokens
        });

        if (
          hasSearchWarning
          && isCurrentCaptureSession(sessionGeneration)
          && liveRecordingDraftRef.current === recording
        ) {
          setRecorderFeedback(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
        }
        return "saved";
      } catch {
        return "failed";
      } finally {
        if (
          isCurrentCaptureSession(sessionGeneration)
          && liveRecordingDraftRef.current === recording
        ) {
          lastDraftAutosaveAtRef.current = Date.now();
        }
      }
    })();
    const pending = { promise, recordingId: recording.id, sessionGeneration };

    pendingLiveDraftSaveRef.current = pending;
    const outcome = await promise;
    if (pendingLiveDraftSaveRef.current === pending) {
      pendingLiveDraftSaveRef.current = null;
    }
    return outcome;
  }

  // persistFinalLiveDraft waits for this capture's autosave, then confirms the latest stop-owned text.
  async function persistFinalLiveDraft({
    captureGeneration,
    recording,
    recordingSession,
    stopGeneration
  }: {
    captureGeneration: number;
    recording: LiveRecordingDraft;
    recordingSession: Recording | null;
    stopGeneration: number;
  }): Promise<FinalLiveDraftPersistOutcome> {
    const pending = pendingLiveDraftSaveRef.current;

    if (
      pending?.recordingId === recording.id
      && pending.sessionGeneration === captureGeneration
    ) {
      await pending.promise;
    }

    if (!stillOwnsStop(recordingSession, stopGeneration)) {
      return "stale";
    }

    const tokens = [...tokensRef.current];
    const rawText = tokensToText(tokens);

    if (!rawText) {
      return "empty";
    }

    try {
      const hasSearchWarning = await persistLiveDraftSnapshot(recording, {
        elapsedSeconds: elapsedSecondsRef.current,
        rawText,
        tokens
      });

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return "stale";
      }
      if (hasSearchWarning) {
        setRecorderFeedback(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
      }
      lastDraftAutosaveAtRef.current = Date.now();
      return "saved";
    } catch {
      return stillOwnsStop(recordingSession, stopGeneration) ? "failed" : "stale";
    }
  }

  // startRecording begins the selected audio and provider owners without coupling their lifecycles.
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecorderFeedback("Tento prohlížeč neumí nahrávání přes mikrofon.", "error");
      return;
    }

    const selectedSaveMode = saveMode;
    const storesAudio = liveModeStoresAudio(selectedSaveMode);
    const usesRealtime = liveModeUsesRealtime(selectedSaveMode);
    const selectedAudioBitsPerSecond = liveAudioQualityOptions[liveAudioQuality].audioBitsPerSecond;
    const selectedMaxAudioFileSizeBytes = storesAudio
      ? maxAudioFileSizeBytes
      : null;

    if (storesAudio && selectedMaxAudioFileSizeBytes === null) {
      setRecorderFeedback("Audio se teď neukládá. Můžete pokračovat jen s přepisem.", "error");
      return;
    }

    const sessionGeneration = recordingSessionGenerationRef.current + 1;
    let recording: Recording | null = null;
    let audioSession: SharedAudioSession | null = null;
    let localRecorderReadyPromise: Promise<boolean> | null = null;

    recordingSessionGenerationRef.current = sessionGeneration;
    recorderStopOwnerRef.current = null;
    setRecorderPhase("starting");
    resetLiveMarkerSession();
    const abandonedPendingDraft = pendingLiveDraftSessionRef.current;

    pendingLiveDraftSessionRef.current = null;
    if (abandonedPendingDraft) {
      failLateLiveDraft(abandonedPendingDraft);
    }

    setRecorderFeedback(
      usesRealtime ? "Připravuji mikrofon a live přepis..." : "Připravuji mikrofon a audio záznam...",
      "working"
    );

    try {
      audioSession = await acquireSharedAudioSession();

      if (!isCurrentStartSession(sessionGeneration)) {
        audioSession.close();
        return;
      }

      sharedAudioSessionRef.current = audioSession;
      setElapsedSeconds(0);
      setDurabilityWarning(null);
      elapsedSecondsRef.current = 0;
      setLiveCaptionBlocks([]);
      setLiveTranscript("");
      setRealtimeWarning(null);
      setWakeLockWarning(null);
      tokenArrivalTimesRef.current = new Map();
      finalTokensRef.current = [];
      partialTokensRef.current = [];
      tokensRef.current = [];
      realtimeSessionIndexRef.current = 0;
      realtimeSessionOffsetMsRef.current = 0;
      pendingRealtimeSessionOffsetMsRef.current = null;
      providerConnectionHealthRef.current = "healthy";
      providerFallbackReasonRef.current = null;
      resetLiveDraftRefs();

      if (storesAudio && selectedMaxAudioFileSizeBytes !== null) {
        const archiveLease = audioSession.lease("archive");
        localRecorderReadyPromise = createLocalMediaRecorder(
          sessionGeneration,
          archiveLease,
          audioSession.masterStream,
          selectedAudioBitsPerSecond,
          selectedMaxAudioFileSizeBytes
        );
      }

      if (usesRealtime) {
        const sonioxLease = audioSession.lease("soniox");
        const sonioxAudioSource = createSonioxAudioSource(sonioxLease);
        const recordingOptions = {
          ...getRealtimeRecordingOptions(realtimeModel, selectedRealtimeLanguage),
          source: sonioxAudioSource
        };

        sonioxAudioSourceRef.current = sonioxAudioSource;
        try {
          recording = developmentRecordingFactory
            ? developmentRecordingFactory(recordingOptions)
            : new SonioxClient({
              config: fetchRealtimeConfig,
              permissions: new BrowserPermissionResolver()
            }).realtime.record(recordingOptions);
        } catch (error) {
          if (!storesAudio) {
            throw error;
          }

          providerFallbackReasonRef.current = "start_failed";
          setRealtimeWarning(getRealtimeErrorMessage(
            error instanceof Error ? error : new Error(String(error)),
            selectedSaveMode
          ));
        }
      }

      const sessionRecording = recording;

      sonioxRecordingRef.current = sessionRecording;
      sonioxResultSessionRef.current = sessionRecording
        ? { recording: sessionRecording, sessionGeneration }
        : null;
      if (sessionRecording) {
      sessionRecording.on("result", (result) => {
        if (!acceptsSonioxResult(sessionRecording, sessionGeneration)) {
          return;
        }

        const now = Date.now();
        const nextState = mergeRealtimeResultTokens(
          finalTokensRef.current,
          result.tokens,
          realtimeSessionIndexRef.current,
          realtimeSessionOffsetMsRef.current
        );
        const nextArrivalTimes = new Map<string, number>();

        nextState.tokens.forEach((token) => {
          const key = getTokenKey(token);

          nextArrivalTimes.set(key, tokenArrivalTimesRef.current.get(key) ?? now);
        });
        finalTokensRef.current = nextState.finalTokens;
        partialTokensRef.current = nextState.partialTokens;
        tokensRef.current = nextState.tokens;
        tokenArrivalTimesRef.current = nextArrivalTimes;
        const tokens = nextState.tokens;

        setLiveTranscript(tokensToText(tokens));
        updateDisplayedLiveCaptions(now);
      });
      sessionRecording.on("connected", () => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        providerConnectionHealthRef.current = "healthy";
        setRealtimeWarning(null);
      });
      sessionRecording.on("error", (error) => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        if (storesAudio) {
          providerFallbackReasonRef.current ??= "error";
        }
        setRealtimeWarning(getRealtimeErrorMessage(error, selectedSaveMode));
      });
      sessionRecording.on("reconnecting", () => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        providerConnectionHealthRef.current = "reconnecting";
        pendingRealtimeSessionOffsetMsRef.current ??= elapsedSecondsRef.current * 1000;
        setRealtimeWarning(getRealtimeStateWarning("reconnecting", selectedSaveMode));
      });
      sessionRecording.on("session_restart", () => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        finalTokensRef.current = promoteRealtimePartialTokens(
          finalTokensRef.current,
          partialTokensRef.current
        );
        partialTokensRef.current = [];
        tokensRef.current = [...finalTokensRef.current];
        realtimeSessionIndexRef.current += 1;
        realtimeSessionOffsetMsRef.current = pendingRealtimeSessionOffsetMsRef.current
          ?? elapsedSecondsRef.current * 1000;
        pendingRealtimeSessionOffsetMsRef.current = null;
        setLiveTranscript(tokensToText(tokensRef.current));
        updateDisplayedLiveCaptions(Date.now());
      });
      sessionRecording.on("reconnected", () => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        providerConnectionHealthRef.current = "healthy";
        setRealtimeWarning(null);
      });
      sessionRecording.on("state_change", (update) => {
        if (!isCurrentSonioxSession(sessionRecording, sessionGeneration)) {
          return;
        }

        if (update.new_state === "recording") {
          providerConnectionHealthRef.current = "healthy";
          liveCaptureActiveRef.current = true;
          setRecorderPhase("recording");
          setRealtimeWarning(null);
          establishLiveMarkerClock(sessionGeneration);
          return;
        }

        if (
          update.new_state === "reconnecting" ||
          update.new_state === "error" ||
          update.new_state === "canceled"
        ) {
          if (update.new_state === "reconnecting") {
            providerConnectionHealthRef.current = "reconnecting";
          }
          if (storesAudio && update.new_state !== "reconnecting") {
            providerFallbackReasonRef.current ??= update.new_state === "canceled"
              ? "canceled"
              : "error";
          }
          setRealtimeWarning(getRealtimeStateWarning(update.new_state, selectedSaveMode));
        }
      });
      }

      if (localRecorderReadyPromise && !(await localRecorderReadyPromise)) {
        return;
      }

      if (!storesAudio) {
        if (!sessionRecording) {
          throw new Error("Live přepis se nepodařilo spustit.");
        }
        const draftPromise = createTranscriptOnlyDraft();
        const pendingDraft = {
          cleanupScheduled: false,
          promise: draftPromise,
          sessionGeneration
        };

        pendingLiveDraftSessionRef.current = pendingDraft;
        const draft = await draftPromise;

        if (!isCurrentCaptureSession(sessionGeneration)) {
          return;
        }

        if (pendingLiveDraftSessionRef.current === pendingDraft) {
          pendingLiveDraftSessionRef.current = null;
        }

        liveRecordingDraftRef.current = draft;
      }

      establishLiveMarkerClock(sessionGeneration);
      await requestWakeLock();

      if (!isCurrentCaptureSession(sessionGeneration)) {
        return;
      }

      setRecorderFeedback(getRecordingActiveMessage(selectedSaveMode, selectedMaxAudioFileSizeBytes));
      setRecorderPhase("recording");
      timerRef.current = window.setInterval(() => {
        if (!isCurrentCaptureSession(sessionGeneration)) {
          return;
        }

        const now = Date.now();

        updateDisplayedLiveCaptions(now);

        if (now - lastDraftAutosaveAtRef.current >= LIVE_RECORDING_AUTOSAVE_INTERVAL_MS) {
          void saveLiveDraft();
        }

        const stopEstimateBytes = getLiveAudioDiscardEstimateBytes(selectedMaxAudioFileSizeBytes);

        if (
          stopEstimateBytes !== null &&
          mediaRecorderRef.current?.state === "recording" &&
          shouldStopLiveRecordingAtAudioLimit(
            mediaRecorderRef.current.audioBitsPerSecond,
            getCurrentAudioAgeSeconds(),
            stopEstimateBytes
          )
        ) {
          void stopRecording("audio_limit");
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

        if (pendingDraft?.sessionGeneration === sessionGeneration) {
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
        const staleSafetySession = safetyAudioSessionRef.current;

        if (staleSafetySession?.captureGeneration === sessionGeneration) {
          if (safetyAudioSessionRef.current === staleSafetySession) {
            safetyAudioSessionRef.current = null;
          }
          void staleSafetySession.controller.stop().catch(() => undefined);
        }
        cleanupAudioSession(audioSession);
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
      const failedSafetySession = safetyAudioSessionRef.current;

      if (failedSafetySession?.captureGeneration === sessionGeneration) {
        safetyAudioSessionRef.current = null;
        await failedSafetySession.controller.stop().catch(() => undefined);
      }
      cleanupAudioSession(audioSession);
      stopTimer();
      audioChunksRef.current = [];
      audioStartedAtRef.current = null;
      setDurabilityWarning(null);
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

  // requestAsyncTranscription starts or explicitly replaces the durable job after audio is uploaded.
  async function requestAsyncTranscription(recordingId: string, restart = false) {
    const suffix = restart ? "?restart=1" : "";
    const response = await fetch(`/api/recordings/${recordingId}/transcription${suffix}`, {
      cache: "no-store",
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Audio je uložené, ale přepis na pozadí se nepodařilo spustit.");
    }
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
    const audioSession = sharedAudioSessionRef.current;
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

      const tokens = tokensRef.current.map((token) => ({ ...token }));
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
        cleanupAudioSession(audioSession);
        void releaseWakeLock();
        recorderStopOwnerRef.current = null;
        setRecorderPhase("idle");
      }
    }
  }

  // finalizeLocalAudioBlob stops the local recorder and returns its single finalized audio file.
  async function finalizeLocalAudioBlob() {
    const recorder = mediaRecorderRef.current;

    if (!recorder) {
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

  // finalizeSafetyAudioSession waits for the final durable part and its generation promotion queue.
  async function finalizeSafetyAudioSession(session: SafetyAudioSession | null) {
    try {
      await session?.controller.stop();
      await session?.promotionQueue;
    } catch {
      if (session) {
        session.persistenceFailed = true;
      }
      if (safetyAudioSessionRef.current === session && isMountedRef.current) {
        setDurabilityWarning(
          "Ochrana proti pádu pro tuto nahrávku není dostupná. Hlavní audio se dál ukládá."
        );
      }
    }
  }

  // cleanupConfirmedSafetyAudio removes remote parts before local recovery after exact archive metadata.
  async function cleanupConfirmedSafetyAudio(
    session: SafetyAudioSession | null,
    confirmedRecordingId: string
  ) {
    if (
      !session
      || confirmedRecordingId !== session.recording.id
      || !ownsSafetyAudioSession(session)
    ) {
      return;
    }

    const manifest = getCurrentSafetyManifest(session);

    if (!manifest) {
      return;
    }

    try {
      const remoteCleanup = await removeRemoteDurableSafetyGeneration({ manifest });

      if (!ownsSafetyAudioSession(session) || remoteCleanup.removed !== manifest.partCount) {
        throw new Error("Úložiště nepotvrdilo odstranění všech bezpečnostních částí.");
      }
    } catch {
      if (ownsSafetyAudioSession(session)) {
        setDurabilityWarning(
          "Uložené bezpečnostní části se nepodařilo přesně uklidit. Zůstávají dostupné pro bezpečné obnovení."
        );
      }
      return;
    }

    try {
      await cleanupDurableSafetyGeneration({
        generationId: session.generationId,
        ownerId: session.recording.userId,
        recordingId: session.recording.id,
        repository: session.repository
      });
    } catch {
      if (ownsSafetyAudioSession(session)) {
        setDurabilityWarning(
          "Vzdálené bezpečnostní části jsou uklizené, ale místní kopii se nepodařilo odstranit."
        );
      }
    }
  }

  // hasCompleteDurableSafetyAudio accepts only contiguous parts durably owned by this exact generation.
  function hasCompleteDurableSafetyAudio(session: SafetyAudioSession | null) {
    if (
      !session
      || session.persistenceFailed
      || session.finalizedParts.length === 0
      || session.durableParts.length !== session.finalizedParts.length
    ) {
      return false;
    }

    return [...session.durableParts]
      .sort((left, right) => left.index - right.index)
      .every((part, index) => (
        part.index === index
        && part.generationId === session.generationId
        && part.ownerId === session.recording.userId
        && part.recordingId === session.recording.id
      ));
  }

  // promoteSafetyAudioSession confirms already promoted exact-generation parts as segmented audio.
  async function promoteSafetyAudioSession(
    session: SafetyAudioSession | null,
    durationSeconds: number
  ) {
    if (!session || !hasCompleteDurableSafetyAudio(session)) {
      return false;
    }

    const manifest = getCurrentSafetyManifest(session);

    if (!manifest) {
      return false;
    }

    const parts = [...session.durableParts].sort((left, right) => left.index - right.index);
    const completion = await completeLiveRecordingUpload({
      contentType: parts[0]?.mimeType ?? liveRecordingContentTypeRef.current,
      durationSeconds,
      recording: session.recording,
      storagePath: session.recording.storagePrefix,
      totalBytes: parts.reduce((total, part) => total + part.size, 0)
    });
    return completion.id === session.recording.id;
  }

  // stopRecording finalizes the selected live save mode under one generation-owned stop reason.
  async function stopRecording(reason: "audio_limit" | "manual" = "manual") {
    if (saveMode === "live_transcript_only") {
      await finishTranscriptOnlyRecording();
      return;
    }

    const recordingSession = sonioxRecordingRef.current;
    const resultSession = sonioxResultSessionRef.current;
    const audioSession = sharedAudioSessionRef.current;
    const safetySession = safetyAudioSessionRef.current;
    const captureGeneration = recordingSessionGenerationRef.current;
    const stopGeneration = beginRecorderStop(recordingSession);
    let audioUploadCompleted = false;
    let audioStoredAsSegments = false;
    let finalDraftPersistOutcome: FinalLiveDraftPersistOutcome | null = null;
    let stoppedRecordingDraft: LiveRecordingDraft | null = null;
    let stoppedRawText = "";

    stopTimer();

    try {
      setRecorderFeedback(
        reason === "audio_limit"
          ? "Dosažen limit audia. Dokončuji a ukládám nahrávku..."
          : saveMode === "audio_only"
          ? "Dokončuji audio a ukládám nahrávku..."
          : "Dokončuji live přepis a ukládám nahrávku...",
        "working"
      );

      await finalizeSafetyAudioSession(safetySession);

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      const audioBlob = await finalizeLocalAudioBlob();

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      const realtimeStopOutcome = await stopRealtimeRecording(recordingSession);

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      if (
        saveMode === "audio_and_live_transcript"
        && (
          realtimeStopOutcome === "failed"
          || realtimeStopOutcome === "timed_out"
          || providerConnectionHealthRef.current === "reconnecting"
        )
      ) {
        providerFallbackReasonRef.current ??= "unhealthy_stop";
      }

      if (recordingSession && resultSession?.recording === recordingSession) {
        closeSonioxResultSession(recordingSession, resultSession.sessionGeneration);
      }

      const draftSettlement = await adoptPendingLiveDraftForStop({
        recording: recordingSession,
        sessionGeneration: resultSession?.sessionGeneration ?? captureGeneration,
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

      const recording = liveRecordingDraftRef.current;

      if (!recording) {
        throw new Error("Záznam live nahrávky nebyl připravený.");
      }
      stoppedRecordingDraft = recording;

      const tokens = [...tokensRef.current];
      const rawText = tokensToText(tokens);
      stoppedRawText = rawText;
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

          const completion = await completeLiveRecordingUpload({
            contentType: liveRecordingContentTypeRef.current,
            durationSeconds: elapsedSecondsRef.current,
            recording,
            storagePath: upload.storagePath,
            totalBytes: upload.bytes
          });

          if (!stillOwnsStop(recordingSession, stopGeneration)) {
            return;
          }

          if (completion.id !== recording.id) {
            throw new Error("Audio je uložené, ale metadata nahrávky se neuložila.");
          }

          audioUploadCompleted = true;
          await cleanupConfirmedSafetyAudio(safetySession, completion.id);
        } catch (error) {
          if (!stillOwnsStop(recordingSession, stopGeneration)) {
            return;
          }

          audioSaveError = error instanceof Error ? error : new Error("Audio se nepodařilo uložit.");
        }
      }

      if (!audioUploadCompleted && maxAudioFileSizeBytes !== null) {
        try {
          audioStoredAsSegments = await promoteSafetyAudioSession(
            safetySession,
            elapsedSecondsRef.current
          );
          audioUploadCompleted = audioStoredAsSegments;
        } catch (error) {
          audioSaveError = error instanceof Error
            ? error
            : new Error("Bezpečnostní části audia se nepodařilo uložit.");
        }
      }

      finalDraftPersistOutcome = await persistFinalLiveDraft({
        captureGeneration,
        recording,
        recordingSession,
        stopGeneration
      });

      if (finalDraftPersistOutcome === "stale") {
        return;
      }

      if (!audioUploadCompleted) {
        if (hasCompleteDurableSafetyAudio(safetySession)) {
          setRecorderFeedback(
            finalDraftPersistOutcome === "saved"
              ? "Serverové uložení audia selhalo. Místní bezpečnostní části zůstaly připravené k obnovení a koncept přepisu je uložený."
              : stoppedRawText
                ? "Serverové uložení audia selhalo. Místní audio lze obnovit, ale poslední text se nepodařilo potvrdit na serveru a zůstává v tomto okně."
                : "Serverové uložení audia selhalo. Místní bezpečnostní části zůstaly připravené k obnovení.",
            "error"
          );
          navigateAfterSave(recording.id);
          return;
        }

        throw audioSaveError ?? new Error(
          rawText
            ? "Audio se nepodařilo uložit."
            : "Audio se nepodařilo uložit a není dostupná bezpečnostní kopie."
        );
      }

      if (saveMode === "audio_only") {
        try {
          await requestAsyncTranscription(recording.id);
          setRecorderFeedback("Audio je uložené a přepis běží na pozadí.");
        } catch (error) {
          setRecorderFeedback(
            error instanceof Error
              ? `${error.message} Můžete ho zkusit znovu z detailu nahrávky.`
              : "Audio je uložené, přepis můžete zkusit znovu z detailu nahrávky.",
            "error"
          );
        }

        navigateAfterSave(recording.id);
        return;
      }

      if (!rawText) {
        providerFallbackReasonRef.current ??= "empty_final_text";
      }

      if (!rawText) {
        try {
          await requestAsyncTranscription(recording.id);
          setRecorderFeedback("Audio je uložené. Live přepis byl prázdný, nový přepis běží na pozadí.");
        } catch (error) {
          setRecorderFeedback(
            error instanceof Error
              ? `${error.message} Můžete ho zkusit znovu z detailu nahrávky.`
              : "Audio je uložené, přepis můžete zkusit znovu z detailu nahrávky.",
            "error"
          );
        }
        navigateAfterSave(recording.id);
        return;
      }

      const hasSearchWarning = await saveLiveTranscript(
        recording.id,
        rawText,
        tokens,
        getPersistedLiveTranscriptAudioStorage(
          saveMode,
          audioUploadCompleted,
          audioStoredAsSegments
        )
      );

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }

      if (
        audioUploadCompleted
        && (audioStoredAsSegments || providerFallbackReasonRef.current)
      ) {
        try {
          await requestAsyncTranscription(recording.id, true);
        } catch (error) {
          setRecorderFeedback(
            error instanceof Error
              ? `${error.message} Částečný live přepis i audio zůstaly uložené.`
              : "Audio a částečný live přepis jsou uložené, přepis můžete zkusit znovu z detailu.",
            "error"
          );
          navigateAfterSave(recording.id, hasSearchWarning);
          return;
        }
      }

      setRecorderFeedback(
        hasSearchWarning
          ? TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
          : providerFallbackReasonRef.current
            ? "Audio a částečný live přepis jsou uložené. Nový přepis běží na pozadí."
          : audioStoredAsSegments
            ? "Audio části a live přepis jsou uložené. Úplný přepis běží na pozadí."
          : audioUploadCompleted
          ? "Live nahrávka a přepis jsou uložené."
          : `Audio není potvrzené. ${audioSaveError?.message ?? "Záznam zůstal k obnovení."}`,
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

      if (finalDraftPersistOutcome === null && stoppedRecordingDraft) {
        finalDraftPersistOutcome = await persistFinalLiveDraft({
          captureGeneration,
          recording: stoppedRecordingDraft,
          recordingSession,
          stopGeneration
        });
      }

      if (
        finalDraftPersistOutcome === "stale"
        || !stillOwnsStop(recordingSession, stopGeneration)
      ) {
        return;
      }

      await failLiveRecordingUpload({ message, recording: liveRecordingDraftRef.current });

      if (!stillOwnsStop(recordingSession, stopGeneration)) {
        return;
      }
      setRecorderFeedback(
        stoppedRawText
          ? finalDraftPersistOutcome === "saved"
            ? `${message} Poslední koncept přepisu je uložený.`
            : `${message} Poslední text se nepodařilo potvrdit na serveru a zůstává viditelný jen v tomto okně.`
          : message,
        "error"
      );
    } finally {
      if (stillOwnsStop(recordingSession, stopGeneration)) {
        stopTimer();
        audioChunksRef.current = [];
        audioStartedAtRef.current = null;
        setRealtimeWarning(null);
        setWakeLockWarning(null);
        resetLiveDraftRefs();
        mediaRecorderRef.current = null;
        if (safetyAudioSessionRef.current === safetySession) {
          safetyAudioSessionRef.current = null;
        }
        liveRecordingDraftRef.current = null;
        if (sonioxRecordingRef.current === recordingSession) {
          sonioxRecordingRef.current = null;
        }

        cleanupAudioSession(audioSession);
        void releaseWakeLock();
        recorderStopOwnerRef.current = null;
        setRecorderPhase("idle");
      }
    }
  }

  const audioHealthNotice = getLiveAudioHealthNotice(audioHealth);

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
      {!compact && status === "idle" && liveModeUsesRealtime(saveMode) ? (
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
          {(["audio_and_live_transcript", "audio_only", "live_transcript_only"] as const).map((mode) => (
            <label key={mode}>
              <input
                checked={saveMode === mode}
                disabled={liveModeStoresAudio(mode) && maxAudioFileSizeBytes === null}
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
          (liveModeStoresAudio(saveMode) && maxAudioFileSizeBytes === null)
        }
        onClick={status === "recording" ? () => void stopRecording() : startRecording}
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
      {durabilityWarning ? (
        <p className="recording-state" role="alert">{durabilityWarning}</p>
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
      {status !== "idle" && audioHealthNotice ? (
        <p
          aria-live={audioHealthNotice.tone === "info" ? "polite" : "assertive"}
          className="recording-state"
          role={audioHealthNotice.tone === "info" ? "status" : "alert"}
        >
          {audioHealthNotice.message}
        </p>
      ) : null}
    </div>
  );
}
