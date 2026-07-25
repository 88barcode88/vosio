export type RecorderStatus = "idle" | "starting" | "recording" | "saving";
export type LiveSaveMode = "audio_and_transcript" | "transcript_only";
export type LiveCaptionBlock = {
  speaker: string;
  speakerClassName: string;
  text: string;
};
export type BrowserRecorderProps = {
  allowTranscriptOnly?: boolean;
  captionMode?: boolean;
  compact?: boolean;
  maxAudioFileSizeBytes: number | null;
  onStatusChange?: (status: RecorderStatus) => void;
  redirectAfterSave?: "detail" | "list";
  realtimeModel?: string;
};
export type RealtimeConfig = {
  api_key: string;
  region?: string;
  stt_ws_url?: string;
};
export type RealtimeConfigErrorCode =
  | "server_env_invalid"
  | "soniox_auth_or_region"
  | "soniox_request_failed"
  | "unknown";
