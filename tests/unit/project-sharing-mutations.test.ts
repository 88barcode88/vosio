import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { PATCH } from "../../app/api/transcript-tasks/[taskId]/status/route";
import { PUT as saveDraft } from "../../app/api/recordings/[recordingId]/live-draft/route";
import { POST as saveFinal } from "../../app/api/recordings/[recordingId]/live-transcript/route";
import { POST as recoverLive } from "../../app/api/recordings/[recordingId]/recover-live/route";
import { POST as processTranscript } from "../../app/api/transcripts/[transcriptId]/process/route";

const taskId = "10000000-0000-4000-8000-000000000001";
const recordingId = "20000000-0000-4000-8000-000000000001";

// Provide a session/RLS task lookup and observable narrow mutation RPC.
function session(edit: boolean, task: unknown = { id: taskId, status: "done", transcripts: { recording_id: recordingId } }) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: task, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const rpc = vi.fn().mockImplementation(async (name: string) => ({ error: null,
    data: name === "recording_capabilities_v1" ? { ...NO_RECORDING_CAPABILITIES, read: true, editTaskStatus: edit } : null }));
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "recipient" } }, error: null }) },
    from: vi.fn().mockReturnValue(query), rpc };
  mocks.createClient.mockResolvedValue(client);
  return { client, query, rpc };
}

// Invoke the real route with a validated task identity and supported status.
function patch(status = "done") {
  return PATCH(new NextRequest(`https://vosio.test/api/transcript-tasks/${taskId}/status`, {
    method: "PATCH", body: JSON.stringify({ status }), headers: { "Content-Type": "application/json" }
  }), { params: Promise.resolve({ taskId }) });
}

beforeEach(() => vi.clearAllMocks());
describe("shared recordings raw transcript boundaries", () => {
  it("denies a personal AI request before prompt, admin job or provider work", async () => {
    const { client, query, rpc } = session(false);
    const transcriptQuery = { ...query, single: vi.fn().mockResolvedValue({ data: { id: taskId, recording_id: recordingId }, error: null }) };
    transcriptQuery.select.mockReturnValue(transcriptQuery);
    transcriptQuery.eq.mockReturnValue(transcriptQuery);
    client.from.mockReturnValue(transcriptQuery);
    const response = await processTranscript(new NextRequest("https://vosio.test/api/process", { method: "POST", headers: { Origin: "https://vosio.test" }, body: JSON.stringify({ processingType: "summary", requestId: recordingId }) }), { params: Promise.resolve({ transcriptId: taskId }) });
    expect(response.status).toBe(403);
    expect(rpc).toHaveBeenCalledOnce();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it.each([saveDraft, saveFinal, recoverLive])("denies editor raw/capture recovery before technical/admin access", async (handler) => {
    const { client, rpc } = session(false);
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await handler(new NextRequest("https://vosio.test/api/recordings/live", { method: "POST", headers: { origin: "https://vosio.test" }, body: JSON.stringify({ requestId: taskId, captureRevision: 1, rawText: "Shared text", elapsedSeconds: 1 }) }), { params: Promise.resolve({ recordingId }) });
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("apply_recording_capture_transition_v1", expect.anything());
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
describe("shared task status mutation", () => {
  it("lets E edit using the locked narrow RPC and a matched result", async () => {
    const { rpc } = session(true);
    const response = await patch();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("edit_recording_task_status_v1", { p_task_id: taskId, p_status: "done" });
  });
  it.each(["R", "S-reader", "X", "revoked"])("denies %s before mutation", async () => {
    const { rpc } = session(false);
    expect((await patch()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalledWith("edit_recording_task_status_v1", expect.anything());
  });
  it("does not return success for a missing task", async () => {
    const { rpc } = session(true, null);
    expect((await patch()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("fails if the RPC loses authorization after its initial capability read", async () => {
    const { rpc } = session(true);
    rpc.mockImplementation(async (name: string) => name === "recording_capabilities_v1"
      ? { data: { ...NO_RECORDING_CAPABILITIES, read: true, editTaskStatus: true }, error: null }
      : { data: null, error: { code: "42501" } });
    expect((await patch()).status).toBe(403);
  });
  it("fails when a void RPC has no matching persisted task afterward", async () => {
    const { query } = session(true);
    query.maybeSingle.mockResolvedValueOnce({ data: { id: taskId, transcripts: { recording_id: recordingId } }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect((await patch()).status).not.toBe(200);
  });
});
