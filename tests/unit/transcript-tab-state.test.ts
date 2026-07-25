import { describe, expect, it } from "vitest";
import {
  getTranscriptTabCookieValue,
  parseTranscriptTabCookieValue
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
});
