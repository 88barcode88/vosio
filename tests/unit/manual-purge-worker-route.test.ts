import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/jobs/manual-recording-purge/route";
const m = vi.hoisted(() => ({ admin: vi.fn(), discover: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recordings/manual-purge-worker.server", () => ({ discoverManualPurges: m.discover }));
// Scheduler inputs are test-only literals; no real environment secrets are read.
function request(token = "Bearer test-token") { return new Request("http://localhost/api/jobs/manual-recording-purge", { method: "POST", headers: { authorization: token } }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TRASH_RETENTION_SCHEDULER_TOKEN", "test-token"); vi.stubEnv("TRASH_RETENTION_ENABLED", "true"); m.admin.mockReturnValue({ admin: true }); });
afterEach(() => vi.unstubAllEnvs());
it.each(["", "Bearer wrong", "Bearer tést-token"])("rejects invalid scheduler auth without service access (%s)", async (token) => {
  expect((await POST(request(token))).status).toBe(401); expect(m.admin).not.toHaveBeenCalled();
});
it("does not execute when the retention enable switch is off", async () => {
  vi.stubEnv("TRASH_RETENTION_ENABLED", "false"); expect((await POST(request())).status).toBe(503); expect(m.admin).not.toHaveBeenCalled();
});
it("returns only aggregate work outcomes", async () => {
  m.discover.mockResolvedValue({ claimed: 2, completed: 1, failed: 1 }); const response = await POST(request());
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ claimed: 2, completed: 1, failed: 1 });
});
it("sanitizes service failure", async () => {
  m.discover.mockRejectedValue(new Error("private token detail")); const response = await POST(request());
  expect(response.status).toBe(500); expect(await response.text()).not.toContain("private token");
});
