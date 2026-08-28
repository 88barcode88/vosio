export const RECORDINGS_BUCKET = "recordings";

export const LIVE_RECORDING_AUDIO_BITS_PER_SECOND = 128000;
export const SEGMENTED_RECORDING_STORAGE_FOLDER = "live";

export const ACCEPTED_RECORDING_MIME_TYPES = [
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "video/mp4"
] as const;

const RECORDING_FORMATS = [
  { extensions: [".m4a"], label: "M4A", mimeTypes: ["audio/m4a", "audio/mp4", "audio/x-m4a"] },
  { extensions: [".mp3"], label: "MP3", mimeTypes: ["audio/mp3", "audio/mpeg"] },
  { extensions: [".wav"], label: "WAV", mimeTypes: ["audio/vnd.wave", "audio/wav", "audio/x-wav"] },
  { extensions: [".webm"], label: "WebM", mimeTypes: ["audio/webm", "video/webm"] },
  { extensions: [".ogg"], label: "OGG", mimeTypes: ["application/ogg", "audio/ogg"] },
  { extensions: [".flac"], label: "FLAC", mimeTypes: ["audio/flac", "audio/x-flac"] },
  { extensions: [".mp4"], label: "MP4", mimeTypes: ["video/mp4"] }
] as const;

const SUPPORTED_RECORDING_MIME_TYPES = [...new Set(
  RECORDING_FORMATS.flatMap((format) => [...format.mimeTypes])
)];

export type AcceptedRecordingMimeType = (typeof ACCEPTED_RECORDING_MIME_TYPES)[number];

export const activeRecordingStatuses = [
  "created",
  "uploading",
  "uploaded",
  "transcribing",
  "completed",
  "failed"
] as const;

export type ActiveRecordingStatus = (typeof activeRecordingStatuses)[number];

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
  deleted_at?: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  file_size_bytes: number | null;
  folder_id: string | null;
  mime_type: string | null;
  purge_after?: string | null;
  project_id: string | null;
  source_type: "upload" | "in_app_recording" | "realtime";
  status: RecordingStatus;
  storage_path: string | null;
  title: string;
  trash_retention_hours?: 24 | 168 | 720 | null;
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

// getSupportedRecordingMimeTypes intersects Supabase bucket rules with Soniox-compatible browser MIME types.
export function getSupportedRecordingMimeTypes(bucketRules: readonly string[]) {
  const normalizedRules = bucketRules.map(normalizeAudioMimeType).filter(Boolean);

  return SUPPORTED_RECORDING_MIME_TYPES.filter((mimeType) => normalizedRules.some((rule) => {
    if (rule === mimeType) return true;
    return rule.endsWith("/*") && mimeType.startsWith(rule.slice(0, -1));
  }));
}

// isSupportedRecordingMimeType gates stored files before they are sent to Soniox.
export function isSupportedRecordingMimeType(mimeType: string | null | undefined) {
  return mimeType
    ? SUPPORTED_RECORDING_MIME_TYPES.includes(normalizeAudioMimeType(mimeType) as typeof SUPPORTED_RECORDING_MIME_TYPES[number])
    : false;
}

// getRecordingContentType resolves only an explicit browser MIME against the runtime bucket allowlist.
export function getRecordingContentType(
  file: Pick<File, "type">,
  allowedMimeTypes: readonly string[] = ACCEPTED_RECORDING_MIME_TYPES
) {
  const normalizedMimeType = normalizeAudioMimeType(file.type);

  if (allowedMimeTypes.includes(normalizedMimeType)) {
    return normalizedMimeType;
  }

  const format = RECORDING_FORMATS.find(({ mimeTypes }) => (
    mimeTypes.some((mimeType) => mimeType === normalizedMimeType)
  ));
  return format?.mimeTypes.find((mimeType) => allowedMimeTypes.includes(mimeType)) ?? normalizedMimeType;
}

// getRecordingFileAccept builds one filtered picker contract from the explicit Supabase bucket allowlist.
export function getRecordingFileAccept(allowedMimeTypes: readonly string[]) {
  return RECORDING_FORMATS.flatMap((format) => {
    const enabled = format.mimeTypes.some((mimeType) => allowedMimeTypes.includes(mimeType));

    return enabled ? [...format.mimeTypes, ...format.extensions] : [];
  }).join(",");
}

// getRecordingFormatSummary lists only format groups enabled by the runtime bucket allowlist.
export function getRecordingFormatSummary(allowedMimeTypes: readonly string[]) {
  const labels = RECORDING_FORMATS
    .filter((format) => format.mimeTypes.some((mimeType) => allowedMimeTypes.includes(mimeType)))
    .map((format) => format.label);

  if (labels.length < 2) return labels[0] ?? "žádný podporovaný formát";
  return `${labels.slice(0, -1).join(", ")} a ${labels.at(-1)}`;
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
