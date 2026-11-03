import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, DELETE } from "../../app/api/transcripts/[transcriptId]/checklist/route";
import { checklistSnapshotSchema, formatChecklistCounts } from "@/lib/ai/checklist-delete";
import { readFileSync } from "node:fs";

const m = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const decisionId = "33333333-3333-4333-8333-333333333333";
const riskId = "44444444-4444-4444-8444-444444444444";
const snapshot = { transcriptId: id, generation: "capture:test-generation", transcriptVersion: "100", outputs: [{ id, version: "101" }], tasks: [
  { id, version: "102", updatedAt: "2026-10-03T00:00:00+00:00", status: "new" },
  { id: second, version: "103", updatedAt: "2026-10-03T00:00:00+00:00", status: "done" }
], decisions: [{ id: decisionId, version: "104" }], risks: [{ id: riskId, version: "105" }] };
const task = { title: "Poslat podklady", owner_category: "Moje práce", deadline: null, deadline_normalized: null };
const decision = { title: "Schváleno", status: "done", owner_category: "Klient" };
const risk = { title: "Zpoždění", impact: "Vysoký" };
const logicalRows = { logicalTasks: [task, { ...task, title: " POSLAT PODKLADY " }], logicalDecisions: [decision], logicalRisks: [risk] };
const context = { params: Promise.resolve({ transcriptId: id }) };
const fullReceipt = { transcriptId: id, tasks: [second, id], decisions: [decisionId], risks: [riskId], deletedCount: 4 };
// Sends the actual endpoint an explicit reviewed snapshot.
function remove(body: unknown = { snapshot }) {
  return DELETE(new NextRequest("http://localhost/checklist", { method: "DELETE", body: JSON.stringify(body) }), context);
}
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ data: { user: { id } } });
  m.client.mockResolvedValue({ auth: { getUser: m.auth }, rpc: m.rpc });
  m.rpc.mockResolvedValue({ data: { snapshot, ...logicalRows } });
});
it("reviews the complete RPC snapshot using the same logical dedupe rules as the workspace", async () => {
  const response = await GET(new NextRequest("http://localhost/checklist"), context);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ snapshot, rowCount: 4, logicalCounts: { tasks: 1, decisions: 1, risks: 1 } });
  expect(JSON.stringify(body)).not.toContain("Poslat podklady");
  expect(m.rpc).toHaveBeenCalledWith("get_managed_transcript_checklist_v2", { p_transcript_id: id });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("preserves separate owner groups in the confirmation count", async () => {
  m.rpc.mockResolvedValue({ data: { snapshot, ...logicalRows, logicalTasks: [task, { ...task, owner_category: "Klient" }] } });
  expect((await (await GET(new NextRequest("http://localhost/checklist"), context)).json()).logicalCounts.tasks).toBe(2);
});
it("refuses a review whose logical rows do not match the snapshot sets", async () => {
  m.rpc.mockResolvedValue({ data: { snapshot, ...logicalRows, logicalRisks: [] } });
  expect((await GET(new NextRequest("http://localhost/checklist"), context)).status).toBe(500);
});
it("formats Czech counts with correct plurals and only non-zero kinds", () => {
  expect(formatChecklistCounts({ tasks: 12, decisions: 3, risks: 2 })).toBe("12 úkolů, 3 rozhodnutí a 2 blokery");
  expect(formatChecklistCounts({ tasks: 1, decisions: 0, risks: 5 })).toBe("1 úkol a 5 blokerů");
  expect(formatChecklistCounts({ tasks: 3, decisions: 0, risks: 0 })).toBe("3 úkoly");
  expect(formatChecklistCounts({ tasks: 0, decisions: 1, risks: 1 })).toBe("1 rozhodnutí a 1 bloker");
});
it("deletes once through the authenticated RPC and returns exact tombstone IDs for every kind", async () => {
  m.rpc.mockResolvedValue({ data: fullReceipt });
  expect(await (await remove()).json()).toEqual({ ok: true, transcriptId: id, deletedIds: [id, second, decisionId, riskId],
    deletedCounts: { tasks: 2, decisions: 1, risks: 1 }, suppressionIds: [id], deletedCount: 4 });
  expect(m.rpc).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith("delete_managed_transcript_checklist_v2", { p_transcript_id: id, p_snapshot: snapshot });
});
it.each(["editor", "reader", "revoked", "missing", "mixedscope"])("fails closed on the DB authority rejection for %s", async () => {
  m.rpc.mockResolvedValue({ error: { code: "42501", message: "private data" } });
  const response = await remove(); expect(response.status).toBe(403); expect(await response.text()).not.toContain("private data");
});
it.each(["stale version", "new task", "new decision", "new risk", "new output", "new generation", "status change"])("requires a fresh confirmation on %s", async () => {
  m.rpc.mockResolvedValue({ error: { code: "40001" } });
  expect((await remove()).status).toBe(409);
});
it("maps the 1000-row bound refusal to 409", async () => {
  m.rpc.mockResolvedValue({ error: { code: "54000" } });
  expect((await remove()).status).toBe(409);
  expect((await GET(new NextRequest("http://localhost/checklist"), context)).status).toBe(409);
});
it("rejects oversized and duplicate raw ID snapshots before RPC", async () => {
  expect((await remove({ snapshot: { ...snapshot, tasks: Array(1001).fill(snapshot.tasks[0]) } })).status).toBe(400);
  expect((await remove({ snapshot: { ...snapshot, decisions: Array(1001).fill(snapshot.decisions[0]) } })).status).toBe(400);
  expect((await remove({ snapshot: { ...snapshot, tasks: [snapshot.tasks[0], snapshot.tasks[0]] } })).status).toBe(400);
  expect((await remove({ snapshot: { ...snapshot, risks: [snapshot.risks[0], snapshot.risks[0]] } })).status).toBe(400);
  expect((await remove({ snapshot: { transcriptId: id, generation: null, transcriptVersion: "1", outputs: [], tasks: [] } })).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects wrong transcript and unreviewed extra fields", async () => {
  expect((await remove({ snapshot: { ...snapshot, transcriptId: second } })).status).toBe(400);
  expect((await remove({ snapshot, taskIds: [id] })).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("accepts a complete empty projection without deleting the source output", async () => {
  const empty = { ...snapshot, tasks: [], decisions: [], risks: [] };
  m.rpc.mockResolvedValue({ data: { transcriptId: id, tasks: [], decisions: [], risks: [], deletedCount: 0 } });
  expect((await remove({ snapshot: empty })).status).toBe(200);
});
it.each([
  ["partial tasks", { tasks: [id], deletedCount: 3 }],
  ["missing decision", { decisions: [], deletedCount: 3 }],
  ["wrong risk", { risks: [id] }],
  ["wrong count", { deletedCount: 3 }],
  ["legacy v1 receipt", { tasks: undefined, decisions: undefined, risks: undefined, deletedIds: [id, second] }]
])("never claims success for a partial or mismatched receipt (%s)", async (_name, override) => {
  m.rpc.mockResolvedValue({ data: { ...fullReceipt, ...override } });
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
  expect(checklistSnapshotSchema.safeParse({ ...snapshot, decisions: undefined }).success).toBe(false);
});
it("v2 source contract reuses the v1 locked builder and deletes only tasks, decisions and risks", () => {
  const sql = readFileSync("supabase/migrations/20261103140000_checklist_delete_all_items.sql", "utf8");
  expect(sql).toContain("public.managed_transcript_checklist_snapshot_v1(p_transcript_id)");
  expect(sql).toContain("order by x.id for update");
  expect(sql).toContain("v_current is distinct from p_snapshot");
  expect(sql).toContain("transcript_checklist_suppressions");
  expect(sql.match(/delete from public\.\w+/g)).toEqual(["delete from public.transcript_tasks", "delete from public.transcript_decisions", "delete from public.transcript_risks"]);
  expect(sql).toContain("to authenticated");
  expect(sql).not.toMatch(/(drop|alter) function/i);
});
it("v2 fences decision/risk insertion and privileged retargets without intercepting status-only updates", () => {
  const sql = readFileSync("supabase/migrations/20261103140000_checklist_delete_all_items.sql", "utf8");
  const triggers = sql.match(/create trigger[^;]+;/g) ?? [];
  expect(triggers).toHaveLength(2);
  expect(triggers.every((trigger) => !trigger.includes("status"))).toBe(true);
  expect(triggers.some((trigger) => trigger.includes("on public.transcript_decisions"))).toBe(true);
  expect(triggers.some((trigger) => trigger.includes("on public.transcript_risks"))).toBe(true);
  expect(sql).toContain("if tg_op='UPDATE' then raise exception 'checklist source suppressed' using errcode='40001'");
  expect(sql).toContain("o.transcript_id=new.transcript_id and o.user_id=new.user_id and o.processing_job_id=new.processing_job_id");
});
it("keeps the v1 migration untouched for older deployments", () => {
  const sql = readFileSync("supabase/migrations/20261003010000_add_atomic_checklist_delete.sql", "utf8");
  expect(sql).toContain("create function public.delete_managed_transcript_checklist_v1");
  expect(sql.match(/delete from public\.\w+/g)).toEqual(["delete from public.transcript_tasks"]);
});
