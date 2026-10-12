import assert from "node:assert/strict";
import { createClient } from "npm:@supabase/supabase-js@2.104.0";
import { Buffer } from "node:buffer";
import { handleMcpEdge } from "./generated/lib/mcp/edge-handler.server.ts";
import { parseMcpConfig } from "./generated/lib/mcp/config.server.ts";
import { runMcpRequest, getRequestCookies, MCP_NONCE_COOKIE, MCP_PENDING_COOKIE } from "./generated/lib/mcp/request-context.server.ts";
import { encryptCustody, decryptCustody } from "./generated/lib/mcp/oauth-crypto.server.ts";
import { handleMcpProtocol, type McpProtocolIdentity } from "./generated/lib/mcp/protocol.server.ts";

const row = { enabled: true, webOrigin: "https://web.example", publicSupabaseUrl: "https://public.example", upstreamClientId: "10000000-0000-4000-8000-000000000001" };
const env = { SUPABASE_URL: "http://gateway:8000", SUPABASE_SECRET_KEYS: '{"default":"disposable-service"}', SUPABASE_PUBLISHABLE_KEYS: '{"default":"disposable-public"}', MCP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"), MCP_SUPABASE_CLIENT_SECRET: "disposable-client-secret" };

// Exercise the deployed entry graph and real SDK imports using an isolated fake DB transport.
Deno.test("Edge discovery, disabled state, missing/bad bearer and retired paths", async () => {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  const originalFetch = globalThis.fetch; let enabled = true;
  try {
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    globalThis.fetch = async (input, init) => {
      if (String(input) === "http://gateway:8000/rest/v1/rpc/mcp_register_dynamic_client_v1") {
        assert.deepEqual(JSON.parse(String(init?.body)).p_payload.redirects, ["http://localhost:50000/callback"]);
        return Response.json({ status: "accepted" });
      }
      assert.equal(String(input), "http://gateway:8000/rest/v1/rpc/mcp_installation_v1");
      assert.equal(JSON.parse(String(init?.body)).p_action, "read");
      return Response.json({ ...row, enabled });
    };
    const request = (suffix = "", token?: string) => new Request(`http://edge-internal/vosio-mcp${suffix}`, { headers: token ? { Authorization: token } : {} });
    const metadata = await handleMcpEdge(request("/metadata"));
    assert.equal(metadata.status, 200);
    const details = await metadata.json(); assert.equal(details.resource, "https://public.example/functions/v1/vosio-mcp"); assert.equal(details.issuer, row.webOrigin);
    assert.equal(details.registration_endpoint, `${details.resource}/oauth/register`);
    assert.equal((await handleMcpEdge(new Request("http://edge-internal/other/metadata"))).status, 404);
    assert.equal((await handleMcpEdge(new Request("http://edge-internal/functions/v1/vosio-mcp/metadata"))).status, 200);
    for (const token of [undefined, "Bearer invalid"]) {
      const denied = await handleMcpEdge(request("", token)); assert.equal(denied.status, 401);
      assert.match(denied.headers.get("www-authenticate")!, /https:\/\/public.example\/functions\/v1\/vosio-mcp\/resource-metadata/);
    }
    const registered = await handleMcpEdge(new Request("http://edge-internal/vosio-mcp/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:50000/callback"] }) }));
    assert.equal(registered.status, 201); assert.equal((await registered.json()).access_token, undefined);
    enabled = false;
    assert.equal((await handleMcpEdge(request("/metadata"))).status, 404);
    assert.equal((await handleMcpEdge(request())).status, 404);
    assert.equal((await handleMcpEdge(new Request("http://edge-internal/vosio-mcp/oauth/register", { method: "POST" }))).status, 404);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value); }
  }
});

// Prove Node-compatible crypto and request-local cookie isolation in Deno itself.
Deno.test("Edge custody crypto and concurrent browser cookies preserve binding", async () => {
  const config = parseMcpConfig(row, env)!;
  const encrypted = encryptCustody(config.encryptionKey, "grant-a", { refresh_token: "private" });
  assert.deepEqual(decryptCustody(config.encryptionKey, "grant-a", encrypted), { refresh_token: "private" });
  assert.throws(() => decryptCustody(config.encryptionKey, "grant-b", encrypted));
  const results = await Promise.all(["a", "b"].map((id) => runMcpRequest(new Request(config.resourceUrl, { headers: { cookie: `${MCP_NONCE_COOKIE}=${id}; ${MCP_PENDING_COOKIE}=pending-${id}; sb-public-auth-token=session-${id}; unrelated=secret; sb-other-auth-token=foreign` } }), config, async () => {
    await Promise.resolve(); const jar = await getRequestCookies();
    assert.equal(jar.get(MCP_NONCE_COOKIE)?.value, id); assert.equal(jar.get("unrelated"), undefined); assert.equal(jar.get("sb-other-auth-token"), undefined);
    jar.set("sb-public-auth-token", `refreshed-${id}`, { httpOnly: true, secure: true, path: "/", sameSite: "lax" });
    return new Response(id);
  })));
  assert.match(results[0].headers.getSetCookie()[0], /refreshed-a/); assert.match(results[1].headers.getSetCookie()[0], /refreshed-b/);
});

// Execute the pinned Web Standard transport in Deno, beyond merely importing its types.
Deno.test("Deno MCP SDK initialize and eleven-tool discovery", async () => {
  const config = parseMcpConfig(row, env)!;
  const identity: McpProtocolIdentity = { resourceUrl: config.resourceUrl, userId: "synthetic-user", grantId: "synthetic-grant", scopes: ["vosio:read"], supabase: createClient(row.publicSupabaseUrl, "synthetic-public-key", { auth: { persistSession: false, autoRefreshToken: false } }) };
  for (const [method, params] of [["initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "disposable-edge-smoke", version: "1" } }], ["tools/list", {}]] as const) {
    const request = new Request(config.resourceUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const response = await handleMcpProtocol(request, async () => identity);
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    if (method === "tools/list") assert.equal(result.tools.length, 11);
    else assert.equal(result.serverInfo.name, "vosio");
  }
});
