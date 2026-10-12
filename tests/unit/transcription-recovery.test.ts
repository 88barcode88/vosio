import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoverTranscriptionOperation } from "@/lib/recordings/transcription-recovery.server";
import { SonioxRequestError } from "@/lib/soniox/client";

const m = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), remove: vi.fn(), reserve: vi.fn(), resume: vi.fn() }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ supabaseUrl: "https://storage.example" }) }));
vi.mock("@/lib/soniox/client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/soniox/client")>(),
  listSonioxTranscriptions: m.list, getSonioxTranscription: m.get, deleteSonioxTranscription: m.remove }));
const operationId = "00000000-0000-4000-8000-000000000701";
const jobId = "00000000-0000-4000-8000-000000000702";
const claimId = "00000000-0000-4000-8000-000000000703";
const actorId = "00000000-0000-4000-8000-000000000704";
const recordingId = "00000000-0000-4000-8000-000000000705";
const requestId = "00000000-0000-4000-8000-000000000706";
const started = new Date(Date.now() - 3600000).toISOString();
const operation = { id: operationId, recording_id: recordingId, phase: "uncertain", region: "eu", model: "stt-async-v5", created_at: started, started_at: started, finalize_attempt_count: 0 };
const part = { job_id: jobId, position: 0, phase: "uncertain", provider_job_id: null, storage_path: `${actorId}/${recordingId}/audio.webm`,
  claim_id: claimId, submission_claim_id: claimId, claimed_at: started, poll_attempt_count: 0 };
const provider = { id: "original-provider", status: "queued", client_reference_id: jobId, model: "stt-async-v5",
  audio_url: `https://storage.example/storage/v1/object/sign/recordings/${part.storage_path}?token=private`, created_at: started };

// Supply exact DB snapshots without substituting permission checks or real customer content.
function client(work = [part], op = operation) {
  const rpc = vi.fn(async (name: string, _args?: unknown) => ({ data: name === "get_recording_transcription_recovery_v1"
    ? { operation: op, work } : { resolved: true, verified: true }, error: null }));
  const from = vi.fn(() => { throw new Error("Private capture tables deny direct service-role SELECT"); });
  return { from, rpc };
}
// Separate the read-only snapshot from provider settlement assertions.
function mutations(admin: ReturnType<typeof client>) { return admin.rpc.mock.calls.filter(call => call[0] !== "get_recording_transcription_recovery_v1"); }
const input = { recordingId, operationId, actorId, requestId };
// Supply explicit session authorization boundaries to every provider recovery scenario.
const authorized = { reserveStop: m.reserve, resume: m.resume };
beforeEach(() => { vi.resetAllMocks(); m.list.mockResolvedValue({ transcriptions: [], next_page_cursor: null }); m.remove.mockResolvedValue(undefined); m.reserve.mockResolvedValue(undefined); m.resume.mockResolvedValue(undefined); });

