import { z } from "zod";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";

const managedFilterKeys = ["client", "project", "folder", "tag"] as const;
const uuidSchema = z.string().trim().uuid().transform((value) => value.toLowerCase());

export type RecordingOrganizationFilters = {
  clientId: string | null;
  folderId: string | null;
  projectId: string | null;
  tagIds: string[];
};

export type RecordingClientGroup = {
  clientId: string | null;
  label: string;
  recordings: RecordingRow[];
};

export type RecordingSearchParamsInput = Record<string, string | string[] | undefined>;

// normalizeUuid returns one canonical UUID or null without throwing on URL input.
function normalizeUuid(value: string | undefined) {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// normalizeOwnedSingle accepts exactly one URL value that belongs to the loaded owner allowlist.
function normalizeOwnedSingle(searchParams: URLSearchParams, key: string, ownedIds: Set<string>) {
  const values = searchParams.getAll(key);
  if (values.length !== 1) return null;
  const normalized = normalizeUuid(values[0]);
  return normalized && ownedIds.has(normalized) ? normalized : null;
}

// createRecordingSearchParams preserves repeatable values from Next.js searchParams input.
export function createRecordingSearchParams(input: RecordingSearchParamsInput) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      value.forEach((item) => searchParams.append(key, item));
    } else if (value !== undefined) {
      searchParams.append(key, value);
    }
  }
  return searchParams;
}

// parseRecordingOrganizationFilters validates URL filters against request-scoped owner choices.
export function parseRecordingOrganizationFilters(
  searchParams: URLSearchParams,
  options: RecordingOrganizationOptions
): RecordingOrganizationFilters {
  const clientIds = new Set(options.clients.map((client) => client.id.toLowerCase()));
  const folderIds = new Set(options.folders.map((folder) => folder.id.toLowerCase()));
  const tagIds = new Set(options.tags.map((tag) => tag.id.toLowerCase()));
  const clientId = normalizeOwnedSingle(searchParams, "client", clientIds);
  const folderId = normalizeOwnedSingle(searchParams, "folder", folderIds);
  const requestedProjectId = normalizeUuid(
    searchParams.getAll("project").length === 1 ? searchParams.get("project") ?? undefined : undefined
  );
  const projectId = requestedProjectId && clientId && options.projects.some((project) =>
    project.id.toLowerCase() === requestedProjectId && project.client_id.toLowerCase() === clientId
  ) ? requestedProjectId : null;
  const normalizedTagIds: string[] = [];
  const seenTagIds = new Set<string>();

  for (const candidate of searchParams.getAll("tag")) {
    const normalized = normalizeUuid(candidate);
    if (!normalized || !tagIds.has(normalized) || seenTagIds.has(normalized)) continue;
    seenTagIds.add(normalized);
    normalizedTagIds.push(normalized);
  }

  return { clientId, folderId, projectId, tagIds: normalizedTagIds };
}

// buildRecordingFilterSearchParams replaces only managed organization keys in an existing URL.
export function buildRecordingFilterSearchParams(
  current: URLSearchParams,
  filters: RecordingOrganizationFilters
) {
  const next = new URLSearchParams(current);
  managedFilterKeys.forEach((key) => next.delete(key));
  if (filters.clientId) next.append("client", filters.clientId);
  if (filters.projectId) next.append("project", filters.projectId);
  if (filters.folderId) next.append("folder", filters.folderId);
  filters.tagIds.forEach((tagId) => next.append("tag", tagId));
  return next;
}

// canonicalizeRecordingOrganizationFilters removes malformed, foreign and incompatible URL values.
export function canonicalizeRecordingOrganizationFilters(
  current: URLSearchParams,
  options: RecordingOrganizationOptions
) {
  const filters = parseRecordingOrganizationFilters(current, options);
  const searchParams = buildRecordingFilterSearchParams(current, filters);
  const changed = managedFilterKeys.some((key) =>
    JSON.stringify(current.getAll(key)) !== JSON.stringify(searchParams.getAll(key))
  );
  return { changed, filters, searchParams };
}

// groupRecordingsByClient creates headings only and preserves RPC order within each group.
export function groupRecordingsByClient(
  recordings: RecordingRow[],
  options: RecordingOrganizationOptions
): RecordingClientGroup[] {
  const names = new Map(options.clients.map((client) => [client.id, client.name]));
  const groups = new Map<string, RecordingClientGroup>();

  for (const recording of recordings) {
    const key = recording.client_id ?? "__unclassified__";
    const existing = groups.get(key);
    if (existing) {
      existing.recordings.push(recording);
      continue;
    }
    groups.set(key, {
      clientId: recording.client_id,
      label: recording.client_id ? names.get(recording.client_id) ?? "Neznámý klient" : "Bez klienta",
      recordings: [recording]
    });
  }

  return Array.from(groups.values());
}
