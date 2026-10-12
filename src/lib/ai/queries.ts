import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiArchiveItem, AiOutputRow, AiOutputView } from "@/lib/ai/types";
import type { RecordingStatus } from "@/lib/recordings/types";
import { fetchAllRows } from "@/lib/supabase/pagination";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";

type AiOutputJoinRow = AiOutputRow;

type AiArchiveJoinRow = Omit<AiOutputRow, "user_id"> & {
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

// Resolve types for an already RLS-authorized output page; missing/currently revoked IDs stay absent.
export async function getAccessibleOutputTypes(supabase: SupabaseClient, rows: Array<{ id: string }>) {
  const types = new Map<string, string>();
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const ids = rows.slice(offset, offset + 1000).map((row) => row.id);
    const { data, error } = await supabase.rpc("get_accessible_ai_output_types_v1", { p_output_ids: ids });
    if (error || !Array.isArray(data)) throw new Error("Unable to load saved AI output types");
    for (const row of data) {
      if (!ids.includes(row.output_id) || typeof row.processing_type !== "string" || !row.processing_type) {
        throw new Error("Unable to load saved AI output types");
      }
      types.set(row.output_id, row.processing_type);
    }
  }
  return types;
}

// Project only saved content, never joined provider/job data or technical author identities.
function toOutputView(output: AiOutputRow, processingType: string): AiOutputView {
  return { id: output.id, created_at: output.created_at, output_json: output.output_json,
    output_text: output.output_text, processing_job_id: output.processing_job_id,
    transcript_id: output.transcript_id, processing_type: processingType };
}

// listAiArchiveItems loads only archive payload, job type and recording identity through forced RLS joins.
export async function listAiArchiveItems(supabase: SupabaseClient) {
  const rows = await fetchAllRows<AiArchiveJoinRow>("Unable to load AI archive", (from, to) =>
    supabase
      .from("ai_outputs")
      .select(
        "id,created_at,output_json,output_text,processing_job_id,transcript_id,transcripts!inner(recording_id,recordings!inner(id,title,status))"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<AiArchiveJoinRow[]>()
  );

  const types = await getAccessibleOutputTypes(supabase, rows);
  const items = rows.flatMap((row): AiArchiveItem[] => {
    const processingType = types.get(row.id);
    const transcript = getJoinedRow(row.transcripts);
    const recording = getJoinedRow(transcript?.recordings);

    if (!processingType || !transcript?.recording_id || !recording?.id || !recording.title || !recording.status) {
      return [];
    }

    return [{
      created_at: row.created_at,
      id: row.id,
      output_json: row.output_json,
      output_text: row.output_text,
      processing_job_id: row.processing_job_id,
      processing_type: processingType,
      recording: { id: recording.id, status: recording.status, title: recording.title },
      transcript_id: row.transcript_id
    }];
  });
  const capabilities = new Map(await Promise.all([...new Set(items.map((item) => item.recording.id))]
    .map(async (id) => [id, await resolveRecordingCapabilities(supabase, id)] as const)));
  return items.map((item) => ({ ...item, capabilities: capabilities.get(item.recording.id) }));
}

// listAiOutputs loads saved AI outputs for the current user through Supabase RLS.
export async function listAiOutputs(supabase: SupabaseClient) {
  const outputs = await fetchAllRows<AiOutputJoinRow>("Unable to load AI outputs", (from, to) =>
    supabase
      .from("ai_outputs")
      .select(
        "id,created_at,output_json,output_text,processing_job_id,transcript_id"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<AiOutputJoinRow[]>()
  );

  const types = await getAccessibleOutputTypes(supabase, outputs);
  return outputs.flatMap((output) => types.has(output.id) ? [toOutputView(output, types.get(output.id)!)] : []);
}

// listAiOutputsForTranscripts loads AI outputs only for transcript ids visible on a detail page.
export async function listAiOutputsForTranscripts(supabase: SupabaseClient, transcriptIds: string[]) {
  if (transcriptIds.length === 0) {
    return [];
  }

  const outputs = await fetchAllRows<AiOutputJoinRow>("Unable to load recording AI outputs", (from, to) => supabase
    .from("ai_outputs")
    .select(
      "id,created_at,output_json,output_text,processing_job_id,transcript_id"
    )
    .in("transcript_id", transcriptIds)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to)
    .returns<AiOutputJoinRow[]>());

  const types = await getAccessibleOutputTypes(supabase, outputs);
  return outputs.flatMap((output) => types.has(output.id) ? [toOutputView(output, types.get(output.id)!)] : []);
}
