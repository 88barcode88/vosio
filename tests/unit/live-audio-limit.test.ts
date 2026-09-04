import { describe, expect, it } from "vitest";
import {
  getLiveAudioDiscardEstimateBytes,
  getLiveAudioMaxFileSizeBytes,
  isLiveAudioBlobWithinLimit
} from "@/lib/recordings/live-audio-limit";

const MEBIBYTE = 1024 * 1024;

describe("live audio size limit", () => {
  it("keeps live audio unavailable when the Storage bucket limit is unavailable", () => {
    expect(getLiveAudioMaxFileSizeBytes(null)).toBeNull();
  });

  it("uses the smaller of the Storage bucket and 128 MiB live audio policy", () => {
    expect(getLiveAudioMaxFileSizeBytes(64 * MEBIBYTE)).toBe(64 * MEBIBYTE);
    expect(getLiveAudioMaxFileSizeBytes(512 * MEBIBYTE)).toBe(128 * MEBIBYTE);
  });

  it("reserves five percent of the live limit, capped at 2 MiB, before owned stop", () => {
    expect(getLiveAudioDiscardEstimateBytes(20 * MEBIBYTE)).toBe(19 * MEBIBYTE);
    expect(getLiveAudioDiscardEstimateBytes(128 * MEBIBYTE)).toBe(126 * MEBIBYTE);
  });

  it("accepts a final audio Blob at the limit and rejects one byte above it", () => {
    const maxBytes = 128 * MEBIBYTE;

    expect(isLiveAudioBlobWithinLimit({ size: maxBytes } as Blob, maxBytes)).toBe(true);
    expect(isLiveAudioBlobWithinLimit({ size: maxBytes + 1 } as Blob, maxBytes)).toBe(false);
  });

  it("does not accept audio when the live limit is unavailable", () => {
    expect(isLiveAudioBlobWithinLimit({ size: 1 } as Blob, null)).toBe(false);
  });
});
