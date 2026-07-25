import { describe, expect, it } from "vitest";
import { normalizeRecordingStorageLimit } from "@/lib/recordings/storage-config";

describe("recording storage config", () => {
  it("accepts a positive safe integer from the bucket metadata", () => {
    expect(normalizeRecordingStorageLimit(50 * 1024 * 1024)).toBe(50 * 1024 * 1024);
    expect(normalizeRecordingStorageLimit(5 * 1024 * 1024 * 1024)).toBe(5 * 1024 * 1024 * 1024);
  });

  it.each([null, undefined, 0, -1, 1.5, Number.POSITIVE_INFINITY, "52428800"])(
    "rejects an unusable bucket limit: %s",
    (value) => {
      expect(normalizeRecordingStorageLimit(value)).toBeNull();
    }
  );
});
