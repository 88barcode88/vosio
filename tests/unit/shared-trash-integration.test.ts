import { beforeEach, describe, expect, it, vi } from "vitest";
import { continueManualPurge, mutateManagedRecording } from "@/lib/recordings/trash-service.server";
import { discoverManualPurges, processManualPurge } from "@/lib/recordings/manual-purge-worker.server";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ caps: vi.fn() }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: mocks.caps }));
const id = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const op = "33333333-3333-4333-8333-333333333333";
const token = "44444444-4444-4444-8444-444444444444";
const request = { recordingId: id, requestId: op, expectedUpdatedAt: "2026-09-20T00:00:00Z" };
const claim = { recording_id: id, storage_prefix: `${owner}/${id}/`, claim_id: token };

// Session fake has no table-write or service client escape hatch.
function client(rpc: ReturnType<typeof vi.fn>) { return { rpc } as unknown as SupabaseClient; }
// Worker fake exposes only service RPCs and the recordings bucket.
function workerClient() {
  const rpc = vi.fn(async (name: string) => ({ data: name === "finalize_recording_purge_work_v1" ? true : [claim], error: null }));
  const list = vi.fn().mockResolvedValue({ data: [], error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ list, remove }));
  return { rpc, list, remove, from, client: { rpc, storage: { from } } as unknown as SupabaseClient };
}

beforeEach(() => { vi.clearAllMocks(); mocks.caps.mockResolvedValue({ delete: true, restore: true, purge: true }); });

