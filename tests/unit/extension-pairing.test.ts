import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePost, CaptureApiError } from "../../extension/src/background/capture-api.ts";
import { continuePairing, startPairing, type PairStep } from "../../extension/src/background/pair-flow.ts";
import { describeStatus, disconnect, discover, getAccessToken, NeedsPairingError, pairWithServer, PairingError, parseWebAddress } from "../../extension/src/background/pairing.ts";
import { setStore } from "../../extension/src/db/store.ts";
import { AUTH_FLOW_TIMEOUT_MS } from "../../extension/src/shared/constants.ts";
import { loadSettings, readCachedConfig, readPairing, writePairing } from "../../extension/src/shared/storage.ts";
import { createMemoryStore, installChrome, installFakeVosio, pairFully, REDIRECT_BASE, RESOURCE, useFastTiming, WEB, type ChromeStub, type FakeVosio } from "./extension-test-utils";

// Extracts the discovery from a step that is waiting for server access.
function discoveryOf(step: PairStep) {
  if (step.kind !== "needs-server-access") throw new Error("expected needs-server-access");
  return step.discovery;
}

let chromeStub: ChromeStub;
let server: FakeVosio;

beforeEach(async () => {
  chromeStub = installChrome();
  server = installFakeVosio(chromeStub);
  setStore(createMemoryStore());
  await useFastTiming();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setStore(null);
});

