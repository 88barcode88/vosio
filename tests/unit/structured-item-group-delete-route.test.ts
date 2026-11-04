import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE as deleteDecision } from "../../app/api/transcript-decisions/[decisionId]/route";
import { DELETE as deleteRisk } from "../../app/api/transcript-risks/[riskId]/route";

const m = vi.hoisted(() => ({ client: vi.fn(), caps: vi.fn(), admin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: m.caps }));

const id = "11111111-1111-4111-8111-111111111111";
const recording = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";
const decision = { id, transcript_id: id, updated_at: "2026-11-04T00:00:00Z", title: "Potvrdit rozsah", status: "needs_confirmation", owner_category: null };
const risk = { id, transcript_id: id, updated_at: "2026-11-04T00:00:00Z", title: "Dropbox brzdí", impact: null };

// Session-only query double supplies the exact target and a paginated logical-group snapshot.
function setup(target: unknown, candidates: unknown[]) {
  const rpc = vi.fn().mockResolvedValue({ data: { recordingId: recording, deletedCount: 2 } });
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValueOnce({ data: candidates.slice(0, 1000) }).mockResolvedValueOnce({ data: candidates.slice(1000) }).mockResolvedValue({ data: [] }),
    maybeSingle: vi.fn().mockResolvedValueOnce({ data: target }).mockResolvedValueOnce({ data: { recording_id: recording } })
  };
  const from = vi.fn(() => query);
  m.client.mockResolvedValue({ from, rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id } } }) } });
  return { from, query, rpc };
}

// Calls the actual decision DELETE route handler.
function removeDecision(decisionId = id) {
  return deleteDecision(new NextRequest("http://localhost/d", { method: "DELETE" }), { params: Promise.resolve({ decisionId }) });
}

// Calls the actual risk DELETE route handler.
function removeRisk(riskId = id) {
  return deleteRisk(new NextRequest("http://localhost/r", { method: "DELETE" }), { params: Promise.resolve({ riskId }) });
}

beforeEach(() => { vi.clearAllMocks(); m.caps.mockResolvedValue({ delete: true }); });

it("atomically deletes the matched logical decision group through the session RPC", async () => {
  const s = setup(decision, [decision, { ...decision, id: second, title: " POTVRDIT  rozsah " }]);
  const response = await removeDecision();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: 2, ids: [id, second], ok: true });
  expect(s.from).toHaveBeenCalledWith("transcript_decisions");
  expect(s.rpc).toHaveBeenCalledWith("delete_managed_transcript_decision_group_v1", {
    p_decision_id: id, p_decision_ids: [id, second], p_expected_updated_at: decision.updated_at
  });
  expect(s.query.eq).toHaveBeenCalledWith("transcripts.recording_id", recording);
  expect(m.admin).not.toHaveBeenCalled();
});

it("keeps a decision with a different status out of the deleted group", async () => {
  const s = setup(decision, [decision, { ...decision, id: second, status: "decided" }]);
  s.rpc.mockResolvedValue({ data: { recordingId: recording, deletedCount: 1 } });
  expect((await removeDecision()).status).toBe(200);
  expect(s.rpc).toHaveBeenCalledWith("delete_managed_transcript_decision_group_v1", expect.objectContaining({ p_decision_ids: [id] }));
});

it("atomically deletes the matched logical risk group through the session RPC", async () => {
  const s = setup(risk, [risk, { ...risk, id: second }]);
  expect((await removeRisk()).status).toBe(200);
  expect(s.from).toHaveBeenCalledWith("transcript_risks");
  expect(s.rpc).toHaveBeenCalledWith("delete_managed_transcript_risk_group_v1", {
    p_expected_updated_at: risk.updated_at, p_risk_id: id, p_risk_ids: [id, second]
  });
});

it("rejects an invalid id before touching the database", async () => {
  expect((await removeRisk("not-a-uuid")).status).toBe(400);
  expect(m.client).not.toHaveBeenCalled();
});

it("denies deletion on the server without the delete capability", async () => {
  const s = setup(risk, [risk]); m.caps.mockResolvedValue({ delete: false });
  expect((await removeRisk()).status).toBe(403);
  expect(s.rpc).not.toHaveBeenCalled();
});

it("rejects an unavailable item without enumeration", async () => {
  const s = setup(null, []);
  expect((await removeDecision()).status).toBe(403);
  expect(s.rpc).not.toHaveBeenCalled();
});

it("does not report success when the RPC deleted a different number of rows", async () => {
  const s = setup(risk, [risk, { ...risk, id: second }]);
  s.rpc.mockResolvedValue({ data: { recordingId: recording, deletedCount: 1 } });
  expect((await removeRisk()).status).toBe(409);
});

it("fails closed above the RPC group bound", async () => {
  const rows = [decision, ...Array.from({ length: 1000 }, (_, i) => ({ ...decision, id: `extra-${i}` }))];
  const s = setup(decision, rows);
  expect((await removeDecision()).status).toBe(409);
  expect(s.rpc).not.toHaveBeenCalled();
});

it.each([["42501", 403], ["40001", 409], ["22023", 400], ["XX000", 500]])("maps RPC error %s without leaking detail", async (code, status) => {
  const s = setup(decision, [decision]);
  s.rpc.mockResolvedValue({ error: { code, message: "secret lineage" } });
  const response = await removeDecision();
  expect(response.status).toBe(status);
  expect(await response.text()).not.toContain("secret lineage");
});
