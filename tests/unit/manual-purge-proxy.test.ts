import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { POST } from "../../app/api/jobs/manual-recording-purge/route";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createServerClient: vi.fn(), admin: vi.fn(), discover: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/env", () => ({ getPublicEnvironmentIssues: () => [], getPublicEnv: () => ({ supabaseUrl: "https://supabase.test", supabasePublishableKey: "public-test-key" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/recordings/manual-purge-worker.server", () => ({ discoverManualPurges: mocks.discover }));

const endpoint = "/api/jobs/manual-recording-purge";

// Exercises the real top-level proxy and real updateSession before the guarded route.
async function invokeThroughProxy(token?: string) {
  const request = new NextRequest(`https://vosio.test${endpoint}`, { method: "POST", headers: token ? { authorization: token } : {} });
  const response = await proxy(request);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
  return POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
  mocks.admin.mockReturnValue({ service: true });
  mocks.discover.mockResolvedValue({ claimed: 0, completed: 0, failed: 0 });
  vi.stubEnv("TRASH_RETENTION_SCHEDULER_TOKEN", "scheduler-test-token");
  vi.stubEnv("TRASH_RETENTION_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("manual purge scheduler proxy boundary", () => {
  it("passes only the exact cookie-less POST to its Bearer-protected route", async () => {
    expect((await invokeThroughProxy("Bearer scheduler-test-token")).status).toBe(200);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.discover).toHaveBeenCalledWith({ service: true });
  });
  it.each([undefined, "Bearer wrong", "scheduler-test-token"])("keeps route authentication for %s", async (token) => {
    expect((await invokeThroughProxy(token)).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("keeps the exact enable switch behind the proxy", async () => {
    vi.stubEnv("TRASH_RETENTION_ENABLED", "false");
    expect((await invokeThroughProxy("Bearer scheduler-test-token")).status).toBe(503);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each([
    `${endpoint}/`, `${endpoint}/extra`, `${endpoint}-other`, "/api/jobs/other", "/api/jobs", "/recordings",
    "/api/recordings/id/audio", "/api/transcript-tasks/id/status", `${endpoint}?next=/recordings`,
    "/api/jobs/manual-recording-purge%2fextra", "/api/jobs/%6danual-recording-purge", "/api//jobs/manual-recording-purge"
  ])("keeps similar, encoded, query and protected paths private: %s", async (path) => {
    const response = await proxy(new NextRequest(`https://vosio.test${path}`, { method: "POST", headers: { authorization: "Bearer scheduler-test-token" } }));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toMatch(/^\/login\/?$/);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"])("does not bypass session protection for method %s", async (method) => {
    const response = await proxy(new NextRequest(`https://vosio.test${endpoint}`, { method }));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
  it("keeps Bearer protection when NextRequest normalizes an empty query to the exact endpoint", async () => {
    const request = new NextRequest(`https://vosio.test${endpoint}?`, { method: "POST" });
    expect(request.url).toBe(`https://vosio.test${endpoint}`);
    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    expect((await POST(request)).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
