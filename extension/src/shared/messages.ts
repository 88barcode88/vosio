// Message contracts between popup/options/content scripts, the service worker and the offscreen document.

import type { ActiveRecording, HistoryEntry, MeetingState, PairingState, PlatformId, Settings, StoredSession } from "./types.ts";

export interface StartRecordingMessage {
  type: "start-recording";
  tabId: number;
  streamId: string;
  tabTitle: string;
  tabUrl: string;
  replaceExisting?: boolean;
}

export type ServiceWorkerMessage =
  | StartRecordingMessage
  | { type: "stop-recording" }
  | { type: "get-popup-state"; tabId: number | null }
  | { type: "retry-upload"; id: string }
  | { type: "delete-session"; id: string }
  | { type: "kick-queue" }
  | { type: "pairing-changed" }
  | { type: "settings-changed" }
  | { type: "meeting-state"; state: MeetingState }
  | { type: "capture-ended"; sessionId: string; reason: string }
  | { type: "capture-heartbeat"; sessionId: string };

export type OffscreenMessage =
  | { target: "offscreen"; type: "offscreen-start"; sessionId: string; streamId: string; audioBitsPerSecond: number; maxPartBytes: number; recorderMimeType: string }
  | { target: "offscreen"; type: "offscreen-stop" }
  | { target: "offscreen"; type: "offscreen-status" };

export interface OffscreenStartResult {
  ok: boolean;
  micAvailable: boolean;
  error?: string;
}

export interface OffscreenStatusResult {
  sessionId: string | null;
}

export interface PopupTabInfo {
  tabId: number;
  platform: PlatformId;
  platformLabel: string;
  isMeeting: boolean;
  inCall: boolean;
}

export interface PopupState {
  pairing: Pick<PairingState, "status" | "webOrigin" | "email">;
  settings: Settings;
  noticeAccepted: boolean;
  recording: ActiveRecording | null;
  sessions: StoredSession[];
  history: HistoryEntry[];
  tab: PopupTabInfo | null;
}

export interface StartResult {
  ok: boolean;
  error?: string;
}
