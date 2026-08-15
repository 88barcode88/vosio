import { describe, expect, it } from "vitest";
import {
  buildRecordingStatusSearchParams,
  canonicalizeRecordingStatusFilter
} from "@/lib/recordings/list-filters";

describe("recording status URL filters", () => {
  it("accepts one active status and preserves unrelated filters", () => {
    const current = new URLSearchParams("q=lucern&client=11111111-1111-4111-8111-111111111111&status=failed&page=3");
    const result = canonicalizeRecordingStatusFilter(current);

    expect(result.status).toBe("failed");
    expect(result.changed).toBe(false);
    expect(result.searchParams.get("q")).toBe("lucern");
  });

  it("removes duplicate, deleted and unknown status values", () => {
    for (const query of ["status=failed&status=completed", "status=deleted", "status=other"]) {
      const result = canonicalizeRecordingStatusFilter(new URLSearchParams(query));
      expect(result.status).toBeNull();
      expect(result.searchParams.has("status")).toBe(false);
      expect(result.changed).toBe(true);
    }
  });

  it("changes status, resets page and preserves q and organization filters", () => {
    const next = buildRecordingStatusSearchParams(
      new URLSearchParams("q=call&client=c1&project=p1&folder=f1&tag=t1&tag=t2&page=4&warning=index"),
      "transcribing"
    );

    expect(next.toString()).toBe(
      "q=call&client=c1&project=p1&folder=f1&tag=t1&tag=t2&warning=index&status=transcribing"
    );
  });
});
