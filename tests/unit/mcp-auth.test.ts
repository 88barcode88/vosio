import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getMcpConfig, parseMcpConfig } from "@/lib/mcp/config.server";
import { authenticateMcpRequest, verifyUpstream } from "@/lib/mcp/auth.server";
import { decryptCustody, encryptCustody, hashToken, newOpaqueToken, pkceChallenge } from "@/lib/mcp/oauth-crypto.server";
import { authorizeSchema, handleMcpOAuth, matchesMcpRedirect, MCP_NONCE_COOKIE, MCP_PENDING_COOKIE, normalizeMcpScopes, upstreamConsentDetails, validateMcpRedirect, validateUpstreamRedirect } from "@/lib/mcp/oauth.server";
import { custodySchemas } from "@/lib/mcp/oauth-store.server";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createServerClient: vi.fn(), custody: vi.fn(), register: vi.fn(), cookies: vi.fn(), config: vi.fn(), installation: { enabled: false, webOrigin: "", publicSupabaseUrl: "", upstreamClientId: "" } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@supabase/ssr", async (original) => ({ ...await original<typeof import("@supabase/ssr")>(), createServerClient: mocks.createServerClient }));
vi.mock("@/lib/mcp/request-context.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/request-context.server")>(), getRequestCookies: mocks.cookies }));
vi.mock("@/lib/mcp/config.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/config.server")>(), getMcpConfig: mocks.config, loadMcpConfig: mocks.config }));
vi.mock("@/lib/mcp/oauth-store.server", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/mcp/oauth-store.server")>(), custody: mocks.custody, registerDynamicClient: mocks.register }));

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const clientId = "10000000-0000-4000-8000-000000000003";
const upstreamClientId = "10000000-0000-4000-8000-000000000004";
const grantId = "10000000-0000-4000-8000-000000000005";
const fence = "10000000-0000-4000-8000-000000000006";
const pendingId = "10000000-0000-4000-8000-000000000007";
const token = "a".repeat(43);

// Configure a disposable installation without consulting real environment files or project keys.
function configure(origin = "https://vosio-a.example", supabase = "https://supabase-a.example") {
  vi.stubEnv("SUPABASE_URL", supabase); vi.stubEnv("SUPABASE_ANON_KEY", "test-publishable-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-admin-key");
  vi.stubEnv("MCP_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 17).toString("base64"));
  vi.stubEnv("MCP_SUPABASE_CLIENT_SECRET", "test-client-secret-is-not-real");
  mocks.installation = { enabled: true, webOrigin: origin, publicSupabaseUrl: supabase, upstreamClientId };
  mocks.config.mockImplementation(() => parseMcpConfig(mocks.installation));
  return getMcpConfig()!;
}

// Supply verified Auth/JWT mocks and a controllable current-session RPC for source-level tests.
function setup() {
  mocks.register.mockResolvedValue({ status: "accepted" });
  const config = configure(); const nonce = newOpaqueToken(); const state = newOpaqueToken(); const verifier = newOpaqueToken();
  const claims = { sub: userId, session_id: sessionId, client_id: upstreamClientId, iss: `${config.supabaseUrl}/auth/v1`, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 };
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  rpc.mockImplementation(() => ({ abortSignal: vi.fn().mockResolvedValue({ data: true, error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: true, error: null }).then(resolve) }));
  const oauth = { getAuthorizationDetails: vi.fn().mockResolvedValue({ data: { authorization_id: "auth-request", redirect_uri: config.callbackUrl, client: { id: upstreamClientId }, user: { id: userId }, scope: "email" }, error: null }), approveAuthorization: vi.fn(), denyAuthorization: vi.fn() };
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }), getClaims: vi.fn().mockImplementation(async () => ({ data: { claims: { ...claims } }, error: null })), oauth };
  const client = { auth, rpc }; mocks.createClient.mockReturnValue(client); mocks.createServerClient.mockReturnValue(client);
  const jar = new Map([[MCP_NONCE_COOKIE, nonce], [MCP_PENDING_COOKIE, pendingId]]);
  mocks.cookies.mockResolvedValue({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, getAll: () => [{ name: "browser-refresh-cookie", value: "browser-secret-never-exchanged" }], set: vi.fn() });
  const pending = { id: pendingId, clientId, redirectUri: "https://host.example/callback", resource: config.resourceUrl, state: "downstream-state", scopes: ["vosio:read", "vosio:write"], userId, status: "approved", encrypted: encryptCustody(config.encryptionKey, pendingId, { state, verifier }) };
  const tokens = { access_token: "upstream-access-jwt", refresh_token: "dedicated-upstream-refresh" };
  const grant = { id: grantId, user_id: userId, session_id: sessionId, client_id: clientId, resource: config.resourceUrl, scopes: ["vosio:read"], encrypted: encryptCustody(config.encryptionKey, grantId, tokens), upstream_expires_at: claims.exp, fence };
  mocks.custody.mockImplementation(async (action: string) => {
    if (action === "access" || action === "code_claim" || action === "refresh_claim") return { ...grant };
    if (action === "client") return { id: clientId, name: "Test host", redirects: [pending.redirectUri] };
    if (action === "pending" || action === "pending_claim" || action === "pending_approve") return { ...pending };
    return { ok: true };
  });
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(tokens), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
  return { config, nonce, state, verifier, claims, client, rpc, auth, oauth, jar, pending, grant, tokens, fetchMock };
}

