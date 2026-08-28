import { describe, expect, it } from "vitest";
import {
  getTranscriptTabCookieValue,
  parseTranscriptTabCookieValue,
  parseTranscriptTabSearchParams
} from "@/components/transcript-tabs/tab-state";

describe("transcript tab state", () => {
  it("parses a tab cookie only for the current recording", () => {
    const cookieValue = getTranscriptTabCookieValue("recording-1", "ai");

    expect(parseTranscriptTabCookieValue("recording-1", cookieValue)).toBe("ai");
    expect(parseTranscriptTabCookieValue("recording-2", cookieValue)).toBeNull();
  });

  it("decodes browser-encoded tab cookie values", () => {
    const cookieValue = encodeURIComponent(getTranscriptTabCookieValue("recording-1", "timeline"));

    expect(parseTranscriptTabCookieValue("recording-1", cookieValue)).toBe("timeline");
  });

  it("ignores invalid tab cookie values", () => {
    expect(parseTranscriptTabCookieValue("recording-1", "recording-1:unknown")).toBeNull();
    expect(parseTranscriptTabCookieValue("recording-1", null)).toBeNull();
  });

  it("accepts every detail tab from one canonical URL value", () => {
    for (const tab of ["transcript", "ai", "timeline", "files", "chat"] as const) {
      expect(parseTranscriptTabSearchParams({ tab })).toEqual({
        explicit: true,
        tab,
        valid: true
      });
    }
  });

  it("rejects duplicate and invalid URL tabs deterministically", () => {
    expect(parseTranscriptTabSearchParams({ tab: ["ai", "transcript"] })).toEqual({
      explicit: false,
      tab: "transcript",
      valid: false
    });
    expect(parseTranscriptTabSearchParams({ tab: "unknown" })).toEqual({
      explicit: false,
      tab: "transcript",
      valid: false
    });
  });
});
