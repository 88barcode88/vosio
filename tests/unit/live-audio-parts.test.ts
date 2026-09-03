import { describe, expect, it } from "vitest";
import {
  InvalidSafetyPartListingError,
  formatSafetyPartName,
  parseSafetyPartName,
  validateSafetyPartListing
} from "@/lib/live-recording/safety-parts";

describe("live safety audio part grammar", () => {
  it("formats and parses the exact zero-based six-digit grammar", () => {
    expect(formatSafetyPartName(0, "webm")).toBe("part-000000.webm");
    expect(formatSafetyPartName(42, "m4a")).toBe("part-000042.m4a");
    expect(parseSafetyPartName("part-000042.m4a")).toEqual({ extension: "m4a", index: 42 });
  });

  it.each([
    "part-00000.webm",
    "part-000000.mp4",
    "part-000000.WEBM",
    "segment-000000.webm",
    "part-000000.webm.tmp",
    "part-1000000.webm"
  ])("rejects non-canonical name %s", (name) => {
    expect(parseSafetyPartName(name)).toBeNull();
  });

  it("ignores unrelated objects and returns numeric order", () => {
    const parts = validateSafetyPartListing([
      { name: "notes.json" },
      { name: "part-000002.webm" },
      { name: "part-000000.webm" },
      { name: "part-000001.webm" }
    ]);

    expect(parts.map((part) => part.name)).toEqual([
      "part-000000.webm",
      "part-000001.webm",
      "part-000002.webm"
    ]);
  });

  it.each([
    [[{ name: "part-000000.webm" }, { name: "part-000000.webm" }]],
    [[{ name: "part-000000.webm" }, { name: "part-000001.m4a" }]],
    [[{ name: "part-000000.webm" }, { name: "part-000002.webm" }]],
    [[{ name: "part-000001.webm" }]]
  ])("fails closed for duplicate, mixed, or gapped listings", (items) => {
    expect(() => validateSafetyPartListing(items)).toThrow(InvalidSafetyPartListingError);
  });
});
