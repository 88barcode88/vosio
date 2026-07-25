import { describe, expect, it } from "vitest";
import {
  getLiveDraftAutosavePayload,
  getRecoveredLiveRecordingUpdate,
  getRecoverableLiveStoragePrefix,
  isRecoverableLiveRecording
} from "@/lib/live-recording/recovery";

describe("live recording recovery helpers", () => {
  it("normalizes partial live transcript autosave payloads", () => {
    expect(
      getLiveDraftAutosavePayload({
        elapsedSeconds: 4.2,
        rawText: "  ahoj svete  ",
        segments: [{ text: "ahoj" }]
      })
    ).toEqual({
      duration_seconds: 5,
      raw_text: "ahoj svete",
      segments: [{ text: "ahoj" }]
    });
  });

  it("detects recoverable unfinished live recordings", () => {
    expect(isRecoverableLiveRecording({ source_type: "in_app_recording", status: "uploading" })).toBe(true);
    expect(isRecoverableLiveRecording({ source_type: "in_app_recording", status: "failed" })).toBe(true);
    expect(isRecoverableLiveRecording({ source_type: "in_app_recording", status: "transcribing" })).toBe(true);
    expect(isRecoverableLiveRecording({ source_type: "realtime", status: "uploading" })).toBe(true);
    expect(isRecoverableLiveRecording({ source_type: "upload", status: "uploading" })).toBe(false);
    expect(isRecoverableLiveRecording({ source_type: "in_app_recording", status: "completed" })).toBe(false);
  });

  it("recovers an oversized live recording as text-only when no audio object exists", () => {
    expect(
      getRecoveredLiveRecordingUpdate({
        hasTranscript: true,
        segmentCount: 0,
        storagePrefix: "user-id/recording-id/live/",
        totalBytes: 0
      })
    ).toMatchObject({
      file_size_bytes: 0,
      source_type: "realtime",
      status: "completed",
      storage_path: null
    });
  });

  it("derives live storage prefix from user and recording ids", () => {
    expect(getRecoverableLiveStoragePrefix("user-id", "recording-id")).toBe("user-id/recording-id/live/");
  });
});
