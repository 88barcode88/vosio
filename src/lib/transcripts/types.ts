export type TranscriptRow = {
  id: string;
  created_at: string;
  language: string | null;
  raw_text: string;
  recording_id: string;
  segments: unknown;
  speakers: unknown;
  transcription_job_id: string | null;
  user_id: string;
};

