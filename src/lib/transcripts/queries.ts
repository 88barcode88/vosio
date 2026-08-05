import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptRow } from "@/lib/transcripts/types";

// listTranscripts loads saved transcripts for the current user through Supabase RLS.
export async function listTranscripts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("transcripts")
    .select(
      "id,created_at,language,raw_text,recording_id,segments,speakers,transcription_job_id,user_id"
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .returns<TranscriptRow[]>();

  if (error) {
    throw new Error(`Unable to load transcripts: ${error.message}`);
  }

  return data ?? [];
}

// listTranscriptsForRecording loads the latest transcript payload for the active recording detail.
export async function listTranscriptsForRecording(supabase: SupabaseClient, recordingId: string) {
  const { data, error } = await supabase
    .from("transcripts")
    .select(
      "id,created_at,language,raw_text,recording_id,segments,speakers,transcription_job_id,user_id"
    )
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .returns<TranscriptRow[]>();

  if (error) {
    throw new Error(`Unable to load recording transcript: ${error.message}`);
  }

  return data ?? [];
}
