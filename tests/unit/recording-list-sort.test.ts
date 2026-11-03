import { describe, expect, it } from "vitest";
import {
  buildRecordingSortSearchParams,
  parseRecordingSort,
  sortRecordings
} from "@/lib/recordings/list-sort";
import type { RecordingRow } from "@/lib/recordings/types";

// row builds the minimal recording fields the list order reads.
function row(id: string, title: string, createdAt: string, duration: number | null): RecordingRow {
  return { id, title, created_at: createdAt, duration_seconds: duration } as RecordingRow;
}

const rows = [
  row("b", "Beta", "2026-10-02T10:00:00.000Z", 30),
  row("a", "alfa 10", "2026-11-02T10:00:00.000Z", null),
  row("c", "Alfa 9", "2026-09-02T10:00:00.000Z", 600)
];

describe("recording list sort", () => {
  it("falls back to client grouping for missing, unknown or repeated values", () => {
    expect(parseRecordingSort(new URLSearchParams(""))).toBe("client");
    expect(parseRecordingSort(new URLSearchParams("sort=random"))).toBe("client");
    expect(parseRecordingSort(new URLSearchParams("sort=newest&sort=oldest"))).toBe("client");
    expect(parseRecordingSort(new URLSearchParams("sort=longest"))).toBe("longest");
  });

  it("orders by date, Czech title and duration without mutating the input", () => {
    const ids = (sorted: RecordingRow[]) => sorted.map((item) => item.id);
    expect(ids(sortRecordings(rows, "newest"))).toEqual(["a", "b", "c"]);
    expect(ids(sortRecordings(rows, "oldest"))).toEqual(["c", "b", "a"]);
    expect(ids(sortRecordings(rows, "title"))).toEqual(["c", "a", "b"]);
    expect(ids(sortRecordings(rows, "longest"))).toEqual(["c", "b", "a"]);
    expect(ids(sortRecordings(rows, "client"))).toEqual(["b", "a", "c"]);
    expect(ids(rows)).toEqual(["b", "a", "c"]);
  });

  it("keeps other list parameters and drops the default sort from the URL", () => {
    const current = new URLSearchParams("status=completed&client=x&sort=title");
    expect(buildRecordingSortSearchParams(current, "newest").toString()).toBe("status=completed&client=x&sort=newest");
    expect(buildRecordingSortSearchParams(current, "client").toString()).toBe("status=completed&client=x");
  });
});