// Create a standard public-client request without an app cookie or confidential downstream secret.
function tokenRequest(config: ReturnType<typeof configure>, args: Record<string, string>) {
  return new Request(`${config.origin}/api/mcp/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(args) });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("portable disabled-first MCP OAuth", () => {
  it("defaults to disabled and validates two independent installations", () => {
    configure(); mocks.installation.enabled = false; expect(getMcpConfig()).toBeNull();
    const first = configure(); const second = configure("https://vosio-b.example", "https://supabase-b.example");
    expect(first.resourceUrl).toBe("https://supabase-a.example/functions/v1/vosio-mcp"); expect(second.supabaseUrl).toBe("https://supabase-b.example");
    expect(second.callbackUrl).toBe("https://vosio-b.example/api/mcp/oauth/callback");
    vi.stubEnv("MCP_TOKEN_ENCRYPTION_KEY", "bad"); expect(getMcpConfig()).toBeNull();
  });

  it("fails closed for insecure endpoints, ambiguous resource paths and missing allowlists", () => {
    configure(); mocks.installation.publicSupabaseUrl = "http://remote.example"; expect(getMcpConfig()).toBeNull();
    configure(); mocks.installation.publicSupabaseUrl = "https://supabase-a.example?other=1"; expect(getMcpConfig()).toBeNull();
    configure(); vi.stubEnv("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ other: "key" })); expect(getMcpConfig()).toBeNull();
    configure(); mocks.installation.upstreamClientId = "not-a-client-uuid"; expect(getMcpConfig()).toBeNull();
  });

  it("binds ciphertext to exact grant identity and only persists hashes of opaque credentials", () => {
    const config = configure(); const secret = newOpaqueToken();
    const encrypted = encryptCustody(config.encryptionKey, grantId, { token: secret });
    expect(encrypted).not.toContain(secret); expect(decryptCustody(config.encryptionKey, grantId, encrypted)).toEqual({ token: secret });
    expect(() => decryptCustody(config.encryptionKey, sessionId, encrypted)).toThrow(); expect(hashToken(secret)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unknown actor keys and requires S256 with an exact resource and immutable redirect", () => {
    const config = configure();
    expect(authorizeSchema.safeParse({ response_type: "code", client_id: clientId, redirect_uri: "https://host.example/callback", code_challenge: token, code_challenge_method: "plain", resource: config.resourceUrl }).success).toBe(false);
    expect(custodySchemas.code_claim.safeParse({ codeHash: hashToken(token), clientId, redirectUri: "https://host.example/callback", resource: config.resourceUrl, challenge: token, actor: userId }).success).toBe(false);
    expect(matchesMcpRedirect(config, "https://host.example/callback", "https://evil.example/callback")).toBe(false); expect(() => validateMcpRedirect(config, "https://host.example/callback#fragment")).toThrow();
    expect(normalizeMcpScopes("vosio:write")).toEqual(["vosio:read", "vosio:write"]); expect(() => normalizeMcpScopes("admin")).toThrow();
  });

  it("allows only the three exact browser return paths", () => {
    expect(getSafeNextPath("/mcp/consent?request=one")).toBe("/mcp/consent?request=one");
    expect(getSafeNextPath("/mcp/upstream-consent?authorization_id=one")).toBe("/mcp/upstream-consent?authorization_id=one");
    expect(getSafeNextPath("/mcp/connections")).toBe("/mcp/connections");
    expect(getSafeNextPath("/mcp/arbitrary")).toBe("/"); expect(getSafeNextPath("/mcp/consent/child")).toBe("/");
  });

  it("allows only the same explicitly enabled loopback host and path to change its ephemeral port", () => {
    configure();
    const config = getMcpConfig()!;
    expect(validateMcpRedirect(config, "http://127.0.0.1:53219/callback")).toBe("http://127.0.0.1:53219/callback");
    expect(matchesMcpRedirect(config, "http://127.0.0.1:40000/callback", "http://127.0.0.1:53219/callback")).toBe(true);
    for (const host of ["127.0.0.1", "[::1]", "localhost"]) {
      expect(validateMcpRedirect(config, `http://${host}:53219/callback`)).toBe(`http://${host}:53219/callback`);
      expect(matchesMcpRedirect(config, `http://${host}:40000/callback`, `http://${host}:53219/callback`)).toBe(true);
      for (const suffix of ["?extra=1", "?", "#", "?#"]) {
        const registered = `http://${host}:40000/callback${suffix}`;
        const actual = `http://${host}:53219/callback${suffix}`;
        expect(() => validateMcpRedirect(config, actual)).toThrow();
        expect(matchesMcpRedirect(config, registered, actual)).toBe(false);
        expect(matchesMcpRedirect(config, registered, registered)).toBe(false);
      }
    }
    expect(matchesMcpRedirect(config, "http://[::1]:40000/callback", "http://[::1]:53219/callback")).toBe(true);
    for (const changed of ["http://localhost:53219/callback", "http://192.168.1.1:53219/callback", "http://127.0.0.1:53219/other", "http://127.0.0.1:53219/callback?extra=1", "http://127.0.0.1:53219/callback#fragment", "http://user@127.0.0.1:53219/callback"]) expect(matchesMcpRedirect(config, "http://127.0.0.1:40000/callback", changed)).toBe(false);
    for (const changed of ["http://localhost.example:53219/callback", "http://localhost.:53219/callback", "http://sub.localhost:53219/callback"]) expect(() => validateMcpRedirect(config, changed)).toThrow();
    for (const changed of ["http://LOCALHOST:40000/callback", "http://localhost:40000/a/../callback", "http://2130706433:40000/callback", "http://127.1:40000/callback", "http://localhost:40000/\\callback", " http://localhost:40000/callback"]) {
      expect(() => validateMcpRedirect(config, changed)).toThrow();
      expect(matchesMcpRedirect(config, changed, "http://localhost:53219/callback")).toBe(false);
      expect(matchesMcpRedirect(config, changed, changed)).toBe(false);
    }
    expect(matchesMcpRedirect({ ...config, allowLoopback: false }, "http://127.0.0.1:40000/callback", "http://127.0.0.1:53219/callback")).toBe(false);
    expect(matchesMcpRedirect(config, "https://host.example:40000/callback", "https://host.example:53219/callback")).toBe(false);
    expect(() => validateMcpRedirect(config, "https://host.example/callback#")).toThrow();
  });

  it("bypasses cookie/config redirects only for MCP APIs and exact metadata endpoints", async () => {
    configure(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    for (const path of ["/api/mcp", "/api/mcp/oauth/token", "/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server"]) {
      expect((await proxy(new NextRequest(`https://vosio-a.example${path}`))).headers.get("x-middleware-next")).toBe("1");
    }
    for (const path of ["/mcp/consent", "/api/mcp-other", "/.well-known/oauth-authorization-server/child"]) {
      expect((await proxy(new NextRequest(`https://vosio-a.example${path}`))).headers.get("location")).toContain("/configuration");
    }
  });
});

