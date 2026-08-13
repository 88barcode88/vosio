import { describe, expect, it } from "vitest";
import {
  createUnavailableRecordingStorageConfig,
  getSupabasePlanMaxFileSizeBytes,
  normalizeRecordingStorageLimit,
  resolveRecordingStorageConfig
} from "@/lib/recordings/storage-config";
import {
  ACCEPTED_RECORDING_MIME_TYPES,
  getSupportedRecordingMimeTypes
} from "@/lib/recordings/types";

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
    expect(resolveRecordingStorageConfig(100 * MEBIBYTE, ACCEPTED_RECORDING_MIME_TYPES, "free")).toEqual({
      allowedMimeTypes: getSupportedRecordingMimeTypes(ACCEPTED_RECORDING_MIME_TYPES),
      bucketMaxFileSizeBytes: 100 * MEBIBYTE,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 50 * MEBIBYTE,
      planMaxFileSizeBytes: 50 * MEBIBYTE
    });
  });

  it("never lets a paid plan raise the configured bucket limit", () => {
    expect(resolveRecordingStorageConfig(50 * MEBIBYTE, ACCEPTED_RECORDING_MIME_TYPES, "paid")).toEqual({
      allowedMimeTypes: getSupportedRecordingMimeTypes(ACCEPTED_RECORDING_MIME_TYPES),
      bucketMaxFileSizeBytes: 50 * MEBIBYTE,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 50 * MEBIBYTE,
      planMaxFileSizeBytes: 500 * GIBIBYTE
    });
  });

  it("caps a larger paid bucket at the 500 GiB plan ceiling without changing the bucket value", () => {
    const bucketLimit = 600 * GIBIBYTE;

    expect(resolveRecordingStorageConfig(bucketLimit, ACCEPTED_RECORDING_MIME_TYPES, "paid")).toEqual({
      allowedMimeTypes: getSupportedRecordingMimeTypes(ACCEPTED_RECORDING_MIME_TYPES),
      bucketMaxFileSizeBytes: bucketLimit,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 500 * GIBIBYTE,
      planMaxFileSizeBytes: 500 * GIBIBYTE
    });
  });

  it("uses the normalized bucket limit when the plan is automatic", () => {
    expect(resolveRecordingStorageConfig(80 * MEBIBYTE, ACCEPTED_RECORDING_MIME_TYPES, "auto")).toEqual({
      allowedMimeTypes: getSupportedRecordingMimeTypes(ACCEPTED_RECORDING_MIME_TYPES),
      bucketMaxFileSizeBytes: 80 * MEBIBYTE,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 80 * MEBIBYTE,
      planMaxFileSizeBytes: null
    });
  });

  it("intersects Supabase wildcard rules with the supported transcription catalog", () => {
    const config = resolveRecordingStorageConfig(
      80 * MEBIBYTE,
      ["audio/*", "application/pdf", "video/webm"],
      "auto"
    );

    expect(config.allowedMimeTypes).not.toContain("audio/aac");
    expect(config.allowedMimeTypes).toContain("audio/x-wav");
    expect(config.allowedMimeTypes).toContain("video/webm");
    expect(config.allowedMimeTypes).not.toContain("application/pdf");
  });

  it("fails closed when Supabase allows only non-transcription MIME types", () => {
    expect(resolveRecordingStorageConfig(80 * MEBIBYTE, ["application/pdf"], "auto")).toMatchObject({
      allowedMimeTypes: null,
      maxFileSizeBytes: null
    });
  });

  it("fails closed while keeping the paid-plan ceiling available as a hint", () => {
    expect(createUnavailableRecordingStorageConfig("paid")).toEqual({
      allowedMimeTypes: null,
      bucketMaxFileSizeBytes: null,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: null,
      planMaxFileSizeBytes: 500 * GIBIBYTE
    });
  });
});
