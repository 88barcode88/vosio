import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { POST } from "../../app/api/jobs/recording-transcription/[operationId]/[jobId]/route";
const m = vi.hoisted(() => ({ getUser: vi.fn(), server: vi.fn(), admin: vi.fn(), verify: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: m.server }));
vi.mock("@/lib/env", () => ({ getPublicEnvironmentIssues: () => [], getPublicEnv: () => ({ supabaseUrl: "https://fixture.invalid", supabasePublishableKey: "synthetic" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recordings/transcription-dispatch.server", () => ({ verifyTranscriptionWebhook: m.verify, runTranscriptionOperation: vi.fn() }));
const operationId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const path = `/api/jobs/recording-transcription/${operationId}/${jobId}`;
beforeEach(() => {
  vi.clearAllMocks();m.getUser.mockResolvedValue({ data: { user: null } });m.server.mockReturnValue({ auth: { getUser: m.getUser } });m.verify.mockReturnValue(false);
});
describe("cookie-less transcription callback proxy boundary", () => {
  it("passes the exact POST to HMAC authentication and still rejects an unauthenticated provider", async () => {
    const request = new NextRequest(`https://vosio.test${path}`, { method: "POST" });
    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    expect(m.getUser).not.toHaveBeenCalled();
    expect((await POST(request, { params: Promise.resolve({ operationId, jobId }) })).status).toBe(401);
    expect(m.admin).not.toHaveBeenCalled();
  });
  it.each([`${path}/`, `${path}/extra`, `${path}?extra=1`, path.replace(jobId,"bad"), path.replace(operationId,"%30"+operationId.slice(1)), "/api/jobs/recording-transcription/other"])("keeps malformed, encoded and unrelated paths session protected (%s)", async (target) => {
    const result = await proxy(new NextRequest(`https://vosio.test${target}`, { method: "POST" }));
    expect(result.status).toBe(307);expect(new URL(result.headers.get("location")!).pathname).toMatch(/^\/login\/?$/);
    expect(m.getUser).toHaveBeenCalledOnce();expect(m.admin).not.toHaveBeenCalled();
  });
  it.each(["GET", "PUT", "DELETE", "OPTIONS"])("keeps method %s session protected", async (method) => {
    expect((await proxy(new NextRequest(`https://vosio.test${path}`, { method }))).status).toBe(307);
  });
});
