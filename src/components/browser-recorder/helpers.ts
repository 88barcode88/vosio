import {
  LIVE_RECORDING_AUDIO_BITS_PER_SECOND,
  formatFileSize
} from "@/lib/recordings/types";
import {
  getSonioxRealtimeLanguageConfig,
  type SonioxRealtimeLanguageId
} from "@/lib/soniox/languages";
import type { Recording, RealtimeToken, RecordOptions } from "@soniox/client";
import type { LiveCaptionBlock, LiveSaveMode, RealtimeConfigErrorCode } from "@/components/browser-recorder/types";

export type RecorderFeedbackTone = "error" | "status" | "working";

// getRecorderFeedbackAnnouncement maps capture feedback to the appropriate screen-reader urgency.
export function getRecorderFeedbackAnnouncement(tone: RecorderFeedbackTone) {
  return tone === "error"
    ? { ariaLive: "assertive" as const, role: "alert" as const }
    : { ariaLive: "polite" as const, role: "status" as const };
}

const preferredMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus"
];

const SONIOX_STOP_TIMEOUT_MS = 5000;
export const LIVE_CAPTION_DISPLAY_DELAY_MS = 2000;
export type StoredRealtimeToken = RealtimeToken & {
  vosio_session_index?: number;
};
export type LiveCaptionToken = StoredRealtimeToken & {
  received_at_ms?: number;
};
export type RealtimeStopOutcome = "failed" | "not_started" | "stopped" | "timed_out";
const liveSpeakerClassNames = [
  "speaker-teal",
  "speaker-violet",
  "speaker-orange",
  "speaker-blue",
  "speaker-green",
  "speaker-red",
  "speaker-cyan",
  "speaker-pink",
  "speaker-amber",
  "speaker-slate"
];

// getSupportedMimeType selects the best MediaRecorder MIME type for the browser.
export function getSupportedMimeType() {
  return preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

// getRealtimeRecordingOptions configures Soniox realtime for long-running live capture.
export function getRealtimeRecordingOptions(
  realtimeModel: string,
  language: SonioxRealtimeLanguageId
): RecordOptions {
  return {
    auto_reconnect: true,
    enable_endpoint_detection: false,
    enable_speaker_diarization: true,
    model: realtimeModel,
    ...getSonioxRealtimeLanguageConfig(language)
  };
}

// formatElapsedTime renders a compact recording timer for the live recorder.
export function formatElapsedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const restSeconds = (seconds % 60).toString().padStart(2, "0");

  return `${minutes}:${restSeconds}`;
}

// getTokenKey creates a session-aware key for deduplicating finalized realtime tokens.
export function getTokenKey(token: StoredRealtimeToken) {
  return `${token.vosio_session_index ?? 0}:${token.start_ms ?? "x"}:${token.end_ms ?? "x"}:${token.speaker ?? "s"}:${token.text}`;
}

// normalizeRealtimeToken converts session-relative Soniox times to one recording-wide timeline.
export function normalizeRealtimeToken(
  token: RealtimeToken,
  sessionIndex: number,
  sessionOffsetMs: number
): StoredRealtimeToken {
  return {
    ...token,
    ...(typeof token.end_ms === "number" ? { end_ms: token.end_ms + sessionOffsetMs } : {}),
    ...(typeof token.start_ms === "number" ? { start_ms: token.start_ms + sessionOffsetMs } : {}),
    vosio_session_index: sessionIndex
  };
}

// mergeRealtimeResultTokens appends finalized tokens and replaces the provider's provisional window.
export function mergeRealtimeResultTokens(
  currentFinalTokens: StoredRealtimeToken[],
  resultTokens: RealtimeToken[],
  sessionIndex: number,
  sessionOffsetMs: number
) {
  const normalizedTokens = resultTokens.map((token) => (
    normalizeRealtimeToken(token, sessionIndex, sessionOffsetMs)
  ));
  const finalByKey = new Map(currentFinalTokens.map((token) => [getTokenKey(token), token]));

  normalizedTokens.filter((token) => token.is_final).forEach((token) => {
    finalByKey.set(getTokenKey(token), token);
  });

  const finalTokens = [...finalByKey.values()];
  const partialTokens = normalizedTokens.filter((token) => !token.is_final);

  return {
    finalTokens,
    partialTokens,
    tokens: [...finalTokens, ...partialTokens]
  };
}

