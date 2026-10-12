import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/recordings/[recordingId]/transcription/route";
const m = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/recordings/transcription-worker.server", () => ({ assertTranscriptionModel: () => "stt-async-v5" }));
afterEach(() => vi.unstubAllEnvs());
describe("canonical transcription format and access guard", () => {
  it("rejects unauthenticated transcription before preparing a job", async () => {
    const rpc = vi.fn();
    m.client.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
    const response = await POST(new Request("http://localhost/api", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000002", captureRevision: 2, purpose: "capture" }) }), { params: Promise.resolve({ recordingId: "00000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["false", undefined])("starts authorized transcription regardless of obsolete switch (%s)", async (enabled) => {
    vi.stubEnv("RECORDING_TRANSCRIPTION_ENABLED", enabled);
    const operation = { operationId: "00000000-0000-4000-8000-000000000003", phase: "queued" };
    const rpc = vi.fn().mockResolvedValue({ data: operation, error: null });
    m.client.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: { id: "author", user_metadata: {} } }, error: null }) } });
    const response = await POST(new Request("http://localhost/api", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000002", captureRevision: 2, purpose: "capture" }) }), { params: Promise.resolve({ recordingId: "00000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ operation, job: { status: "queued" } });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["prepare_recording_transcription_v1", "start_recording_transcription_v1"]);
  });

  it.each([["22023", 400], ["55000", 409], ["42501", 403]])("rejects prepare %s before irreversible start", async (code, status) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code } });
    m.client.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: { id: "author", user_metadata: {} } }, error: null }) } });
    const id = "00000000-0000-4000-8000-000000000001";
    const response = await POST(new Request("http://localhost/api", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000002", captureRevision: 2, purpose: "capture" }) }), { params: Promise.resolve({ recordingId: id }) });
    expect(response.status).toBe(status);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]![0]).toBe("prepare_recording_transcription_v1");
  });
});
