import type { SupabaseClient } from "@supabase/supabase-js";
import { getStatusLabel, type RecordingRow } from "@/lib/recordings/types";
import { fetchAllRows } from "@/lib/supabase/pagination";

const recordingColumns = `
  id,
  user_id,
  client_id,
  project_id,
  folder_id,
  title,
  source_type,
  storage_path,
  mime_type,
  duration_seconds,
  file_size_bytes,
  status,
  error_message,
  created_at,
  updated_at
`;

const sourceSearchLabels: Record<RecordingRow["source_type"], string> = {
  in_app_recording: "nahrano v aplikaci live zaznam live nahravka",
  realtime: "realtime live prepis zivy prepis hotovy text vlozeny prepis",
  upload: "upload soubor nahrany soubor"
};

// normalizeRecordingSearchQuery prepares user search input for recordings list filtering.
export function normalizeRecordingSearchQuery(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

// recordingMatchesSearch checks lightweight recording fields for the list page search.
export function recordingMatchesSearch(
  recording: RecordingRow,
  normalizedQuery: string
) {
  if (!normalizedQuery) {
    return true;
  }

  const needle = normalizedQuery.toLocaleLowerCase("cs-CZ");
  const haystack = [
    recording.title,
    recording.status,
    getStatusLabel(recording.status),
    recording.source_type,
    sourceSearchLabels[recording.source_type],
    recording.mime_type ?? ""
  ].join(" ").toLocaleLowerCase("cs-CZ");

  return haystack.includes(needle);
}

// listRecordings loads and optionally filters the current user's recordings through Supabase RLS.
export async function listRecordings(
  supabase: SupabaseClient,
  options: { searchQuery?: string | null } = {}
) {
  const normalizedQuery = normalizeRecordingSearchQuery(options.searchQuery);
  const recordings = await fetchAllRows<RecordingRow>("Unable to load recordings", (from, to) =>
    supabase
      .from("recordings")
      .select(recordingColumns)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<RecordingRow[]>()
  );

  if (!normalizedQuery) {
    return recordings;
  }

  return recordings.filter((recording) => recordingMatchesSearch(recording, normalizedQuery));
}

// getRecordingById loads one recording for a detail route through Supabase RLS.
export async function getRecordingById(supabase: SupabaseClient, recordingId: string) {
  const { data, error } = await supabase
    .from("recordings")
    .select(recordingColumns)
    .eq("id", recordingId)
    .neq("status", "deleted")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load recording: ${error.message}`);
  }

  return data as RecordingRow | null;
}

// listDeletedRecordings loads soft-deleted recordings for the trash page through Supabase RLS.
export async function listDeletedRecordings(supabase: SupabaseClient) {
  return fetchAllRows<RecordingRow>("Unable to load deleted recordings", (from, to) =>
    supabase
      .from("recordings")
      .select(recordingColumns)
      .eq("status", "deleted")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<RecordingRow[]>()
  );
}
