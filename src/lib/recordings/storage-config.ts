export type RecordingStorageConfig = {
  maxFileSizeBytes: number | null;
};

export const unavailableRecordingStorageConfig: RecordingStorageConfig = {
  maxFileSizeBytes: null
};

// normalizeRecordingStorageLimit accepts only bucket limits that are safe to use in browser validation.
export function normalizeRecordingStorageLimit(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}
