import { afterEach, describe, expect, it, vi } from "vitest";
import { getMcpMetadata, proxyMcpOAuth } from "@/lib/mcp/gateway.server";
import { parseMcpConfig } from "@/lib/mcp/config.server";
import { mcpMetadata } from "@/lib/mcp/edge-handler.server";
import { filterMcpCookies, MCP_NONCE_COOKIE, MCP_PENDING_COOKIE } from "@/lib/mcp/request-context.server";

const row = { enabled: true, webOrigin: "https://web.example", publicSupabaseUrl: "https://sb.example", upstreamClientId: "10000000-0000-4000-8000-000000000001" };
const env = { SUPABASE_URL: "http://gateway:8000", SUPABASE_SECRET_KEYS: '{"default":"test-service"}', SUPABASE_PUBLISHABLE_KEYS: '{"default":"test-public"}', MCP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), MCP_SUPABASE_CLIENT_SECRET: "disposable-upstream-secret" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// Configure only pre-existing web variables and return the trusted public metadata.
function web() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", row.publicSupabaseUrl);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
  return mcpMetadata(parseMcpConfig(row, env)!);
}

describe("MCP web/Function boundary", () => {
  it("bootstraps without MCP env and keeps internal service URLs and keys out of metadata", async () => {
    const metadata = web(); const fetcher = vi.fn().mockResolvedValue(Response.json(metadata)); vi.stubGlobal("fetch", fetcher);
    expect(await getMcpMetadata()).toEqual(metadata);
    expect(fetcher.mock.calls[0][0]).toBe("https://sb.example/functions/v1/vosio-mcp/metadata");
    expect(JSON.stringify(metadata)).not.toMatch(/gateway|secret|test-service/);
    expect(metadata.issuer).toBe(row.webOrigin);
  });
  it("rejects metadata with a foreign resource or issuer and unavailable Function", async () => {
    const metadata = web(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const value of [{ ...metadata, resource: "https://evil.example/functions/v1/vosio-mcp" }, { ...metadata, issuer: "https://evil.example" }, { ...metadata, registration_endpoint: "https://evil.example/oauth/register" }, { ...metadata, registration_endpoint: `${metadata.resource}/oauth/register?target=foreign` }]) {
      fetcher.mockResolvedValueOnce(Response.json(value)); expect(await getMcpMetadata()).toBeNull();
    }
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 })); expect(await getMcpMetadata()).toBeNull();
  });
  it("forwards only own auth and MCP cookies, preserving separate Set-Cookie and manual redirects", async () => {
    const metadata = web();
    const response = new Response(null, { status: 303, headers: { Location: "https://client.example/callback?code=opaque" } });
    response.headers.append("Set-Cookie", `${MCP_NONCE_COOKIE}=nonce; Secure; HttpOnly; Path=/; SameSite=Lax`);
    response.headers.append("Set-Cookie", `${MCP_PENDING_COOKIE}=pending; Secure; HttpOnly; Path=/; SameSite=Lax`);
    response.headers.append("Set-Cookie", "__cf_bm=edge-cookie; Secure; HttpOnly; Path=/; Domain=supabase.co; SameSite=None");
    response.headers.append("Set-Cookie", "sb-other-auth-token=foreign; Secure; Path=/; Domain=other.example");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(response); vi.stubGlobal("fetch", fetcher);
    const result = await proxyMcpOAuth(new Request("https://web.example/api/mcp/oauth/consent", { method: "POST", headers: { Origin: row.webOrigin, Cookie: `${MCP_NONCE_COOKIE}=nonce; sb-sb-auth-token=own; sb-other-auth-token=foreign; unrelated=private`, Authorization: "Bearer should-not-forward", "Content-Type": "application/x-www-form-urlencoded" }, body: "action=approve" }), "consent");
    expect(result.status).toBe(303); expect(result.headers.getSetCookie()).toHaveLength(2);
    const outgoing = fetcher.mock.calls[1][1];
    expect(outgoing.redirect).toBe("manual"); expect(outgoing.headers.get("cookie")).toContain("sb-sb-auth-token=own");
    expect(outgoing.headers.get("cookie")).not.toMatch(/foreign|private/); expect(outgoing.headers.has("authorization")).toBe(false);
    expect(fetcher.mock.calls[1][0]).toBe(`${metadata.resource}/oauth/consent`);
  });
  it("preserves an OAuth error when the Supabase gateway adds an unrelated cookie", async () => {
    const metadata = web();
    const response = Response.json({ error: "invalid_request" }, { status: 400 });
    response.headers.append("Set-Cookie", "__cf_bm=edge-cookie; Secure; HttpOnly; Path=/; Domain=supabase.co");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(response); vi.stubGlobal("fetch", fetcher);
    const result = await proxyMcpOAuth(new Request("https://web.example/api/mcp/oauth/authorize"), "authorize");
    expect(result.status).toBe(400); expect(await result.json()).toEqual({ error: "invalid_request" });
    expect(result.headers.getSetCookie()).toEqual([]);
  });
  it.each([MCP_NONCE_COOKIE, MCP_PENDING_COOKIE, "sb-sb-auth-token", "sb-sb-auth-token.0"])("rejects a Domain attribute on the allowed cookie %s", async (name) => {
    const metadata = web();
    const response = new Response(null, { status: 303, headers: { Location: "https://client.example/callback" } });
    response.headers.append("Set-Cookie", `${name}=value; Secure; HttpOnly; Path=/; Domain=web.example`);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(response); vi.stubGlobal("fetch", fetcher);
    const result = await proxyMcpOAuth(new Request("https://web.example/api/mcp/oauth/authorize"), "authorize");
    expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: "temporarily_unavailable" });
    expect(result.headers.getSetCookie()).toEqual([]); expect(result.headers.has("location")).toBe(false);
  });
  it("cannot choose a backend target through query, Host or Forwarded headers", async () => {
    const metadata = web(); const fetcher = vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response(null, { status: 400 })); vi.stubGlobal("fetch", fetcher);
    await proxyMcpOAuth(new Request("https://web.example/api/mcp/oauth/authorize?target=https://evil.example", { headers: { Forwarded: "host=evil.example" } }), "authorize");
    expect(fetcher.mock.calls[1][0]).toBe(`${metadata.resource}/oauth/authorize?target=https://evil.example`);
    expect(fetcher.mock.calls[1][1].headers.has("forwarded")).toBe(false);
  });
  it("keeps URL roles separate and fails closed for missing or ambiguous default keys", () => {
    const config = parseMcpConfig(row, env)!;
    expect(config.supabaseUrl).toBe("http://gateway:8000"); expect(config.publicSupabaseUrl).toBe(row.publicSupabaseUrl);
    expect(config.callbackUrl).toBe(`${row.webOrigin}/api/mcp/oauth/callback`);
    expect(parseMcpConfig({ ...row, enabled: false }, env)).toBeNull();
    expect(parseMcpConfig(row, { ...env, SUPABASE_SECRET_KEYS: '{"other":"privileged"}', SUPABASE_SERVICE_ROLE_KEY: "legacy" })).toBeNull();
    expect(parseMcpConfig(row, { ...env, SUPABASE_PUBLISHABLE_KEYS: "broken", SUPABASE_ANON_KEY: "legacy" })).toBeNull();
    expect(parseMcpConfig(row, { ...env, MCP_TOKEN_ENCRYPTION_KEY: "invalid" })).toBeNull();
  });
  it("filters cookie chunk names precisely", () => {
    expect(filterMcpCookies("sb-sb-auth-token.0=a; sb-sb-auth-token.extra=b; sb-other-auth-token=c; unrelated=d", row.publicSupabaseUrl)).toEqual([{ name: "sb-sb-auth-token.0", value: "a" }]);
  });
});
