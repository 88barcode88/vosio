import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, DELETE } from "../../app/api/transcripts/[transcriptId]/checklist/route";
import { checklistSnapshotSchema } from "@/lib/ai/checklist-delete";
import { readFileSync } from "node:fs";

const m = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const snapshot = { transcriptId: id, generation: "capture:test-generation", transcriptVersion: "100", outputs: [{ id, version: "101" }], tasks: [
  { id, version: "102", updatedAt: "2026-10-03T00:00:00+00:00", status: "new" },
  { id: second, version: "103", updatedAt: "2026-10-03T00:00:00+00:00", status: "done" }
] };
const task = { title: "Poslat podklady", owner_category: "Moje práce", deadline: null, deadline_normalized: null };
const context = { params: Promise.resolve({ transcriptId: id }) };
// Sends the actual endpoint an explicit reviewed snapshot.
function remove(body: unknown = { snapshot }) {
  return DELETE(new NextRequest("http://localhost/checklist", { method: "DELETE", body: JSON.stringify(body) }), context);
}
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ data: { user: { id } } });
  m.client.mockResolvedValue({ auth: { getUser: m.auth }, rpc: m.rpc });
  m.rpc.mockResolvedValue({ data: { snapshot, logicalTasks: [task, { ...task, title: " POSLAT PODKLADY " }] } });
});
it("reviews the complete RPC snapshot using the same logical dedupe rule as the workspace", async () => {
  const response = await GET(new NextRequest("http://localhost/checklist"), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ snapshot, rowCount: 2, logicalCount: 1 });
  expect(m.rpc).toHaveBeenCalledWith("get_managed_transcript_checklist_v1", { p_transcript_id: id });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("preserves separate owner groups in the confirmation count", async () => {
  m.rpc.mockResolvedValue({ data: { snapshot, logicalTasks: [task, { ...task, owner_category: "Klient" }] } });
  expect((await (await GET(new NextRequest("http://localhost/checklist"), context)).json()).logicalCount).toBe(2);
});
it("deletes once through the authenticated RPC and returns exact tombstone IDs", async () => {
  m.rpc.mockResolvedValue({ data: { transcriptId: id, deletedIds: [second, id], deletedCount: 2 } });
  expect(await (await remove()).json()).toEqual({ ok: true, transcriptId: id, deletedIds: [second, id], suppressionIds: [id], deletedCount: 2 });
  expect(m.rpc).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith("delete_managed_transcript_checklist_v1", { p_transcript_id: id, p_snapshot: snapshot });
});
it.each(["editor", "reader", "revoked", "missing", "mixedscope"])("fails closed on the DB authority rejection for %s", async () => {
  m.rpc.mockResolvedValue({ error: { code: "42501", message: "private data" } });
  const response = await remove(); expect(response.status).toBe(403); expect(await response.text()).not.toContain("private data");
});
it.each(["stale version", "new task", "new output", "new generation", "status change"])("requires a fresh confirmation on %s", async () => {
  m.rpc.mockResolvedValue({ error: { code: "40001" } });
  expect((await remove()).status).toBe(409);
});
it("rejects oversized and duplicate raw ID snapshots before RPC", async () => {
  expect((await remove({ snapshot: { ...snapshot, tasks: Array(1001).fill(snapshot.tasks[0]) } })).status).toBe(400);
  expect((await remove({ snapshot: { ...snapshot, tasks: [snapshot.tasks[0], snapshot.tasks[0]] } })).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects wrong transcript and unreviewed extra fields", async () => {
  expect((await remove({ snapshot: { ...snapshot, transcriptId: second } })).status).toBe(400);
  expect((await remove({ snapshot, taskIds: [id] })).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("accepts a complete empty projection without deleting the source output", async () => {
  const empty = { ...snapshot, tasks: [] };
  m.rpc.mockResolvedValue({ data: { transcriptId: id, deletedIds: [], deletedCount: 0 } });
  expect((await remove({ snapshot: empty })).status).toBe(200);
});
it("never claims success for a partial or mismatched receipt", async () => {
  m.rpc.mockResolvedValue({ data: { transcriptId: id, deletedIds: [id], deletedCount: 1 } });
  expect((await remove()).status).toBe(409);
});
it("rejects unauthenticated requests and unavailable RPCs safely", async () => {
  m.auth.mockResolvedValue({ data: { user: null } });
  expect((await remove()).status).toBe(401); expect(m.rpc).not.toHaveBeenCalled();
  m.auth.mockResolvedValue({ data: { user: { id } } }); m.rpc.mockResolvedValue({ error: { code: "PGRST202" } });
  expect((await remove()).status).toBe(500);
});
it("uses an immutable bounded snapshot contract", () => {
  expect(checklistSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(checklistSnapshotSchema.safeParse({ ...snapshot, transcriptVersion: "not-a-version" }).success).toBe(false);
});
it("source contract fences phantoms, compares whole snapshot, and deletes tasks only", () => {
  const sql = readFileSync("supabase/migrations/20261003010000_add_atomic_checklist_delete.sql", "utf8");
  expect(sql).toContain("perform public.recording_sharing_lock_v1()");
  expect(sql).toContain("lock_managed_trash_recording_v1(v_recording_id)");
  expect(sql).toContain("order by o.id for update"); expect(sql).toContain("order by x.id for update");
  expect(sql).toContain("v_current is distinct from p_snapshot");
  expect(sql).toContain("before insert or update of transcript_id,processing_job_id,user_id on public.ai_outputs");
  expect(sql).toContain("before insert or update of transcript_id,ai_output_id,processing_job_id,user_id on public.transcript_tasks");
  expect(sql).toContain("transcript_checklist_suppressions");
  expect(sql.match(/delete from public\.\w+/g)).toEqual(["delete from public.transcript_tasks"]);
  expect(sql).toContain("to authenticated");
});
it("fences privileged source-key retargets without intercepting status-only updates", () => {
  const sql = readFileSync("supabase/migrations/20261003010000_add_atomic_checklist_delete.sql", "utf8");
  const triggers = sql.match(/create trigger[^;]+;/g) ?? [];
  expect(triggers).toHaveLength(2);
  expect(triggers.every((trigger) => !trigger.includes("status"))).toBe(true);
  expect(sql).toContain("if tg_op='UPDATE' then raise exception 'checklist source suppressed' using errcode='40001'");
  expect(sql).toContain("j.transcript_id=new.transcript_id and j.user_id=new.user_id");
  expect(sql).toContain("o.transcript_id=new.transcript_id and o.user_id=new.user_id and o.processing_job_id=new.processing_job_id");
});
