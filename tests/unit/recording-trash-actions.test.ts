import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRecordingAction, purgeRecordingAction, restoreRecordingAction } from "@/lib/recordings/actions";
const m = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), caps: vi.fn(), worker: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: m.caps }));
vi.mock("@/lib/recordings/manual-purge-worker.server", () => ({ processManualPurge: m.worker }));
const id = "00000000-0000-4000-8000-000000000801";
const operation = "00000000-0000-4000-8000-000000000802";
const version = "2026-09-20T00:00:00Z";
// Supplies only the authenticated RPC boundary; table access is forbidden by construction.
function setup(metadata = {}, authenticated = true) {
  const rpc = vi.fn(async (name: string) => ({ error: null, data: name === "get_accessible_recording_v1" ? [{ id, updated_at: version }]
    : name === "trash_recording_v1" ? { recordingId: id, status: "deleted", changed: true }
      : name === "restore_shared_recording_v1" ? { recordingId: id, status: "transcribing", changed: true }
        : { operationId: operation, phase: name === "prepare_recording_purge_v1" ? "prepared" : "started", changed: true } }));
  m.client.mockResolvedValue({ rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authenticated ? { id, user_metadata: metadata } : null } }) } });
  return rpc;
}
// Includes the durable client-generated key and its original snapshot, retained on any uncertain reply.
function form(next = "/trash", recordingId = id) {
  const data = new FormData(); data.set("recordingId", recordingId); data.set("next", next);
  data.set("requestId", operation); data.set("expectedUpdatedAt", version); return data;
}
beforeEach(() => {
  vi.clearAllMocks(); m.caps.mockResolvedValue({ delete: true, restore: true, purge: true });
  m.worker.mockResolvedValue(true); m.admin.mockReturnValue({ service: true });
  m.redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
});
describe("recording Trash actions using reviewed RPCs", () => {
  it.each([[{ vosio_settings: { trashRetentionHours: 168 } }, 168], [{}, 720], [{ vosio_settings: { trashRetentionHours: 48 } }, 720]])("passes sanitized retention snapshot", async (metadata, retention) => {
    const rpc = setup(metadata); const data = form(); data.delete("next"); await deleteRecordingAction(data);
    expect(rpc).toHaveBeenLastCalledWith("trash_recording_v1", { p_recording_id: id, p_expected_updated_at: version, p_retention_hours: retention });
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("restores the DB-captured status and preserves a safe return URL", async () => {
    const rpc = setup();
    await expect(restoreRecordingAction(form("/trash?kind=audio&error=old"))).rejects.toThrow("REDIRECT:/trash?kind=audio");
    expect(rpc).toHaveBeenLastCalledWith("restore_shared_recording_v1", { p_recording_id: id, p_expected_updated_at: version });
    expect(m.admin).not.toHaveBeenCalled(); expect(m.revalidate).toHaveBeenCalledWith(`/recordings/${id}`);
  });
  it.each([restoreRecordingAction, purgeRecordingAction])("rejects unauthenticated calls before service work", async (action) => {
    setup({}, false); await expect(action(form())).rejects.toThrow("REDIRECT:/login?next=%2Ftrash"); expect(m.admin).not.toHaveBeenCalled();
  });
  it.each([["42501", "forbidden"], ["40001", "conflict"], ["55000", "conflict"], ["XX000", "internal"]])("maps restore %s without database detail", async (code, expected) => {
    const rpc = setup(); rpc.mockResolvedValueOnce({ data: [{ id, updated_at: version }], error: null })
      .mockResolvedValueOnce({ data: null, error: { code, message: "private" } } as never);
    await expect(restoreRecordingAction(form())).rejects.toThrow(`REDIRECT:/trash?error=${expected}`);
  });
  it("does not give editor a restore write path", async () => {
    const rpc = setup(); m.caps.mockResolvedValue({ restore: false });
    await expect(restoreRecordingAction(form())).rejects.toThrow("REDIRECT:/trash?error=forbidden"); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not return success for an empty restore outcome", async () => {
    const rpc = setup(); rpc.mockResolvedValueOnce({ data: [{ id, updated_at: version }], error: null }).mockResolvedValueOnce({ data: null, error: null } as never);
    await expect(restoreRecordingAction(form())).rejects.toThrow("REDIRECT:/trash?error=internal");
  });
  it("starts session work before invoking the service worker", async () => {
    const rpc = setup(); await expect(purgeRecordingAction(form())).rejects.toThrow("REDIRECT:/trash");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["prepare_recording_purge_v1", "start_recording_purge_v1"]);
    expect(m.worker).toHaveBeenCalledWith({ service: true }, operation);
    expect(m.worker.mock.invocationCallOrder[0]).toBeGreaterThan(rpc.mock.invocationCallOrder[1]!);
  });
  it("never releases a started receipt after Storage failure", async () => {
    const rpc = setup(); m.worker.mockRejectedValue(new Error("Storage detail"));
    await expect(purgeRecordingAction(form())).rejects.toThrow("REDIRECT:/trash?error=purge_failed");
    expect(rpc.mock.calls.some(([name]) => name.includes("release"))).toBe(false);
  });
  it("recovers completed work after revoke without any service write", async () => {
    const rpc = setup(); rpc.mockResolvedValue({ data: { operationId: operation, phase: "completed" }, error: null } as never);
    m.caps.mockResolvedValue({ purge: false }); await expect(purgeRecordingAction(form())).rejects.toThrow("REDIRECT:/trash");
    expect(m.admin).not.toHaveBeenCalled(); expect(m.caps).not.toHaveBeenCalled();
  });
  it("refuses purge without a previously retained request key", async () => {
    const rpc = setup(); const data = form(); data.delete("requestId");
    await expect(purgeRecordingAction(data)).rejects.toThrow("REDIRECT:/trash?error=invalid_item");
    expect(rpc).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it("rejects invalid restore before authentication", async () => {
    await expect(restoreRecordingAction(form("/trash?error=old", "invalid"))).rejects.toThrow("REDIRECT:/trash?error=invalid_restore");
    expect(m.client).not.toHaveBeenCalled();
  });
});
