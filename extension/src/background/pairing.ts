// Pairing with a self-hosted Vosio: discovery, dynamic client registration, PKCE login, token storage, serialized refresh.

import {
  ACCESS_SKEW_MS, AUTH_FLOW_TIMEOUT_MS, CAPTURE_SCOPE, CLIENT_NAME, DISCOVERY_PATH, GRANT_LIFETIME_MS,
  REDIRECT_PATH, REGISTRATION_SUFFIX, REQUEST_TIMEOUT_MS, TOKEN_LOCK
} from "../shared/constants.ts";
import { base64Url, isRecord, numberField, randomToken, stringField, timing } from "../shared/format.ts";
import { EMPTY_PAIRING, readPairing, writeCachedConfig, writePairing } from "../shared/storage.ts";
import type { Discovery, PairingState, PairingStatus } from "../shared/types.ts";

export type PairingErrorCode =
  | "invalid_address" | "insecure" | "unreachable" | "not_vosio" | "unsupported" | "permission_denied"
  | "cancelled" | "timeout" | "auth_error" | "invalid_client" | "network" | "server";

// Error raised during pairing/refresh with a machine code and a Czech user message.
export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode, message: string) {
    super(message);
    this.name = "PairingError";
    this.code = code;
  }
}

// Raised when the extension has no usable pairing (unpaired, expired or disconnected) and the user must pair again.
export class NeedsPairingError extends Error {
  readonly status: PairingStatus;

  constructor(status: PairingStatus) {
    super(describeStatus(status));
    this.name = "NeedsPairingError";
    this.status = status;
  }
}

// Czech status line for the pairing state shown in popup and options.
export function describeStatus(status: PairingStatus, state?: Pick<PairingState, "webOrigin" | "email">): string {
  if (status === "paired") {
    const host = state?.webOrigin ? new URL(state.webOrigin).host : "Vosiem";
    return state?.email ? `Spárováno s ${host} jako ${state.email}` : `Spárováno s ${host}`;
  }
  if (status === "expired") return "Spárování vypršelo – přihlaste se znovu";
  if (status === "disconnected") return "Odpojeno ve Vosiu";
  return "Rozšíření není spárované";
}

// Validates the address typed by the user and returns the HTTPS origin of the Vosio web.
export function parseWebAddress(input: string): { ok: true; origin: string } | { ok: false; error: PairingError } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: new PairingError("invalid_address", "Zadejte adresu svého Vosia, například https://vosio.firma.cz.") };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: new PairingError("invalid_address", "Adresa Vosia není platná.") };
  }
  if (url.protocol !== "https:") return { ok: false, error: new PairingError("insecure", "Vosio musí být dostupné přes HTTPS. Adresy začínající http:// nejsou podporovány.") };
  if (url.username || url.password) return { ok: false, error: new PairingError("invalid_address", "Adresa nesmí obsahovat přihlašovací údaje.") };
  return { ok: true, origin: url.origin };
}

