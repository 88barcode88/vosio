// URL based recognition of supported meeting platforms, shared by the service worker and the content scripts.

import { PLATFORM_LABELS } from "./format.ts";
import type { PlatformId } from "./types.ts";

const MEET_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\/|$)/i;
const TEAMS_MEETING_PATHS = [/\/meetup-join\b/i, /\/light-meetings\b/i, /\/meet\//i];

// Parses a URL string or returns null when it is not a valid absolute URL.
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// Extracts the lowercase hostname of a site entry (stored as origin) or null.
export function hostOf(value: string): string | null {
  return parseUrl(value)?.hostname.toLowerCase() ?? null;
}

// Identifies the platform family of a tab URL (custom sites are matched by host); "other" when unknown.
export function platformForUrl(url: string, customHosts: readonly string[] = []): PlatformId {
  const parsed = parseUrl(url);
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return "other";
  const host = parsed.hostname.toLowerCase();
  if (host === "meet.google.com") return "meet";
  if (host === "teams.microsoft.com" || host === "teams.live.com") return "teams";
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return "zoom";
  return customHosts.includes(host) ? "custom" : "other";
}

// Tells whether the URL itself looks like a meeting of the given platform (custom sites: any page of the host).
export function isMeetingUrl(platform: PlatformId, url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (platform === "meet") return parsed.hostname.toLowerCase() === "meet.google.com" && MEET_PATH.test(parsed.pathname);
  if (platform === "teams") return TEAMS_MEETING_PATHS.some((pattern) => pattern.test(parsed.pathname + parsed.hash));
  if (platform === "zoom") return /^\/wc\//i.test(parsed.pathname);
  return platform === "custom";
}

// Tells whether a tab should be treated as a meeting page (Teams also needs an in-call signal, its URLs are ambiguous).
export function isMeetingTab(url: string, inCall: boolean, customHosts: readonly string[] = []): boolean {
  const platform = platformForUrl(url, customHosts);
  if (platform === "other") return false;
  if (platform === "teams") return inCall || isMeetingUrl("teams", url);
  return isMeetingUrl(platform, url);
}

// Returns the label used in titles: the platform name, or the hostname for custom and unknown sites.
export function labelFor(platform: PlatformId, url: string): string {
  if (platform === "custom" || platform === "other") return parseUrl(url)?.hostname || PLATFORM_LABELS[platform];
  return PLATFORM_LABELS[platform];
}

// Tells whether a URL left the meeting pattern of the platform the recording started on (stop signal).
export function leftMeetingUrl(platform: PlatformId, startUrl: string, url: string): boolean {
  if (platform === "other") {
    const before = parseUrl(startUrl);
    const after = parseUrl(url);
    return !before || !after || before.origin !== after.origin;
  }
  if (platform === "custom") return platformForUrl(url, [hostOf(startUrl) ?? ""]) !== "custom";
  if (platform === "teams") return platformForUrl(url) !== "teams";
  return !isMeetingUrl(platform, url);
}
