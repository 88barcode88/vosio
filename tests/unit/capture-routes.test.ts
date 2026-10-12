import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as recover } from "../../app/api/recordings/[recordingId]/recover-live/route";
import { POST as importTranscript } from "../../app/api/recordings/import-transcript/route";
import { GET as recoverable } from "../../app/api/recordings/recoverable/route";
const m = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/transcripts/capture-index.server", () => ({ indexCapturedTranscript: vi.fn(async () => ({ status: "ready" })) }));
const id = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
beforeEach(() => vi.clearAllMocks());
describe("session-only capture routes", () => {
  it("fails revoked recovery without service writes or replacement drafts", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    m.client.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: { id } }, error: null }) } });
    const response = await recover(new Request("http://localhost/api", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ requestId, captureRevision: 3 }) }), { params: Promise.resolve({ recordingId: id }) });
    expect(response.status).toBe(403); expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_transition: "recover", p_expected_capture_revision: 3, p_raw_text: null });
  });
  it("rejects cross-origin multipart import before reading payload or creating a client", async () => {
    const response = await importTranscript(new NextRequest("http://localhost/api", { method: "POST", headers: { origin: "https://foreign.invalid" }, body: new FormData() }));
    expect(response.status).toBe(403); expect(m.client).not.toHaveBeenCalled();
  });
  it("creates import with exact selected scope and author-derived draft, without provider jobs", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: id, error: null }).mockResolvedValueOnce({ data: { recordingId: id, captureRevision: 1, status: "completed", transcriptId: requestId, jobId: null }, error: null });
    m.client.mockResolvedValue({ rpc, auth: { getUser: async () => ({ data: { user: { id } }, error: null }) } });
    const scope = { projectId: id, visibility: "selected", recipients: [{ userId: id, role: "editor" }] };
    const response = await importTranscript(new NextRequest("http://localhost/api", { method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ requestId, transitionRequestId: requestId, scope, rawText: "saved transcript", title: "import" }) }));
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_request_id: requestId, p_project_id: id, p_visibility: "selected", p_recipients: scope.recipients });
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_transition: "import_final", p_raw_text: "saved transcript" });
  });
  it("loads recovery with one metadata RPC and no transcript-body reads", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null }); const from = vi.fn();
    m.client.mockResolvedValue({ rpc, from, auth: { getUser: async () => ({ data: { user: { id } }, error: null }) } });
    expect((await recoverable()).status).toBe(200); expect(rpc).toHaveBeenCalledOnce(); expect(from).not.toHaveBeenCalled();
  });
});
