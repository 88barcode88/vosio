// Typed access to chrome.storage: settings (sync), tokens/state/history (local), tab meeting states (session).

import { MAX_HISTORY } from "./constants.ts";
import { isRecord } from "./format.ts";
import type { ActiveRecording, CachedConfig, HistoryEntry, MeetingState, Mode, PairingState, Settings } from "./types.ts";

export const DEFAULT_SETTINGS: Settings = { mode: "ask", webAddress: "", customSites: [], meetingNotifications: false };

export const EMPTY_PAIRING: PairingState = {
  status: "unpaired",
  webOrigin: "",
  resource: "",
  endpoints: null,
  clientId: null,
  redirectUri: null,
  accessToken: null,
  accessExpiresAt: null,
  refreshToken: null,
  grantExpiresAt: null,
  email: null,
  pairedAt: null
};

const KEYS = {
  settings: "settings",
  pairing: "pairing",
  config: "captureConfig",
  notice: "noticeAccepted",
  active: "activeRecording",
  history: "history",
  tabStates: "tabStates",
  retries: "transcriptionRetries"
} as const;

// Pending retry of /complete for a recording whose audio is stored but whose transcription was reported as "not_started".
export interface TranscriptionRetry {
  recordingId: string;
  requestId: string;
  captureRevision: number;
  durationSeconds: number;
  partCount: number;
  attempts: number;
}

// Reads the transcription start retries that survive deletion of the local audio.
export async function readTranscriptionRetries(): Promise<TranscriptionRetry[]> {
  const stored = (await chrome.storage.local.get(KEYS.retries))[KEYS.retries];
  return Array.isArray(stored) ? (stored as TranscriptionRetry[]) : [];
}

// Replaces the list of transcription start retries.
export async function writeTranscriptionRetries(retries: TranscriptionRetry[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.retries]: retries });
}

// Narrows an unknown value to a valid recording mode.
function isMode(value: unknown): value is Mode {
  return value === "auto" || value === "ask" || value === "off";
}

// Loads settings from chrome.storage.sync, filling defaults and discarding malformed values.
export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.sync.get(KEYS.settings))[KEYS.settings];
  if (!isRecord(stored)) return { ...DEFAULT_SETTINGS };
  return {
    mode: isMode(stored.mode) ? stored.mode : DEFAULT_SETTINGS.mode,
    webAddress: typeof stored.webAddress === "string" ? stored.webAddress : "",
    customSites: Array.isArray(stored.customSites) ? stored.customSites.filter((site): site is string => typeof site === "string") : [],
    meetingNotifications: stored.meetingNotifications === true
  };
}

// Merges a partial settings change into chrome.storage.sync and returns the new settings.
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.sync.set({ [KEYS.settings]: next });
  return next;
}

// Loads the pairing state (tokens and endpoints) from chrome.storage.local.
export async function readPairing(): Promise<PairingState> {
  const stored = (await chrome.storage.local.get(KEYS.pairing))[KEYS.pairing];
  return isRecord(stored) ? { ...EMPTY_PAIRING, ...(stored as Partial<PairingState>) } : { ...EMPTY_PAIRING };
}

// Persists the full pairing state; callers persist rotated tokens before using them.
export async function writePairing(state: PairingState): Promise<void> {
  await chrome.storage.local.set({ [KEYS.pairing]: state });
}

// Reads the cached capture config (bitrate, part limit, storage key) of the paired installation.
export async function readCachedConfig(): Promise<CachedConfig | null> {
  const stored = (await chrome.storage.local.get(KEYS.config))[KEYS.config];
  return isRecord(stored) && isRecord(stored.config) ? (stored as unknown as CachedConfig) : null;
}

// Stores the capture config fetched from the server.
export async function writeCachedConfig(value: CachedConfig | null): Promise<void> {
  if (value === null) await chrome.storage.local.remove(KEYS.config);
  else await chrome.storage.local.set({ [KEYS.config]: value });
}

// Tells whether the user already confirmed the one-time notice about recording participants.
export async function readNoticeAccepted(): Promise<boolean> {
  return (await chrome.storage.local.get(KEYS.notice))[KEYS.notice] === true;
}

// Remembers that the participant notice was confirmed.
export async function writeNoticeAccepted(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.notice]: true });
}

// Reads the descriptor of the recording currently in progress (persisted for service worker restarts).
export async function readActiveRecording(): Promise<ActiveRecording | null> {
  const stored = (await chrome.storage.local.get(KEYS.active))[KEYS.active];
  return isRecord(stored) ? (stored as unknown as ActiveRecording) : null;
}

// Persists or clears the active recording descriptor.
export async function writeActiveRecording(value: ActiveRecording | null): Promise<void> {
  if (value === null) await chrome.storage.local.remove(KEYS.active);
  else await chrome.storage.local.set({ [KEYS.active]: value });
}

// Reads the list of recently uploaded recordings shown in the popup.
export async function readHistory(): Promise<HistoryEntry[]> {
  const stored = (await chrome.storage.local.get(KEYS.history))[KEYS.history];
  return Array.isArray(stored) ? (stored as HistoryEntry[]) : [];
}

// Prepends an uploaded recording to the bounded history.
export async function addHistory(entry: HistoryEntry): Promise<void> {
  const current = await readHistory();
  const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [KEYS.history]: next });
}

// Reads per-tab meeting states kept in session storage so they survive service worker restarts.
export async function readTabStates(): Promise<Record<string, MeetingState>> {
  const stored = (await chrome.storage.session.get(KEYS.tabStates))[KEYS.tabStates];
  return isRecord(stored) ? (stored as Record<string, MeetingState>) : {};
}

// Writes per-tab meeting states to session storage.
export async function writeTabStates(states: Record<string, MeetingState>): Promise<void> {
  await chrome.storage.session.set({ [KEYS.tabStates]: states });
}
