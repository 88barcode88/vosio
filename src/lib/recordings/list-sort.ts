import type { RecordingRow } from "@/lib/recordings/types";

export const recordingSortOptions = [
  { id: "client", label: "Podle klienta" },
  { id: "newest", label: "Nejnovější" },
  { id: "oldest", label: "Nejstarší" },
  { id: "title", label: "Název A–Z" },
  { id: "longest", label: "Nejdelší" }
] as const;

export type RecordingSort = (typeof recordingSortOptions)[number]["id"];

export const DEFAULT_RECORDING_SORT: RecordingSort = "client";

const sortIds = new Set<string>(recordingSortOptions.map((option) => option.id));
const titleCollator = new Intl.Collator("cs", { numeric: true, sensitivity: "base" });

// parseRecordingSort reads the URL `sort` value of the recordings list and falls back to client grouping.
export function parseRecordingSort(searchParams: URLSearchParams): RecordingSort {
  const values = searchParams.getAll("sort");
  return values.length === 1 && sortIds.has(values[0]) ? values[0] as RecordingSort : DEFAULT_RECORDING_SORT;
}

// buildRecordingSortSearchParams sets one sort in a copy of the list URL; the default sort leaves no parameter.
export function buildRecordingSortSearchParams(current: URLSearchParams, sort: RecordingSort) {
  const next = new URLSearchParams(current);
  if (sort === DEFAULT_RECORDING_SORT) next.delete("sort");
  else next.set("sort", sort);
  return next;
}

// createdAtValue turns a row timestamp into a comparable number; unparsable dates sort last.
function createdAtValue(recording: RecordingRow) {
  const value = Date.parse(recording.created_at);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

// sortRecordings returns a new array ordered for the flat list; "client" keeps the RPC order (newest first) for grouping.
export function sortRecordings(recordings: readonly RecordingRow[], sort: RecordingSort): RecordingRow[] {
  const rows = [...recordings];
  if (sort === "newest") return rows.sort((a, b) => createdAtValue(b) - createdAtValue(a));
  if (sort === "oldest") return rows.sort((a, b) => createdAtValue(a) - createdAtValue(b));
  if (sort === "title") return rows.sort((a, b) => titleCollator.compare(a.title, b.title));
  if (sort === "longest") return rows.sort((a, b) => (b.duration_seconds ?? -1) - (a.duration_seconds ?? -1));
  return rows;
}
