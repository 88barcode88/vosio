// Content script engine: evaluates a platform detector on DOM/URL changes and reports debounced meeting state to the service worker.

import type { MeetingState } from "../shared/types.ts";
import type { PlatformDetector } from "./platforms/types.ts";

export const LEAVE_CONFIRM_MS = 3000;
export const POLL_MS = 1000;

export interface InCallTracker {
  reported: boolean;
  falseSince: number | null;
}

// Debounces the "in call" signal: true is reported immediately, false only after it persisted for LEAVE_CONFIRM_MS (reconnect UIs flicker).
export function stepInCall(previous: InCallTracker, raw: boolean, now: number): InCallTracker {
  if (raw) return { reported: true, falseSince: null };
  if (!previous.reported) return { reported: false, falseSince: null };
  const since = previous.falseSince ?? now;
  return now - since >= LEAVE_CONFIRM_MS ? { reported: false, falseSince: null } : { reported: true, falseSince: since };
}

// Computes the current meeting state of the page with the given tracker applied.
export function evaluateState(detector: PlatformDetector, doc: Document, href: string, tracker: InCallTracker, now: number): { state: MeetingState; tracker: InCallTracker } {
  const next = stepInCall(tracker, detector.inCall(doc), now);
  return {
    tracker: next,
    state: { platform: detector.platform, meetingUrl: detector.isMeetingUrl(href), inCall: next.reported, title: detector.title(doc) }
  };
}

// Tells whether two meeting states differ in a way worth reporting.
export function stateChanged(a: MeetingState | null, b: MeetingState): boolean {
  return !a || a.platform !== b.platform || a.meetingUrl !== b.meetingUrl || a.inCall !== b.inCall || a.title !== b.title;
}

// Starts monitoring the page; reports changes via send() and returns a stop function.
export function startMonitor(detector: PlatformDetector, send: (state: MeetingState) => void, doc: Document = document, location: Location = window.location): () => void {
  let tracker: InCallTracker = { reported: false, falseSince: null };
  let last: MeetingState | null = null;
  // Re-evaluates the page and reports the state when it changed.
  const tick = (): void => {
    const result = evaluateState(detector, doc, location.href, tracker, Date.now());
    tracker = result.tracker;
    if (stateChanged(last, result.state)) {
      last = result.state;
      send(result.state);
    }
  };
  const observer = new MutationObserver(() => tick());
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  const timer = setInterval(tick, POLL_MS);
  tick();
  return () => {
    observer.disconnect();
    clearInterval(timer);
  };
}

// Sends the meeting state to the service worker, ignoring errors from an invalidated extension context.
export function sendToServiceWorker(state: MeetingState): void {
  try {
    void chrome.runtime.sendMessage({ type: "meeting-state", state }).catch(() => undefined);
  } catch {
    // Extension was reloaded; this content script instance is stale and simply stops reporting.
  }
}
