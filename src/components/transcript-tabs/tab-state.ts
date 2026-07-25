import { transcriptTabIds } from "@/components/transcript-tabs/constants";
import type { TranscriptTab } from "@/components/transcript-tabs/types";
import type { RecordingRow } from "@/lib/recordings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

export const VOSIO_ACTIVE_RECORDING_TAB_COOKIE = "vosio-active-recording-tab";

// isTranscriptTab validates tab ids read from browser storage.
export function isTranscriptTab(value: string | null): value is TranscriptTab {
  return transcriptTabIds.some((tabId) => tabId === value);
}

// getTranscriptTabStorageKey scopes browser tab memory to one recording detail.
export function getTranscriptTabStorageKey(activeRecording: RecordingRow | null) {
  return activeRecording ? `vosio:recording:${activeRecording.id}:active-tab` : "vosio:recording:new:active-tab";
}

// getTranscriptTabCookieValue serializes the last active tab for server-side refresh rendering.
export function getTranscriptTabCookieValue(recordingId: string, tab: TranscriptTab) {
  return `${recordingId}:${tab}`;
}

// parseTranscriptTabCookieValue validates a refresh tab cookie for the current recording only.
export function parseTranscriptTabCookieValue(
  recordingId: string,
  value: string | null | undefined
): TranscriptTab | null {
  const decodedValue = decodeCookieValue(value);

  if (!decodedValue?.startsWith(`${recordingId}:`)) {
    return null;
  }

  const tab = decodedValue.slice(recordingId.length + 1);

  return isTranscriptTab(tab) ? tab : null;
}

// decodeCookieValue safely decodes values written by the client tab persistence helper.
function decodeCookieValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// getTranscriptStatusLabel describes the current transcription state in the tab footer.
export function getTranscriptStatusLabel(
  activeRecording: RecordingRow | null,
  activeTranscript: TranscriptRow | null
) {
  if (activeTranscript) {
    return "Přepis uložený v Supabase";
  }

  if (!activeRecording) {
    return "Bez aktivní nahrávky";
  }

  const labels: Record<RecordingRow["status"], string> = {
    completed: "Přepis se načítá",
    created: "Nahrávka se připravuje",
    deleted: "Nahrávka je v koši",
    failed: "Přepis selhal",
    transcribing: "Soniox zpracovává přepis",
    uploaded: "Připraveno ke spuštění přepisu",
    uploading: "Audio se nahrává"
  };

  return labels[activeRecording.status];
}
