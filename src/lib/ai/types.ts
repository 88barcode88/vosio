export type AiOutputRow = {
  id: string;
  created_at: string;
  output_json: unknown;
  output_text: string | null;
  processing_job_id: string;
  transcript_id: string;
  user_id: string;
};

export type AiOutputView = AiOutputRow & {
  processing_type: string | null;
};

export type AiArchiveItem = Omit<AiOutputView, "user_id"> & {
  recording: {
    id: string;
    status: import("@/lib/recordings/types").RecordingStatus;
    title: string;
  };
};
