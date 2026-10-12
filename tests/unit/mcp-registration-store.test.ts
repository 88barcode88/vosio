import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMcpConfig } from "@/lib/mcp/config.server";
import { handleMcpOAuth } from "@/lib/mcp/oauth.server";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn(), result: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/mcp/config.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/config.server")>(), getMcpConfig: mocks.config }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue(parseMcpConfig({ enabled: true, webOrigin: "https://web.example", publicSupabaseUrl: "https://public.example", upstreamClientId: "10000000-0000-4000-8000-000000000001" }, {
    SUPABASE_URL: "https://public.example", SUPABASE_ANON_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    MCP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), MCP_SUPABASE_CLIENT_SECRET: "synthetic-client-secret"
  }));
  mocks.result.mockResolvedValue({ data: { status: "accepted" }, error: null });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.result });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

// Exercise the real store/result validation behind a valid public registration request.
function register(redirect = "http://localhost:50000/callback") {
  return handleMcpOAuth(new Request("https://web.example/api/mcp/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirect] }) }), "register");
}

describe("durable registration adapter boundary", () => {
  it("uses only the narrow service RPC with a deadline and returns no data grant", async () => {
    const response = await register();
    expect(response.status).toBe(201); expect(await response.json()).not.toHaveProperty("access_token");
    expect(mocks.rpc).toHaveBeenCalledWith("mcp_register_dynamic_client_v1", { p_payload: { clientId: expect.any(String), name: "MCP client", redirects: ["http://localhost:50000/callback"] } });
    expect(mocks.result).toHaveBeenCalledWith(expect.any(AbortSignal)); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, { status: "unexpected" }, { status: "accepted", actor: "untrusted" },
    { status: "rate_limited" }, { status: "rate_limited", retryAfter: 0 }, { status: "capacity_limited", retryAfter: 61 },
    { status: "rate_limited", retryAfter: 1.5 }, { status: "rate_limited", retryAfter: "60" }
  ])("reports malformed successful RPC data as server unavailability %#", async (data) => {
    mocks.result.mockResolvedValue({ data, error: null });
    const response = await register();
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(response.headers.has("retry-after")).toBe(false);
  });
  it.each(["rate_limited", "capacity_limited"])("keeps validated %s denial retryable", async (status) => {
    mocks.result.mockResolvedValue({ data: { status, retryAfter: 60 }, error: null });
    const response = await register();
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
  });
  it("hides database transport errors and preserves client-input rejection before RPC", async () => {
    mocks.result.mockResolvedValue({ data: null, error: { message: "synthetic private error" } });
    const response = await register(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    mocks.admin.mockClear(); mocks.rpc.mockClear();
    expect((await register("http://LOCALHOST:50000/callback")).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
