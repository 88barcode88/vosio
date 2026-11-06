// Test helpers for the browser extension: chrome.* stub, Web Locks, in-memory recording store and a stateful fake Vosio server (D8 contract).
import { vi } from "vitest";
import type { RecordingStore } from "../../extension/src/db/store.ts";
import type { ChunkRecord, PartInfo, StoredSession } from "../../extension/src/shared/types.ts";

export const WEB = "https://vosio.example";
export const RESOURCE = "https://supabase.example/functions/v1/vosio-mcp";
export const STORAGE_BASE = "https://supabase.example/storage/v1/object/upload/sign/recordings";
export const REDIRECT_BASE = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org";

type Listener = (...args: unknown[]) => unknown;

// Creates a chrome-style event object whose listeners can be fired from tests.
function makeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    hasListener: (listener: Listener) => listeners.has(listener),
    fire: (...args: unknown[]) => [...listeners].map((listener) => listener(...args))
  };
}

// In-memory implementation of a chrome.storage area with onChanged support.
function makeArea(name: string, onChanged: ReturnType<typeof makeEvent>) {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      const wanted = keys == null ? [...data.keys()] : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result: Record<string, unknown> = {};
      for (const key of wanted) if (data.has(key)) result[key] = structuredClone(data.get(key));
      return result;
    },
    async set(items: Record<string, unknown>) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data.get(key), newValue: value };
        data.set(key, structuredClone(value));
      }
      onChanged.fire(changes, name);
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    }
  };
}

export interface ChromeStub {
  storage: { local: ReturnType<typeof makeArea>; sync: ReturnType<typeof makeArea>; session: ReturnType<typeof makeArea>; onChanged: ReturnType<typeof makeEvent> };
  permissions: { granted: Set<string>; prompt: (origins: string[]) => boolean; request: ReturnType<typeof vi.fn>; contains: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  identity: { launchWebAuthFlow: ReturnType<typeof vi.fn>; getRedirectURL: (path?: string) => string };
  scripting: { registered: Map<string, { id: string; matches?: string[] }>; registerContentScripts: ReturnType<typeof vi.fn>; unregisterContentScripts: ReturnType<typeof vi.fn>; getRegisteredContentScripts: ReturnType<typeof vi.fn> };
  alarms: { created: Map<string, unknown>; create: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  notifications: { create: ReturnType<typeof vi.fn> };
}

// Installs a chrome.* stub (and Web Locks) on globalThis and returns handles for assertions.
export function installChrome(): ChromeStub {
  const onChanged = makeEvent();
  const granted = new Set<string>();
  const registered = new Map<string, { id: string; matches?: string[] }>();
  const created = new Map<string, unknown>();
  const stub: ChromeStub = {
    storage: { local: makeArea("local", onChanged), sync: makeArea("sync", onChanged), session: makeArea("session", onChanged), onChanged },
    permissions: {
      granted,
      prompt: () => true,
      request: vi.fn(async ({ origins = [] }: { origins?: string[] }) => {
        const allowed = stub.permissions.prompt(origins);
        if (allowed) origins.forEach((origin) => granted.add(origin));
        return allowed;
      }),
      contains: vi.fn(async ({ origins = [] }: { origins?: string[] }) => origins.every((origin) => granted.has(origin))),
      remove: vi.fn(async ({ origins = [] }: { origins?: string[] }) => {
        origins.forEach((origin) => granted.delete(origin));
        return true;
      })
    },
    identity: { launchWebAuthFlow: vi.fn(), getRedirectURL: (path = "") => `${REDIRECT_BASE}/${path}` },
    scripting: {
      registered,
      registerContentScripts: vi.fn(async (scripts: Array<{ id: string; matches?: string[] }>) => scripts.forEach((script) => registered.set(script.id, script))),
      unregisterContentScripts: vi.fn(async ({ ids }: { ids?: string[] } = {}) => (ids ?? [...registered.keys()]).forEach((id) => registered.delete(id))),
      getRegisteredContentScripts: vi.fn(async ({ ids }: { ids?: string[] } = {}) => [...registered.values()].filter((script) => !ids || ids.includes(script.id)))
    },
    alarms: { created, create: vi.fn(async (name: string, info: unknown) => void created.set(name, info)), clear: vi.fn(async (name: string) => created.delete(name)) },
    notifications: { create: vi.fn(async () => "id") }
  };
  vi.stubGlobal("chrome", {
    ...stub,
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage: vi.fn(async () => undefined) },
    action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn(async () => undefined), setPopup: vi.fn(async () => undefined), setTitle: vi.fn(async () => undefined) }
  });
  installLocks();
  return stub;
}

