import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
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

const ORGANIZATION_RECORDING_PAGE_SIZE = 1000;

type RecordingCursor = {
  createdAt: string;
  id: string;
};

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

// recordingCursorFromRow validates and returns the stable tuple used by keyset pagination.
function recordingCursorFromRow(recording: RecordingRow): RecordingCursor {
  if (!recording.id || !Number.isFinite(Date.parse(recording.created_at))) {
    throw new Error("Unable to load recordings: invalid pagination cursor");
  }

  return { createdAt: recording.created_at, id: recording.id };
}

// listRecordings loads and optionally filters the current user's recordings through Supabase RLS.
export async function listRecordings(
  supabase: SupabaseClient,
  options: {
    organizationFilters?: RecordingOrganizationFilters;
    searchQuery?: string | null;
  } = {}
) {
  const normalizedQuery = normalizeRecordingSearchQuery(options.searchQuery);
  const filters = options.organizationFilters ?? {
    clientId: null,
    folderId: null,
    projectId: null,
    tagIds: []
  };
  const recordings: RecordingRow[] = [];
  const seenRecordingIds = new Set<string>();
  const seenCursorKeys = new Set<string>();
  let cursor: RecordingCursor | null = null;

  for (;;) {
    const { data, error } = await supabase.rpc("list_own_recordings_v1", {
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_client_id: filters.clientId,
      p_folder_id: filters.folderId,
      p_limit: ORGANIZATION_RECORDING_PAGE_SIZE,
      p_project_id: filters.projectId,
      p_tag_ids: filters.tagIds
    });

    if (error) {
      throw new Error(`Unable to load recordings: ${error.message}`);
    }
    if (!Array.isArray(data)) {
      throw new Error("Unable to load recordings: invalid paginated response");
    }

    const page = data as RecordingRow[];
    for (const recording of page) {
      if (seenRecordingIds.has(recording.id)) continue;
      seenRecordingIds.add(recording.id);
      recordings.push(recording);
    }

    if (page.length < ORGANIZATION_RECORDING_PAGE_SIZE) break;
    const nextCursor = recordingCursorFromRow(page[page.length - 1]);
    const nextCursorKey = `${nextCursor.createdAt}\u0000${nextCursor.id}`;
    if (seenCursorKeys.has(nextCursorKey)) {
      throw new Error("Unable to load recordings: recording pagination cursor did not advance");
    }
    seenCursorKeys.add(nextCursorKey);
    cursor = nextCursor;
  }

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
