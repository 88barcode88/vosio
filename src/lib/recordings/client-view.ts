import { getAudioPlaybackEligibility } from "@/lib/recordings/audio-playback";
import type { RecordingRow } from "@/lib/recordings/types";

export type RecordingAudioAvailability = "single" | "segmented" | "none";

export type RecordingClientView = Pick<
  RecordingRow,
  | "created_at"
  | "duration_seconds"
  | "file_size_bytes"
  | "id"
  | "mime_type"
  | "source_type"
  | "status"
  | "title"
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
    duration_seconds: recording.duration_seconds,
    file_size_bytes: recording.file_size_bytes,
    id: recording.id,
    mime_type: recording.mime_type,
    source_type: recording.source_type,
    status: recording.status,
    title: recording.title,
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
