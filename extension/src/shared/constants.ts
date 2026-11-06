// Shared constants for the Vosio browser extension (OAuth, recording, upload tuning).

export const CAPTURE_SCOPE = "vosio:capture";
export const CLIENT_NAME = "Vosio rozšíření prohlížeče";
export const REDIRECT_PATH = "oauth";
export const DISCOVERY_PATH = "/.well-known/oauth-authorization-server";
export const REGISTRATION_SUFFIX = "/oauth/register";

// Pairing timing: window timeout, grant lifetime (30 days from consent), access token refresh skew.
export const AUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;
export const GRANT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCESS_SKEW_MS = 60 * 1000;
export const REQUEST_TIMEOUT_MS = 30 * 1000;
export const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

// Web Locks names serializing token refresh and upload queue processing across extension contexts.
export const TOKEN_LOCK = "vosio-token-refresh";
export const UPLOAD_LOCK = "vosio-upload-queue";

// Recording tuning: chunk flush interval, rotation at 90 % of the server part limit, fallbacks when config is unknown.
export const CHUNK_TIMESLICE_MS = 5000;
export const PART_ROTATION_RATIO = 0.9;
export const FALLBACK_BITRATE = 64000;
export const FALLBACK_MAX_PART_BYTES = 20 * 1024 * 1024;
export const UPLOAD_MIME = "audio/webm";
export const RECORDER_MIME = "audio/webm;codecs=opus";

// Upload retry policy (in-process PUT retries, session level backoff and the permanent failure ceiling).
export const PUT_ATTEMPTS = 3;
export const SESSION_MAX_ATTEMPTS = 40;
export const SESSION_MAX_ROUNDS = 4;
export const BACKOFF_BASE_MS = 5000;
export const BACKOFF_MAX_MS = 15 * 60 * 1000;
export const UPLOAD_ALARM = "vosio-upload";
export const TICK_ALARM = "vosio-tick";

// Recording statuses (server side) that mean the audio is safely stored in Vosio.
export const DONE_STATUSES: readonly string[] = ["uploaded", "transcribing", "transcribed", "completed", "ready"];

export const MAX_HISTORY = 5;
export const DEFAULT_SHORTCUT_COMMAND = "toggle-recording";
