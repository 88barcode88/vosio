import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { POST } from "../../app/api/jobs/recording-transcription/dispatch/route";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), run: vi.fn(), after: [] as Array<() => Promise<void>>, getUser: vi.fn(), server: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: (callback: () => Promise<void>) => { mocks.after.push(callback); } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/recordings/transcription-dispatch.server", () => ({ runTranscriptionOperation: mocks.run }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.server }));
vi.mock("@/lib/env", () => ({ getPublicEnvironmentIssues: () => [], getPublicEnv: () => ({ supabaseUrl: "https://fixture.invalid", supabasePublishableKey: "synthetic" }) }));

const operationId = "00000000-0000-4000-8000-000000000001";
const url = "https://vosio.test/api/jobs/recording-transcription/dispatch";
// Build a dispatch request with an optional Authorization header and raw body.
function request(authorization: string | undefined, body: unknown = { operationId }) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks(); mocks.after.length = 0;
  vi.stubEnv("RECORDING_TRANSCRIPTION_DISPATCH_TOKEN", "test-dispatch-token"); vi.stubEnv("RECORDING_TRANSCRIPTION_WORKER_TOKEN", "test-worker-token");
  mocks.getUser.mockResolvedValue({ data: { user: null } }); mocks.server.mockReturnValue({ auth: { getUser: mocks.getUser } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("capture transcription dispatch route", () => {
  it("accepts only the dispatch token and dispatches exactly the named operation after responding", async () => {
    const client = {}; mocks.admin.mockReturnValue(client); mocks.run.mockResolvedValue("pending");
    const response = await POST(request("Bearer test-dispatch-token"));
    expect(response.status).toBe(202); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.after).toHaveLength(1);
    await mocks.after[0]();
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(client, operationId);
  });
  it.each([undefined, "Bearer wrong", "Bearer test-worker-token", "test-dispatch-token"])("rejects authorization %s before touching the body or admin client", async (authorization) => {
    const response = await POST(request(authorization));
    expect(response.status).toBe(401); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.after).toHaveLength(0);
  });
  it("rejects every request when the dispatch token is not configured", async () => {
    vi.stubEnv("RECORDING_TRANSCRIPTION_DISPATCH_TOKEN", "");
    expect((await POST(request("Bearer "))).status).toBe(401);
  });
  it.each([{}, { operationId: "not-a-uuid" }, { operationId, extra: 1 }, "{", []])("rejects an invalid body %j", async (body) => {
    expect((await POST(request("Bearer test-dispatch-token", body))).status).toBe(400); expect(mocks.after).toHaveLength(0);
  });
  it("still reports a dispatch failure only in the background and keeps the response", async () => {
    mocks.run.mockRejectedValue(new Error("provider detail")); const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await POST(request("Bearer test-dispatch-token"))).status).toBe(202);
    await mocks.after[0](); expect(log).toHaveBeenCalledOnce(); expect(JSON.stringify(log.mock.calls)).not.toContain("provider detail");
  });
});

describe("dispatch proxy bypass", () => {
  it("passes only the exact POST path without a session", async () => {
    expect((await proxy(new NextRequest(url, { method: "POST" }))).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it.each([[`${url}/`, "POST"], [`${url}?x=1`, "POST"], [`${url}/extra`, "POST"], [url, "GET"], [url, "PUT"], ["https://vosio.test/api/jobs/recording-transcription/dispatcher", "POST"]])("keeps %s (%s) session protected", async (target, method) => {
    const result = await proxy(new NextRequest(target, { method }));
    expect(result.status).toBe(307); expect(mocks.getUser).toHaveBeenCalledOnce();
  });
});
