// Shared data types of the Vosio extension: settings, pairing, recording sessions, capture API payloads.

export type Mode = "auto" | "ask" | "off";
export type PlatformId = "meet" | "teams" | "zoom" | "custom" | "other";
export type PairingStatus = "unpaired" | "paired" | "expired" | "disconnected";

export interface Settings {
  mode: Mode;
  webAddress: string;
  customSites: string[];
  meetingNotifications: boolean;
}

export interface Endpoints {
  authorization: string;
  token: string;
  registration: string;
  revocation: string | null;
}

export interface Discovery {
  webOrigin: string;
  resource: string;
  endpoints: Endpoints;
}

export interface PairingState {
  status: PairingStatus;
  webOrigin: string;
  resource: string;
  endpoints: Endpoints | null;
  clientId: string | null;
  redirectUri: string | null;
  accessToken: string | null;
  accessExpiresAt: number | null;
  refreshToken: string | null;
  grantExpiresAt: number | null;
  email: string | null;
  pairedAt: number | null;
}

export interface CaptureConfig {
  audioBitsPerSecond: number;
  maxPartBytes: number;
  mimeType: string;
  recorderMimeType: string;
  storage: { apiKey: string };
  webOrigin: string;
  account: { email: string };
}

export interface CachedConfig {
  config: CaptureConfig;
  fetchedAt: number;
}

// Lifecycle of a locally stored recording from capture until confirmed upload.
export type SessionStatus = "recording" | "queued" | "uploading" | "waiting-pair" | "failed" | "remote-deleted";

export interface StoredSession {
  id: string;
  platform: PlatformId;
  platformLabel: string;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  title: string | null;
  requestId: string | null;
  completeRequestId: string | null;
  durationSeconds: number | null;
  partCount: number;
  recordingId: string | null;
  captureRevision: number | null;
  accountEmail: string | null;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  uploadedParts: number[];
  detailUrl: string | null;
}

export interface ChunkRecord {
  sessionId: string;
  part: number;
  seq: number;
  t: number;
  blob: Blob;
}

export interface PartInfo {
  part: number;
  bytes: number;
  lastT: number;
}

export interface ActiveRecording {
  sessionId: string;
  tabId: number;
  platform: PlatformId;
  platformLabel: string;
  tabTitle: string;
  startedAt: number;
  micAvailable: boolean;
  tabUrl: string;
}

export interface HistoryEntry {
  id: string;
  title: string;
  detailUrl: string | null;
  at: number;
  transcription: string | null;
}

// Meeting signal reported by content scripts for one tab.
export interface MeetingState {
  platform: PlatformId;
  meetingUrl: boolean;
  inCall: boolean;
  title: string;
}

export interface CreateRecordingResponse {
  recordingId: string;
  captureRevision: number;
  status: string;
  detailUrl: string;
}

export type PartRegistration =
  | { index: number; state: "ready"; uploadUrl: string }
  | { index: number; state: "exists" };

export interface RegisterPartsResponse {
  captureRevision: number;
  parts: PartRegistration[];
}

export interface CompleteResponse {
  recordingId: string;
  status: string;
  transcription: { state: string; operationId: string | null };
  detailUrl: string;
}

export interface StatusResponse {
  recordingId: string;
  status: string;
  transcriptionState: string | null;
  detailUrl: string;
  captureRevision?: number;
}
