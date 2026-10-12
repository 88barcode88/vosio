import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranscriptionWebhook, runTranscriptionOperation, verifyTranscriptionWebhook } from "@/lib/recordings/transcription-dispatch.server";
const m = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ sonioxApiKey: "synthetic-provider-key" }) }));
vi.mock("@/lib/recordings/transcription-worker.server", () => ({ assertTranscriptionModel: () => "stt-async-v5", executeTranscriptionWork: m.execute }));
const op = "00000000-0000-4000-8000-000000000001";
const job = "00000000-0000-4000-8000-000000000002";
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("exact operation dispatch and callback capability", () => {
  it("authenticates the exact operation/job pair without exposing the API key", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vosio.example.invalid/a-path");
    const hook = getTranscriptionWebhook(op, job);
    expect(hook.webhook_url).toBe(`https://vosio.example.invalid/api/jobs/recording-transcription/${op}/${job}`);
    expect(hook.webhook_auth_header_value).not.toContain("synthetic-provider-key");
    expect(verifyTranscriptionWebhook(op, job, hook.webhook_auth_header_value!)).toBe(true);
    expect(verifyTranscriptionWebhook(job, op, hook.webhook_auth_header_value!)).toBe(false);
    expect(verifyTranscriptionWebhook(op, job, "wrong")).toBe(false);
  });
  it.each([undefined, "http://localhost:3047", "https://name:password@vosio.example.invalid"])("does not register an unsafe/local callback (%s)", (url) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", url);
    expect(getTranscriptionWebhook(op, job)).toEqual({});
  });
  it("wakes one unit of only the accepted operation and leaves provider execution to the worker", async () => {
    const work = { operation_id: op, work_kind: "poll" };
    const rpc = vi.fn().mockResolvedValueOnce({ data: { operationId: op, phase: "accepted" } })
      .mockResolvedValueOnce({ data: [work] });
    m.execute.mockResolvedValue("done");
    expect(await runTranscriptionOperation({ rpc } as never, op, 1000, false)).toBe("done");
    expect(rpc).toHaveBeenLastCalledWith("claim_recording_transcription_work_v2", { p_limit: 1, p_operation_id: op });
    expect(m.execute).toHaveBeenCalledExactlyOnceWith({ rpc }, work);
  });
  it.each(["completed", "failed", "manual_required"])("never claims terminal work (%s)", async (phase) => {
    const rpc = vi.fn().mockResolvedValue({ data: { operationId: op, phase } });
    expect(await runTranscriptionOperation({ rpc } as never, op, 1000, false)).toBe(phase);
    expect(rpc).toHaveBeenCalledOnce();expect(m.execute).not.toHaveBeenCalled();
  });
  it("does not execute another operation returned by a corrupted response", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { operationId: op, phase: "started" } }).mockResolvedValueOnce({ data: [{ operation_id: job }] });
    await expect(runTranscriptionOperation({ rpc } as never, op, 1000, false)).rejects.toThrow("mismatch");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("lets the DB continue accepted siblings while fencing an uncertain submission", async () => {
    const work = { operation_id: op, work_kind: "poll", provider_job_id: "known-provider" };
    const rpc = vi.fn().mockResolvedValueOnce({ data: { operationId: op, phase: "uncertain" } }).mockResolvedValueOnce({ data: [work] });
    m.execute.mockResolvedValue("done");
    expect(await runTranscriptionOperation({ rpc } as never, op, 1000, false)).toBe("done");
    expect(m.execute).toHaveBeenCalledExactlyOnceWith({rpc}, work);
  });
  it("stops an uncertain operation once no safe sibling work can be claimed", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { operationId: op, phase: "uncertain", pendingAcceptedWork: false } }).mockResolvedValueOnce({ data: [] });
    expect(await runTranscriptionOperation({rpc} as never, op)).toBe("manual_required");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("waits for a known accepted sibling's poll time rather than acknowledging its callback early", async () => {
    vi.useFakeTimers();
    try {
      const state={operationId:op,phase:"uncertain",pendingAcceptedWork:true};
      const work={operation_id:op,work_kind:"poll",provider_job_id:"safe-sibling"};
      const rpc=vi.fn().mockResolvedValueOnce({data:state}).mockResolvedValueOnce({data:[]})
        .mockResolvedValueOnce({data:state}).mockResolvedValueOnce({data:[work]})
        .mockResolvedValueOnce({data:{...state,pendingAcceptedWork:false}}).mockResolvedValueOnce({data:[]});
      m.execute.mockResolvedValue("done");
      const dispatched=runTranscriptionOperation({rpc} as never,op);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await dispatched).toBe("manual_required");expect(m.execute).toHaveBeenCalledExactlyOnceWith({rpc},work);
    } finally { vi.useRealTimers(); }
  });
  it("drains a known accepted sibling after another submission becomes uncertain during this callback", async () => {
    const submitting={operation_id:op,work_kind:"submit"};
    const polling={operation_id:op,work_kind:"poll",provider_job_id:"accepted-sibling"};
    const rpc=vi.fn().mockResolvedValueOnce({data:{operationId:op,phase:"accepted",pendingAcceptedWork:true}})
      .mockResolvedValueOnce({data:[submitting]})
      .mockResolvedValueOnce({data:{operationId:op,phase:"uncertain",pendingAcceptedWork:true}})
      .mockResolvedValueOnce({data:[polling]})
      .mockResolvedValueOnce({data:{operationId:op,phase:"uncertain",pendingAcceptedWork:false}})
      .mockResolvedValueOnce({data:[]});
    m.execute.mockResolvedValueOnce("manual_required").mockResolvedValueOnce("done");
    expect(await runTranscriptionOperation({rpc} as never,op)).toBe("manual_required");
    expect(m.execute.mock.calls.map(call=>call[1])).toEqual([submitting,polling]);
  });
  it("returns without a waiting loop when another dispatcher owns the claim", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { operationId: op, phase: "started" } }).mockResolvedValueOnce({ data: [] });
    expect(await runTranscriptionOperation({ rpc } as never, op, 1000, false)).toBe("pending");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
