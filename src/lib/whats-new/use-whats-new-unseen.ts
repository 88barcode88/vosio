"use client";

import { useEffect, useState } from "react";
import { getLatestWhatsNewId } from "@/lib/whats-new/entries";

const SEEN_EVENT = "vosio-whats-new-seen";

// seenStorageKey scopes the "already opened" marker to one signed-in user in this browser.
function seenStorageKey(userKey: string) {
  return `vosio-whats-new-seen:${userKey}`;
}

// readSeenId returns the last release id the user opened, null when nothing was stored yet, and undefined when storage is unavailable.
function readSeenId(userKey: string): string | null | undefined {
  try {
    return window.localStorage.getItem(seenStorageKey(userKey));
  } catch {
    return undefined;
  }
}

// markWhatsNewSeen remembers the newest release as seen and tells mounted navigation to hide its dot.
export function markWhatsNewSeen(userKey: string) {
  try {
    window.localStorage.setItem(seenStorageKey(userKey), getLatestWhatsNewId());
  } catch {
    // Storage can be blocked (private mode); the dot then simply stays until the next visit.
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

// useWhatsNewUnseen is true only after hydration when the user has not opened the newest release yet; unreadable storage never shows the dot.
export function useWhatsNewUnseen(userKey: string): boolean {
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    if (!userKey) return;
    // refresh recomputes the dot from storage so it reacts to the Novinky page marking itself as read.
    const refresh = () => {
      const seen = readSeenId(userKey);
      setUnseen(seen !== undefined && seen !== getLatestWhatsNewId());
    };
    refresh();
    window.addEventListener(SEEN_EVENT, refresh);
    return () => window.removeEventListener(SEEN_EVENT, refresh);
  }, [userKey]);

  return unseen;
}
