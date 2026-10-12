import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpEdge } from "@/lib/mcp/edge-handler.server";
import { parseMcpConfig } from "@/lib/mcp/config.server";
import { McpAuthError } from "@/lib/mcp/auth.server";

const mocks = vi.hoisted(() => ({ load: vi.fn(), auth: vi.fn(), audio: vi.fn(), register: vi.fn() }));
vi.mock("@/lib/mcp/config.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/config.server")>(), loadMcpConfig: mocks.load }));
vi.mock("@/lib/mcp/auth.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/auth.server")>(), authenticateMcpRequest: mocks.auth }));
vi.mock("@/lib/mcp/audio.server", () => ({ readAuthorizedAudioChunk: mocks.audio }));
vi.mock("@/lib/mcp/oauth-store.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/oauth-store.server")>(), registerDynamicClient: mocks.register }));
const id = "10000000-0000-4000-8000-000000000001";
const resourceUrl = "https://public.example/functions/v1/vosio-mcp";
const identity = { resourceUrl, userId: id, grantId: id, scopes: ["vosio:read"], supabase: {} };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(parseMcpConfig({ enabled: true, webOrigin: "https://web.example", publicSupabaseUrl: "https://public.example", upstreamClientId: id }, { SUPABASE_URL: "http://gateway:8000", SUPABASE_SERVICE_ROLE_KEY: "admin", SUPABASE_ANON_KEY: "public", MCP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), MCP_SUPABASE_CLIENT_SECRET: "disposable-secret-value" }));
  mocks.auth.mockResolvedValue(identity);
  mocks.register.mockResolvedValue({ status: "accepted" });
  mocks.audio.mockResolvedValue({ bytes: Buffer.from("audio"), status: 206, contentRange: "bytes 0-4/100", mimeType: "audio/webm" });
});
afterEach(() => vi.restoreAllMocks());

// Exercise the actual Edge dispatcher and real pinned SDK using canonical resources after gateway stripping.
describe("Supabase MCP HTTP dispatch", () => {
  it("discovers public registration from a 401 and registers without granting tools or browser identity", async () => {
    mocks.auth.mockRejectedValue(new McpAuthError("invalid_token"));
    const denied = await handleMcpEdge(new Request("http://internal/vosio-mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    expect(denied.status).toBe(401); expect(denied.headers.get("www-authenticate")).toContain(`${resourceUrl}/resource-metadata`);
    const resource = await (await handleMcpEdge(new Request("http://internal/vosio-mcp/resource-metadata"))).json();
    expect(resource.authorization_servers).toEqual(["https://web.example"]);
    const metadata = await (await handleMcpEdge(new Request("http://internal/vosio-mcp/metadata"))).json();
    expect(metadata.registration_endpoint).toBe(`${resourceUrl}/oauth/register`);
    const registered = await handleMcpEdge(new Request("http://internal/vosio-mcp/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:50000/callback"] }) }));
    expect(registered.status).toBe(201); expect(await registered.json()).not.toHaveProperty("access_token");
    expect(mocks.register).toHaveBeenCalledOnce();
    mocks.load.mockResolvedValue(null);
    expect((await handleMcpEdge(new Request("http://internal/vosio-mcp/oauth/register", { method: "POST" }))).status).toBe(404);
  });
  it("serves the same eleven tools through the real SDK behind a stripped gateway path", async () => {
    const response = await handleMcpEdge(new Request("http://internal/vosio-mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    expect(response.status).toBe(200); expect((await response.json()).result.tools).toHaveLength(11);
    expect(mocks.auth.mock.calls[0][0].url).toBe(resourceUrl);
  });
  it.each([undefined, "bytes=0-", "bytes=0-31"])("preserves bounded audio range %s", async (range) => {
    const response = await handleMcpEdge(new Request(`http://internal/vosio-mcp/audio/${id}`, { headers: range ? { Range: range } : {} }));
    expect(response.status).toBe(206); expect(await response.text()).toBe("audio");
    expect(mocks.audio).toHaveBeenCalledWith(identity, id, 0, range === "bytes=0-31" ? 32 : 1_048_576);
    expect(response.headers.get("accept-ranges")).toBe("bytes"); expect(response.headers.get("vary")).toBe("Authorization");
  });
  it("rejects foreign origins, query strings, malformed and oversized ranges before Storage", async () => {
    for (const [query, headers, status] of [["?x=1", {}, 403], ["", { Origin: "https://foreign.example" }, 403], ["", { Range: "bytes=0-2000000" }, 416], ["", { Range: "bytes=-4" }, 416]] as const) {
      const response = await handleMcpEdge(new Request(`http://internal/vosio-mcp/audio/${id}${query}`, { headers })); expect(response.status).toBe(status);
    }
    expect(mocks.audio).not.toHaveBeenCalled();
  });
  it("withholds audio when identity changes during Storage read", async () => {
    mocks.auth.mockResolvedValueOnce(identity).mockResolvedValueOnce({ ...identity, grantId: "different" });
    const response = await handleMcpEdge(new Request(`http://internal/vosio-mcp/audio/${id}`));
    expect(response.status).toBe(401); expect(await response.text()).not.toBe("audio");
  });
  it("rechecks installation activation on each HTTP request", async () => {
    expect((await handleMcpEdge(new Request("http://internal/vosio-mcp/metadata"))).status).toBe(200);
    mocks.load.mockResolvedValue(null);
    expect((await handleMcpEdge(new Request("http://internal/vosio-mcp/metadata"))).status).toBe(404);
  });
});
