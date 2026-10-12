import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTranscriptionWork } from "@/lib/recordings/transcription-worker.server";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), poll: vi.fn() }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ sonioxAsyncModel: "stt-async-v5" }) }));
vi.mock("@/lib/soniox/client", () => ({
  createSonioxTranscription: mocks.submit, getSonioxTranscription: mocks.poll, getSonioxTranscript: vi.fn()
}));
const operation = "00000000-0000-4000-8000-000000000601";
const job = "00000000-0000-4000-8000-000000000602";
const claim = "00000000-0000-4000-8000-000000000603";
const base = { operation_id: operation, job_id: job, claim_id: claim, client_reference_id: job,
  model: "stt-async-v5", region: "eu", manifest: null };
beforeEach(() => vi.clearAllMocks());
describe("durable transcription provider failures", () => {
  it.each([401, 403, 400, 429])("settles definite HTTP %s rejection without uncertainty or another POST", async (status) => {
    mocks.submit.mockRejectedValue(Object.assign(new Error("private provider diagnostic"), { name: "SonioxRequestError", status }));
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const admin = { rpc, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://fixture.invalid" }, error: null }) }) } };
    expect(await executeTranscriptionWork(admin as never, { ...base, work_kind: "submit", storage_path: "exact-object", provider_job_id: null })).toBe("failed");
    expect(rpc).toHaveBeenLastCalledWith("fail_recording_submission_v1", { p_operation_id: operation, p_job_id: job, p_claim_id: claim,
      p_error_code: status === 401 || status === 403 ? "provider_authentication" : status === 429 ? "rate_limited" : "submission_rejected" });
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("private provider diagnostic");
  });
  it("fails before POST when signing the audio fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const admin = { rpc, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "private storage error" } }) }) } };
    expect(await executeTranscriptionWork(admin as never, { ...base, work_kind: "submit", storage_path: "exact-object", provider_job_id: null })).toBe("failed");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fail_recording_submission_v1", { p_operation_id: operation, p_job_id: job, p_claim_id: claim, p_error_code: "audio_unavailable" });
  });
  it("never persists raw submission diagnostics or retries an uncertain provider POST", async () => {
    mocks.submit.mockRejectedValue(new Error("sk-secret https://storage.invalid/?token=secret"));
    const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: true, error: null }));
    const from = vi.fn();
    const admin = { rpc, from, storage: { from: () => ({ createSignedUrl: async () =>
      ({ data: { signedUrl: "https://fixture.invalid" }, error: null }) }) } };
    expect(await executeTranscriptionWork(admin as never, { ...base, work_kind: "submit",
      storage_path: "exact-object", provider_job_id: null })).toBe("manual_required");
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenLastCalledWith("mark_recording_submission_uncertain_v1",
      { p_operation_id: operation, p_job_id: job, p_claim_id: claim });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("secret");
    expect(from).not.toHaveBeenCalled();
  });
  it("settles only the exact accepted job when the provider confirms terminal failure", async () => {
    mocks.poll.mockResolvedValue({ id: "accepted-id", status: "error", error_message: "secret provider detail" });
    const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: true, error: null }));
    const from = vi.fn();
    expect(await executeTranscriptionWork({ rpc, from } as never, { ...base, work_kind: "poll",
      storage_path: null, provider_job_id: "accepted-id" })).toBe("failed");
    expect(rpc).toHaveBeenLastCalledWith("settle_recording_provider_job_v1", {
      p_operation_id: operation, p_job_id: job, p_claim_id: claim, p_status: "failed", p_audio_duration_ms: null
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("secret");
    expect(from).not.toHaveBeenCalled();
  });
  it("does not falsely settle a transient observation failure or mismatched provider identity", async () => {
    const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: true, error: null }));
    mocks.poll.mockRejectedValueOnce(new Error("temporary connection"));
    const work = { ...base, work_kind: "poll", storage_path: null, provider_job_id: "accepted-id" };
    await expect(executeTranscriptionWork({ rpc } as never, work)).rejects.toThrow();
    mocks.poll.mockResolvedValueOnce({ id: "foreign-id", status: "completed" });
    await expect(executeTranscriptionWork({ rpc } as never, work)).rejects.toThrow("Provider observation mismatch");
    expect(rpc.mock.calls.every(([name]) => name === "refresh_recording_transcription_claim_v1")).toBe(true);
  });
});