describe("extension pairing: happy path", () => {
  it("asks for web origin first, then the server origin, registers a public PKCE client and stores tokens locally only", async () => {
    const first = await startPairing(`${WEB}/`);
    expect(first.kind).toBe("needs-server-access");
    expect(chromeStub.permissions.request.mock.calls[0][0]).toEqual({ origins: [`${WEB}/*`] });

    const state = await continuePairing(discoveryOf(first));
    expect(state.kind).toBe("paired");
    expect(chromeStub.permissions.request.mock.calls[1][0]).toEqual({ origins: ["https://supabase.example/*"] });

    const pairing = await readPairing();
    expect(pairing).toMatchObject({ status: "paired", webOrigin: WEB, resource: RESOURCE, email: "user@example.com" });
    expect(pairing.accessToken).toBeTruthy();
    expect(pairing.refreshToken).toBeTruthy();
    expect(chromeStub.storage.sync.data.get("pairing")).toBeUndefined();
    expect(JSON.stringify([...chromeStub.storage.sync.data.values()])).not.toContain(pairing.refreshToken as string);
    expect((await loadSettings()).webAddress).toBe(WEB);
    expect((await readCachedConfig())?.config.audioBitsPerSecond).toBe(64000);
  });

  it("registers via DCR with scope vosio:capture and sends PKCE S256 plus resource to authorize", async () => {
    await pairFully();
    const registration = (server.calls.indexOf("POST /functions/v1/vosio-mcp/oauth/register"));
    expect(registration).toBeGreaterThanOrEqual(0);
    const authorizeUrl = new URL(chromeStub.identity.launchWebAuthFlow.mock.calls[0][0].url as string);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("scope")).toBe("vosio:capture");
    expect(authorizeUrl.searchParams.get("resource")).toBe(RESOURCE);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(`${REDIRECT_BASE}/oauth`);
    expect(authorizeUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("extension pairing: discovery and permission errors", () => {
  it("rejects non-HTTPS addresses before any request", async () => {
    const step = await startPairing("http://vosio.example");
    expect(step).toMatchObject({ kind: "error" });
    expect(parseWebAddress("http://vosio.example")).toMatchObject({ ok: false, error: { code: "insecure" } });
    expect(chromeStub.permissions.request).not.toHaveBeenCalled();
    expect(server.calls).toEqual([]);
  });

  it("reports an unreachable address and stores nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(discover(WEB)).rejects.toMatchObject({ code: "unreachable" });
    const step = await startPairing(WEB);
    expect(step.kind).toBe("error");
    expect((await readPairing()).status).toBe("unpaired");
  });

  it("reports a non-Vosio address and a bridge that is switched off (404)", async () => {
    server.intercept = () => new Response("nope", { status: 404 });
    await expect(discover(WEB)).rejects.toMatchObject({ code: "not_vosio" });
  });

  it("reports an installation without vosio:capture support", async () => {
    server.intercept = async (_route, request) => {
      if (!request.url.includes("well-known")) return undefined;
      return new Response(JSON.stringify({ authorization_endpoint: `${WEB}/a`, token_endpoint: `${WEB}/t`, registration_endpoint: `${RESOURCE}/oauth/register`, scopes_supported: ["vosio:read"] }), { status: 200 });
    };
    await expect(discover(WEB)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("explains the denied web origin permission and does not call the server", async () => {
    chromeStub.permissions.prompt = () => false;
    const step = await startPairing(WEB);
    expect(step).toMatchObject({ kind: "error", message: expect.stringContaining("Bez přístupu k webu Vosia") });
    expect(server.calls).toEqual([]);
  });

  it("explains the denied server origin permission and stays unpaired", async () => {
    const first = await startPairing(WEB);
    expect(first.kind).toBe("needs-server-access");
    chromeStub.permissions.prompt = () => false;
    const second = await continuePairing(discoveryOf(first));
    expect(second).toMatchObject({ kind: "error", message: expect.stringContaining("Bez přístupu k serveru") });
    expect((await readPairing()).status).toBe("unpaired");
    expect(chromeStub.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });
});

describe("extension pairing: login window outcomes", () => {
  it("stays unpaired when the user closes the login window", async () => {
    chromeStub.identity.launchWebAuthFlow.mockRejectedValue(new Error("The user did not approve access."));
    const discovery = await discover(WEB);
    await expect(pairWithServer(discovery)).rejects.toMatchObject({ code: "cancelled" });
    const pairing = await readPairing();
    expect(pairing.status).toBe("unpaired");
    expect(pairing.accessToken).toBeNull();
  });

  it("treats a declined consent (access_denied redirect) as cancelled", async () => {
    chromeStub.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => {
      const parameters = new URL(url).searchParams;
      return `${parameters.get("redirect_uri")}?error=access_denied&state=${parameters.get("state")}`;
    });
    await expect(pairWithServer(await discover(WEB))).rejects.toMatchObject({ code: "cancelled" });
  });

  it("times out instead of hanging when the login window never returns", async () => {
    const discovery = await discover(WEB);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    chromeStub.identity.launchWebAuthFlow.mockImplementation(() => new Promise(() => undefined));
    const outcome = pairWithServer(discovery).catch((error: unknown) => error);
    // Wait (real event loop) until the login window was opened and the timeout timer is armed.
    for (let i = 0; i < 100 && chromeStub.identity.launchWebAuthFlow.mock.calls.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(AUTH_FLOW_TIMEOUT_MS + 10);
    expect(await outcome).toMatchObject({ code: "timeout" });
    expect((await readPairing()).status).toBe("unpaired");
  });

  it("rejects a redirect with a mismatched state", async () => {
    chromeStub.identity.launchWebAuthFlow.mockImplementation(async ({ url }: { url: string }) => `${new URL(url).searchParams.get("redirect_uri")}?code=x&state=forged`);
    await expect(pairWithServer(await discover(WEB))).rejects.toBeInstanceOf(PairingError);
  });

  it("re-registers once when the server no longer knows the stored client (invalid_client)", async () => {
    await writePairing({ ...(await readPairing()), webOrigin: WEB, clientId: "stale-client", redirectUri: `${REDIRECT_BASE}/oauth` });
    const state = await pairWithServer(await discover(WEB));
    expect(state.status).toBe("paired");
    expect(server.registrations).toBe(1);
    expect(state.clientId).toBe("client-1");
  });
});

describe("extension pairing: tokens, refresh and states", () => {
  beforeEach(async () => {
    await pairFully();
  });

  // Marks the stored access token as expired so the next use refreshes it.
  async function expireAccess(): Promise<void> {
    await writePairing({ ...(await readPairing()), accessExpiresAt: Date.now() - 1000 });
  }

  it("persists the rotated pair before returning the new access token", async () => {
    const before = await readPairing();
    await expireAccess();
    const token = await getAccessToken();
    const after = await readPairing();
    expect(after.accessToken).toBe(token);
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(server.refreshes).toBe(1);
  });

  it("runs at most one refresh for concurrent callers", async () => {
    await expireAccess();
    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(server.refreshes).toBe(1);
    expect(server.grant.revoked).toBe(false);
  });

  it("refreshes exactly once on a 401 from the capture API and retries the request", async () => {
    const stale = (await readPairing()).accessToken as string;
    server.expiredTokens.add(stale);
    const config = await capturePost<{ account: { email: string } }>("/config", {});
    expect(config.account.email).toBe("user@example.com");
    expect(server.refreshes).toBe(1);
  });

  it("goes to the disconnected state when refresh after a 401 is rejected (revoked in Vosio)", async () => {
    server.grant.revoked = true;
    await expect(capturePost("/config", {})).rejects.toBeInstanceOf(NeedsPairingError);
    const pairing = await readPairing();
    expect(pairing.status).toBe("disconnected");
    expect(pairing.accessToken).toBeNull();
    expect(describeStatus("disconnected")).toBe("Odpojeno ve Vosiu");
  });

  it("recovers from a lost refresh response by requiring a new pairing (no silent replay)", async () => {
    await expireAccess();
    server.dropResponseFor.add("TOKEN refresh_token");
    await expect(getAccessToken()).rejects.toMatchObject({ code: "network" });
    expect((await readPairing()).status).toBe("paired");
    // The server already rotated the token: the retry is a replay and revokes the grant.
    await expect(getAccessToken()).rejects.toBeInstanceOf(NeedsPairingError);
    expect((await readPairing()).status).toBe("disconnected");
  });

  it("reports expiry after the 30 day grant lifetime", async () => {
    await writePairing({ ...(await readPairing()), accessExpiresAt: Date.now() - 1, grantExpiresAt: Date.now() - 1 });
    await expect(getAccessToken()).rejects.toMatchObject({ status: "expired" });
    expect((await readPairing()).status).toBe("expired");
    expect(describeStatus("expired")).toBe("Spárování vypršelo – přihlaste se znovu");
    expect(server.refreshes).toBe(0);
  });

  it("does not clobber a newer pairing when a late 401 handler marks the old token expired", async () => {
    const stale = (await readPairing()).accessToken as string;
    await pairFully();
    const { markNeedsPairing } = await import("../../extension/src/background/pairing.ts");
    await markNeedsPairing("expired", stale);
    expect((await readPairing()).status).toBe("paired");
  });

  it("disconnect revokes on the server, deletes local tokens and keeps pending recordings", async () => {
    const store = createMemoryStore();
    setStore(store);
    await store.putSession({ id: "pending-1", platform: "meet", platformLabel: "Google Meet", startedAt: 1, endedAt: 2, status: "queued", title: "t", requestId: "r", completeRequestId: "c", durationSeconds: 1, partCount: 1, recordingId: null, captureRevision: null, accountEmail: null, attempts: 0, nextAttemptAt: null, lastError: null, uploadedParts: [], detailUrl: null });
    const result = await disconnect();
    expect(result.revoked).toBe(true);
    expect(server.grant.revoked).toBe(true);
    const pairing = await readPairing();
    expect(pairing).toMatchObject({ status: "unpaired", accessToken: null, refreshToken: null });
    expect(await readCachedConfig()).toBeNull();
    expect((await store.listSessions()).map((session) => session.id)).toEqual(["pending-1"]);
  });

  it("surfaces capture API errors with their code", async () => {
    await expect(capturePost("/recordings/nope/status", {})).rejects.toMatchObject({ code: "not_found", status: 404 } satisfies Partial<CaptureApiError>);
  });
});