describe("manager Trash session RPCs", () => {
  it("uses canonical delete authority and matches the locked outcome", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ id, updated_at: request.expectedUpdatedAt }], error: null })
      .mockResolvedValueOnce({ data: { recordingId: id, status: "deleted", changed: true }, error: null });
    await mutateManagedRecording(client(rpc), id, "delete", 168);
    expect(rpc).toHaveBeenLastCalledWith("trash_recording_v1", { p_recording_id: id, p_expected_updated_at: request.expectedUpdatedAt, p_retention_hours: 168 });
  });
  it.each(["delete", "restore"] as const)("rejects editor %s without calling mutation", async (action) => {
    mocks.caps.mockResolvedValue({ delete: false, restore: false });
    const rpc = vi.fn();
    await expect(mutateManagedRecording(client(rpc), id, action)).rejects.toMatchObject({ code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects an empty mutation result", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: [{ id, updated_at: request.expectedUpdatedAt }] }).mockResolvedValueOnce({ data: null });
    await expect(mutateManagedRecording(client(rpc), id, "restore")).rejects.toMatchObject({ code: "internal" });
  });
  it("recovers the same lost prepare response after revoke without a capability gate", async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ data: { operationId: op, phase: "prepared" } })
      .mockResolvedValueOnce({ error: { code: "42501" } });
    await expect(continueManualPurge(client(rpc), request)).rejects.toThrow();
    await expect(continueManualPurge(client(rpc), request)).rejects.toMatchObject({ code: "forbidden" });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(mocks.caps).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(([name]) => name === "release_recording_purge_v1")).toBe(false);
  });
  it("recovers accepted/completed receipts after revoke without restarting", async () => {
    for (const phase of ["started", "completed"]) {
      const rpc = vi.fn().mockResolvedValue({ data: { operationId: op, phase } });
      expect(await continueManualPurge(client(rpc), request)).toEqual({ operationId: op, phase });
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("releases only an explicitly recovered prepared receipt", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { operationId: op, phase: "released", changed: true } });
    await continueManualPurge(client(rpc), request, true);
    expect(rpc).toHaveBeenLastCalledWith("release_recording_purge_request_v1", { p_recording_id: id, p_request_id: op });
  });
  it("recovers a lost release response without preparing or starting new work", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { operationId: op, phase: "released" } });
    expect(await continueManualPurge(client(rpc), request, true)).toEqual({ operationId: op, phase: "released" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("cancels a proven absent receipt after a stale first prepare without refreshing the stale version", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "40001" } })
      .mockResolvedValueOnce({ data: { operationId: op, phase: "released" }, error: null });
    await expect(continueManualPurge(client(rpc), request)).rejects.toMatchObject({ code: "conflict" });
    expect(await continueManualPurge(client(rpc), request, true)).toEqual({ operationId: op, phase: "released" });
    expect(rpc.mock.calls[1]).toEqual(["release_recording_purge_request_v1", { p_recording_id: id, p_request_id: op }]);
  });
  it("never treats an uncertain cancellation as released", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("unknown"));
    await expect(continueManualPurge(client(rpc), request, true)).rejects.toThrow("unknown");
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe("durable manual purge worker", () => {
  it("discovers started work after crash before app receipt persistence", async () => {
    const w = workerClient();
    w.rpc.mockImplementation(async (name) => ({ data: name === "claim_started_recording_purge_work_v1" ? [{ ...claim, operation_id: op }] : name === "finalize_recording_purge_work_v1" ? true : [claim], error: null }));
    expect(await discoverManualPurges(w.client)).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(w.rpc).toHaveBeenCalledWith("claim_started_recording_purge_work_v1", { p_limit: 5 });
    expect(w.rpc).toHaveBeenCalledWith("acquire_recording_purge_work_v1", { p_operation_id: op, p_claim_id: token });
  });
  it("does nothing for exhausted or fresh leased work excluded by discovery", async () => {
    const w = workerClient(); w.rpc.mockResolvedValue({ data: [], error: null });
    expect(await discoverManualPurges(w.client)).toEqual({ claimed: 0, completed: 0, failed: 0 });
    expect(w.from).not.toHaveBeenCalled();
  });
  it("fences a stale token before Storage removal and never releases started work", async () => {
    const w = workerClient(); w.list.mockResolvedValue({ data: [{ id: "object", name: "audio.webm" }], error: null });
    w.rpc.mockResolvedValueOnce({ data: [claim], error: null }).mockResolvedValueOnce({ data: [claim], error: null }).mockResolvedValueOnce({ data: null, error: { code: "55000" } } as never);
    await expect(processManualPurge(w.client, op)).rejects.toThrow();
    expect(w.remove).not.toHaveBeenCalled();
    expect(w.rpc.mock.calls.some(([name]) => name.includes("release") || name.includes("finalize"))).toBe(false);
  });
  it("cleans bounded batches and re-lists the full prefix before exact finalize", async () => {
    const w = workerClient();
    w.list.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `chunk-${i}` })), error: null })
      .mockResolvedValueOnce({ data: [{ id: "last", name: "last" }], error: null }).mockResolvedValue({ data: [], error: null });
    expect(await processManualPurge(w.client, op)).toBe(true);
    expect(w.remove.mock.calls.map(([batch]) => batch.length)).toEqual([100, 1]);
    expect(w.rpc).toHaveBeenLastCalledWith("finalize_recording_purge_work_v1", { p_operation_id: op, p_claim_id: token });
    expect(w.from).toHaveBeenCalledWith("recordings");
  });
  it("rejects unsafe folder names before recursive traversal", async () => {
    const w = workerClient(); w.list.mockResolvedValue({ data: [{ id: null, name: "../foreign" }], error: null });
    await expect(processManualPurge(w.client, op)).rejects.toThrow();
    expect(w.list).toHaveBeenCalledTimes(1); expect(w.remove).not.toHaveBeenCalled();
  });
  it.each(["list", "remove", "finalize"])("retains started work after %s failure", async (failure) => {
    const w = workerClient();
    if (failure === "list") w.list.mockResolvedValue({ data: null, error: { message: "private detail" } });
    if (failure === "remove") {
      w.list.mockResolvedValue({ data: [{ id: "object", name: "audio" }], error: null });
      w.remove.mockResolvedValue({ error: { message: "partial removal" } });
    }
    if (failure === "finalize") w.rpc.mockImplementation(async (name) => ({ data: name === "finalize_recording_purge_work_v1" ? false : [claim], error: null }));
    await expect(processManualPurge(w.client, op)).rejects.toThrow();
    expect(w.rpc.mock.calls.some(([name]) => name.includes("release"))).toBe(false);
  });
  it("checks the same token before every batch and stops a later batch after rotation", async () => {
    const w = workerClient();
    w.list.mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `chunk-${i}` })), error: null })
      .mockResolvedValueOnce({ data: [{ id: "late", name: "late" }], error: null });
    w.rpc.mockResolvedValueOnce({ data: [claim], error: null }).mockResolvedValueOnce({ data: [claim], error: null })
      .mockResolvedValueOnce({ data: [claim], error: null }).mockResolvedValueOnce({ data: [{ ...claim, claim_id: op }], error: null });
    await expect(processManualPurge(w.client, op)).rejects.toThrow();
    expect(w.remove).toHaveBeenCalledTimes(1);
    expect(w.rpc.mock.calls.some(([name]) => name.includes("finalize"))).toBe(false);
  });
  it("bounds late-upload cleanup and does not finalize a nonempty prefix", async () => {
    const w = workerClient(); w.list.mockResolvedValue({ data: [{ id: "late", name: "late" }], error: null });
    await expect(processManualPurge(w.client, op)).rejects.toThrow("Purge prefix not empty");
    expect(w.remove).toHaveBeenCalledTimes(3);
    expect(w.rpc.mock.calls.some(([name]) => name.includes("finalize") || name.includes("release"))).toBe(false);
  });
  it("rejects a wrong canonical prefix before touching Storage", async () => {
    const w = workerClient(); w.rpc.mockResolvedValue({ data: [{ ...claim, storage_prefix: `${owner}/${op}/` }], error: null });
    await expect(processManualPurge(w.client, op)).rejects.toThrow(); expect(w.from).not.toHaveBeenCalled();
  });
  it("walks safe nested folders and re-lists the whole recording root", async () => {
    const w = workerClient(); w.list.mockResolvedValueOnce({ data: [{ id: null, name: "live" }], error: null })
      .mockResolvedValueOnce({ data: [{ id: "object", name: "chunk" }], error: null }).mockResolvedValue({ data: [], error: null });
    await processManualPurge(w.client, op);
    expect(w.remove).toHaveBeenCalledWith([`${claim.storage_prefix}live/chunk`]);
    expect(w.list.mock.calls.map(([path]) => path)).toEqual([claim.storage_prefix.slice(0, -1), `${claim.storage_prefix}live`, claim.storage_prefix.slice(0, -1)]);
  });
});
