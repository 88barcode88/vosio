import { describe, expect, it } from "vitest";
import {
  ACCEPTED_RECORDING_MIME_TYPES,
  formatFileSize,
  getRecordingContentType,
  getRecordingFileAccept,
  getRecordingFormatSummary,
  isSupportedRecordingMimeType,
  getStatusLabel,
  isSegmentedRecordingStoragePath,
  liveAudioQualityOptions,
  normalizeLiveAudioQuality,
  normalizeAudioMimeType
} from "@/lib/recordings/types";

describe("recording type helpers", () => {
  it("normalizes browser MIME types with codec parameters", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("never infers a content type from the file extension", () => {
    const file = new File(["audio"], "call-lucern.m4a", { type: "" });

    expect(getRecordingContentType(file)).toBe("");
  });

  it("keeps a generic browser MIME generic instead of applying an extension fallback", () => {
    expect(getRecordingContentType(
      new File(["audio"], "lucern-33mb.m4a", { type: "application/octet-stream" })
    )).toBe("application/octet-stream");
  });

  it.each(ACCEPTED_RECORDING_MIME_TYPES)("keeps concrete bucket MIME %s authoritative", (mimeType) => {
    expect(getRecordingContentType(new File(["media"], "recording", { type: mimeType }))).toBe(mimeType);
  });

  it("normalizes only explicit browser aliases whose canonical MIME is allowed", () => {
    const aliasedM4a = new File(["media"], "recording.m4a", { type: "audio/m4a" });

    expect(getRecordingContentType(aliasedM4a, ["audio/mp4"])).toBe("audio/mp4");
    expect(getRecordingContentType(aliasedM4a, ["audio/webm"])).toBe("audio/m4a");
  });

  it.each([
    ["audio/flac", "audio/x-flac"],
    ["audio/mp4", "audio/x-m4a"],
    ["audio/ogg", "application/ogg"],
    ["audio/webm", "video/webm"]
  ])("maps explicit %s to the exact sparse bucket alias %s", (browserMime, bucketMime) => {
    expect(getRecordingContentType(
      new File(["media"], "recording", { type: browserMime }),
      [bucketMime]
    )).toBe(bucketMime);
  });

  it("builds one explicit picker hint without broad MIME wildcards", () => {
    const accept = getRecordingFileAccept(ACCEPTED_RECORDING_MIME_TYPES);

    expect(accept).not.toContain("audio/*");
    expect(accept).toContain(".m4a");
    expect(accept).toContain("video/webm");
    expect(getRecordingFormatSummary(ACCEPTED_RECORDING_MIME_TYPES)).toBe(
      "M4A, MP3, WAV, WebM, OGG, FLAC a MP4"
    );
  });

  it("recognizes Soniox-compatible aliases without accepting arbitrary bucket files", () => {
    expect(isSupportedRecordingMimeType("audio/asf")).toBe(false);
    expect(isSupportedRecordingMimeType("audio/amr")).toBe(false);
    expect(isSupportedRecordingMimeType("video/webm")).toBe(true);
    expect(isSupportedRecordingMimeType("application/pdf")).toBe(false);
    expect(isSupportedRecordingMimeType("application/octet-stream")).toBe(false);
  });

  it("renders compact file sizes for storage metadata", () => {
    expect(formatFileSize(52_428_800)).toBe("50 MB");
    expect(formatFileSize(null)).toBe("bez velikosti");
  });

  it("maps persisted statuses to Czech UI labels", () => {
    expect(getStatusLabel("completed")).toBe("Dokončeno");
    expect(getStatusLabel("transcribing")).toBe("Přepisuje se");
  });

  it("detects segmented live recording storage prefixes", () => {
    expect(isSegmentedRecordingStoragePath("user-id/recording-id/live/")).toBe(true);
    expect(isSegmentedRecordingStoragePath("user-id/recording-id/file.webm")).toBe(false);
    expect(isSegmentedRecordingStoragePath(null)).toBe(false);
  });

  it("maps each live audio quality to its requested bitrate and decimal hourly estimate", () => {
    expect(liveAudioQualityOptions).toEqual({
      economy: { audioBitsPerSecond: 32_000, estimatedMegabytesPerHour: 14.4, label: "Úsporná" },
      standard: { audioBitsPerSecond: 64_000, estimatedMegabytesPerHour: 28.8, label: "Standardní" },
      high: { audioBitsPerSecond: 96_000, estimatedMegabytesPerHour: 43.2, label: "Vysoká" }
    });
  });

  it("normalizes missing and invalid live audio quality to standard", () => {
    expect(normalizeLiveAudioQuality(undefined)).toBe("standard");
    expect(normalizeLiveAudioQuality("lossless")).toBe("standard");
    expect(normalizeLiveAudioQuality("high")).toBe("high");
  });
});
