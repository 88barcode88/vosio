import { describe, expect, it, vi } from "vitest";
import { NO_RECORDING_CAPABILITIES, resolveRecordingCapabilities, resolveRecordingCapabilitiesBatch } from "@/lib/recording-sharing/resolve-capabilities";
import { listAiArchiveItems } from "@/lib/ai/queries";

const manager = { ...NO_RECORDING_CAPABILITIES, read: true, delete: true, manageAccess: true };

describe("resolveRecordingCapabilitiesBatch", () => {
  it("resolves many recordings with a single RPC and fails closed for absent rows", async () => {
    const rpc = vi.fn(async (_name: string, args: { p_recording_ids: string[] }) => ({
      data: [{ recording_id: args.p_recording_ids[0], capabilities: manager }], error: null
    }));
    const result = await resolveRecordingCapabilitiesBatch({ rpc } as never, ["a", "b", "a", "c"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("recording_capabilities_batch_v1", { p_recording_ids: ["a", "b", "c"] });
    expect(result.get("a")).toEqual(manager);
    expect(result.get("b")).toEqual(NO_RECORDING_CAPABILITIES);
    expect(result.get("c")).toEqual(NO_RECORDING_CAPABILITIES);
    expect([...result.keys()]).toEqual(["a", "b", "c"]);
  });

  it("matches the single-recording resolver for the same RPC payload", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === "recording_capabilities_batch_v1" ? [{ recording_id: "a", capabilities: manager }] : manager, error: null
    }));
    expect((await resolveRecordingCapabilitiesBatch({ rpc } as never, ["a"])).get("a"))
      .toEqual(await resolveRecordingCapabilities({ rpc } as never, "a"));
  });

  it("ignores malformed, unrequested and non-readable rows", async () => {
    const rpc = vi.fn(async () => ({ data: [
      { recording_id: "a", capabilities: { ...manager, delete: "yes" } },
      { recording_id: "x", capabilities: manager },
      { recording_id: "b", capabilities: { ...manager, read: false } },
      null
    ], error: null }));
    const result = await resolveRecordingCapabilitiesBatch({ rpc } as never, ["a", "b"]);
    expect(result.get("a")).toEqual(NO_RECORDING_CAPABILITIES);
    expect(result.get("b")).toEqual(NO_RECORDING_CAPABILITIES);
    expect(result.has("x")).toBe(false);
  });

  it("grants nothing when the RPC errors, throws or returns a non-array", async () => {
    for (const rpc of [
      vi.fn(async () => ({ data: null, error: { message: "boom" } })),
      vi.fn(async () => { throw new Error("network"); }),
      vi.fn(async () => ({ data: manager, error: null }))
    ]) {
      const result = await resolveRecordingCapabilitiesBatch({ rpc } as never, ["a"]);
      expect(result.get("a")).toEqual(NO_RECORDING_CAPABILITIES);
    }
  });

  it("splits more than 1000 ids into chunks and makes no call for an empty list", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const ids = Array.from({ length: 1001 }, (_, i) => `r-${i}`);
    await resolveRecordingCapabilitiesBatch({ rpc } as never, ids);
    expect(rpc.mock.calls.map((call) => (call as unknown as [string, { p_recording_ids: string[] }])[1].p_recording_ids.length)).toEqual([1000, 1]);
    rpc.mockClear();
    expect((await resolveRecordingCapabilitiesBatch({ rpc } as never, [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("listAiArchiveItems capability lookup", () => {
  it("asks for capabilities of all archive recordings with one batch RPC", async () => {
    const outputs = ["1", "2", "3"].map((n) => ({
      id: `out-${n}`, created_at: "2026-11-03T00:00:00Z", output_json: null, output_text: "t", processing_job_id: "job", transcript_id: `t-${n}`,
      transcripts: { recording_id: `rec-${n}`, recordings: { id: `rec-${n}`, status: "completed", title: `T${n}` } }
    }));
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order"]) chain[method] = vi.fn(() => chain);
    chain.range = vi.fn(() => chain);
    chain.returns = vi.fn(async () => ({ data: outputs, error: null }));
    const rpc = vi.fn(async (name: string, args: Record<string, string[]>) => ({
      data: name === "recording_capabilities_batch_v1"
        ? args.p_recording_ids.map((id) => ({ recording_id: id, capabilities: manager }))
        : args.p_output_ids.map((id) => ({ output_id: id, processing_type: "summary" })),
      error: null
    }));
    const items = await listAiArchiveItems({ from: vi.fn(() => chain), rpc } as never);
    expect(items.map((item) => item.capabilities)).toEqual([manager, manager, manager]);
    const capabilityCalls = rpc.mock.calls.filter(([name]) => name === "recording_capabilities_batch_v1");
    expect(capabilityCalls).toHaveLength(1);
    expect(rpc.mock.calls.some(([name]) => name === "recording_capabilities_v1")).toBe(false);
  });
});
