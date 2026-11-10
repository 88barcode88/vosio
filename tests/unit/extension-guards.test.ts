import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEP_ALIVE_MS, startKeepAlive } from "../../extension/src/background/keep-alive.ts";
import { authorizeMessage } from "../../extension/src/background/message-guard.ts";
import { decideShortcut } from "../../extension/src/background/shortcut.ts";
import { refreshToolbar } from "../../extension/src/background/tab-ui.ts";
import { isHttpsOnOrigin, safeDetailUrl } from "../../extension/src/background/url-guard.ts";
import { saveSettings, writeNoticeAccepted } from "../../extension/src/shared/storage.ts";
import { installChrome, installFakeVosio, pairFully, type ChromeStub } from "./extension-test-utils";

const BASE = "chrome-extension://test/";
const state = { platform: "meet", meetingUrl: true, inCall: true, title: "Standup" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("message sender authorization", () => {
  it("accepts a validated meeting-state only from a content script", () => {
    const content = { id: "test", url: "https://meet.google.com/abc-defg-hij", tab: { id: 3 } };
    expect(authorizeMessage({ type: "meeting-state", state }, content, "test", BASE)).toEqual({ type: "meeting-state", state });
    expect(authorizeMessage({ type: "meeting-state", state: { ...state, platform: "evil" } }, content, "test", BASE)).toBeNull();
    expect(authorizeMessage({ type: "meeting-state", state: { ...state, inCall: "yes" } }, content, "test", BASE)).toBeNull();
    expect(authorizeMessage({ type: "meeting-state" }, content, "test", BASE)).toBeNull();
    const long = authorizeMessage({ type: "meeting-state", state: { ...state, title: "x".repeat(1000) } }, content, "test", BASE);
    expect(long && "state" in long && long.state.title).toHaveLength(300);
  });

  it("rejects every other message type from content scripts and web pages", () => {
    const content = { id: "test", url: "https://meet.google.com/abc-defg-hij", tab: { id: 3 } };
    for (const type of ["start-recording", "stop-recording", "get-popup-state", "delete-session", "pairing-changed", "capture-ended"]) {
      expect(authorizeMessage({ type, tabId: 1, streamId: "x" }, content, "test", BASE)).toBeNull();
    }
  });

  it("accepts page messages only from the extension's own pages and ids", () => {
    const popup = { id: "test", url: `${BASE}popup/popup.html` };
    expect(authorizeMessage({ type: "stop-recording" }, popup, "test", BASE)).toEqual({ type: "stop-recording" });
    expect(authorizeMessage({ type: "capture-ended", sessionId: "s", reason: "r" }, { id: "test", url: `${BASE}offscreen/offscreen.html` }, "test", BASE)).not.toBeNull();
    expect(authorizeMessage({ type: "stop-recording" }, { id: "other", url: `${BASE}popup/popup.html` }, "test", BASE)).toBeNull();
    expect(authorizeMessage({ type: "stop-recording" }, { id: "test", url: "https://evil.example/" }, "test", BASE)).toBeNull();
    expect(authorizeMessage({ type: "unknown-type" }, popup, "test", BASE)).toBeNull();
    expect(authorizeMessage({ type: "meeting-state", state }, { ...popup, tab: { id: 2 } }, "test", BASE)).toBeNull();
  });
});

describe("shortcut decision (mode semantics)", () => {
  const base = { recording: false, mode: "auto" as const, paired: true, noticeAccepted: true, canCapture: true };

  it("starts immediately only in Automaticky", () => {
    expect(decideShortcut(base)).toBe("start");
    expect(decideShortcut({ ...base, mode: "ask" })).toBe("prompt");
    expect(decideShortcut({ ...base, mode: "off" })).toBe("prompt");
  });

  it("asks via the popup when unpaired, notice pending or the tab cannot be captured", () => {
    expect(decideShortcut({ ...base, paired: false })).toBe("prompt");
    expect(decideShortcut({ ...base, noticeAccepted: false })).toBe("prompt");
    expect(decideShortcut({ ...base, canCapture: false })).toBe("prompt");
  });

  it("stops a running recording in every mode", () => {
    for (const mode of ["auto", "ask", "off"] as const) expect(decideShortcut({ ...base, mode, recording: true })).toBe("stop");
  });
});

describe("service worker keep-alive", () => {
  it("pings an extension API every 20 s until stopped", () => {
    installChrome();
    vi.useFakeTimers();
    const stop = startKeepAlive();
    vi.advanceTimersByTime(KEEP_ALIVE_MS * 2 + 100);
    expect((chrome.runtime.getPlatformInfo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    stop();
    vi.advanceTimersByTime(KEEP_ALIVE_MS * 3);
    expect((chrome.runtime.getPlatformInfo as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe("server URL validation", () => {
  it("accepts only HTTPS URLs on the expected origin", () => {
    expect(isHttpsOnOrigin("https://supabase.example/storage/x", "https://supabase.example")).toBe(true);
    expect(isHttpsOnOrigin("http://supabase.example/storage/x", "https://supabase.example")).toBe(false);
    expect(isHttpsOnOrigin("https://evil.example/storage/x", "https://supabase.example")).toBe(false);
    expect(isHttpsOnOrigin("https://supabase.example.evil.example/", "https://supabase.example")).toBe(false);
    expect(isHttpsOnOrigin(undefined, "https://supabase.example")).toBe(false);
    expect(safeDetailUrl("https://vosio.example/recordings/1", "https://vosio.example")).toBe("https://vosio.example/recordings/1");
    expect(safeDetailUrl("javascript:alert(1)", "https://vosio.example")).toBeNull();
    expect(safeDetailUrl("https://evil.example/recordings/1", "https://vosio.example")).toBeNull();
  });
});

describe("toolbar after a worker restart", () => {
  let chromeStub: ChromeStub;

  beforeEach(() => {
    chromeStub = installChrome();
    installFakeVosio(chromeStub);
  });

  it("reads the tab URL from the tab when the in-memory URL map is empty and disables the popup in Automaticky", async () => {
    await pairFully();
    await saveSettings({ mode: "auto" });
    await writeNoticeAccepted();
    chromeStub.tabs.urls.set(5, "https://meet.google.com/abc-defg-hij");
    await refreshToolbar({ 5: { platform: "meet", meetingUrl: true, inCall: false, title: "" } }, {});
    expect(chromeStub.action.setPopup).toHaveBeenCalledWith({ tabId: 5, popup: "" });
    expect(chromeStub.action.setBadgeText).toHaveBeenCalledWith({ tabId: 5, text: "●" });
  });

  it("keeps the popup in mode Zeptat se", async () => {
    await pairFully();
    await writeNoticeAccepted();
    chromeStub.tabs.urls.set(5, "https://meet.google.com/abc-defg-hij");
    await refreshToolbar({ 5: { platform: "meet", meetingUrl: true, inCall: false, title: "" } }, {});
    expect(chromeStub.action.setPopup).toHaveBeenCalledWith({ tabId: 5, popup: "popup/popup.html" });
  });
});
