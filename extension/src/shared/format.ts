// Small pure helpers: titles, durations, base64url and type guards shared by all extension contexts.

import type { PlatformId } from "./types.ts";

// Human labels of supported platforms used in recording titles and the popup.
export const PLATFORM_LABELS: Record<PlatformId, string> = {
  meet: "Google Meet",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  custom: "Schůzka",
  other: "Schůzka"
};

// Pads a number with a leading zero to two digits.
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// Builds the recording title "<Platform> – DD.MM.YYYY HH:MM" from the local time of the meeting start.
export function formatTitle(label: string, date: Date): string {
  return `${label} – ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Formats elapsed milliseconds as H:MM:SS or M:SS for the recording timer.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Encodes bytes as unpadded base64url (PKCE verifier/challenge and OAuth state).
export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns a random base64url string built from the given number of random bytes.
export function randomToken(byteLength: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

// Narrows an unknown value to a plain object record.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Reads a non-empty string property from an unknown object, or null.
export function stringField(source: unknown, key: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Reads a finite number property from an unknown object, or null.
export function numberField(source: unknown, key: string): number | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Waits for the given time; replaceable in tests through the timing object.
export const timing = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  now: (): number => Date.now()
};
