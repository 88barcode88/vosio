// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startMonitor, stepInCall, LEAVE_CONFIRM_MS, POLL_MS } from "../../extension/src/content/monitor.ts";
import { customDetector } from "../../extension/src/content/platforms/custom.ts";
import { meetDetector } from "../../extension/src/content/platforms/meet.ts";
import { teamsDetector } from "../../extension/src/content/platforms/teams.ts";
import { zoomDetector } from "../../extension/src/content/platforms/zoom.ts";
import { isMeetingTab, isMeetingUrl, labelFor, leftMeetingUrl, platformForUrl } from "../../extension/src/shared/platforms.ts";
import type { MeetingState } from "../../extension/src/shared/types.ts";

// Replaces the document body with a DOM fixture.
function fixture(html: string, title = ""): Document {
  document.title = title;
  document.body.innerHTML = html;
  return document;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("meeting URL recognition", () => {
  it("recognizes Meet codes but not the landing page", () => {
    expect(isMeetingUrl("meet", "https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(isMeetingUrl("meet", "https://meet.google.com/abc-defg-hij?authuser=1")).toBe(true);
    expect(isMeetingUrl("meet", "https://meet.google.com/landing")).toBe(false);
    expect(isMeetingUrl("meet", "https://meet.google.com/")).toBe(false);
  });

  it("recognizes Teams meeting links but treats the plain app as a meeting only when in call", () => {
    expect(isMeetingUrl("teams", "https://teams.microsoft.com/l/meetup-join/19%3ameeting")).toBe(true);
    expect(isMeetingUrl("teams", "https://teams.live.com/meet/9876543")).toBe(true);
    expect(isMeetingTab("https://teams.microsoft.com/v2/", false)).toBe(false);
    expect(isMeetingTab("https://teams.microsoft.com/v2/", true)).toBe(true);
  });

  it("recognizes the Zoom web client only", () => {
    expect(isMeetingUrl("zoom", "https://app.zoom.us/wc/123456789/join")).toBe(true);
    expect(isMeetingUrl("zoom", "https://acme.zoom.us/wc/123456789/start")).toBe(true);
    expect(isMeetingUrl("zoom", "https://zoom.us/j/123456789")).toBe(false);
  });

  it("matches custom sites by host and labels them with the host", () => {
    expect(platformForUrl("https://meet.firma.cz/room", ["meet.firma.cz"])).toBe("custom");
    expect(platformForUrl("https://meet.firma.cz/room", [])).toBe("other");
    expect(labelFor("custom", "https://meet.firma.cz/room")).toBe("meet.firma.cz");
    expect(labelFor("meet", "https://meet.google.com/abc-defg-hij")).toBe("Google Meet");
  });

  it("detects leaving the meeting URL as a stop signal", () => {
    const start = "https://meet.google.com/abc-defg-hij";
    expect(leftMeetingUrl("meet", start, "https://meet.google.com/abc-defg-hij?pli=1")).toBe(false);
    expect(leftMeetingUrl("meet", start, "https://meet.google.com/landing")).toBe(true);
    expect(leftMeetingUrl("teams", "https://teams.microsoft.com/v2/", "https://teams.microsoft.com/v2/?x=1")).toBe(false);
    expect(leftMeetingUrl("teams", "https://teams.microsoft.com/v2/", "https://example.com/")).toBe(true);
    expect(leftMeetingUrl("custom", "https://meet.firma.cz/a", "https://meet.firma.cz/b")).toBe(false);
    expect(leftMeetingUrl("custom", "https://meet.firma.cz/a", "https://other.example/")).toBe(true);
    expect(leftMeetingUrl("other", "https://x.example/a", "https://x.example/b")).toBe(false);
  });
});

describe("platform detectors on DOM fixtures", () => {
  it("Meet: lobby is not a call, leave button (en/cs) is", () => {
    expect(meetDetector.inCall(fixture('<button aria-label="Join now">Join now</button>'))).toBe(false);
    expect(meetDetector.inCall(fixture('<button aria-label="Leave call"></button>'))).toBe(true);
    expect(meetDetector.inCall(fixture('<button aria-label="Opustit hovor"></button>'))).toBe(true);
    expect(meetDetector.inCall(fixture('<div role="button" data-tooltip="Leave call"></div>'))).toBe(true);
    expect(meetDetector.title(fixture("", "Týdenní porada - Google Meet"))).toBe("Týdenní porada");
  });

  it("Meet: an unknown UI language never reports a call (conservative, no false auto-stop)", () => {
    expect(meetDetector.inCall(fixture('<button aria-label="Zxcv"></button>'))).toBe(false);
  });

  it("Teams: hang-up selectors and labels", () => {
    expect(teamsDetector.inCall(fixture('<button id="hangup-button"></button>'))).toBe(true);
    expect(teamsDetector.inCall(fixture('<button data-tid="hangup-main-btn"></button>'))).toBe(true);
    expect(teamsDetector.inCall(fixture('<button aria-label="Leave (Ctrl+Shift+H)"></button>'))).toBe(true);
    expect(teamsDetector.inCall(fixture('<button aria-label="Chat"></button>'))).toBe(false);
  });

  it("Zoom: footer leave button", () => {
    expect(zoomDetector.inCall(fixture('<button class="footer__leave-btn">Leave</button>'))).toBe(true);
    expect(zoomDetector.inCall(fixture('<button class="join-btn">Join</button>'))).toBe(false);
  });

  it("custom sites: every page counts as a meeting, no call signal", () => {
    expect(customDetector.isMeetingUrl("https://anything.example/x")).toBe(true);
    expect(customDetector.inCall(fixture('<button aria-label="Leave call"></button>'))).toBe(false);
  });
});

describe("in-call debounce and monitor", () => {
  it("reports a call immediately but the end only after it persisted", () => {
    let tracker = stepInCall({ reported: false, falseSince: null }, true, 0);
    expect(tracker.reported).toBe(true);
    tracker = stepInCall(tracker, false, 1000);
    expect(tracker.reported).toBe(true);
    tracker = stepInCall(tracker, true, 2000);
    expect(tracker).toEqual({ reported: true, falseSince: null });
    tracker = stepInCall(tracker, false, 3000);
    tracker = stepInCall(tracker, false, 3000 + LEAVE_CONFIRM_MS);
    expect(tracker.reported).toBe(false);
  });

  it("sends state changes: lobby -> in call -> left, ignoring a short flicker", () => {
    vi.useFakeTimers();
    fixture('<button aria-label="Join now"></button>', "Standup - Google Meet");
    const location = { href: "https://meet.google.com/abc-defg-hij" } as Location;
    const sent: MeetingState[] = [];
    const stop = startMonitor(meetDetector, (state) => sent.push(state), document, location);
    expect(sent).toEqual([{ platform: "meet", meetingUrl: true, inCall: false, title: "Standup" }]);

    document.body.innerHTML = '<button aria-label="Leave call"></button>';
    vi.advanceTimersByTime(POLL_MS);
    expect(sent.at(-1)?.inCall).toBe(true);

    document.body.innerHTML = "";
    vi.advanceTimersByTime(POLL_MS * 2);
    expect(sent.at(-1)?.inCall).toBe(true);
    document.body.innerHTML = '<button aria-label="Leave call"></button>';
    vi.advanceTimersByTime(POLL_MS * 2);
    expect(sent.at(-1)?.inCall).toBe(true);

    document.body.innerHTML = "";
    vi.advanceTimersByTime(LEAVE_CONFIRM_MS + POLL_MS * 2);
    expect(sent.at(-1)?.inCall).toBe(false);
    stop();
  });

  it("reports when an SPA navigation leaves the meeting URL", () => {
    vi.useFakeTimers();
    fixture('<button aria-label="Leave call"></button>');
    const location = { href: "https://meet.google.com/abc-defg-hij" } as Location;
    const sent: MeetingState[] = [];
    const stop = startMonitor(meetDetector, (state) => sent.push(state), document, location);
    location.href = "https://meet.google.com/landing";
    vi.advanceTimersByTime(POLL_MS);
    expect(sent.at(-1)?.meetingUrl).toBe(false);
    stop();
  });
});
