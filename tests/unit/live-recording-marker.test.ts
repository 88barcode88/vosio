import { describe, expect, it } from "vitest";
import {
  getLiveMarkerOffsetMs,
  isLiveMarkerSaveResponse
} from "@/lib/recording-markers/live-marker";

describe("live recording marker helper", () => {
  it("rounds a monotonic elapsed offset and clamps it to the schema range", () => {
    expect(getLiveMarkerOffsetMs({ nowMs: 18_765.9, startedAtMs: 5_000 })).toBe(13_766);
    expect(getLiveMarkerOffsetMs({ nowMs: 4_000, startedAtMs: 5_000 })).toBe(0);
    expect(getLiveMarkerOffsetMs({
      nowMs: 90_000_000,
      startedAtMs: 0
    })).toBe(86_400_000);
  });

  it.each([
    ["client marker", { client_marker_id: "other-client-marker" }],
    ["recording", { recording_id: "other-recording" }],
    ["offset", { offset_ms: 12_346 }],
    ["type", { marker_type: "note" }],
    ["note", { note: "unexpected" }]
  ])("rejects a response with a mismatched %s", (_label, mismatch) => {
    const attempt = {
      clientMarkerId: "client-marker",
      markerType: "important",
      note: null,
      offsetMs: 12_345
    } as const;
    const marker = {
      client_marker_id: attempt.clientMarkerId,
      marker_type: attempt.markerType,
      note: attempt.note,
      offset_ms: attempt.offsetMs,
      recording_id: "recording-1",
      ...mismatch
    };

    expect(isLiveMarkerSaveResponse(
      { marker },
      { attempt, recordingId: "recording-1" }
    )).toBe(false);
  });
});