// promoteRealtimePartialTokens preserves the last audible words before a replacement Soniox session.
export function promoteRealtimePartialTokens(
  currentFinalTokens: StoredRealtimeToken[],
  partialTokens: StoredRealtimeToken[]
) {
  const finalByKey = new Map(currentFinalTokens.map((token) => [getTokenKey(token), token]));

  partialTokens.forEach((token) => {
    const promotedToken = { ...token, is_final: true };

    finalByKey.set(getTokenKey(promotedToken), promotedToken);
  });

  return [...finalByKey.values()];
}

// getLiveSpeakerLabel renders Soniox realtime speaker ids as compact labels.
export function getLiveSpeakerLabel(token: RealtimeToken) {
  return token.speaker !== undefined && token.speaker !== null
    ? `Mluvčí ${token.speaker}`
    : "Mluvčí ?";
}

// getLiveSpeakerClassName keeps live speaker chips visually stable during recording.
export function getLiveSpeakerClassName(token: RealtimeToken) {
  const speaker = token.speaker;

  if (speaker === undefined || speaker === null) {
    return "speaker-teal";
  }

  const index = typeof speaker === "number"
    ? speaker
    : Math.abs(String(speaker).split("").reduce((total, char) => total + char.charCodeAt(0), 0));

  return liveSpeakerClassNames[index % liveSpeakerClassNames.length];
}

// joinRealtimeTokenText joins provider token text without adding fake spaces between partial tokens.
export function joinRealtimeTokenText(tokens: Array<Pick<RealtimeToken, "text">>) {
  return tokens.map((token) => token.text).join("").replace(/\s+/g, " ").trim();
}

// tokensToText joins realtime tokens into a readable transcript string.
export function tokensToText(tokens: RealtimeToken[]) {
  return joinRealtimeTokenText(tokens);
}

// tokensToCaptionBlocks groups consecutive realtime tokens by speaker for live captions.
export function tokensToCaptionBlocks(tokens: RealtimeToken[]): LiveCaptionBlock[] {
  return tokens.reduce<Array<LiveCaptionBlock & { tokens: RealtimeToken[] }>>((blocks, token) => {
    const text = token.text.trim();

    if (!text) {
      return blocks;
    }

    const speaker = getLiveSpeakerLabel(token);
    const previous = blocks.at(-1);

    if (previous?.speaker === speaker) {
      const nextTokens = [...previous.tokens, token];

      return [
        ...blocks.slice(0, -1),
        {
          ...previous,
          text: joinRealtimeTokenText(nextTokens),
          tokens: nextTokens
        }
      ];
    }

    return [
      ...blocks,
      {
        speaker,
        speakerClassName: getLiveSpeakerClassName(token),
        text: joinRealtimeTokenText([token]),
        tokens: [token]
      }
    ];
  }, []).map(({ tokens: _tokens, ...block }) => block);
}

// getStableLiveCaptionTokens delays live caption display so partial Soniox tokens can settle first.
export function getStableLiveCaptionTokens(
  tokens: LiveCaptionToken[],
  nowMs: number,
  delayMs = LIVE_CAPTION_DISPLAY_DELAY_MS
) {
  return tokens.filter((token) => {
    if (typeof token.received_at_ms === "number") {
      return nowMs - token.received_at_ms >= delayMs;
    }

    const providerAgeMs =
      typeof token.end_ms === "number"
        ? nowMs - token.end_ms
        : typeof token.start_ms === "number"
          ? nowMs - token.start_ms
          : null;

    if (providerAgeMs !== null) {
      return providerAgeMs >= delayMs;
    }

    return true;
  });
}