// Installs a minimal Web Locks implementation (exclusive locks per name, ifAvailable support).
function installLocks(): void {
  const held = new Map<string, Promise<unknown>>();
  const request = async (name: string, a: unknown, b?: unknown) => {
    const options = (typeof a === "function" ? {} : a) as { ifAvailable?: boolean };
    const callback = (typeof a === "function" ? a : b) as (lock: unknown) => Promise<unknown>;
    if (options.ifAvailable && held.has(name)) return callback(null);
    const previous = held.get(name) ?? Promise.resolve();
    const run = previous.then(() => callback({ name }), () => callback({ name }));
    const tail = run.catch(() => undefined);
    held.set(name, tail);
    try {
      return await run;
    } finally {
      if (held.get(name) === tail) held.delete(name);
    }
  };
  Object.defineProperty(globalThis.navigator, "locks", { value: { request }, configurable: true });
}

// In-memory RecordingStore used instead of IndexedDB.
export function createMemoryStore(): RecordingStore & { sessions: Map<string, StoredSession>; chunks: ChunkRecord[] } {
  const sessions = new Map<string, StoredSession>();
  const chunks: ChunkRecord[] = [];
  return {
    sessions,
    chunks,
    async putSession(session) { sessions.set(session.id, structuredClone(session)); },
    async getSession(id) { const value = sessions.get(id); return value ? structuredClone(value) : null; },
    async listSessions() { return [...sessions.values()].map((value) => structuredClone(value)); },
    async deleteSession(id) {
      sessions.delete(id);
      for (let index = chunks.length - 1; index >= 0; index -= 1) if (chunks[index].sessionId === id) chunks.splice(index, 1);
    },
    async addChunk(chunk) { chunks.push(chunk); },
    async getPartInfos(sessionId) {
      const parts = new Map<number, PartInfo>();
      for (const chunk of chunks.filter((item) => item.sessionId === sessionId)) {
        const info = parts.get(chunk.part) ?? { part: chunk.part, bytes: 0, lastT: 0 };
        parts.set(chunk.part, { part: chunk.part, bytes: info.bytes + chunk.blob.size, lastT: Math.max(info.lastT, chunk.t) });
      }
      return [...parts.values()].sort((a, b) => a.part - b.part);
    },
    async getPartBlob(sessionId, part, type) {
      return new Blob(chunks.filter((chunk) => chunk.sessionId === sessionId && chunk.part === part).map((chunk) => chunk.blob), { type });
    }
  };
}

interface FakeRecording {
  id: string;
  requestId: string;
  title: string;
  revision: number;
  deleted: boolean;
  registered: Map<number, number>;
  completeRequestId: string | null;
  completeCalls: number;
}

export type Interceptor = (route: string, request: { url: string; method: string; body: unknown; headers: Headers }) => Response | undefined | Promise<Response | undefined>;

// Stateful fake of the Vosio OAuth bridge and capture API following design D8; used as global fetch.
export class FakeVosio {
  clients = new Set<string>();
  codes = new Map<string, string>();
  grant = { refreshToken: "", oldRefresh: new Set<string>(), revoked: false, tokens: new Set<string>() };
  recordings = new Map<string, FakeRecording>();
  objects = new Map<string, number>();
  calls: string[] = [];
  tokenCounter = 0;
  intercept: Interceptor | null = null;
  dropResponseFor = new Set<string>();
  registrations = 0;
  refreshes = 0;
  expiredTokens = new Set<string>();
  putCount = 0;

