export const LIVE_RECORDING_AUTOSAVE_INTERVAL_MS = 15 * 1000;

type AutosaveInput = {
  elapsedSeconds: number;
  rawText: string;
  segments: unknown[];
};

type RecoverableLiveRecordingInput = {
  source_type: string;
  status: string;
};

// getLiveDraftAutosavePayload normalizes partial live transcript data before persistence.
export function getLiveDraftAutosavePayload(input: AutosaveInput) {
  return {
    duration_seconds: Math.max(0, Math.ceil(input.elapsedSeconds)),
    raw_text: input.rawText.trim(),
    segments: input.segments
  };
}

// isRecoverableLiveRecording returns true for unfinished in-app live captures.
export function isRecoverableLiveRecording(recording: RecoverableLiveRecordingInput) {
  return (
    ["in_app_recording", "realtime"].includes(recording.source_type) &&
    ["uploading", "failed", "transcribing"].includes(recording.status)
  );
}

// getRecoveredLiveRecordingUpdate keeps transcript-only recovery from advertising missing audio.
export function getRecoveredLiveRecordingUpdate(input: {
  hasTranscript: boolean;
  segmentCount: number;
  storagePrefix: string | null;
  totalBytes: number;
}) {
  const hasAudio = input.segmentCount > 0 && Boolean(input.storagePrefix);

  return {
    error_message: null,
    file_size_bytes: hasAudio ? input.totalBytes : 0,
    status: input.hasTranscript ? "completed" : "uploaded",
    ...(hasAudio
      ? { storage_path: input.storagePrefix }
      : { source_type: "realtime", storage_path: null })
  };
}

// getRecoverableLiveStoragePrefix derives the Storage folder for a live recording draft.
export function getRecoverableLiveStoragePrefix(userId: string, recordingId: string) {
  return `${userId}/${recordingId}/live/`;
}

// getLiveStorageListPrefix converts a stored live prefix into the folder accepted by Supabase list().
export function getLiveStorageListPrefix(storagePrefix: string) {
  return storagePrefix.replace(/\/$/, "");
}
