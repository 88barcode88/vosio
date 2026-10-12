import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
import type {
  ActiveRecordingStatus,
  RecordingRow,
  RecordingStatus
} from "@/lib/recordings/types";

const ORGANIZATION_RECORDING_PAGE_SIZE = 1000;

type RecordingCursor = {
  createdAt: string;
  id: string;
};

export type RecordingStatusCounts = Record<RecordingStatus, number>;

// recordingCursorFromRow validates and returns the stable tuple used by keyset pagination.
function recordingCursorFromRow(recording: RecordingRow): RecordingCursor {
  if (!recording.id || !Number.isFinite(Date.parse(recording.created_at))) {
    throw new Error("Unable to load recordings: invalid pagination cursor");
  }

  return { createdAt: recording.created_at, id: recording.id };
}

// listRecordings preserves the accessible RPC's stable, already-deduplicated keyset pages.
export async function listRecordings(
  supabase: SupabaseClient,
  options: {
    organizationFilters?: RecordingOrganizationFilters;
    status?: ActiveRecordingStatus | "deleted" | null;
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
    const { data, error } = await supabase.rpc("list_accessible_recordings_v1", {
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_client_id: filters.clientId,
      p_folder_id: filters.folderId,
      p_limit: ORGANIZATION_RECORDING_PAGE_SIZE,
      p_project_id: filters.projectId,
      p_status: options.status ?? null,
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
      if (seenRecordingIds.has(recording.id)) throw new Error("Unable to load recordings: duplicate RPC row");
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

// countOwnRecordingStatuses reads server-scoped facets, including the unfiltered manager Trash count.
export async function countOwnRecordingStatuses(
  supabase: SupabaseClient,
  options: { organizationFilters: RecordingOrganizationFilters; searchQuery: string }
): Promise<RecordingStatusCounts> {
  const { data, error } = await supabase.rpc("count_accessible_recording_statuses_v1", {
    p_client_id: options.organizationFilters.clientId,
    p_folder_id: options.organizationFilters.folderId,
    p_project_id: options.organizationFilters.projectId,
    p_query: options.searchQuery || null,
    p_tag_ids: options.organizationFilters.tagIds
  });
  if (error || !Array.isArray(data)) throw new Error("Unable to count recording statuses");

  const counts: RecordingStatusCounts = {
    completed: 0,
    created: 0,
    deleted: 0,
    failed: 0,
    transcribing: 0,
    uploaded: 0,
    uploading: 0
  };
  for (const row of data as Array<{ status: RecordingStatus; total_count: number | string }>) {
    const value = Number(row.total_count);
    if (row.status in counts && Number.isSafeInteger(value) && value >= 0) counts[row.status] = value;
  }
  return counts;
}

// countDeletedRecordings returns the current manager's Trash count from the same accessible contract.
export async function countDeletedRecordings(supabase: SupabaseClient) {
  const counts = await countOwnRecordingStatuses(supabase, {
    organizationFilters: { clientId: null, projectId: null, folderId: null, tagIds: [] }, searchQuery: ""
  });
  return counts.deleted;
}

// getRecordingById loads one recording for a detail route through Supabase RLS.
export async function getRecordingById(supabase: SupabaseClient, recordingId: string) {
  const { data, error } = await supabase.rpc("get_accessible_recording_v1", { p_recording_id: recordingId });

  if (error) {
    throw new Error(`Unable to load recording: ${error.message}`);
  }

  if (!Array.isArray(data) || data.length > 1) throw new Error("Unable to load recording: invalid response");
  const recording = data[0] as RecordingRow | undefined;
  return recording?.status === "deleted" ? null : recording ?? null;
}

// Enriches the server-scoped Trash list in bounded safe batches without changing list membership or order.
export async function listDeletedRecordings(supabase: SupabaseClient) {
  const rows = await listRecordings(supabase, { status: "deleted" });
  for (let offset = 0; offset < rows.length; offset += 100) {
    const page = rows.slice(offset, offset + 100);
    const { data, error } = await supabase.rpc("get_managed_recording_trash_v2", { p_recording_ids: page.map((row) => row.id) });
    if (error || !Array.isArray(data)) throw new Error("Unable to load Trash metadata");
    if (data.length !== page.length || data.some((row) => !row || typeof row !== "object"
      || !["none", "segmented", "single"].includes(row.audio_availability))) throw new Error("Invalid Trash audio metadata");
    const metadata = new Map(data.map((row) => [row.recording_id, row]));
    if (metadata.size !== data.length || data.some((row) => !page.some((recording) => recording.id === row.recording_id))) throw new Error("Invalid Trash metadata");
    await Promise.all(page.map(async (row) => {
      const item = metadata.get(row.id);
      if (!item) throw new Error("Missing Trash metadata");
      row.capabilities = await resolveRecordingCapabilities(supabase, row.id);
      row.deleted_at = item.deleted_at ?? null;
      row.trash_retention_hours = item.trash_retention_hours ?? null;
      row.purge_after = item.purge_after ?? null;
      row.purge_phase = item.purge_phase ?? null;
      row.audioAvailability = item.audio_availability;
    }));
  }
  return rows;
}
