import { describe, expect, it } from "vitest";
import {
  createUnavailableRecordingStorageConfig,
  getSupabasePlanMaxFileSizeBytes,
  normalizeRecordingStorageLimit,
  resolveRecordingStorageConfig
} from "@/lib/recordings/storage-config";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

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

  it("maps known Supabase plans to their safe global file-size ceilings", () => {
    expect(getSupabasePlanMaxFileSizeBytes("auto")).toBeNull();
    expect(getSupabasePlanMaxFileSizeBytes("free")).toBe(50 * MEBIBYTE);
    expect(getSupabasePlanMaxFileSizeBytes("paid")).toBe(500 * GIBIBYTE);
  });

  it("uses the Free plan as a ceiling without inventing a detected global limit", () => {
    expect(resolveRecordingStorageConfig(100 * MEBIBYTE, "free")).toEqual({
      bucketMaxFileSizeBytes: 100 * MEBIBYTE,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 50 * MEBIBYTE,
      planMaxFileSizeBytes: 50 * MEBIBYTE
    });
  });

  it("never lets a paid plan raise the configured bucket limit", () => {
    expect(resolveRecordingStorageConfig(50 * MEBIBYTE, "paid")).toEqual({
      bucketMaxFileSizeBytes: 50 * MEBIBYTE,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 50 * MEBIBYTE,
      planMaxFileSizeBytes: 500 * GIBIBYTE
    });
  });

  it("uses the normalized bucket limit when the plan is automatic", () => {
    expect(resolveRecordingStorageConfig(80 * MEBIBYTE, "auto")).toEqual({
      bucketMaxFileSizeBytes: 80 * MEBIBYTE,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 80 * MEBIBYTE,
      planMaxFileSizeBytes: null
    });
  });

  it("fails closed while keeping the paid-plan ceiling available as a hint", () => {
    expect(createUnavailableRecordingStorageConfig("paid")).toEqual({
      bucketMaxFileSizeBytes: null,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: null,
      planMaxFileSizeBytes: 500 * GIBIBYTE
    });
  });
});