describe("current bearer identity", () => {
  it("uses the installation-scoped JWT client and checks durable revocation twice without cookies", async () => {
    const { config, auth } = setup();
    const result = await authenticateMcpRequest(new Request(config.resourceUrl, { headers: { Authorization: `Bearer ${token}` } }));
    expect(result).toMatchObject({ userId, grantId, scopes: ["vosio:read"], resourceUrl: config.resourceUrl });
    expect(mocks.createClient).toHaveBeenCalledWith(config.supabaseUrl, config.publishableKey, expect.objectContaining({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: expect.objectContaining({ headers: { Authorization: "Bearer upstream-access-jwt" } }) }));
    expect(auth.getUser).toHaveBeenCalledWith("upstream-access-jwt"); expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.custody).toHaveBeenCalledTimes(2);
  });

  it.each(["aud", "exp", "client_id", "sub", "session_id", "role", "iss"])("rejects signed-but-wrong %s claims", async (field) => {
    const { config, claims } = setup();
    Object.assign(claims, { [field]: field === "exp" ? 1 : field === "session_id" || field === "sub" ? grantId : "wrong" });
    await expect(verifyUpstream(config, "upstream-access-jwt", userId, sessionId)).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("rejects deleted, inactive or newly revoked upstream sessions and grants", async () => {
    const { config, rpc } = setup();
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(authenticateMcpRequest(new Request(config.resourceUrl, { headers: { Authorization: `Bearer ${token}` } }))).rejects.toMatchObject({ code: "invalid_token" });
    setup(); mocks.custody.mockResolvedValue(null);
    await expect(authenticateMcpRequest(new Request(config.resourceUrl, { headers: { Authorization: `Bearer ${token}` } }))).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("rejects wrong resource/scopes and a revoke racing current upstream verification", async () => {
    const { config, grant } = setup();
    mocks.custody.mockResolvedValue({ ...grant, scopes: ["vosio:write"] });
    await expect(authenticateMcpRequest(new Request(config.resourceUrl, { headers: { Authorization: `Bearer ${token}` } }))).rejects.toMatchObject({ code: "invalid_token" });
    mocks.custody.mockResolvedValue({ ...grant, resource: "https://other.example/api/mcp" });
    await expect(authenticateMcpRequest(new Request(config.resourceUrl, { headers: { Authorization: `Bearer ${token}` } }))).rejects.toMatchObject({ code: "invalid_token" });
    mocks.custody.mockResolvedValueOnce(grant).mockResolvedValueOnce(null);
    await expect(authenticateMcpRequest(new Request(config.resourceUrl, { headers: { Authorization: `Bearer ${token}` } }))).rejects.toMatchObject({ code: "invalid_token" });
  });
});

describe("OAuth consent, callback and single-use issuance", () => {
  it("rejects oversized bodies and unregistered redirect URIs", async () => {
    const { config } = setup();
    const oversized = tokenRequest(config, { bad: "x".repeat(17000) }); expect((await handleMcpOAuth(oversized, "token")).status).toBe(400);
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://host.example/unregistered", code_challenge: token, code_challenge_method: "S256", resource: config.resourceUrl });
    expect((await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/authorize?${params}`), "authorize")).status).toBe(400);
    expect(mocks.custody).not.toHaveBeenCalledWith("pending_create", expect.anything());
  });

  it("registers a public SDK client without fetching metadata or granting access", async () => {
    const { config, fetchMock } = setup();
    const metadata = OAuthClientMetadataSchema.parse({ client_name: "Test SDK host", redirect_uris: ["https://host.example/callback"], client_uri: "https://host.example", logo_uri: "https://host.example/logo.png", contacts: ["operator@host.example"], software_id: "test-host", software_version: "1", scope: "vosio:write", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    const response = await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) }), "register");
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ client_id: expect.stringMatching(/^[a-f0-9-]{36}$/), token_endpoint_auth_method: "none" });
    expect(mocks.register).toHaveBeenCalledWith({ clientId: expect.any(String), name: metadata.client_name, redirects: metadata.redirect_uris });
    expect(mocks.custody).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.custody).not.toHaveBeenCalledWith("grant_create", expect.anything());
  });

  it.each(["native", "web"])("accepts standard %s application metadata without granting access", async (applicationType) => {
    const { config, fetchMock } = setup();
    const metadata = { client_name: "Codex", redirect_uris: ["http://127.0.0.1:50000/callback/codex"], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none", response_types: ["code"], scope: "vosio:read vosio:write", application_type: applicationType };
    const response = await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) }), "register");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ application_type: applicationType, client_id: expect.stringMatching(/^[a-f0-9-]{36}$/), token_endpoint_auth_method: "none" });
    expect(mocks.register).toHaveBeenCalledWith({ clientId: expect.any(String), name: "Codex", redirects: metadata.redirect_uris });
    expect(mocks.custody).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["rate_limited", "capacity_limited"])("maps durable %s admission to retryable 429 without using static custody", async (status) => {
    const { config } = setup(); mocks.register.mockResolvedValue({ status, retryAfter: 23 });
    const response = await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:50000/callback"] }) }), "register");
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("23");
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" }); expect(mocks.custody).not.toHaveBeenCalled();
  });

  it.each([
    { scope: "admin" }, { grant_types: ["refresh_token"] }, { grant_types: ["client_credentials"] },
    { application_type: "admin" }, { application_type: null },
    { token_endpoint_auth_method: "client_secret_basic" }, { redirect_uris: ["http://localhost:50000/callback?extra=1"] },
    { redirect_uris: ["https://host.example/callback#bad"] }, { client_name: "x".repeat(101) }, { actor: userId },
    { redirect_uris: ["http://LOCALHOST:50000/callback"] }, { redirect_uris: ["http://localhost:50000/a/../callback"] },
    { redirect_uris: ["http://2130706433:50000/callback"] },
    { redirect_uris: ["http://localhost:50000/callback?"] }, { redirect_uris: ["http://localhost:50000/callback#"] },
    { redirect_uris: ["http://localhost:50000/callback?#"] }, { redirect_uris: ["https://host.example/callback#"] }
  ])("rejects invalid registration before durable admission %#", async (extra) => {
    const { config } = setup();
    const response = await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:50000/callback"], ...extra }) }), "register");
    expect(response.status).toBe(400); expect(mocks.register).not.toHaveBeenCalled();
  });

  it.each(["{", JSON.stringify({ redirect_uris: ["http://localhost/callback"], client_name: "x".repeat(17000) })])("bounds malformed and oversized registration bodies before admission", async (body) => {
    const { config } = setup();
    const response = await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body }), "register");
    expect(response.status).toBe(400); expect(mocks.register).not.toHaveBeenCalled();
  });

  it("keeps public registration unavailable when DCR is disabled", async () => {
    const { config } = setup(); mocks.config.mockReturnValue({ ...config, dcrEnabled: false });
    expect((await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/register`, { method: "POST" }), "register")).status).toBe(403);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("creates nonce-bound downstream consent before any upstream exchange", async () => {
    const { config, fetchMock } = setup();
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://host.example/callback", code_challenge: token, code_challenge_method: "S256", resource: config.resourceUrl, scope: "vosio:write" });
    const response = await handleMcpOAuth(new Request(`${config.origin}/api/mcp/oauth/authorize?${params}`), "authorize");
    expect(response.status).toBe(303); expect(response.headers.get("location")).toContain("/mcp/consent?request=");
    expect(response.headers.getSetCookie().find((value) => value.startsWith(`${MCP_NONCE_COOKIE}=`))).toMatch(/=[A-Za-z0-9_-]{43};/);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/); expect(response.headers.get("set-cookie")).toMatch(/Secure/);
    expect(mocks.custody).toHaveBeenCalledWith("pending_create", expect.objectContaining({ scopes: ["vosio:read", "vosio:write"], nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks approved pending actor before OAuth details and rejects third-party clients", async () => {
    const { config, pending, oauth } = setup();
    pending.userId = sessionId;
    await expect(upstreamConsentDetails(config, "auth-request")).rejects.toThrow(); expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    pending.userId = userId; oauth.getAuthorizationDetails.mockResolvedValue({ data: { authorization_id: "auth-request", redirect_uri: config.callbackUrl, client: { id: clientId }, user: { id: userId }, scope: "email" }, error: null });
    await expect(upstreamConsentDetails(config, "auth-request")).rejects.toThrow(); expect(oauth.approveAuthorization).not.toHaveBeenCalled();
  });

  it("validates autoapproved callback, state and nonce before redirect", async () => {
    const { config, state, oauth, jar } = setup();
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_url: `${config.callbackUrl}?code=upstream-code&state=${state}` }, error: null });
    expect((await upstreamConsentDetails(config, "auth-request")).redirectUrl).toContain(`state=${state}`);
    expect(() => validateUpstreamRedirect(config, `https://evil.example/callback?code=x&state=${state}`, state)).toThrow();
    expect(() => validateUpstreamRedirect(config, `${config.callbackUrl}?code=x&state=wrong`, state)).toThrow();
    jar.set(MCP_NONCE_COOKIE, "bad"); await expect(upstreamConsentDetails(config, "auth-request")).rejects.toThrow();
  });

  it("requires same-origin form submission and nonce matching", async () => {
    const { config, nonce } = setup();
    const form = { action: "approve", nonce, pendingId, access: "read" };
    const request = new Request(`${config.origin}/api/mcp/oauth/consent`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
    expect((await handleMcpOAuth(request, "consent")).status).toBe(400);
    expect(mocks.custody).not.toHaveBeenCalled();
    const wrongNonce = new Request(`${config.origin}/api/mcp/oauth/consent`, { method: "POST", headers: { Origin: config.origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...form, nonce: token }) });
    expect((await handleMcpOAuth(wrongNonce, "consent")).status).toBe(400); expect(mocks.custody).not.toHaveBeenCalled();
  });

  it("claims callback once before upstream exchange and never reuses browser refresh credentials", async () => {
    const { config, state, fetchMock, tokens } = setup();
    const response = await handleMcpOAuth(new Request(`${config.callbackUrl}?code=upstream-code&state=${state}`), "callback");
    expect(response.status).toBe(303); expect(response.headers.get("location")).toContain("https://host.example/callback?code=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0"); expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(mocks.custody.mock.calls[0][0]).toBe("pending_claim");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]; expect(url).toBe(`${config.supabaseUrl}/auth/v1/oauth/token`); expect(init.redirect).toBe("error");
    expect(init.body.get("code_verifier")).toHaveLength(43); expect(JSON.stringify(init)).not.toContain("browser-secret");
    const persisted = mocks.custody.mock.calls.find(([action]) => action === "grant_create")?.[1];
    expect(persisted.codeHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(persisted)).not.toContain(tokens.access_token);
    expect(decryptCustody(config.encryptionKey, persisted.grantId, persisted.encrypted)).toEqual(tokens);
    mocks.custody.mockResolvedValue(null);
    expect((await handleMcpOAuth(new Request(`${config.callbackUrl}?code=upstream-code&state=${state}`), "callback")).status).not.toBe(303);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("passes the exact downstream PKCE challenge and limits access expiry to 300 seconds", async () => {
    const { config, fetchMock } = setup(); const verifier = newOpaqueToken();
    const response = await handleMcpOAuth(tokenRequest(config, { grant_type: "authorization_code", code: token, client_id: clientId, redirect_uri: "https://host.example/callback", resource: config.resourceUrl, code_verifier: verifier }), "token");
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ expires_in: 300, token_type: "Bearer", scope: "vosio:read" });
    expect(mocks.custody).toHaveBeenCalledWith("code_claim", expect.objectContaining({ challenge: pkceChallenge(verifier), clientId, resource: config.resourceUrl }));
    expect(mocks.custody).toHaveBeenCalledWith("token_issue", expect.objectContaining({ fence, accessHash: expect.stringMatching(/^[a-f0-9]{64}$/), refreshHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("claims refresh before network and revokes family on any upstream uncertainty without retry", async () => {
    const { config, fetchMock } = setup(); fetchMock.mockRejectedValue(new Error("secret transport detail"));
    const response = await handleMcpOAuth(tokenRequest(config, { grant_type: "refresh_token", refresh_token: token, client_id: clientId, resource: config.resourceUrl }), "token");
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_grant" });
    expect(mocks.custody.mock.calls[0][0]).toBe("refresh_claim"); expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.custody).toHaveBeenCalledWith("revoke_grant", { grantId });
  });
});
