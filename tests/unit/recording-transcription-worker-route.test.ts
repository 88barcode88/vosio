import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/jobs/recording-transcription/route";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), discover: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/recordings/transcription-worker.server", () => ({ discoverTranscriptionWork: mocks.discover }));

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("transcription worker authorization without an enable switch", () => {
  it.each(["false", undefined])("dispatches with the valid token regardless of obsolete switch (%s)", async (enabled) => {
    vi.stubEnv("RECORDING_TRANSCRIPTION_ENABLED", enabled);
    vi.stubEnv("RECORDING_TRANSCRIPTION_WORKER_TOKEN", "test-worker-token");
    const client = {};
    mocks.admin.mockReturnValue(client);
    mocks.discover.mockResolvedValue({ processed: 0 });
    const response = await POST(new Request("http://localhost/api/jobs/recording-transcription", {
      method: "POST", headers: { authorization: "Bearer test-worker-token" }
    }));
    expect(response.status).toBe(200);
    expect(mocks.discover).toHaveBeenCalledExactlyOnceWith(client);
  });

  it.each([undefined, "Bearer wrong-token"])("rejects invalid authorization (%s) before creating an admin client", async (authorization) => {
    vi.stubEnv("RECORDING_TRANSCRIPTION_WORKER_TOKEN", "test-worker-token");
    const response = await POST(new Request("http://localhost/api/jobs/recording-transcription", {
      method: "POST", headers: authorization ? { authorization } : {}
    }));
    expect(response.status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("rejects an unconfigured worker token", async () => {
    vi.stubEnv("RECORDING_TRANSCRIPTION_WORKER_TOKEN", undefined);
    const response = await POST(new Request("http://localhost/api/jobs/recording-transcription", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
