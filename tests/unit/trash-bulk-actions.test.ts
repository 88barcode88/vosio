import { beforeEach, describe, expect, it, vi } from "vitest";
import { purgeRecordingMutationAction, restoreRecordingsBulkAction } from "@/lib/recordings/actions";
const m = vi.hoisted(() => ({ client: vi.fn(), caps: vi.fn(), admin: vi.fn(), worker: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: m.caps }));
vi.mock("@/lib/recordings/manual-purge-worker.server", () => ({ processManualPurge: m.worker }));
const id = "00000000-0000-4000-8000-000000000901";
const missing = "00000000-0000-4000-8000-000000000902";
// Builds the bounded repeated-id input and a durable purge retry key.
function form(ids: string[]) {
  const data = new FormData(); ids.forEach((value) => data.append("recordingId", value));
  data.set("requestId", missing); data.set("expectedUpdatedAt", "2026-09-20T00:00:00Z"); return data;
}
// RPC-only session double prevents fallback to protected metadata or direct writes.
function setup() {
  const rpc = vi.fn(async (name: string, args: { p_recording_id?: string }) => ({
    data: name === "get_accessible_recording_v1" ? [{ id: args.p_recording_id, updated_at: "2026-09-20T00:00:00Z" }]
      : name === "restore_shared_recording_v1" ? { recordingId: args.p_recording_id, changed: true, status: "completed" }
        : { operationId: missing, phase: "completed" }, error: null }));
  m.client.mockResolvedValue({ rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id } } }) } }); return rpc;
}
beforeEach(() => { vi.clearAllMocks(); m.caps.mockImplementation(async (_client, value) => ({ restore: value !== missing })); });
describe("bounded Trash mutations", () => {
  it("returns stable partial results without enumerating a denied target", async () => {
    setup(); expect(await restoreRecordingsBulkAction(form([id, missing]))).toEqual({ succeededIds: [id], failures: [{ id: missing, code: "forbidden" }] });
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("deduplicates input order and rejects over 100 unique restore IDs", async () => {
    const rpc = setup(); expect(await restoreRecordingsBulkAction(form([id, id]))).toEqual({ succeededIds: [id], failures: [] }); expect(rpc).toHaveBeenCalledTimes(2);
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await restoreRecordingsBulkAction(form(ids))).toEqual({ succeededIds: [], failures: [{ id: "bulk", code: "invalid_bulk" }] });
  });
  it("recovers exactly one completed purge receipt", async () => {
    const rpc = setup(); expect(await purgeRecordingMutationAction(form([id]))).toEqual({ id, ok: true });
    expect(rpc).toHaveBeenCalledWith("prepare_recording_purge_v1", { p_recording_id: id, p_request_id: missing, p_expected_updated_at: "2026-09-20T00:00:00Z" });
  });
  it("keeps started receipt pending when acquisition returns false rather than reporting completed", async () => {
    const rpc = setup();
    rpc.mockResolvedValue({ data: { operationId: missing, phase: "started" }, error: null });
    m.worker.mockResolvedValue(false);
    expect(await purgeRecordingMutationAction(form([id]))).toEqual({ id, ok: false, code: "conflict" });
    expect(m.worker).toHaveBeenCalledWith(m.admin.mock.results[0]?.value, missing);
  });
  it.each([[[]], [[id, missing]]])("rejects zero or multiple purge IDs", async (ids) => {
    expect(await purgeRecordingMutationAction(form(ids))).toEqual({ id: "item", ok: false, code: "invalid_item" }); expect(m.client).not.toHaveBeenCalled();
  });
  it("reports a locked upload fence or exhausted work as conflict without provider detail", async () => {
    const rpc = setup(); rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "private" } } as never);
    expect(await purgeRecordingMutationAction(form([id]))).toEqual({ id, ok: false, code: "conflict" });
  });
});
