import type { RecordOptions, Recording } from "@soniox/client";
import type { SonioxRealtimeLanguageId } from "@/lib/soniox/languages";

export type RecorderStatus = "idle" | "starting" | "recording" | "saving";
export type LiveSaveMode = "audio_and_transcript" | "transcript_only";
export type LiveCaptionBlock = {
  speaker: string;
  speakerClassName: string;
  text: string;
};
export type LiveMarkerAttempt = {
  clientMarkerId: string;
  markerType: "important";
  note: null;
  offsetMs: number;
};
export type LiveMarkerFeedback = {
  message: string;
  offsetMs: number;
  tone: "error" | "status" | "working";
};
export type DevelopmentRecordingFactory = (options: RecordOptions) => Recording;
export type BrowserRecorderProps = {
  allowTranscriptOnly?: boolean;
  captionMode?: boolean;
  compact?: boolean;
  developmentRecordingFactory?: DevelopmentRecordingFactory;
  maxAudioFileSizeBytes: number | null;
  onStatusChange?: (status: RecorderStatus) => void;
  realtimeLanguage?: SonioxRealtimeLanguageId;
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
