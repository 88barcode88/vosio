export const RECORDINGS_BUCKET = "recordings";

export const LIVE_RECORDING_AUDIO_BITS_PER_SECOND = 128000;
export const SEGMENTED_RECORDING_STORAGE_FOLDER = "live";

export const ACCEPTED_RECORDING_MIME_TYPES = [
  "audio/aac",
  "audio/aiff",
  "audio/amr",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-aiff",
  "audio/x-m4a",
  "application/vnd.ms-asf",
  "video/x-ms-asf",
  "video/mp4"
] as const;

export const ACCEPTED_RECORDING_FILE_EXTENSIONS = [
  ".aac",
  ".aif",
  ".aiff",
  ".amr",
  ".asf",
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".ogg",
  ".wav",
  ".webm"
] as const;

export const RECORDING_FILE_ACCEPT = [
  "audio/*",
  "video/mp4",
  ...ACCEPTED_RECORDING_MIME_TYPES,
  ...ACCEPTED_RECORDING_FILE_EXTENSIONS
] as const;

export const RECORDING_MIME_TYPE_BY_EXTENSION: Record<string, AcceptedRecordingMimeType> = {
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  amr: "audio/amr",
  asf: "video/x-ms-asf",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm"
};

export type AcceptedRecordingMimeType = (typeof ACCEPTED_RECORDING_MIME_TYPES)[number];

export type RecordingStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "transcribing"
  | "completed"
  | "failed"
  | "deleted";

export type RecordingRow = {
  client_id: string | null;
  id: string;
  created_at: string;
  duration_seconds: number | null;
  error_message: string | null;
  file_size_bytes: number | null;
  folder_id: string | null;
  mime_type: string | null;
  project_id: string | null;
  source_type: "upload" | "in_app_recording" | "realtime";
  status: RecordingStatus;
  storage_path: string | null;
  title: string;
  updated_at: string;
  user_id: string;
};

export type RecordingSearchResult = {
  clientId: string | null;
  createdAt: string;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  folderId: string | null;
  id: string;
  matchedExcerpt: string | null;
  matchEndMs: number | null;
  matchStartMs: number | null;
  mimeType: string | null;
  projectId: string | null;
  sourceType: RecordingRow["source_type"];
  status: RecordingStatus;
  title: string;
  updatedAt: string;
};

export type RecordingSearchPage = {
  page: number;
  pageSize: number;
  results: RecordingSearchResult[];
  totalCount: number;
};

// isSegmentedRecordingStoragePath detects live audio archives stored as multiple objects.
export function isSegmentedRecordingStoragePath(storagePath: string | null | undefined) {
  return storagePath?.endsWith(`/${SEGMENTED_RECORDING_STORAGE_FOLDER}/`) ?? false;
}

// normalizeAudioMimeType strips browser codec parameters before validation and Storage upload.
export function normalizeAudioMimeType(mimeType: string) {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

// getRecordingContentType returns a Storage-safe MIME type, falling back to extension when needed.
export function getRecordingContentType(file: File) {
  const normalizedMimeType = normalizeAudioMimeType(file.type);

  if (normalizedMimeType) {
    return normalizedMimeType;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  return RECORDING_MIME_TYPE_BY_EXTENSION[extension] ?? "";
}

// formatFileSize renders storage byte counts for the recording workspace.
export function formatFileSize(bytes: number | null) {
  if (!bytes) {
    return "bez velikosti";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

// formatRecordingDate renders recording timestamps for compact Czech UI labels.
// The time zone is pinned so SSR (UTC) and the browser render identical text (no hydration mismatch).
export function formatRecordingDate(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
    timeZone: "Europe/Prague",
    year: "numeric"
  }).format(new Date(value));
}

// getStatusLabel maps database statuses into user-facing Czech labels.
export function getStatusLabel(status: RecordingStatus) {
  const labels: Record<RecordingStatus, string> = {
    completed: "Dokončeno",
    created: "Vytvořeno",
    deleted: "Smazáno",
    failed: "Chyba",
    transcribing: "Přepisuje se",
    uploaded: "Nahráno",
    uploading: "Nahrává se"
  };

  return labels[status];
}