  // Decides the route key of a request, e.g. "POST /capture/complete" or "TOKEN refresh_token".
  private async handle(url: string, init: RequestInit = {}): Promise<{ route: string; response: Response }> {
    const method = init.method ?? "GET";
    const parsed = new URL(url);
    const headers = new Headers(init.headers);
    const raw = init.body;
    const body = typeof raw === "string" ? (headers.get("content-type")?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))) : raw;
    const json = (status: number, payload: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...extra } });
    const error = (status: number, code: string) => json(status, { error: { code, message: `${code} (test)` } });
    let route = `${method} ${parsed.pathname}`;
    if (parsed.pathname.endsWith("/api/mcp/oauth/token")) route = `TOKEN ${(body as Record<string, string>).grant_type}`;
    if (this.intercept) {
      const hijacked = await this.intercept(route, { url, method, body, headers });
      if (hijacked) return { route, response: hijacked };
    }

    if (url === `${WEB}/.well-known/oauth-authorization-server`) {
      return { route, response: json(200, { issuer: WEB, authorization_endpoint: `${WEB}/api/mcp/oauth/authorize`, token_endpoint: `${WEB}/api/mcp/oauth/token`, registration_endpoint: `${RESOURCE}/oauth/register`, revocation_endpoint: `${WEB}/api/mcp/oauth/revoke`, scopes_supported: ["vosio:read", "vosio:write", "vosio:capture"], code_challenge_methods_supported: ["S256"] }) };
    }
    if (parsed.pathname.endsWith("/oauth/register")) {
      this.registrations += 1;
      const clientId = `client-${this.registrations}`;
      this.clients.add(clientId);
      return { route, response: json(201, { client_id: clientId }) };
    }
    if (route.startsWith("TOKEN")) return { route, response: this.token(body as Record<string, string>, json) };
    if (parsed.pathname.endsWith("/oauth/revoke")) {
      this.grant.revoked = true;
      return { route, response: json(200, {}) };
    }
    if (url.startsWith(`${STORAGE_BASE}/`)) return { route: `PUT storage`, response: this.put(url, init, headers, error) };
    if (parsed.pathname.startsWith("/functions/v1/vosio-mcp/capture/")) return { route, response: this.capture(parsed.pathname.replace("/functions/v1/vosio-mcp/capture", ""), body as Record<string, unknown>, headers, json, error) };
    return { route, response: json(404, { error: "not_found" }) };
  }

  // Issues or rotates tokens for the authorization_code and refresh_token grants (replay revokes the grant).
  private token(body: Record<string, string>, json: (status: number, payload: unknown) => Response): Response {
    if (!this.clients.has(body.client_id)) return json(400, { error: "invalid_client" });
    const issue = () => {
      this.tokenCounter += 1;
      const access = `access-${this.tokenCounter}`;
      this.grant.tokens.add(access);
      return access;
    };
    if (body.grant_type === "authorization_code") {
      if (!this.codes.has(body.code)) return json(400, { error: "invalid_grant" });
      this.codes.delete(body.code);
      this.grant = { refreshToken: `refresh-${this.tokenCounter + 1}`, oldRefresh: new Set(), revoked: false, tokens: new Set() };
      return json(200, { access_token: issue(), refresh_token: this.grant.refreshToken, expires_in: 300, scope: "vosio:capture", token_type: "Bearer" });
    }
    this.refreshes += 1;
    if (this.grant.oldRefresh.has(body.refresh_token)) this.grant.revoked = true;
    if (this.grant.revoked || body.refresh_token !== this.grant.refreshToken) return json(400, { error: "invalid_grant" });
    this.grant.oldRefresh.add(body.refresh_token);
    this.grant.refreshToken = `refresh-${this.tokenCounter + 1}`;
    return json(200, { access_token: issue(), refresh_token: this.grant.refreshToken, expires_in: 300, scope: "vosio:capture", token_type: "Bearer" });
  }

  // Handles the signed storage PUT: no overwrite, objects keyed by recording and part index.
  private put(url: string, init: RequestInit, headers: Headers, error: (status: number, code: string) => Response): Response {
    this.putCount += 1;
    if (headers.get("content-type") !== "audio/webm" || !headers.get("apikey") || headers.get("x-upsert") !== "false") return error(400, "bad_headers");
    const key = new URL(url).pathname.split("/recordings/")[1];
    if (this.objects.has(key)) return error(409, "Duplicate");
    this.objects.set(key, (init.body as Blob).size);
    return new Response("{}", { status: 200 });
  }

  // Implements the capture endpoints of design D8 including idempotency, CAS revisions and part verification.
  private capture(path: string, body: Record<string, unknown>, headers: Headers, json: (status: number, payload: unknown, extra?: Record<string, string>) => Response, error: (status: number, code: string) => Response): Response {
    const token = headers.get("authorization")?.replace("Bearer ", "") ?? "";
    if (!this.grant.tokens.has(token) || this.grant.revoked || this.expiredTokens.has(token)) return json(401, { error: { code: "unauthorized", message: "unauthorized" } }, { "www-authenticate": "Bearer" });
    if (path === "/config") return json(200, { audioBitsPerSecond: 64000, maxPartBytes: 1000, mimeType: "audio/webm", recorderMimeType: "audio/webm;codecs=opus", storage: { apiKey: "anon-key" }, webOrigin: WEB, account: { email: "user@example.com" } });
    if (path === "/recordings") {
      const existing = [...this.recordings.values()].find((item) => item.requestId === body.requestId);
      const recording = existing ?? { id: `rec-${this.recordings.size + 1}`, requestId: String(body.requestId), title: String(body.title), revision: 1, deleted: false, registered: new Map(), completeRequestId: null, completeCalls: 0 };
      this.recordings.set(recording.id, recording);
      return json(200, { recordingId: recording.id, captureRevision: recording.revision, status: "created", detailUrl: `${WEB}/recordings/${recording.id}` });
    }
    const match = /^\/recordings\/([^/]+)\/(parts|complete|status)$/.exec(path);
    const recording = match ? this.recordings.get(match[1]) : undefined;
    if (!match || !recording) return error(404, "not_found");
    if (recording.deleted) return error(410, "recording_deleted");
    const detailUrl = `${WEB}/recordings/${recording.id}`;
    if (match[2] === "status") return json(200, { recordingId: recording.id, status: recording.completeRequestId ? "uploaded" : "uploading", transcriptionState: recording.completeRequestId ? "queued" : null, detailUrl, captureRevision: recording.revision });
    if (body.captureRevision !== recording.revision) return error(409, "revision_conflict");
    if (match[2] === "parts") {
      const parts = body.parts as Array<{ index: number; sizeBytes: number }>;
      recording.revision += 1;
      return json(200, {
        captureRevision: recording.revision,
        parts: parts.map((part) => {
          recording.registered.set(part.index, part.sizeBytes);
          const key = `${recording.id}/part-${part.index}`;
          return this.objects.get(key) === part.sizeBytes ? { index: part.index, state: "exists" } : { index: part.index, state: "ready", uploadUrl: `${STORAGE_BASE}/${key}?token=t` };
        })
      });
    }
    if (recording.completeRequestId === body.requestId) {
      recording.completeCalls += 1;
      return json(200, { recordingId: recording.id, status: "uploaded", transcription: { state: "queued", operationId: "op-1" }, detailUrl });
    }
    const complete = [...recording.registered].every(([index, size]) => this.objects.get(`${recording.id}/part-${index}`) === size) && recording.registered.size === body.partCount;
    if (!complete) return error(409, "incomplete_parts");
    recording.completeRequestId = String(body.requestId);
    recording.completeCalls += 1;
    return json(200, { recordingId: recording.id, status: "uploaded", transcription: { state: "queued", operationId: "op-1" }, detailUrl });
  }

  // Global fetch replacement; a route in dropResponseFor is processed but its response is lost (network error).
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const { route, response } = await this.handle(url, init);
    this.calls.push(route);
    if (this.dropResponseFor.delete(route)) throw new TypeError("network response lost");
    return response;
  };

  // Simulates the browser auth window: approves the authorization request and returns the redirect URL with a code.
  authorize = async ({ url }: { url: string }): Promise<string> => {
    const parameters = new URL(url).searchParams;
    if (!this.clients.has(parameters.get("client_id") ?? "")) return `${parameters.get("redirect_uri")}?error=invalid_client&state=${parameters.get("state")}`;
    const code = `code-${this.codes.size + 1}-${Math.random()}`;
    this.codes.set(code, parameters.get("code_challenge") ?? "");
    return `${parameters.get("redirect_uri")}?code=${code}&state=${parameters.get("state")}`;
  };
}

// Wires a FakeVosio as fetch and as the chrome identity auth window; returns it for assertions.
export function installFakeVosio(chromeStub: ChromeStub): FakeVosio {
  const server = new FakeVosio();
  vi.stubGlobal("fetch", server.fetch);
  chromeStub.identity.launchWebAuthFlow.mockImplementation(server.authorize);
  return server;
}

// Runs the complete two-step pairing against the fake server and returns the final pairing state.
export async function pairFully(address = WEB) {
  const { continuePairing, startPairing } = await import("../../extension/src/background/pair-flow.ts");
  let step = await startPairing(address);
  if (step.kind === "needs-server-access") step = await continuePairing(step.discovery);
  if (step.kind !== "paired") throw new Error(`Pairing failed in test setup: ${JSON.stringify(step)}`);
  return step.state;
}

// Makes timing helpers instant and deterministic for tests.
export async function useFastTiming(): Promise<void> {
  const { timing } = await import("../../extension/src/shared/format.ts");
  timing.sleep = async () => undefined;
}
