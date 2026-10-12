import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTranscriptionWork } from "@/lib/recordings/transcription-worker.server";
const m = vi.hoisted(() => ({ submit: vi.fn(), poll: vi.fn(), text: vi.fn() }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ sonioxAsyncModel: "stt-async-v5" }) }));
vi.mock("@/lib/soniox/client", () => ({ createSonioxTranscription: m.submit, getSonioxTranscription: m.poll, getSonioxTranscript: m.text }));
const operation = "00000000-0000-4000-8000-000000000001";
const job = "00000000-0000-4000-8000-000000000002";
const claim = "00000000-0000-4000-8000-000000000003";
const base = { operation_id: operation, job_id: job, claim_id: claim, client_reference_id: job, model: "stt-async-v5", manifest: null };
beforeEach(() => { vi.clearAllMocks(); m.submit.mockResolvedValue({ id: "exact-provider", status: "queued" }); });
describe("frozen worker region and attribution", () => {
  it.each(["eu", "global"] as const)("submits the accepted %s configuration independent of UI membership", async (region) => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const signed = vi.fn().mockResolvedValue({ data: { signedUrl: "https://fixture.invalid/exact" }, error: null });
    await executeTranscriptionWork({ rpc, storage: { from: () => ({ createSignedUrl: signed }) } } as never, { ...base, region, work_kind: "submit", storage_path: "exact/path", provider_job_id: null });
    expect(m.submit).toHaveBeenCalledOnce();
    expect(m.submit).toHaveBeenCalledWith(expect.objectContaining({ region, clientReferenceId: job }));
    expect(rpc).toHaveBeenLastCalledWith("accept_recording_provider_job_v1", { p_operation_id: operation, p_job_id: job, p_claim_id: claim, p_provider_job_id: "exact-provider" });
  });
  it("marks ambiguous submit uncertain once, never repeats POST", async () => {
    m.submit.mockRejectedValue(new Error("timeout"));
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await executeTranscriptionWork({ rpc, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://fixture.invalid" }, error: null }) }) } } as never, { ...base, region: "eu", work_kind: "submit", storage_path: "exact/path", provider_job_id: null })).toBe("manual_required");
    expect(m.submit).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenLastCalledWith("mark_recording_submission_uncertain_v1", { p_operation_id: operation, p_job_id: job, p_claim_id: claim });
  });
  it("polls the exact stored provider identity and consumes its claim", async () => {
    m.poll.mockResolvedValue({ id: "exact-provider", status: "processing" });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await executeTranscriptionWork({ rpc } as never, { ...base, region: "eu", work_kind: "poll", storage_path: null, provider_job_id: "exact-provider" });
    expect(m.poll).toHaveBeenCalledWith("eu", "exact-provider");
    expect(rpc).toHaveBeenLastCalledWith("settle_recording_provider_job_v1", expect.objectContaining({ p_claim_id: claim, p_status: "running" }));
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("does not settle mismatched provider observations", async () => {
    m.poll.mockResolvedValue({ id: "foreign", status: "completed" });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(executeTranscriptionWork({ rpc } as never, { ...base, region: "eu", work_kind: "poll", storage_path: null, provider_job_id: "exact-provider" })).rejects.toThrow("mismatch");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
