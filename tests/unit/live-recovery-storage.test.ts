import { describe, expect, it } from "vitest";
import { InvalidSafetyPartListingError } from "@/lib/live-recording/safety-parts";
import { summarizeSafetyPartStorageObjects } from "@/lib/live-recording/recovery";

describe("live recovery storage listings", () => {
  it("summarizes only canonical contiguous parts", () => {
    expect(summarizeSafetyPartStorageObjects([
      { created_at: "2026-09-03T10:00:00.000Z", metadata: { size: 10 }, name: "part-000001.webm" },
      { created_at: "2026-09-03T09:00:00.000Z", metadata: { size: 5 }, name: "part-000000.webm" },
      { created_at: "2026-09-03T11:00:00.000Z", metadata: { size: 999 }, name: "manifest.json" }
    ])).toEqual({ count: 2, newestUpdatedAt: "2026-09-03T10:00:00.000Z", totalBytes: 15 });
  });

  it("rejects malformed part sets instead of recovering them", () => {
    expect(() => summarizeSafetyPartStorageObjects([
      { metadata: { size: 5 }, name: "part-000000.webm" },
      { metadata: { size: 10 }, name: "part-000002.webm" }
    ])).toThrow(InvalidSafetyPartListingError);
  });
});
