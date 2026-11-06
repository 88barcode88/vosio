// Client for the Vosio capture API (design D8): authenticated POST calls with one refresh on 401, config cache, signed PUT.

import { REQUEST_TIMEOUT_MS, UPLOAD_MIME, UPLOAD_TIMEOUT_MS } from "../shared/constants.ts";
import { isRecord, numberField, stringField, timing } from "../shared/format.ts";
import { readCachedConfig, readPairing, writeCachedConfig, writePairing } from "../shared/storage.ts";
import type { CaptureConfig, Discovery, PairingState } from "../shared/types.ts";
import { disconnect, getAccessToken, markNeedsPairing, NeedsPairingError, pairWithServer } from "./pairing.ts";

// Error returned by the capture API or the storage PUT; status 0 means a network failure.
export class CaptureApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CaptureApiError";
    this.status = status;
    this.code = code;
  }

  // True for failures worth retrying later (network, rate limit, server trouble).
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

// Sends one capture request with the bearer token; a 401 triggers exactly one forced refresh and one retry.
export async function capturePost<T>(path: string, body: unknown): Promise<T> {
  const state = await readPairing();
  if (state.status !== "paired" || !state.resource) throw new NeedsPairingError(state.status);
  const url = `${state.resource}/capture${path}`;
  let token = await getAccessToken();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new CaptureApiError(0, "network", "Server Vosia je nedostupný.");
    }
    if (response.status === 401) {
      if (attempt === 0) {
        token = await getAccessToken({ forceRefresh: true, staleToken: token });
        continue;
      }
      await markNeedsPairing("expired", token);
      throw new NeedsPairingError("expired");
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = isRecord(payload) ? payload.error : null;
      throw new CaptureApiError(response.status, stringField(error, "code") ?? "http_error", stringField(error, "message") ?? `Server vrátil chybu ${response.status}.`);
    }
    return payload as T;
  }
  throw new CaptureApiError(0, "network", "Server Vosia je nedostupný.");
}

// Validates the /capture/config payload and returns the typed config.
function parseConfig(payload: unknown): CaptureConfig {
  const storage = isRecord(payload) ? payload.storage : null;
  const account = isRecord(payload) ? payload.account : null;
  const bitrate = numberField(payload, "audioBitsPerSecond");
  const maxPart = numberField(payload, "maxPartBytes");
  const apiKey = stringField(storage, "apiKey");
  const webOrigin = stringField(payload, "webOrigin");
  if (!bitrate || bitrate <= 0 || !maxPart || maxPart <= 0 || !apiKey || !webOrigin) {
    throw new CaptureApiError(502, "invalid_config", "Server vrátil neplatnou konfiguraci nahrávání.");
  }
  return {
    audioBitsPerSecond: bitrate,
    maxPartBytes: maxPart,
    mimeType: stringField(payload, "mimeType") ?? UPLOAD_MIME,
    recorderMimeType: stringField(payload, "recorderMimeType") ?? "audio/webm;codecs=opus",
    storage: { apiKey },
    webOrigin,
    account: { email: stringField(account, "email") ?? "" }
  };
}

// Fetches /capture/config from the server and caches it locally.
export async function fetchConfig(): Promise<CaptureConfig> {
  const config = parseConfig(await capturePost<unknown>("/config", {}));
  await writeCachedConfig({ config, fetchedAt: timing.now() });
  return config;
}

// Returns the cached config when present, otherwise fetches it; null when neither is possible (offline, unpaired).
export async function getConfigOrCached(): Promise<CaptureConfig | null> {
  const cached = await readCachedConfig();
  if (cached) return cached.config;
  try {
    return await fetchConfig();
  } catch {
    return null;
  }
}

// Completes pairing: stores tokens, loads config and the account e-mail; rolls the pairing back when config fails.
export async function finishPairing(discovery: Discovery): Promise<PairingState> {
  await pairWithServer(discovery);
  try {
    const config = await fetchConfig();
    const state = await readPairing();
    const next = { ...state, email: config.account.email || null };
    await writePairing(next);
    return next;
  } catch (error) {
    await disconnect();
    if (error instanceof CaptureApiError && error.status === 403) {
      throw new CaptureApiError(403, error.code, "Vosio nepovolilo rozšíření tohoto původu. Zkontrolujte ID rozšíření v nastavení připojení.");
    }
    throw error;
  }
}

export type PutResult = "uploaded" | "exists";

// Uploads one part to its signed storage URL; "exists" means the object is already stored (no overwrite).
export async function putPart(uploadUrl: string, blob: Blob, apiKey: string): Promise<PutResult> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": UPLOAD_MIME, apikey: apiKey, "x-upsert": "false" },
      body: blob,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    });
  } catch {
    throw new CaptureApiError(0, "network", "Nahrání části selhalo (síť).");
  }
  if (response.ok) return "uploaded";
  const text = await response.text().catch(() => "");
  if (response.status === 409 || /duplicate|already exists/i.test(text)) return "exists";
  if (response.status === 401 || response.status === 403) throw new CaptureApiError(response.status, "upload_url_rejected", "Oprávnění k nahrání vypršelo.");
  throw new CaptureApiError(response.status, "upload_failed", `Úložiště odmítlo nahrání části (${response.status}).`);
}
