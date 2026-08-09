import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  getRecordingContentType,
  getStatusLabel,
  isSegmentedRecordingStoragePath,
  normalizeAudioMimeType
} from "@/lib/recordings/types";

describe("recording type helpers", () => {
  it("normalizes browser MIME types with codec parameters", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("falls back to extension-based content type when a phone file has no MIME type", () => {
    const file = new File(["audio"], "call-lucern.m4a", { type: "" });

    expect(getRecordingContentType(file)).toBe("audio/mp4");
  });

  it("falls back from a generic browser MIME only for an allowlisted recording extension", () => {
    expect(
      getRecordingContentType(new File(["audio"], "lucern-33mb.m4a", { type: "application/octet-stream" }))
    ).toBe("audio/mp4");
    expect(
      getRecordingContentType(new File(["text"], "notes.exe", { type: "application/octet-stream" }))
    ).toBe("application/octet-stream");
  });

  it("keeps concrete accepted M4A and MP4 browser MIME types", () => {
    expect(getRecordingContentType(new File(["audio"], "call.m4a", { type: "audio/x-m4a" }))).toBe("audio/x-m4a");
    expect(getRecordingContentType(new File(["video"], "call.mp4", { type: "video/mp4" }))).toBe("video/mp4");
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
});
