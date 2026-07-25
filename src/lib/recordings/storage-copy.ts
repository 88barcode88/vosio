import { formatFileSize } from "@/lib/recordings/types";

// getUnavailableRecordingStorageCopy gives every capture path the same non-technical availability notice.
export function getUnavailableRecordingStorageCopy() {
  return "Audio soubory teď nelze ukládat. Live přepis i vložení hotového přepisu fungují dál.";
}

// getLiveAudioStorageCopy explains the separate live-recording audio limit without exposing Storage internals.
export function getLiveAudioStorageCopy(maxFileSizeBytes: number | null) {
  if (maxFileSizeBytes === null) {
    return "Přepis se uloží vždy; audio se teď neukládá.";
  }

  return `Audio se uloží do ${formatFileSize(maxFileSizeBytes)}. Přepis se uloží vždy.`;
}

// getManualUploadStorageCopy explains the current connected Storage limit for manually selected files.
export function getManualUploadStorageCopy(maxFileSizeBytes: number | null) {
  if (maxFileSizeBytes === null) {
    return getUnavailableRecordingStorageCopy();
  }

  return `Soubor můžete nahrát do ${formatFileSize(maxFileSizeBytes)}.`;
}