describe("original provider recovery without paid submission", () => {
  it("recovers through the private read RPC while direct table access is forbidden", async () => {
    m.list.mockResolvedValue({ transcriptions: [provider], next_page_cursor: null });
    const admin = client();
    await expect(recoverTranscriptionOperation(admin as never, { ...input, action: "resume" }, authorized)).resolves.toEqual({ status: "queued" });
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("get_recording_transcription_recovery_v1", {
      p_operation_id: operationId, p_recording_id: recordingId
    });
  });
  it("reports an unavailable snapshot separately from an actual state conflict", async () => {
    const admin = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } }) };
    await expect(recoverTranscriptionOperation(admin as never, { ...input, action: "resume" }, authorized)).rejects.toMatchObject({ code: "recovery_unavailable" });
    expect(m.list).not.toHaveBeenCalled(); expect(m.reserve).not.toHaveBeenCalled();
  });
  it("rejects a snapshot for a different recording before provider access", async () => {
    await expect(recoverTranscriptionOperation(client([part], { ...operation, recording_id: actorId }) as never,
      { ...input, action: "resume" }, authorized)).rejects.toMatchObject({ code: "state_changed" });
    expect(m.list).not.toHaveBeenCalled();
  });
  it("performs no provider deletion after a rejected stop reservation", async () => {
    m.list.mockResolvedValue({ transcriptions: [{ ...provider, status: "error" }], next_page_cursor: null });
    m.reserve.mockRejectedValue(new Error("State or management changed"));
    const admin = client();
    await expect(recoverTranscriptionOperation(admin as never, { ...input, action: "stop" }, authorized)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(m.remove).not.toHaveBeenCalled(); expect(mutations(admin)).toEqual([]);
  });
  it("matches the immutable creation time after renewal and renews an old newly bound operation in one action", async () => {
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    const original = { ...provider, created_at: old };
    m.list.mockResolvedValue({ transcriptions: [original], next_page_cursor: null });
    const renewed = client([part], { ...operation, created_at: old, started_at: new Date().toISOString() });
    await expect(recoverTranscriptionOperation(renewed as never, { ...input, action: "resume" }, authorized)).resolves.toMatchObject({ status: "queued" });
    const aged = client([part], { ...operation, created_at: old, started_at: old });
    await recoverTranscriptionOperation(aged as never, { ...input, action: "resume" }, authorized);
    expect(mutations(aged).map(call => (call[1] as { p_resolution: string }).p_resolution)).toEqual(["bind_verified", "resume_poll"]);
  });
  it("binds the exact original correlation/audio and leaves continuation to durable dispatch", async () => {
    m.list.mockResolvedValue({ transcriptions: [provider], next_page_cursor: null });
    const admin = client();
    expect(await recoverTranscriptionOperation(admin as never, { ...input, action: "resume" }, authorized)).toEqual({ status: "queued" });
    expect(admin.rpc).toHaveBeenCalledWith("resolve_uncertain_recording_job_v1", expect.objectContaining({
      p_operation_id: operationId, p_job_id: jobId, p_resolution: "bind_verified", p_provider_job_id: provider.id
    }));
    expect(m.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toContain("token=private");
  });
  it("only attests absence after complete successful lookup and an expired submit lease", async () => {
    const admin = client();
    expect(await recoverTranscriptionOperation(admin as never, { ...input, action: "stop" }, authorized)).toEqual({ status: "failed", stopped: true });
    expect(admin.rpc).toHaveBeenCalledWith("verify_recording_transcription_stop_v1", expect.objectContaining({
      p_actor_id: actorId, p_request_id: requestId, p_snapshot: [[jobId, "uncertain", null, claimId, claimId]]
    }));
  });
  it("does not treat a fresh pending submit or incomplete pagination as absent", async () => {
    const admin = client([{ ...part, claimed_at: new Date().toISOString() }]);
    await expect(recoverTranscriptionOperation(admin as never, { ...input, action: "stop" }, authorized)).rejects.toMatchObject({ code: "submission_pending" });
    expect(mutations(admin)).toEqual([]);
    m.list.mockResolvedValue({ transcriptions: [], next_page_cursor: "repeated-cursor" });
    await expect(recoverTranscriptionOperation(client() as never, { ...input, action: "stop" }, authorized)).rejects.toMatchObject({ code: "lookup_incomplete" });
  });
  it.each(["queued", "processing", "completed"])("never deletes or restarts an existing %s transcription", async status => {
    m.list.mockResolvedValue({ transcriptions: [{ ...provider, status }], next_page_cursor: null });
    const admin = client();
    await expect(recoverTranscriptionOperation(admin as never, { ...input, action: "stop" }, authorized)).rejects.toMatchObject({
      code: status === "completed" ? "provider_completed" : "provider_processing"
    });
    expect(m.remove).not.toHaveBeenCalled(); expect(mutations(admin)).toEqual([]);
  });
  it("requires a reserved stop and 404 observation after deleting an exact terminal error job", async () => {
    m.list.mockResolvedValue({ transcriptions: [{ ...provider, status: "error" }], next_page_cursor: null });
    m.get.mockRejectedValue(new SonioxRequestError({ status: 404, message: "Missing" }));
    const admin = client();
    expect(await recoverTranscriptionOperation(admin as never, { ...input, action: "stop" }, authorized)).toMatchObject({ stopped: true });
    expect(m.remove).toHaveBeenCalledExactlyOnceWith("eu", provider.id, expect.any(AbortSignal));
    expect(m.get).toHaveBeenCalledExactlyOnceWith("eu", provider.id, expect.any(AbortSignal));
    expect(m.reserve.mock.invocationCallOrder[0]).toBeLessThan(m.remove.mock.invocationCallOrder[0]);
    m.get.mockResolvedValue(provider);
    await expect(recoverTranscriptionOperation(client() as never, { ...input, action: "stop" }, authorized)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
  it("refuses mismatched audio and duplicate correlations instead of guessing a provider ID", async () => {
    m.list.mockResolvedValue({ transcriptions: [{ ...provider, audio_url: "https://foreign.example/audio" }], next_page_cursor: null });
    await expect(recoverTranscriptionOperation(client() as never, { ...input, action: "resume" }, authorized)).rejects.toMatchObject({ code: "ambiguous_job" });
    m.list.mockResolvedValue({ transcriptions: [provider, { ...provider, id: "second-provider" }], next_page_cursor: null });
    await expect(recoverTranscriptionOperation(client() as never, { ...input, action: "resume" }, authorized)).rejects.toMatchObject({ code: "ambiguous_job" });
  });
  it("preserves the reservation when Soniox rejects authentication or a delete outcome is unknown", async () => {
    m.list.mockRejectedValue(new SonioxRequestError({ status: 401, message: "private API detail" }));
    const admin = client();
    await expect(recoverTranscriptionOperation(admin as never, { ...input, action: "stop" }, authorized)).rejects.toMatchObject({ code: "provider_authentication" });
    expect(mutations(admin)).toEqual([]); expect(m.remove).not.toHaveBeenCalled();
    m.list.mockResolvedValue({ transcriptions: [{ ...provider, status: "error" }], next_page_cursor: null }); m.remove.mockRejectedValue(new Error("Timeout"));
    await expect(recoverTranscriptionOperation(admin as never, { ...input, action: "stop" }, authorized)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(mutations(admin)).toEqual([]);
  });
});
