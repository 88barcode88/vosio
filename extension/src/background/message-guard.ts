// Sender authorization for service worker messages: content scripts may only report meeting state, everything else needs an extension page.

import type { ServiceWorkerMessage } from "../shared/messages.ts";
import { isRecord } from "../shared/format.ts";
import type { MeetingState, PlatformId } from "../shared/types.ts";

const PLATFORMS: readonly PlatformId[] = ["meet", "teams", "zoom", "custom", "other"];
const PAGE_MESSAGE_TYPES: readonly string[] = [
  "start-recording", "stop-recording", "get-popup-state", "retry-upload", "delete-session", "kick-queue",
  "pairing-changed", "settings-changed", "capture-ended", "capture-heartbeat"
];
const MAX_TITLE = 300;

export interface SenderLike {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

// Validates the shape of a meeting state reported by a content script; returns a normalized copy or null.
export function parseMeetingState(value: unknown): MeetingState | null {
  if (!isRecord(value)) return null;
  const { platform, meetingUrl, inCall, title } = value;
  if (typeof platform !== "string" || !PLATFORMS.includes(platform as PlatformId)) return null;
  if (typeof meetingUrl !== "boolean" || typeof inCall !== "boolean" || typeof title !== "string") return null;
  return { platform: platform as PlatformId, meetingUrl, inCall, title: title.slice(0, MAX_TITLE) };
}

// Tells whether the sender is one of the extension's own pages (popup, options, offscreen document).
export function isExtensionPage(sender: SenderLike, extensionId: string, baseUrl: string): boolean {
  return sender.id === extensionId && typeof sender.url === "string" && sender.url.startsWith(baseUrl);
}

// Authorizes a message by sender: meeting-state only from content scripts (validated), all other types only from extension pages.
export function authorizeMessage(message: unknown, sender: SenderLike, extensionId: string, baseUrl: string): ServiceWorkerMessage | null {
  if (!isRecord(message) || typeof message.type !== "string" || sender.id !== extensionId) return null;
  if (message.type === "meeting-state") {
    if (sender.tab?.id === undefined || isExtensionPage(sender, extensionId, baseUrl)) return null;
    const state = parseMeetingState(message.state);
    return state ? { type: "meeting-state", state } : null;
  }
  if (!PAGE_MESSAGE_TYPES.includes(message.type) || !isExtensionPage(sender, extensionId, baseUrl)) return null;
  return message as unknown as ServiceWorkerMessage;
}
