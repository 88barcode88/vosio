import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "../../app/api/transcript-tasks/[taskId]/route";
import { deleteAiOutputAction } from "@/lib/ai/actions";

const m = vi.hoisted(() => ({ client: vi.fn(), caps: vi.fn(), admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: m.caps }));
const id = "11111111-1111-4111-8111-111111111111";
const recording = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";
const task = { id, transcript_id: id, updated_at: "2026-09-20T00:00:00Z", title: "Poslat podklady", owner_category: "Moje práce", deadline: null, deadline_normalized: null };

// Session-only query double supplies exact target and full paginated logical group snapshots.
function setup(target: unknown = task, candidates = [task, { ...task, id: second, title: " POSLAT  PODKLADY " }]) {
  const rpc = vi.fn().mockResolvedValue({ data: { recordingId: recording, deletedCount: 2 } });
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: candidates }), maybeSingle: vi.fn().mockResolvedValueOnce({ data: target }).mockResolvedValueOnce({ data: { recording_id: recording } }) };
  const from = vi.fn(() => query);
  m.client.mockResolvedValue({ from, rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id } } }) } });
  return { rpc, query, from };
}
// Calls the actual DELETE route, not a UI permission proxy.
function removeTask() { return DELETE(new NextRequest("http://localhost/task", { method: "DELETE" }), { params: Promise.resolve({ taskId: id }) }); }
beforeEach(() => { vi.clearAllMocks(); m.caps.mockResolvedValue({ delete: true }); });

it("atomically deletes the matched logical task group using a version and session RPC", async () => {
  const s = setup();
  expect((await removeTask()).status).toBe(200);
  expect(s.rpc).toHaveBeenCalledWith("delete_managed_transcript_task_group_v1", { p_task_id: id, p_expected_updated_at: task.updated_at, p_task_ids: [id, second] });
  expect(m.admin).not.toHaveBeenCalled();
});
it("denies editor task deletion on the server", async () => {
  const s = setup(); m.caps.mockResolvedValue({ delete: false });
  expect((await removeTask()).status).toBe(403); expect(s.rpc).not.toHaveBeenCalled();
});
it("does not report success for a zero-row task outcome", async () => {
  const s = setup(); s.rpc.mockResolvedValue({ data: { recordingId: recording, deletedCount: 0 } });
  expect((await removeTask()).status).toBe(409);
});
it("rejects an unavailable or revoked task without enumeration", async () => {
  const s = setup(null); expect((await removeTask()).status).toBe(403); expect(s.rpc).not.toHaveBeenCalled();
});
it("preserves a different logical sibling while deleting all matching projections", async () => {
  const s = setup(task, [task, { ...task, id: second, title: "Jiný úkol" }]);
  s.rpc.mockResolvedValue({ data: { recordingId: recording, deletedCount: 1 } });
  expect((await removeTask()).status).toBe(200);
  expect(s.rpc).toHaveBeenCalledWith("delete_managed_transcript_task_group_v1", expect.objectContaining({ p_task_ids: [id] }));
  expect(s.query.eq).toHaveBeenCalledWith("transcripts.recording_id", recording);
});
it("fails closed rather than partially deleting a logical group above the RPC bound", async () => {
  const s = setup();
  const rows = [task, ...Array.from({ length: 1000 }, (_, i) => ({ ...task, id: `extra-${i}` }))];
  s.query.range.mockResolvedValueOnce({ data: rows.slice(0, 1000) }).mockResolvedValueOnce({ data: rows.slice(1000) });
  expect((await removeTask()).status).toBe(409); expect(s.rpc).not.toHaveBeenCalled();
});
it.each([["42501", 403], ["40001", 409], ["55000", 409], ["XX000", 500]])("maps task error %s without leaking detail", async (code, status) => {
  const s = setup(); s.rpc.mockResolvedValue({ error: { code, message: "secret lineage" } });
  const response = await removeTask(); expect(response.status).toBe(status); expect(await response.text()).not.toContain("secret lineage");
});
it("deletes exact saved output via session RPC and matched result", async () => {
  const s = setup({ id, transcript_id: id }); s.rpc.mockResolvedValue({ data: { recordingId: recording, deletedId: id } });
  const form = new FormData(); form.set("outputIds", id); form.set("next", "/ai?type=summary");
  await expect(deleteAiOutputAction(form)).rejects.toThrow("REDIRECT:/ai?type=summary");
  expect(s.rpc).toHaveBeenCalledWith("delete_managed_ai_output_v1", { p_output_id: id }); expect(m.admin).not.toHaveBeenCalled();
});
it("denies editor output deletion and preserves archive return state", async () => {
  const s = setup({ id, transcript_id: id }); m.caps.mockResolvedValue({ delete: false });
  const form = new FormData(); form.set("outputIds", id); form.set("next", "/ai?type=summary");
  await expect(deleteAiOutputAction(form)).rejects.toThrow("REDIRECT:/ai?type=summary&error=ai_output_delete_failed");
  expect(s.rpc).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
});
