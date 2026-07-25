"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mic, Square } from "lucide-react";
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
import type {
  BrowserRecorderProps,
  LiveCaptionBlock,
  LiveSaveMode,
  RealtimeConfig,
  RealtimeConfigErrorCode,
  RecorderStatus
} from "@/components/browser-recorder/types";
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

// BrowserRecorder captures microphone audio and can save audio plus transcript or transcript text only.
export function BrowserRecorder({
  allowTranscriptOnly = false,
  captionMode = false,
  compact = false,
  maxAudioFileSizeBytes,
  onStatusChange,
  redirectAfterSave,
  realtimeModel = "stt-rt-v5"
}: BrowserRecorderProps) {
  const router = useRouter();
  const { registerNavigationBlocker } = useRecordingNavigationBlocker();
  const elapsedSecondsRef = useRef(0);
  const audioDiscardedForSizeRef = useRef(false);
  const audioDiscardPromiseRef = useRef<Promise<void> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStartedAtRef = useRef<number | null>(null);
  const liveRecordingContentTypeRef = useRef("audio/webm");
  const liveRecordingDraftRef = useRef<LiveRecordingDraft | null>(null);
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
  const [feedback, setFeedback] = useState<RecorderFeedback | null>(null);
  const [realtimeWarning, setRealtimeWarning] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState<LiveSaveMode>(
    maxAudioFileSizeBytes === null && allowTranscriptOnly
      ? "transcript_only"
      : "audio_and_transcript"
  );
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [wakeLockWarning, setWakeLockWarning] = useState<string | null>(null);

  // setRecorderFeedback keeps ordinary capture state separate from assertive errors and provider warnings.
  function setRecorderFeedback(message: string, tone: RecorderFeedbackTone = "status") {
    setFeedback({ message, tone });
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
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }

      sonioxRecordingRef.current?.cancel();

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
  async function createLocalMediaRecorder() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mimeType = getSupportedMimeType();
    const contentType = mimeType ? mimeType.split(";")[0] ?? "audio/webm" : "audio/webm";
    const recording = await createLiveRecordingDraft({
      contentType,
      title: getLiveRecordingTitle("Live nahrávka")
    });

    liveRecordingContentTypeRef.current = contentType;
    liveRecordingDraftRef.current = recording;
    audioChunksRef.current = [];
    audioDiscardedForSizeRef.current = false;
    audioDiscardPromiseRef.current = null;
    audioStartedAtRef.current = null;
    startLocalAudioRecording();
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

    setStatus("starting");
    setRecorderFeedback("Připravuji mikrofon a live přepis...", "working");

    try {
      const client = new SonioxClient({
        config: fetchRealtimeConfig,
        permissions: new BrowserPermissionResolver()
      });
      const recording = client.realtime.record(getRealtimeRecordingOptions(realtimeModel));

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
      sonioxRecordingRef.current = recording;
      recording.on("result", (result) => {
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
      recording.on("connected", () => {
        setRealtimeWarning(null);
      });
      recording.on("error", (error) => {
        setRealtimeWarning(getRealtimeErrorMessage(error, selectedSaveMode));
      });
      recording.on("reconnecting", () => {
        setRealtimeWarning(getRealtimeStateWarning("reconnecting", selectedSaveMode));
      });
      recording.on("reconnected", () => {
        setRealtimeWarning(null);
      });
      recording.on("state_change", (update) => {
        if (update.new_state === "recording") {
          setStatus("recording");
          setRealtimeWarning(null);
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
        await createLocalMediaRecorder();
      } else {
        liveRecordingDraftRef.current = await createTranscriptOnlyDraft();
      }

      await requestWakeLock();
      setRecorderFeedback(getRecordingActiveMessage(selectedSaveMode, selectedMaxAudioFileSizeBytes));
      setStatus("recording");
      timerRef.current = window.setInterval(() => {
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

      await failLiveRecordingUpload({ message, recording: liveRecordingDraftRef.current });
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
      resetLiveDraftRefs();
      void releaseWakeLock();
      setStatus("idle");
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
      | "transcript_only" = "supabase_recording_segments"
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
  }

  // createTranscriptOnlyRecording stores or completes a recording row without an audio object.
  async function createTranscriptOnlyRecording(rawText: string, tokens: RealtimeToken[]) {
    const draft = liveRecordingDraftRef.current;

    if (draft) {
      await saveLiveTranscript(draft.id, rawText, tokens, "transcript_only");

      return draft.id;
    }

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
        duration_seconds: elapsedSecondsRef.current,
        file_size_bytes: 0,
        source_type: "realtime",
        status: "uploaded",
        title: getLiveRecordingTitle("Live přepis"),
        user_id: user.id
      })
      .select("id")
      .single();

    if (error || !recording) {
      throw new Error("Nepovedlo se vytvořit záznam live přepisu.");
    }

    await saveLiveTranscript(recording.id, rawText, tokens, "transcript_only");

    return recording.id as string;
  }

  // navigateAfterSave moves the user to the configured destination after saving a recording.
  function navigateAfterSave(recordingId: string) {
    if (redirectAfterSave === "detail") {
      router.push(`/recordings/${recordingId}`);
      return;
    }

    if (redirectAfterSave === "list") {
      router.push("/recordings");
      return;
    }

    router.refresh();
  }

  // finishTranscriptOnlyRecording stops Soniox and saves only the live transcript text.
  async function finishTranscriptOnlyRecording() {
    setStatus("saving");
    setRecorderFeedback("Dokončuji live přepis a ukládám text...", "working");

    try {
      stopTimer();
      await stopRealtimeRecording(sonioxRecordingRef.current);
      await saveLiveDraft();

      const tokens = [...tokensRef.current.values()];
      const rawText = tokensToText(tokens);

      if (!rawText) {
        setRecorderFeedback("Live přepis je prázdný. Není co uložit.", "error");
        return;
      }

      const recordingId = await createTranscriptOnlyRecording(rawText, tokens);

      setRecorderFeedback("Live přepis je uložený bez audio souboru.");
      navigateAfterSave(recordingId);
    } catch (error) {
      setRecorderFeedback(error instanceof Error ? error.message : "Live přepis se nepodařilo uložit.", "error");
    } finally {
      stopTimer();
      sonioxRecordingRef.current = null;
      liveRecordingDraftRef.current = null;
      resetLiveDraftRefs();
      void releaseWakeLock();
      setStatus("idle");
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

    let audioUploadCompleted = false;
    stopTimer();

    try {
      setStatus("saving");
      setRecorderFeedback("Dokončuji live přepis a ukládám nahrávku...", "working");

      const audioBlob = await finalizeLocalAudioBlob();
      await stopRealtimeRecording(sonioxRecordingRef.current);
      await saveLiveDraft();

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
          audioUploadCompleted = true;
        } catch (error) {
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
      }

      if (!rawText) {
        setRecorderFeedback("Audio je uložené, ale live přepis zůstal prázdný.");
        navigateAfterSave(recording.id);
        return;
      }

      await saveLiveTranscript(
        recording.id,
        rawText,
        tokens,
        audioUploadCompleted ? "supabase_recording_upload" : "transcript_only"
      );
      setRecorderFeedback(
        audioUploadCompleted
          ? "Live nahrávka a přepis jsou uložené."
          : audioSaveError
            ? `Přepis je uložený bez audia. ${audioSaveError.message}`
            : getLiveAudioFallbackMessage({
              audioDiscardedForSize: audioLimitReached || audioDiscardedForSizeRef.current,
              maxAudioFileSizeBytes
            }),
        audioSaveError ? "error" : "status"
      );
      navigateAfterSave(recording.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nahrávku se nepodařilo uložit.";

      if (audioUploadCompleted && liveRecordingDraftRef.current) {
        setRecorderFeedback(`${message} Audio je uložené, live přepis můžete zkusit znovu z detailu.`, "error");
        navigateAfterSave(liveRecordingDraftRef.current.id);
        return;
      }

      await failLiveRecordingUpload({ message, recording: liveRecordingDraftRef.current });
      setRecorderFeedback(error instanceof Error ? error.message : "Nahrávku se nepodařilo uložit.", "error");
    } finally {
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
      sonioxRecordingRef.current = null;
      cleanupStream();
      void releaseWakeLock();
      setStatus("idle");
    }
  }

  return (
    <div
      aria-busy={status === "starting" || status === "saving"}
      className={compact ? "browser-recorder browser-recorder-compact" : "browser-recorder"}
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
          <Link href="/recordings/new">Otevřít nahrávání</Link>
        </div>
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
