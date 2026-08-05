import { isSegmentedRecordingStoragePath } from "@/lib/recordings/types";

export type AudioPlaybackEligibility =
  | { eligible: true }
  | { eligible: false; reason: "no_audio" | "segmented" };

// getAudioPlaybackEligibility allows playback only for one concrete Storage object.
export function getAudioPlaybackEligibility(recording: {
  storage_path: string | null;
}): AudioPlaybackEligibility {
  if (!recording.storage_path) {
    return { eligible: false, reason: "no_audio" };
  }

  if (isSegmentedRecordingStoragePath(recording.storage_path)) {
    return { eligible: false, reason: "segmented" };
  }

  return { eligible: true };
}
