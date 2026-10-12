import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureAttempt } from "@/lib/recordings/capture";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createResumableRecordingUpload: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recordings/resumable-upload", () => {
  class RecordingUploadCancelledError extends Error {
    constructor() { super("Nahrávání bylo zrušeno."); this.name = "RecordingUploadCancelledError"; }
  }
  return { createResumableRecordingUpload: mocks.createResumableRecordingUpload, RecordingUploadCancelledError };
});
import { RecordingUploadCancelledError } from "@/lib/recordings/resumable-upload";
import { uploadRecording } from "@/lib/recordings/upload";
const id = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const file = { name: "call.webm", size: 42, type: "audio/webm" } as File;
// RPC-only fixture retains exact object binding; no direct table writes can pass unnoticed.
function harness({ completionError = false, recoveryError = null as string | null } = {}) {
  const events: string[] = []; let stateReads = 0;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    events.push(name);
    if (name === "create_recording_with_access_v1") return { data: id, error: null };
    if (name === "get_recording_capture_state_v1") {
      stateReads++;
      return stateReads > 1 && recoveryError ? { data: null, error: { code: recoveryError } } : { data: { recordingId: id, status: "uploading", captureRevision: 0 }, error: null };
    }
    if (name === "prepare_recording_upload_v1") return { data: owner + "/" + id + "/" + args.p_filename, error: null };
    if (completionError) return { data: null, error: { code: "55000" } };
    return { data: { recordingId: id, status: "uploaded", captureRevision: 1, transcriptId: null, jobId: null }, error: null };
  });
  const from = vi.fn();
  mocks.createClient.mockReturnValue({ rpc, from, auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }) } });
  return { rpc, from, events };
}
// Begin one retained immutable file attempt with the production uploader.
function upload(capture = createCaptureAttempt()) {
  return uploadRecording({ capture, file, allowedMimeTypes: ["audio/webm"], maxFileSizeBytes: 100, sourceType: "upload" });
}
beforeEach(() => { vi.clearAllMocks(); mocks.createResumableRecordingUpload.mockReturnValue({ cancel: vi.fn(), done: Promise.resolve() }); });
describe("uploadRecording resumable capture contract", () => {
  it("rejects generic MIME before auth, capture mutation or TUS", async () => {
    const h = harness();
    await expect(uploadRecording({ file: { ...file, type: "application/octet-stream" }, allowedMimeTypes: ["audio/webm"], maxFileSizeBytes: 100, sourceType: "upload" })).rejects.toThrow("Soubor nemá podporovaný MIME typ");
    expect(h.rpc).not.toHaveBeenCalled(); expect(mocks.createResumableRecordingUpload).not.toHaveBeenCalled();
  });
  it("creates scoped metadata before fixed TUS transfer, clears task and finalizes through the current CAS", async () => {
    const h = harness(); const capture = createCaptureAttempt();
    const controls: unknown[] = []; const phases: string[] = [];
    const task = { cancel: vi.fn(), done: Promise.resolve() };
    mocks.createResumableRecordingUpload.mockImplementation(() => { h.events.push("tus"); return task; });
    const result = await uploadRecording({ capture, file, allowedMimeTypes: ["audio/webm"], maxFileSizeBytes: 100, sourceType: "upload", onPhase: (p) => phases.push(p), onResumableUploadTask: (t) => controls.push(t) });
    expect(h.events).toEqual(["create_recording_with_access_v1","get_recording_capture_state_v1","prepare_recording_upload_v1","tus","apply_recording_capture_transition_v1"]);
    expect(h.rpc.mock.calls[0]![1]).toMatchObject({ p_visibility: "private", p_project_id: null, p_request_id: capture.requestId });
    expect(mocks.createResumableRecordingUpload).toHaveBeenCalledWith(expect.objectContaining({ objectName: result.storagePath, contentType: "audio/webm" }));
    expect(result.storagePath).toContain(capture.requestId);
    expect(controls).toEqual([task,null]); expect(phases).toEqual(["transferring","finalizing"]);
    expect(h.from).not.toHaveBeenCalled();
  });
  it("retains uploading and deliberate cancellation identity for exact-object resume", async () => {
    const h = harness(); const cancellation = new RecordingUploadCancelledError();
    mocks.createResumableRecordingUpload.mockImplementation(() => ({ cancel: vi.fn(), done: Promise.reject(cancellation) }));
    await expect(upload()).rejects.toBe(cancellation);
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(["create_recording_with_access_v1","get_recording_capture_state_v1","prepare_recording_upload_v1","get_recording_capture_state_v1"]);
    expect(h.from).not.toHaveBeenCalled();
  });
  it("reports actual recovery lookup failure without claiming any failed-state update", async () => {
    const h = harness({ recoveryError: "55000" }); const cancellation = new RecordingUploadCancelledError();
    mocks.createResumableRecordingUpload.mockImplementation(() => ({ cancel: vi.fn(), done: Promise.reject(cancellation) }));
    await expect(upload()).rejects.toMatchObject({ name: "RecordingUploadCancelledError", message: "Nahrávání bylo zrušeno. Stav nahrávky se nepodařilo ověřit. Obnovte stav před dalším pokusem.", cause: { code: "55000" } });
    expect(h.from).not.toHaveBeenCalled();
  });
  it("surfaces revoke as explicit private-recovery authority loss, not a successful cancellation", async () => {
    harness({ recoveryError: "42501" });
    mocks.createResumableRecordingUpload.mockImplementation(() => ({ cancel: vi.fn(), done: Promise.reject(new RecordingUploadCancelledError()) }));
    await expect(upload()).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("Místní obsah") });
  });
  it("retains the exact finalization request after durable transfer rather than marking the row failed", async () => {
    const h = harness({ completionError: true }); const capture = createCaptureAttempt();
    await expect(upload(capture)).rejects.toMatchObject({ code: "55000" });
    const final = h.rpc.mock.calls.at(-1);
    expect(final?.[1]).toMatchObject({ p_transition: "upload_complete", p_expected_capture_revision: 0 });
    expect(capture.requests.upload_complete).toBeDefined();
    await expect(upload(capture)).rejects.toMatchObject({ code: "55000" });
    expect(h.rpc.mock.calls.at(-1)).toEqual(final);
    expect(h.rpc.mock.calls.some(([,args]) => args.p_transition === "capture_failed")).toBe(false);
    expect(h.from).not.toHaveBeenCalled();
  });
});
