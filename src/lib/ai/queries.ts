import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiArchiveItem, AiOutputRow, AiOutputView } from "@/lib/ai/types";
import type { RecordingStatus } from "@/lib/recordings/types";
import { fetchAllRows } from "@/lib/supabase/pagination";

type AiOutputJoinRow = AiOutputRow & {
  ai_processing_jobs?: {
    processing_type?: string | null;
  } | null;
};

type AiArchiveJoinRow = Omit<AiOutputRow, "user_id"> & {
  ai_processing_jobs?: { processing_type?: string | null } | Array<{ processing_type?: string | null }> | null;
  transcripts?: {
    recording_id?: string | null;
    recordings?: { id?: string; status?: RecordingStatus; title?: string } | Array<{ id?: string; status?: RecordingStatus; title?: string }> | null;
  } | Array<{
    recording_id?: string | null;
    recordings?: { id?: string; status?: RecordingStatus; title?: string } | Array<{ id?: string; status?: RecordingStatus; title?: string }> | null;
  }> | null;
};

// getJoinedRow unwraps Supabase's to-one relation whether generated as an object or one-item array.
function getJoinedRow<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

// listAiArchiveItems loads only archive payload, job type and recording identity through forced RLS joins.
export async function listAiArchiveItems(supabase: SupabaseClient) {
  const rows = await fetchAllRows<AiArchiveJoinRow>("Unable to load AI archive", (from, to) =>
    supabase
      .from("ai_outputs")
      .select(
        "id,created_at,output_json,output_text,processing_job_id,transcript_id,ai_processing_jobs!inner(processing_type),transcripts!inner(recording_id,recordings!inner(id,title,status))"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<AiArchiveJoinRow[]>()
  );

  return rows.flatMap((row): AiArchiveItem[] => {
    const job = getJoinedRow(row.ai_processing_jobs);
    const transcript = getJoinedRow(row.transcripts);
    const recording = getJoinedRow(transcript?.recordings);

    if (!job?.processing_type || !transcript?.recording_id || !recording?.id || !recording.title || !recording.status) {
      return [];
    }

    return [{
      created_at: row.created_at,
      id: row.id,
      output_json: row.output_json,
      output_text: row.output_text,
      processing_job_id: row.processing_job_id,
      processing_type: job.processing_type,
      recording: { id: recording.id, status: recording.status, title: recording.title },
      transcript_id: row.transcript_id
    }];
  });
}

// listAiOutputs loads saved AI outputs for the current user through Supabase RLS.
export async function listAiOutputs(supabase: SupabaseClient) {
  const outputs = await fetchAllRows<AiOutputJoinRow>("Unable to load AI outputs", (from, to) =>
    supabase
      .from("ai_outputs")
      .select(
        "id,created_at,output_json,output_text,processing_job_id,transcript_id,user_id,ai_processing_jobs(processing_type)"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<AiOutputJoinRow[]>()
  );

  return outputs.map((output): AiOutputView => ({
    ...output,
    processing_type: output.ai_processing_jobs?.processing_type ?? null
  }));
}

// listAiOutputsForTranscripts loads AI outputs only for transcript ids visible on a detail page.
export async function listAiOutputsForTranscripts(supabase: SupabaseClient, transcriptIds: string[]) {
  if (transcriptIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("ai_outputs")
    .select(
      "id,created_at,output_json,output_text,processing_job_id,transcript_id,user_id,ai_processing_jobs(processing_type)"
    )
    .in("transcript_id", transcriptIds)
    .order("created_at", { ascending: false })
    .returns<AiOutputJoinRow[]>();

  if (error) {
    throw new Error(`Unable to load recording AI outputs: ${error.message}`);
  }

  return (data ?? []).map((output): AiOutputView => ({
    ...output,
    processing_type: output.ai_processing_jobs?.processing_type ?? null
  }));
}
