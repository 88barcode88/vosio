// Contract of a per-platform meeting detector used by the content script monitor.

import type { PlatformId } from "../../shared/types.ts";

export interface PlatformDetector {
  platform: PlatformId;
  // True when the page URL itself identifies a meeting of this platform.
  isMeetingUrl(url: string): boolean;
  // True when the DOM shows an active call (leave/hang-up control present); conservative: unknown means false.
  inCall(doc: Document): boolean;
  // Display title of the meeting (document title without the platform suffix).
  title(doc: Document): string;
}

// Finds an element matching one of the CSS selectors, or a button whose accessible label matches the pattern.
export function hasControl(doc: Document, selectors: readonly string[], label: RegExp | null): boolean {
  for (const selector of selectors) {
    if (doc.querySelector(selector)) return true;
  }
  if (!label) return false;
  for (const element of Array.from(doc.querySelectorAll("button, [role='button']"))) {
    const text = element.getAttribute("aria-label") ?? element.getAttribute("data-tooltip") ?? element.getAttribute("title") ?? "";
    if (label.test(text)) return true;
  }
  return false;
}

// Trims platform suffixes like " - Google Meet" from the document title.
export function cleanTitle(doc: Document, suffix: RegExp): string {
  return (doc.title ?? "").replace(suffix, "").trim();
}