// Parses an absolute HTTPS URL from discovery metadata, or null when it is missing or insecure.
function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Fetches OAuth discovery metadata from the Vosio web and derives the Function resource and endpoints.
export async function discover(webOrigin: string): Promise<Discovery> {
  let response: Response;
  try {
    response = await fetch(`${webOrigin}${DISCOVERY_PATH}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new PairingError("unreachable", "Adresu se nepodařilo kontaktovat. Zkontrolujte ji a připojení k internetu.");
  }
  if (!response.ok) throw new PairingError("not_vosio", "Na této adrese nebylo nalezeno připojení Vosia (OAuth je vypnuté nebo adresa není Vosio).");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PairingError("not_vosio", "Odpověď serveru není platná. Zkontrolujte, že zadáváte adresu Vosia.");
  }
  const authorization = httpsUrl(stringField(body, "authorization_endpoint"));
  const token = httpsUrl(stringField(body, "token_endpoint"));
  const registration = httpsUrl(stringField(body, "registration_endpoint"));
  if (!authorization || !token || !registration || !new URL(registration).pathname.endsWith(REGISTRATION_SUFFIX)) {
    throw new PairingError("not_vosio", "Server nevrací platná OAuth metadata Vosia (nebo používá nezabezpečené adresy).");
  }
  const scopes = isRecord(body) && Array.isArray(body.scopes_supported) ? body.scopes_supported : [];
  if (!scopes.includes(CAPTURE_SCOPE)) {
    throw new PairingError("unsupported", "Tato verze Vosia ještě nepodporuje rozšíření prohlížeče. Aktualizujte Vosio.");
  }
  const methods = isRecord(body) && Array.isArray(body.code_challenge_methods_supported) ? body.code_challenge_methods_supported : ["S256"];
  if (!methods.includes("S256")) throw new PairingError("not_vosio", "Server nepodporuje PKCE S256.");
  const registrationUrl = new URL(registration);
  const resource = `${registrationUrl.origin}${registrationUrl.pathname.slice(0, -REGISTRATION_SUFFIX.length)}`;
  return {
    webOrigin,
    resource,
    endpoints: { authorization, token, registration, revocation: httpsUrl(stringField(body, "revocation_endpoint")) }
  };
}

// Lists the origin match patterns (other than the web origin) the extension must be allowed to call.
export function originsToRequest(discovery: Discovery): string[] {
  const urls = [discovery.resource, discovery.endpoints.authorization, discovery.endpoints.token, discovery.endpoints.registration, discovery.endpoints.revocation];
  const origins = new Set<string>();
  for (const value of urls) {
    if (value) origins.add(`${new URL(value).origin}/*`);
  }
  origins.delete(`${discovery.webOrigin}/*`);
  return [...origins];
}

// Asks the browser for host access to the given origins (must run inside a user gesture); true when granted.
export async function requestOrigins(patterns: string[]): Promise<boolean> {
  if (patterns.length === 0) return true;
  if (await chrome.permissions.contains({ origins: patterns })) return true;
  return chrome.permissions.request({ origins: patterns });
}

// Races a promise against a timeout and clears the timer afterwards.
async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Registers the extension as a public OAuth client (DCR) and returns the issued client_id.
async function registerClient(discovery: Discovery, redirectUri: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(discovery.endpoints.registration, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        redirect_uris: [redirectUri],
        scope: CAPTURE_SCOPE
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new PairingError("unreachable", "Registrace rozšíření ve Vosiu se nezdařila (server je nedostupný).");
  }
  const body: unknown = await response.json().catch(() => null);
  const clientId = stringField(body, "client_id");
  if (!response.ok || !clientId) throw new PairingError("auth_error", "Vosio odmítlo registraci rozšíření. Zkontrolujte, že je připojení MCP/OAuth zapnuté.");
  return clientId;
}

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Posts a form to the token endpoint and returns the parsed token set; maps OAuth errors to PairingError.
async function postToken(endpoint: string, form: Record<string, string>): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new PairingError("network", "Server Vosia je nedostupný.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = stringField(body, "error");
    if (code === "invalid_client") throw new PairingError("invalid_client", "Vosio nezná tohoto klienta.");
    if (code === "invalid_grant") throw new PairingError("auth_error", "Vosio odmítlo přihlášení (neplatný nebo odvolaný kód).");
    if (response.status >= 500 || response.status === 429) throw new PairingError("server", "Vosio dočasně neodpovídá.");
    throw new PairingError("auth_error", "Vosio odmítlo přihlášení.");
  }
  const accessToken = stringField(body, "access_token");
  const refreshToken = stringField(body, "refresh_token");
  const expiresIn = numberField(body, "expires_in");
  const scope = stringField(body, "scope");
  if (!accessToken || !refreshToken || expiresIn === null || (scope !== null && scope !== CAPTURE_SCOPE)) {
    throw new PairingError("auth_error", "Vosio vrátilo neplatnou odpověď s tokeny.");
  }
  return { accessToken, refreshToken, expiresIn };
}

// Runs the interactive authorization (PKCE S256) in the browser's auth window and exchanges the code for tokens.
async function authorize(discovery: Discovery, clientId: string, redirectUri: string): Promise<TokenSet> {
  const verifier = randomToken(32);
  const state = randomToken(16);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const url = new URL(discovery.endpoints.authorization);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", CAPTURE_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", discovery.resource);

  let redirected: string | undefined;
  try {
    redirected = await withTimeout(
      chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true }),
      AUTH_FLOW_TIMEOUT_MS,
      () => new PairingError("timeout", "Přihlášení vypršelo. Zavřete okno přihlášení a zkuste to znovu.")
    );
  } catch (error) {
    if (error instanceof PairingError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/did not approve|cancel|closed/i.test(message)) throw new PairingError("cancelled", "Přihlášení bylo zrušeno. Rozšíření zůstává nespárované.");
    throw new PairingError("auth_error", "Přihlašovací stránku Vosia se nepodařilo otevřít.");
  }
  if (!redirected) throw new PairingError("cancelled", "Přihlášení bylo zrušeno. Rozšíření zůstává nespárované.");

  const params = new URL(redirected).searchParams;
  const error = params.get("error");
  if (error === "invalid_client") throw new PairingError("invalid_client", "Vosio nezná tohoto klienta.");
  if (error === "access_denied") throw new PairingError("cancelled", "Souhlas byl odmítnut. Rozšíření zůstává nespárované.");
  if (error) throw new PairingError("auth_error", params.get("error_description") ?? "Vosio odmítlo přihlášení.");
  const code = params.get("code");
  if (!code || params.get("state") !== state) throw new PairingError("auth_error", "Odpověď přihlášení je neplatná.");
  return postToken(discovery.endpoints.token, {
    grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: discovery.resource
  });
}

// Pairs with the discovered installation (DCR with one re-registration on invalid_client) and persists the token pair.
export async function pairWithServer(discovery: Discovery): Promise<PairingState> {
  const redirectUri = chrome.identity.getRedirectURL(REDIRECT_PATH);
  const existing = await readPairing();
  let clientId = existing.webOrigin === discovery.webOrigin && existing.redirectUri === redirectUri ? existing.clientId : null;
  let reRegistered = false;
  let tokens: TokenSet;
  for (;;) {
    if (!clientId) clientId = await registerClient(discovery, redirectUri);
    try {
      tokens = await authorize(discovery, clientId, redirectUri);
      break;
    } catch (error) {
      if (error instanceof PairingError && error.code === "invalid_client" && !reRegistered) {
        reRegistered = true;
        clientId = null;
        continue;
      }
      throw error;
    }
  }
  const now = timing.now();
  const state: PairingState = {
    status: "paired",
    webOrigin: discovery.webOrigin,
    resource: discovery.resource,
    endpoints: discovery.endpoints,
    clientId,
    redirectUri,
    accessToken: tokens.accessToken,
    accessExpiresAt: now + tokens.expiresIn * 1000,
    refreshToken: tokens.refreshToken,
    grantExpiresAt: now + GRANT_LIFETIME_MS,
    email: null,
    pairedAt: now
  };
  await navigator.locks.request(TOKEN_LOCK, () => writePairing(state));
  return state;
}

// Clears tokens and marks the pairing with a terminal status; must run inside the token lock.
async function setStatusLocked(status: PairingStatus): Promise<void> {
  const state = await readPairing();
  await writePairing({ ...state, status, accessToken: null, accessExpiresAt: null, refreshToken: null });
}

// Marks the pairing expired/disconnected unless a newer token was already stored (guards against clobbering a re-pair).
export async function markNeedsPairing(status: PairingStatus, usedToken?: string): Promise<void> {
  await navigator.locks.request(TOKEN_LOCK, async () => {
    const state = await readPairing();
    if (usedToken !== undefined && state.accessToken !== usedToken) return;
    await setStatusLocked(status);
  });
}

// Rotates the refresh token; the new pair is persisted before it is returned so a crash cannot lose the rotation.
async function refreshLocked(state: PairingState): Promise<string> {
  if (!state.endpoints || !state.clientId || !state.refreshToken) {
    await setStatusLocked("expired");
    throw new NeedsPairingError("expired");
  }
  const now = timing.now();
  if (state.grantExpiresAt !== null && now >= state.grantExpiresAt) {
    await setStatusLocked("expired");
    throw new NeedsPairingError("expired");
  }
  let tokens: TokenSet;
  try {
    tokens = await postToken(state.endpoints.token, { grant_type: "refresh_token", refresh_token: state.refreshToken, client_id: state.clientId, resource: state.resource });
  } catch (error) {
    if (error instanceof PairingError && (error.code === "auth_error" || error.code === "invalid_client")) {
      const status: PairingStatus = error.code === "invalid_client" ? "expired" : state.grantExpiresAt !== null && timing.now() >= state.grantExpiresAt ? "expired" : "disconnected";
      await setStatusLocked(status);
      throw new NeedsPairingError(status);
    }
    throw error;
  }
  await writePairing({ ...state, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, accessExpiresAt: timing.now() + tokens.expiresIn * 1000 });
  return tokens.accessToken;
}

export interface AccessTokenOptions {
  forceRefresh?: boolean;
  staleToken?: string;
}

// Returns a valid access token, refreshing at most once across all extension contexts (Web Locks) and re-reading state under the lock.
export async function getAccessToken(options: AccessTokenOptions = {}): Promise<string> {
  return navigator.locks.request(TOKEN_LOCK, async () => {
    const state = await readPairing();
    if (state.status !== "paired" || !state.accessToken || !state.refreshToken) throw new NeedsPairingError(state.status === "paired" ? "expired" : state.status);
    const fresh = state.accessExpiresAt !== null && state.accessExpiresAt - timing.now() > ACCESS_SKEW_MS;
    const alreadyRotated = options.staleToken !== undefined && state.accessToken !== options.staleToken;
    if (fresh && (!options.forceRefresh || alreadyRotated)) return state.accessToken;
    return refreshLocked(state);
  });
}

// Revokes the grant on the server (best effort) and deletes local tokens; pending recordings are left untouched.
export async function disconnect(): Promise<{ revoked: boolean }> {
  return navigator.locks.request(TOKEN_LOCK, async () => {
    const state = await readPairing();
    let revoked = false;
    if (state.refreshToken && state.clientId && state.endpoints?.revocation) {
      try {
        const response = await fetch(state.endpoints.revocation, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: state.refreshToken, token_type_hint: "refresh_token", client_id: state.clientId }).toString(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        revoked = response.ok;
      } catch {
        revoked = false;
      }
    }
    await writePairing({ ...EMPTY_PAIRING, webOrigin: state.webOrigin, resource: state.resource, endpoints: state.endpoints });
    await writeCachedConfig(null);
    return { revoked };
  });
}
