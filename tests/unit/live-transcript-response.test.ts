import { describe, expect, it } from "vitest";
import { buildLiveTranscriptSuccessPayload } from "@/lib/live-recording/live-transcript-response";
import { TRANSCRIPT_SEARCH_INDEX_WARNING } from "@/lib/transcripts/search-warning";

describe("live transcript response", () => {
  it("serializes only the saved id and stable warnings from the full database row", () => {
    const savedTranscript = {
      id: "transcript-public-id",
      raw_text: "private transcript text",
      recording_id: "private-recording-id",
      segments: [{ text: "private segment" }],
      speakers: [{ name: "Private speaker" }],
      user_id: "private-user-id"
    };
    const payload = buildLiveTranscriptSuccessPayload(savedTranscript, { status: "incomplete" });
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({
      transcript: { id: "transcript-public-id" },
      warnings: [TRANSCRIPT_SEARCH_INDEX_WARNING]
    });
    expect(serialized).not.toContain("raw_text");
    expect(serialized).not.toContain("segments");
    expect(serialized).not.toContain("speakers");
    expect(serialized).not.toContain("user_id");
    expect(serialized).not.toContain("private transcript text");
  });
});
