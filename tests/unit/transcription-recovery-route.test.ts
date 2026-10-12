import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/recordings/[recordingId]/transcription/recover/route";
import { TranscriptionRecoveryError } from "@/lib/recordings/transcription-recovery.server";
const m = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), recovery: vi.fn(), after: vi.fn(), run: vi.fn() }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.session }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/recordings/transcription-recovery.server", async original => ({ ...await original<typeof import("@/lib/recordings/transcription-recovery.server")>(), recoverTranscriptionOperation: m.recovery }));
vi.mock("@/lib/recordings/transcription-dispatch.server", () => ({ runTranscriptionOperation: m.run }));
const recordingId = "00000000-0000-4000-8000-000000000801";
const operationId = "00000000-0000-4000-8000-000000000802";
const requestId = "00000000-0000-4000-8000-000000000803";
const context = { params: Promise.resolve({ recordingId }) };
// Use synthetic same-origin requests and real route validation.
function request(action = "stop", origin = "http://localhost", extra = {}) {
  return new NextRequest("http://localhost/api", { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ operationId, requestId, action, ...extra }) });
}
// Keep permission outcomes at the authenticated session boundary.
function session(rows: unknown[] = [{ recording_id: recordingId, operation_id: operationId }], stopError?: string) {
  const rpc = vi.fn(async (name: string) => name === "get_managed_recording_transcription_v1"
    ? { data: rows } : stopError ? { error: { code: stopError } } : { data: { operationId, stopped: true, reserved: true, resumed: true } });
  m.session.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: { id: recordingId } } }) } });
  return rpc;
}
beforeEach(() => { vi.resetAllMocks(); m.admin.mockReturnValue({}); });
describe("transcription recovery authority", () => {
  it("reports a database read failure as unavailable, never as a state conflict", async () => {
    session(); m.recovery.mockRejectedValue(new TranscriptionRecoveryError("recovery_unavailable"));
    const response = await POST(request("resume"), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "recovery_unavailable" });
    expect(m.after).not.toHaveBeenCalled();
  });
  it("rejects foreign origins and extra input before allocating either client", async () => {
    expect((await POST(request("stop", "https://foreign.invalid"), context)).status).toBe(403);
    expect((await POST(request("stop", "http://localhost", { providerId: "forged" }), context)).status).toBe(400);
    expect(m.session).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it.each([{ rows: [] }, { rows: [{ recording_id: recordingId, operation_id: requestId }] }])("rejects invisible or superseded operations before provider access", async ({ rows }) => {
    session(rows);
    expect((await POST(request(), context)).status).toBe(rows.length ? 409 : 403);
    expect(m.admin).not.toHaveBeenCalled(); expect(m.recovery).not.toHaveBeenCalled();
  });
  it("requires a fresh authenticated stop after service verification", async () => {
    const rpc = session(); m.recovery.mockImplementation(async (_admin, _input, authorization) => {
      await authorization.reserveStop([]); return { status: "failed", stopped: true };
    });
    expect((await POST(request(), context)).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("stop_recording_transcription_v1", { p_operation_id: operationId, p_request_id: requestId });
    expect(rpc).toHaveBeenCalledWith("prepare_recording_transcription_stop_v1", { p_operation_id: operationId, p_request_id: requestId, p_snapshot: [] });
    expect(m.after).not.toHaveBeenCalled();
  });
  it.each(["42501", "40001"])("preserves a permission/state change at final closure (%s)", async code => {
    session(undefined, code); m.recovery.mockResolvedValue({ status: "failed", stopped: true });
    expect((await POST(request(), context)).status).toBe(code === "42501" ? 403 : 409);
    expect(m.after).not.toHaveBeenCalled();
  });
  it("resumes only the original operation without a new submission route", async () => {
    const rpc = session(); m.recovery.mockResolvedValue({ status: "running" });
    expect((await POST(request("resume"), context)).status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce(); expect(m.after).toHaveBeenCalledOnce();
    await m.after.mock.calls[0][0]();
    expect(m.run).toHaveBeenCalledWith({}, operationId, expect.any(Number));
  });
});
