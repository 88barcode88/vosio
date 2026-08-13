import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
import type { RecordingRow } from "@/lib/recordings/types";
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
  deleted_at,
  updated_at
`;

const ORGANIZATION_RECORDING_PAGE_SIZE = 1000;

type RecordingCursor = {
  createdAt: string;
  id: string;
};

// recordingCursorFromRow validates and returns the stable tuple used by keyset pagination.
function recordingCursorFromRow(recording: RecordingRow): RecordingCursor {
  if (!recording.id || !Number.isFinite(Date.parse(recording.created_at))) {
    throw new Error("Unable to load recordings: invalid pagination cursor");
  }

  return { createdAt: recording.created_at, id: recording.id };
}

// listRecordings loads the current user's ordinary organization list through Supabase RLS.
export async function listRecordings(
  supabase: SupabaseClient,
  options: {
    organizationFilters?: RecordingOrganizationFilters;
  } = {}
) {
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

  return recordings;
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
      .order("deleted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<RecordingRow[]>()
  );
}
