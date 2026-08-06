import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
import type {
  RecordingSearchPage,
  RecordingSearchResult,
  RecordingStatus
} from "@/lib/recordings/types";

export const RECORDING_SEARCH_PAGE_SIZE = 25;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
export const RECORDING_SEARCH_MAX_PAGE =
  Math.floor(POSTGRES_INTEGER_MAX / RECORDING_SEARCH_PAGE_SIZE) + 1;
export const RECORDING_SEARCH_MAX_START_MS = 86_400_000;

const recordingStatuses = new Set<RecordingStatus>([
  "completed",
  "created",
  "deleted",
  "failed",
  "transcribing",
  "uploaded",
  "uploading"
]);
const recordingSourceTypes = new Set(["in_app_recording", "realtime", "upload"] as const);

// normalizeRecordingSearchQuery prepares bounded user input for the search RPC and highlight links.
export function normalizeRecordingSearchQuery(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

// parseRecordingSearchPage accepts only one canonical positive integer inside the UI bound.
export function parseRecordingSearchPage(value: string | string[] | undefined) {
  if (value === undefined) {
    return 1;
  }

  if (Array.isArray(value)) {
    if (value.length !== 1) return 1;
    return parseRecordingSearchPage(value[0]);
  }

  if (!/^[1-9]\d*$/.test(value)) {
    return 1;
  }

  if (value.length > String(RECORDING_SEARCH_MAX_PAGE).length) {
    return RECORDING_SEARCH_MAX_PAGE;
  }

  const page = Number(value);

  return Number.isSafeInteger(page)
    ? Math.min(page, RECORDING_SEARCH_MAX_PAGE)
    : RECORDING_SEARCH_MAX_PAGE;
}

// canonicalizeRecordingSearchParams normalizes q and removes invalid, duplicate or first-page values.
export function canonicalizeRecordingSearchParams(
  current: URLSearchParams,
  normalizedQuery: string
) {
  const searchParams = new URLSearchParams(current);
  const page = normalizedQuery ? parseRecordingSearchPage(current.getAll("page")) : 1;

  if (normalizedQuery) {
    searchParams.set("q", normalizedQuery);
  } else {
    searchParams.delete("q");
  }

  if (normalizedQuery && page > 1) {
    searchParams.set("page", String(page));
  } else {
    searchParams.delete("page");
  }

  const changed = JSON.stringify(current.getAll("q")) !== JSON.stringify(searchParams.getAll("q"))
    || JSON.stringify(current.getAll("page")) !== JSON.stringify(searchParams.getAll("page"));

  return { changed, page, searchParams };
}

// buildRecordingSearchPageHref changes only the page while preserving the canonical query and filters.
export function buildRecordingSearchPageHref(current: URLSearchParams, page: number) {
  if (!Number.isInteger(page) || page < 1 || page > RECORDING_SEARCH_MAX_PAGE) {
    throw new Error("Unable to build recording search page: invalid page");
  }

  const searchParams = new URLSearchParams(current);

  if (page > 1) {
    searchParams.set("page", String(page));
  } else {
    searchParams.delete("page");
  }

  const queryString = searchParams.toString();

  return queryString ? `/recordings?${queryString}` : "/recordings";
}

// getObjectField reads one untrusted RPC field without copying the full provider row.
function getObjectField(row: unknown, field: string) {
  return row && typeof row === "object" ? (row as Record<string, unknown>)[field] : undefined;
}

// getRequiredString validates one required string field from the search RPC.
function getRequiredString(row: unknown, field: string) {
  const value = getObjectField(row, field);

  if (typeof value !== "string" || !value) {
    throw new Error("Unable to search recordings: invalid response");
  }

  return value;
}

// getNullableString validates a nullable string field from the search RPC.
function getNullableString(row: unknown, field: string) {
  const value = getObjectField(row, field);

  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new Error("Unable to search recordings: invalid response");
}

// getSafeInteger converts PostgreSQL bigint output without accepting unsafe JavaScript values.
function getSafeInteger(value: unknown, nullable: boolean) {
  if (nullable && value === null) return null;
  const normalized = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;

  if (!Number.isSafeInteger(normalized) || (normalized as number) < 0) {
    throw new Error("Unable to search recordings: invalid response");
  }

  return normalized as number;
}

// getNullableSafeInteger validates one nullable duration, byte or timestamp field.
function getNullableSafeInteger(row: unknown, field: string) {
  return getSafeInteger(getObjectField(row, field), true);
}

// mapRecordingSearchRow explicitly projects one RPC row and drops every unrecognized field.
export function mapRecordingSearchRow(row: unknown): RecordingSearchResult {
  const sourceType = getRequiredString(row, "source_type");
  const status = getRequiredString(row, "status");
  const createdAt = getRequiredString(row, "created_at");
  const updatedAt = getRequiredString(row, "updated_at");
  const matchStartMs = getNullableSafeInteger(row, "match_start_ms");
  const matchEndMs = getNullableSafeInteger(row, "match_end_ms");

  if (!recordingSourceTypes.has(sourceType as "upload")
    || !recordingStatuses.has(status as RecordingStatus)
    || !Number.isFinite(Date.parse(createdAt))
    || !Number.isFinite(Date.parse(updatedAt))
    || (matchStartMs !== null && matchEndMs !== null && matchEndMs < matchStartMs)) {
    throw new Error("Unable to search recordings: invalid response");
  }

  return {
    clientId: getNullableString(row, "client_id"),
    createdAt,
    durationSeconds: getNullableSafeInteger(row, "duration_seconds"),
    fileSizeBytes: getNullableSafeInteger(row, "file_size_bytes"),
    folderId: getNullableString(row, "folder_id"),
    id: getRequiredString(row, "recording_id"),
    matchedExcerpt: getNullableString(row, "matched_excerpt"),
    matchEndMs,
    matchStartMs,
    mimeType: getNullableString(row, "mime_type"),
    projectId: getNullableString(row, "project_id"),
    sourceType: sourceType as RecordingSearchResult["sourceType"],
    status: status as RecordingStatus,
    title: getRequiredString(row, "title"),
    updatedAt
  };
}

// getSearchTotalCount validates row totals; an empty page has no count row and derives zero.
function getSearchTotalCount(rows: unknown[]) {
  if (rows.length === 0) return 0;
  const counts = rows.map((row) => getSafeInteger(getObjectField(row, "total_count"), false));
  const totalCount = counts[0] as number;

  if (counts.some((count) => count !== totalCount)) {
    throw new Error("Unable to search recordings: inconsistent total count");
  }

  return totalCount;
}

// searchOwnRecordings invokes exactly one authenticated search RPC page with organization filters.
export async function searchOwnRecordings(
  supabase: SupabaseClient,
  options: {
    organizationFilters: RecordingOrganizationFilters;
    page: number;
    searchQuery: string;
  }
): Promise<RecordingSearchPage> {
  const searchQuery = normalizeRecordingSearchQuery(options.searchQuery);

  if (!searchQuery
    || !Number.isInteger(options.page)
    || options.page < 1
    || options.page > RECORDING_SEARCH_MAX_PAGE) {
    throw new Error("Unable to search recordings: invalid request");
  }

  const offset = (options.page - 1) * RECORDING_SEARCH_PAGE_SIZE;
  const { data, error } = await supabase.rpc("search_own_recordings_v1", {
    p_client_id: options.organizationFilters.clientId,
    p_folder_id: options.organizationFilters.folderId,
    p_limit: RECORDING_SEARCH_PAGE_SIZE,
    p_offset: offset,
    p_project_id: options.organizationFilters.projectId,
    p_query: searchQuery,
    p_tag_ids: options.organizationFilters.tagIds
  });

  if (error || !Array.isArray(data) || data.length > RECORDING_SEARCH_PAGE_SIZE) {
    throw new Error("Unable to search recordings");
  }

  const totalCount = getSearchTotalCount(data);
  const results = data.map(mapRecordingSearchRow);

  if (results.length > 0 && totalCount < offset + results.length) {
    throw new Error("Unable to search recordings: inconsistent total count");
  }

  return {
    page: options.page,
    pageSize: RECORDING_SEARCH_PAGE_SIZE,
    results,
    totalCount
  };
}

// buildRecordingSearchResultHref targets the transcript tab with only a safe timestamp and query.
export function buildRecordingSearchResultHref(
  result: Pick<RecordingSearchResult, "id" | "matchStartMs">,
  normalizedQuery: string
) {
  const searchParams = new URLSearchParams({ tab: "transcript" });

  if (Number.isSafeInteger(result.matchStartMs)
    && (result.matchStartMs as number) >= 0
    && (result.matchStartMs as number) <= RECORDING_SEARCH_MAX_START_MS) {
    searchParams.set("at", String(result.matchStartMs));
  }
  searchParams.set("highlight", normalizeRecordingSearchQuery(normalizedQuery));

  return `/recordings/${encodeURIComponent(result.id)}?${searchParams.toString()}`;
}
