import { getAudioPlaybackEligibility } from "@/lib/recordings/audio-playback";
import type { RecordingRow } from "@/lib/recordings/types";

export type RecordingAudioAvailability = "single" | "segmented" | "none";

export type RecordingClientView = Pick<
  RecordingRow,
  | "created_at"
  | "deleted_at"
  | "duration_seconds"
  | "file_size_bytes"
  | "id"
  | "mime_type"
  | "purge_after"
  | "source_type"
  | "status"
  | "title"
  | "trash_retention_hours"
  | "updated_at"
> & {
  audioAvailability: RecordingAudioAvailability;
};

// toRecordingClientView removes private ownership and Storage locator fields before serialization.
export function toRecordingClientView(recording: RecordingRow): RecordingClientView {
  const eligibility = getAudioPlaybackEligibility(recording);
  const audioAvailability = eligibility.eligible
    ? "single"
    : eligibility.reason === "segmented"
      ? "segmented"
      : "none";

  return {
    audioAvailability,
    created_at: recording.created_at,
    deleted_at: recording.deleted_at ?? null,
    duration_seconds: recording.duration_seconds,
    file_size_bytes: recording.file_size_bytes,
    id: recording.id,
    mime_type: recording.mime_type,
    purge_after: recording.purge_after ?? null,
    source_type: recording.source_type,
    status: recording.status,
    title: recording.title,
    trash_retention_hours: recording.trash_retention_hours ?? null,
    updated_at: recording.updated_at
  };
}

// getRecordingAudioAvailabilityLabel maps safe availability metadata into compact Czech UI text.
export function getRecordingAudioAvailabilityLabel(
  availability: RecordingAudioAvailability
) {
  const labels: Record<RecordingAudioAvailability, string> = {
    none: "bez audia",
    segmented: "po částech",
    single: "jeden soubor"
  };

  return labels[availability];
}
