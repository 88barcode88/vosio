import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), index: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/transcripts/capture-index.server", () => ({ indexCapturedTranscript: mocks.index }));
import { POST } from "@/../app/api/recordings/[recordingId]/recover-live/route";
const recordingId = "00000000-0000-4000-8000-000000000111";
const requestId = "00000000-0000-4000-8000-000000000112";
const transcriptId = "00000000-0000-4000-8000-000000000113";
// Recovery replays a DB receipt, never performs another metadata write or schedules AI.
function request() {
  return new Request("http://localhost/recover", { method: "POST", headers: { origin: "http://localhost" },
    body: JSON.stringify({ requestId, captureRevision: 4 }) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockReturnValue({}); mocks.index.mockResolvedValue({ status: "ready" }); });
it("indexes both initial recovery and exact replay from the durable transcript receipt", async () => {
  const from = vi.fn();
  const receipt = { recordingId, transcriptId, status: "completed", captureRevision: 5, jobId: null };
  const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
  mocks.client.mockResolvedValue({ from, rpc, auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) } });
  for (let index = 0; index < 2; index++) expect((await POST(request(), { params: Promise.resolve({ recordingId }) })).status).toBe(200);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenCalledWith("apply_recording_capture_transition_v1", expect.objectContaining({
    p_transition: "recover", p_request_id: requestId, p_expected_capture_revision: 4, p_raw_text: null
  }));
  expect(from).not.toHaveBeenCalled();
  expect(mocks.index).toHaveBeenCalledTimes(2);
  expect(mocks.index).toHaveBeenCalledWith({}, transcriptId);
});
it.each(["40001", "42501"])("rejects stale or revoked recovery (%s) without metadata regression or service work", async (code) => {
  const from = vi.fn(); const rpc = vi.fn().mockResolvedValue({ data: null, error: { code } });
  mocks.client.mockResolvedValue({ from, rpc, auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) } });
  expect((await POST(request(), { params: Promise.resolve({ recordingId }) })).status).toBe(code === "40001" ? 409 : 403);
  expect(rpc).toHaveBeenCalledOnce(); expect(from).not.toHaveBeenCalled();
  expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.index).not.toHaveBeenCalled();
});