// stopRealtimeRecording waits briefly for final Soniox tokens without blocking audio saving.
export async function stopRealtimeRecording(recording: Recording | null) {
  if (!recording) {
    return "not_started" as const;
  }

  let timeoutId: number | null = null;
  const outcome = await Promise.race<Exclude<RealtimeStopOutcome, "not_started">>([
    recording.stop().then(
      () => "stopped" as const,
      () => "failed" as const
    ),
    new Promise<"timed_out">((resolve) => {
      timeoutId = window.setTimeout(() => {
        resolve("timed_out");
      }, SONIOX_STOP_TIMEOUT_MS);
    })
  ]);

  if (timeoutId) {
    window.clearTimeout(timeoutId);
  }

  if (outcome === "timed_out") {
    recording.cancel();
  }

  return outcome;
}

// getRecordedFileExtension maps MediaRecorder output MIME types to archive file extensions.
export function getRecordedFileExtension(mimeType: string) {
  return mimeType.includes("mp4") ? "m4a" : "webm";
}

// getRealtimeErrorMessage exposes provider errors without leaking any secret values.
export function getRealtimeErrorMessage(error: Error, saveMode: LiveSaveMode) {
  const baseMessage = error.message ? `Live přepis má chybu: ${error.message}.` : "Live přepis má chybu.";

  return saveMode !== "live_transcript_only"
    ? `${baseMessage} Lokální audio může dál pokračovat.`
    : `${baseMessage} Textový režim potřebuje funkční live přepis.`;
}

// getRealtimeConfigErrorMessage converts realtime key API failures into actionable UI text.
export function getRealtimeConfigErrorMessage(
  code: RealtimeConfigErrorCode | undefined,
  requestId?: string
) {
  const messages: Record<RealtimeConfigErrorCode, string> = {
    server_env_invalid: "Realtime konfigurace na serveru není platná.",
    soniox_auth_or_region: "Soniox API key neodpovídá nastavenému regionu.",
    soniox_eu_access_required:
      "EU region Soniox vyžaduje EU Soniox projekt a odpovídající regionální API key. " +
      "Kontaktujte support@soniox.com.",
    soniox_request_failed: "Soniox nevydal dočasný realtime klíč.",
    unknown: "Nepovedlo se získat realtime klíč."
  };

  const resolvedCode = code ?? "unknown";
  const message = messages[resolvedCode];

  return resolvedCode === "soniox_eu_access_required" && requestId
    ? `${message} ID požadavku: ${requestId}.`
    : message;
}

// isSafeRecordingStartErrorMessage allows only curated startup errors into visible UI.
export function isSafeRecordingStartErrorMessage(message: string) {
  return [
    "Realtime konfigurace",
    "EU region Soniox",
    "Soniox API key",
    "Soniox nevydal",
    "Nepovedlo se získat"
  ].some((prefix) => message.startsWith(prefix));
}

// getRecordingStartErrorMessage keeps provider/config errors visible during live recording startup.
export function getRecordingStartErrorMessage(error: unknown) {
  if (error instanceof Error && error.message && isSafeRecordingStartErrorMessage(error.message)) {
    return `Nahrávání se nepodařilo spustit: ${error.message}`;
  }

  return "Mikrofon se nepodařilo spustit. Zkontrolujte oprávnění prohlížeče.";
}

// getBufferedRecordingSize sums MediaRecorder chunks kept for the final upload.
export function getBufferedRecordingSize(chunks: Blob[]) {
  return chunks.reduce((total, chunk) => total + chunk.size, 0);
}

// getEstimatedLiveRecordingBytes estimates the current encoded audio size from its bitrate.
export function getEstimatedLiveRecordingBytes(audioBitsPerSecond: number, elapsedSeconds: number) {
  const bitrate = audioBitsPerSecond > 0
    ? audioBitsPerSecond
    : LIVE_RECORDING_AUDIO_BITS_PER_SECOND;

  return Math.ceil((bitrate * Math.max(0, elapsedSeconds)) / 8);
}

