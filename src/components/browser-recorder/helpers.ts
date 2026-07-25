import {
  LIVE_RECORDING_AUDIO_BITS_PER_SECOND,
  formatFileSize
} from "@/lib/recordings/types";
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
export type LiveCaptionToken = RealtimeToken & {
  received_at_ms?: number;
};
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
export function getRealtimeRecordingOptions(realtimeModel: string): RecordOptions {
  return {
    auto_reconnect: true,
    enable_endpoint_detection: false,
    enable_language_identification: true,
    enable_speaker_diarization: true,
    language_hints: ["cs"],
    model: realtimeModel
  };
}

// formatElapsedTime renders a compact recording timer for the live recorder.
export function formatElapsedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const restSeconds = (seconds % 60).toString().padStart(2, "0");

  return `${minutes}:${restSeconds}`;
}

// getTokenKey creates a stable best-effort key for deduplicating realtime tokens.
export function getTokenKey(token: RealtimeToken) {
  return `${token.start_ms ?? "x"}:${token.end_ms ?? "x"}:${token.speaker ?? "s"}:${token.text}`;
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
    const providerAgeMs =
      typeof token.end_ms === "number"
        ? nowMs - token.end_ms
        : typeof token.start_ms === "number"
          ? nowMs - token.start_ms
          : null;

    if (providerAgeMs !== null) {
      return providerAgeMs >= delayMs;
    }

    return typeof token.received_at_ms === "number" ? nowMs - token.received_at_ms >= delayMs : true;
  });
}

// stopRealtimeRecording waits briefly for final Soniox tokens without blocking audio saving.
export async function stopRealtimeRecording(recording: Recording | null) {
  if (!recording) {
    return;
  }

  let timeoutId: number | null = null;
  let timedOut = false;

  await Promise.race([
    recording.stop().catch(() => undefined),
    new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(() => {
        timedOut = true;
        resolve();
      }, SONIOX_STOP_TIMEOUT_MS);
    })
  ]);

  if (timeoutId) {
    window.clearTimeout(timeoutId);
  }

  if (timedOut) {
    recording.cancel();
  }
}

// getRecordedFileExtension maps MediaRecorder output MIME types to archive file extensions.
export function getRecordedFileExtension(mimeType: string) {
  return mimeType.includes("mp4") ? "m4a" : "webm";
}

// getRealtimeErrorMessage exposes provider errors without leaking any secret values.
export function getRealtimeErrorMessage(error: Error, saveMode: LiveSaveMode) {
  const baseMessage = error.message ? `Live přepis má chybu: ${error.message}.` : "Live přepis má chybu.";

  return saveMode === "audio_and_transcript"
    ? `${baseMessage} Lokální audio může dál pokračovat.`
    : `${baseMessage} Textový režim potřebuje funkční live přepis.`;
}

// getRealtimeConfigErrorMessage converts realtime key API failures into actionable UI text.
export function getRealtimeConfigErrorMessage(code: RealtimeConfigErrorCode | undefined) {
  const messages: Record<RealtimeConfigErrorCode, string> = {
    server_env_invalid: "Realtime konfigurace na serveru není platná.",
    soniox_auth_or_region: "Soniox API key neodpovídá nastavenému regionu.",
    soniox_request_failed: "Soniox nevydal dočasný realtime klíč.",
    unknown: "Nepovedlo se získat realtime klíč."
  };

  return messages[code ?? "unknown"];
}

// isSafeRecordingStartErrorMessage allows only curated startup errors into visible UI.
export function isSafeRecordingStartErrorMessage(message: string) {
  return [
    "Realtime konfigurace",
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

// shouldDiscardLiveRecordingAudio switches long live sessions to transcript-only before Storage rejects them.
export function shouldDiscardLiveRecordingAudio(
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
  if (mode === "transcript_only") {
    return "Jen live přepis";
  }

  return maxAudioFileSizeBytes === null
    ? "Audio není dostupné"
    : `Audio do ${formatFileSize(maxAudioFileSizeBytes)} + přepis`;
}

// getRecordingActiveMessage keeps the active capture status separate from provider and Wake Lock warnings.
export function getRecordingActiveMessage(mode: LiveSaveMode, maxAudioFileSizeBytes: number | null) {
  if (mode === "audio_and_transcript" && maxAudioFileSizeBytes !== null) {
    return `Nahrávání a přepis probíhají. Audio se uloží do ${formatFileSize(maxAudioFileSizeBytes)}.`;
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
    return saveMode === "audio_and_transcript"
      ? "Live přepis byl zrušen. Lokální audio se může dál nahrávat."
      : "Live přepis byl zrušen. Textový režim nebude dostávat další přepis.";
  }

  return saveMode === "audio_and_transcript"
    ? "Live přepis narazil na chybu. Lokální audio se může dál nahrávat."
    : "Live přepis narazil na chybu. Textový režim nebude dostávat další přepis.";
}

// getLiveAudioFallbackMessage reports the precise reason a completed live transcript has no audio file.
export function getLiveAudioFallbackMessage(input: {
  audioDiscardedForSize: boolean;
  maxAudioFileSizeBytes: number | null;
}) {
  if (input.maxAudioFileSizeBytes === null) {
    return "Přepis je uložený bez audia, protože ukládání audia teď není dostupné.";
  }

  if (input.audioDiscardedForSize) {
    return `Přepis je uložený bez audia, protože ukládání audia bylo zastaveno s rezervou před limitem ${formatFileSize(input.maxAudioFileSizeBytes)}.`;
  }

  return `Přepis je uložený bez audia, protože výsledný audio soubor byl prázdný, neplatný nebo překročil limit ${formatFileSize(input.maxAudioFileSizeBytes)}.`;
}
