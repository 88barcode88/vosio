import {
  activeRecordingStatuses,
  type ActiveRecordingStatus
} from "@/lib/recordings/types";

const activeStatusSet = new Set<string>(activeRecordingStatuses);

// canonicalizeRecordingStatusFilter accepts exactly one owned inbox status value.
export function canonicalizeRecordingStatusFilter(current: URLSearchParams) {
  const searchParams = new URLSearchParams(current);
  const requested = current.getAll("status");
  const status = requested.length === 1 && activeStatusSet.has(requested[0])
    ? requested[0] as ActiveRecordingStatus
    : null;

  if (status) searchParams.set("status", status);
  else searchParams.delete("status");

  const changed = JSON.stringify(requested) !== JSON.stringify(searchParams.getAll("status"));
  return { changed, searchParams, status };
}

// buildRecordingStatusSearchParams updates one status while resetting bounded search pagination.
export function buildRecordingStatusSearchParams(
  current: URLSearchParams,
  status: ActiveRecordingStatus | null
) {
  const next = new URLSearchParams(current);
  next.delete("status");
  next.delete("page");
  if (status) next.set("status", status);
  return next;
}
