import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as complete } from "../../app/api/recordings/[recordingId]/complete-saved-transcript/route";
import { POST as reconcile } from "../../app/api/recordings/[recordingId]/transcription/reconcile/route";
import { GET as status, POST as start } from "../../app/api/recordings/[recordingId]/transcription/route";
import { POST as webhook } from "../../app/api/jobs/recording-transcription/[operationId]/[jobId]/route";
const m = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), after: vi.fn(), run: vi.fn(), verify: vi.fn(), state: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recordings/transcription-dispatch.server", () => ({ runTranscriptionOperation: m.run, verifyTranscriptionWebhook: m.verify }));
vi.mock("@/lib/recordings/transcription-worker.server", () => ({ assertTranscriptionModel: () => "stt-async-v5" }));
vi.mock("@/lib/recordings/capture", async (original) => ({ ...await original<typeof import("@/lib/recordings/capture")>(), getCaptureState: m.state }));
vi.mock("@/lib/transcripts/capture-index.server", () => ({ indexCapturedTranscript: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ recordingId: id }) };
const callbackContext = { params: Promise.resolve({ operationId: id, jobId: requestId }) };
// Keep every request in a synthetic same-origin session.
function request(body: unknown = { requestId, captureRevision: 0 }, origin = "http://localhost") {
  return new NextRequest("http://localhost/api", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
// Supply only session-scoped permissions and synthetic metadata.
function session(rpc = vi.fn()) {
  m.client.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: { id, user_metadata: {} } } }) } });return rpc;
}
beforeEach(() => { vi.resetAllMocks();m.run.mockResolvedValue("completed"); });
describe("completion and transcription continuation authorization", () => {
  it("blocks cross-origin completion before creating a client", async () => {
    expect((await complete(request({}, "https://foreign.invalid"), context)).status).toBe(403);expect(m.client).not.toHaveBeenCalled();
  });
  it("confirms only through session RPC and never allocates a service client", async () => {
    const rpc=session(vi.fn().mockResolvedValue({ data: { recordingId: id, captureRevision: 1, status: "completed", transcriptId: requestId, jobId: null } }));
    expect((await complete(request(),context)).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("complete_saved_recording_transcript_v1", {p_recording_id:id,p_request_id:requestId,p_expected_capture_revision:0});expect(m.admin).not.toHaveBeenCalled();
  });
  it.each(["40001", "55000", "42501"])("retains canonical completion failure (%s)", async (code) => {
    session(vi.fn().mockResolvedValue({ error: { code } }));
    expect((await complete(request(),context)).status).toBe(code==="42501"?403:409);expect(m.admin).not.toHaveBeenCalled();
  });
  it("starts background work only after a matching durable start receipt", async () => {
    session(vi.fn().mockResolvedValue({ data: {operationId:id,phase:"started"} }));m.admin.mockReturnValue({});
    expect((await start(request({requestId,captureRevision:0,purpose:"capture"}),context)).status).toBe(200);
    expect(m.after).toHaveBeenCalledOnce();expect(m.admin).not.toHaveBeenCalled();
    await m.after.mock.calls[0][0]();expect(m.run).toHaveBeenCalledExactlyOnceWith({},id);
  });
  it("metadata GET reports unclaimed work as queued and never wakes it", async () => {
    session(vi.fn().mockResolvedValue({ data: [{recording_id:id,operation_id:requestId,phase:"started"}] }));m.state.mockResolvedValue({status:"transcribing"});
    expect((await (await status(request(),context)).json()).job.status).toBe("queued");expect(m.after).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled();
  });
  it.each(["provider_authentication", "private-provider-detail"])("failed metadata reads use the private RPC and expose only safe diagnostics (%s)", async errorCode => {
    session(vi.fn().mockResolvedValue({ data: [{ recording_id: id, operation_id: requestId, phase: "failed" }] }));
    m.state.mockResolvedValue({ status: "failed" });
    const rpc = vi.fn().mockResolvedValue({ data: {
      operation: { id: requestId, recording_id: id, phase: "failed", region: "eu", model: "stt-async-v5", created_at: "2026-10-06T10:00:00Z", started_at: "2026-10-06T10:00:00Z", finalize_attempt_count: 0 },
      work: [{ job_id: id, phase: "failed", position: 0, provider_job_id: null, storage_path: "private-audio-locator", claim_id: null, submission_claim_id: null, claimed_at: null, poll_attempt_count: 0, error_code: errorCode }]
    }, error: null });
    const from = vi.fn(() => { throw new Error("Direct private table reads are forbidden"); });
    m.admin.mockReturnValue({ rpc, from });
    const response = await status(request(), context);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.job.failureCode).toBe(errorCode === "provider_authentication" ? errorCode : null);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_recording_transcription_recovery_v1", { p_operation_id: requestId, p_recording_id: id });
    expect(from).not.toHaveBeenCalled();
    expect(JSON.stringify(payload)).not.toContain("private-audio-locator");
    expect(JSON.stringify(payload)).not.toContain("private-provider-detail");
  });
  it("failed metadata never allocates a recovery client for a non-manager", async () => {
    session(vi.fn().mockResolvedValue({ data: [] })); m.state.mockResolvedValue({ status: "failed" });
    expect((await status(request(), context)).status).toBe(200);
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("reconcile denies invisible operations and never accepts a caller-supplied operation", async () => {
    session(vi.fn().mockResolvedValue({data:[]}));expect((await reconcile(request({operationId:id}),context)).status).toBe(403);expect(m.after).not.toHaveBeenCalled();
  });
  it.each(["accepted", "manual_required"])("reconcile wakes only safe work of the authorized existing operation (%s)", async (phase) => {
    session(vi.fn().mockResolvedValue({ data: [{recording_id:id,operation_id:requestId,phase}] }));m.admin.mockReturnValue({});
    expect((await reconcile(request(),context)).status).toBe(202);await m.after.mock.calls[0][0]();
    expect(m.run).toHaveBeenCalledExactlyOnceWith({},requestId,1000,false);
  });
  it("an unauthenticated callback cannot allocate an admin client", async () => {
    m.verify.mockReturnValue(false);expect((await webhook(request(),callbackContext)).status).toBe(401);expect(m.admin).not.toHaveBeenCalled();
  });
  it("a valid callback still needs exact DB provider custody before execution", async () => {
    m.verify.mockReturnValue(true);m.admin.mockReturnValue({rpc:vi.fn().mockResolvedValue({error:{code:"42501"}})});
    expect((await webhook(request({id:"foreign-provider",status:"completed"}),callbackContext)).status).toBe(503);expect(m.run).not.toHaveBeenCalled();
  });
  it("callback status does not replace provider verification in the worker", async () => {
    m.verify.mockReturnValue(true);const rpc=vi.fn().mockResolvedValue({data:{phase:"accepted"}});m.admin.mockReturnValue({rpc});
    expect((await webhook(request({id:"exact-provider",status:"completed"}),callbackContext)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("get_recording_transcription_dispatch_v1",{p_operation_id:id,p_job_id:requestId,p_provider_job_id:"exact-provider"});
    expect(m.run).toHaveBeenCalledExactlyOnceWith({rpc},id);
  });
});