// shouldStopLiveRecordingAtAudioLimit reserves encoder headroom before the owned final save begins.
export function shouldStopLiveRecordingAtAudioLimit(
  audioBitsPerSecond: number,
  elapsedSeconds: number,
  maxBytes: number
) {
  return getEstimatedLiveRecordingBytes(audioBitsPerSecond, elapsedSeconds) >= maxBytes;
}

// getLiveRecordingTitle creates a readable title for browser live captures.
export function getLiveRecordingTitle(prefix: string) {
  return `${prefix} ${new Date().toLocaleString("cs-CZ")}`;
}

// getSaveModeLabel maps live save modes into short Czech UI labels.
export function getSaveModeLabel(mode: LiveSaveMode, maxAudioFileSizeBytes: number | null) {
  if (mode === "live_transcript_only") {
    return "Jen live přepis";
  }

  if (maxAudioFileSizeBytes === null) {
    return mode === "audio_only"
      ? "Jen audio není dostupné"
      : "Audio + live přepis není dostupné";
  }

  return mode === "audio_only"
    ? `Jen audio do ${formatFileSize(maxAudioFileSizeBytes)}`
    : `Audio do ${formatFileSize(maxAudioFileSizeBytes)} + live přepis`;
}

// getRecordingActiveMessage keeps the active capture status separate from provider and Wake Lock warnings.
export function getRecordingActiveMessage(mode: LiveSaveMode, maxAudioFileSizeBytes: number | null) {
  if (mode === "audio_and_live_transcript" && maxAudioFileSizeBytes !== null) {
    return `Nahrávání a přepis probíhají. Audio se uloží do ${formatFileSize(maxAudioFileSizeBytes)}.`;
  }

  if (mode === "audio_only" && maxAudioFileSizeBytes !== null) {
    return `Nahrávání probíhá. Audio se uloží do ${formatFileSize(maxAudioFileSizeBytes)} a potom se odešle k přepisu.`;
  }

  return "Přepisuji živě bez ukládání audio souboru.";
}

// getWakeLockWarning explains only the screen-awake capability, never the realtime recording state.
export function getWakeLockWarning(hasWakeLock: boolean) {
  return hasWakeLock
    ? null
    : "Prohlížeč nedovolil udržet obrazovku vzhůru. Během nahrávání telefon nezamykejte.";
}

// getRealtimeStateWarning describes provider lifecycle changes without claiming that local audio capture stopped.
export function getRealtimeStateWarning(
  state: "reconnecting" | "error" | "canceled",
  saveMode: LiveSaveMode
) {
  if (state === "reconnecting") {
    return "Live přepis se znovu připojuje. Nahrávání pokračuje.";
  }

  if (state === "canceled") {
    return saveMode !== "live_transcript_only"
      ? "Live přepis byl zrušen. Lokální audio se může dál nahrávat."
      : "Live přepis byl zrušen. Textový režim nebude dostávat další přepis.";
  }

  return saveMode !== "live_transcript_only"
    ? "Live přepis narazil na chybu. Lokální audio se může dál nahrávat."
    : "Live přepis narazil na chybu. Textový režim nebude dostávat další přepis.";
}

// liveModeStoresAudio reports whether the selected mode owns an archive recorder.
export function liveModeStoresAudio(mode: LiveSaveMode) {
  return mode !== "live_transcript_only";
}

// liveModeUsesRealtime reports whether the selected mode starts Soniox realtime transcription.
export function liveModeUsesRealtime(mode: LiveSaveMode) {
  return mode !== "audio_only";
}

// getPersistedLiveTranscriptAudioStorage maps product modes onto existing provider metadata values.
export function getPersistedLiveTranscriptAudioStorage(
  mode: LiveSaveMode,
  audioUploadCompleted: boolean,
  audioStoredAsSegments = false
): "supabase_recording_segments" | "supabase_recording_upload" | "transcript_only" {
  return liveModeStoresAudio(mode) && audioUploadCompleted
    ? audioStoredAsSegments
      ? "supabase_recording_segments"
      : "supabase_recording_upload"
    : "transcript_only";
}
