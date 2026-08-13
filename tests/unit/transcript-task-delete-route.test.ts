import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { DELETE } from "../../app/api/transcript-tasks/[taskId]/route";

const taskId = "00000000-0000-4000-8000-000000000001";
const duplicateId = "00000000-0000-4000-8000-000000000002";
const siblingId = "00000000-0000-4000-8000-000000000003";
const transcriptId = "00000000-0000-4000-8000-000000000004";
const olderTranscriptId = "00000000-0000-4000-8000-000000000005";
const userId = "00000000-0000-4000-8000-000000000006";
const recordingId = "00000000-0000-4000-8000-000000000007";
const foreignTranscriptId = "00000000-0000-4000-8000-000000000008";

// buildTask creates the query fields needed by the shared logical-task dedupe key.
function buildTask(id: string, title = "Poslat podklady", sourceTranscriptId = transcriptId) {
  return {
    created_at: "2026-08-10T08:00:00.000Z",
    deadline: null,
    deadline_normalized: null,
    id,
    owner_category: "Moje práce",
    position: 1,
    status: "new",
    title,
    transcript_id: sourceTranscriptId,
    user_id: userId
  };
}

// createAdminDouble exposes each owner-scoped query and records the final delete filter.
function createAdminDouble({
  candidates = [
    buildTask(taskId),
    buildTask(duplicateId, " POSLAT   PODKLADY ", olderTranscriptId),
    buildTask(siblingId, "Jiný úkol", olderTranscriptId)
  ],
  deleted = [{ id: taskId }, { id: duplicateId }],
  target = buildTask(taskId),
  targetError = null
}: {
  candidates?: Array<ReturnType<typeof buildTask>>;
  deleted?: Array<{ id: string }>;
  target?: ReturnType<typeof buildTask> | null;
  targetError?: { message: string } | null;
} = {}) {
  const candidateIn = vi.fn().mockReturnThis();
  const candidateUserEq = vi.fn().mockReturnThis();
  const deleteIn = vi.fn().mockReturnThis();
  const deleteEq = vi.fn().mockReturnThis();
  const deleteSelect = vi.fn().mockResolvedValue({
    data: deleted,
    error: null
  });
  const recordingTranscriptEq = vi.fn().mockReturnThis();
  const targetTranscriptEq = vi.fn().mockReturnThis();
  const targetEq = vi.fn().mockReturnThis();
  let taskCall = 0;

  const from = vi.fn((table: string) => {
    if (table === "transcript_tasks") {
      taskCall += 1;
      if (taskCall === 1) {
        const query = {
          eq: targetEq,
          maybeSingle: vi.fn().mockResolvedValue({ data: target, error: targetError }),
          select: vi.fn().mockReturnThis()
        };
        return query;
      }
      if (taskCall === 2) {
        const query = {
          eq: candidateUserEq,
          in: candidateIn,
          returns: vi.fn().mockResolvedValue({
            data: candidates,
            error: null
          }),
          select: vi.fn().mockReturnThis()
        };
        return query;
      }
      return {
        delete: vi.fn(() => ({
          eq: deleteEq,
          in: deleteIn,
          select: deleteSelect
        }))
      };
    }

    if (table === "transcripts") {
      const select = vi.fn((columns: string) => columns === "recording_id"
        ? {
            eq: targetTranscriptEq,
            maybeSingle: vi.fn().mockResolvedValue({ data: { recording_id: recordingId }, error: null })
          }
        : {
            eq: recordingTranscriptEq,
            returns: vi.fn().mockResolvedValue({
              data: [{ id: transcriptId }, { id: olderTranscriptId }],
              error: null
            })
          });
      return { select };
    }

    throw new Error(`Unexpected table ${table}`);
  });

  return {
    candidateIn,
    candidateUserEq,
    client: { from },
    deleteEq,
    deleteIn,
    from,
    recordingTranscriptEq,
    targetEq,
    targetTranscriptEq
  };
}

// deleteRequest creates the authenticated same-origin request shape used by the route.
function deleteRequest(id = taskId) {
  return DELETE(
    new NextRequest(`http://localhost/api/transcript-tasks/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ taskId: id }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) }
  });
});

describe("DELETE /api/transcript-tasks/:taskId", () => {
  it("rejects invalid ids before auth or admin access", async () => {
    const response = await deleteRequest("invalid");
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before admin access", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) }
    });
    const response = await deleteRequest();
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 404 for an absent or wrong-owner task", async () => {
    const admin = createAdminDouble({ target: null });
    mocks.createAdminClient.mockReturnValue(admin.client);
    const response = await deleteRequest();
    expect(response.status).toBe(404);
  });

  it("deletes every current duplicate of the owned logical task and preserves siblings", async () => {
    const admin = createAdminDouble();
    mocks.createAdminClient.mockReturnValue(admin.client);
    const response = await deleteRequest();
    expect(response.status).toBe(200);
    expect(admin.targetEq).toHaveBeenCalledWith("id", taskId);
    expect(admin.targetEq).toHaveBeenCalledWith("user_id", userId);
    expect(admin.targetTranscriptEq).toHaveBeenCalledWith("id", transcriptId);
    expect(admin.targetTranscriptEq).toHaveBeenCalledWith("user_id", userId);
    expect(admin.recordingTranscriptEq).toHaveBeenCalledWith("recording_id", recordingId);
    expect(admin.recordingTranscriptEq).toHaveBeenCalledWith("user_id", userId);
    expect(admin.candidateIn).toHaveBeenCalledWith("transcript_id", [transcriptId, olderTranscriptId]);
    expect(admin.candidateUserEq).toHaveBeenCalledWith("user_id", userId);
    expect(admin.deleteEq).toHaveBeenCalledWith("user_id", userId);
    expect(admin.deleteIn).toHaveBeenCalledWith("id", [taskId, duplicateId]);
    expect(admin.deleteIn).not.toHaveBeenCalledWith("id", expect.arrayContaining([siblingId]));
    expect(admin.from).not.toHaveBeenCalledWith("transcript_decisions");
    expect(admin.from).not.toHaveBeenCalledWith("transcript_risks");
    expect(admin.from).not.toHaveBeenCalledWith("transcript_chapters");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/recordings");
  });

  it("excludes a same-key task outside the owned recording even if the query double returns it", async () => {
    const admin = createAdminDouble({
      candidates: [
        buildTask(taskId),
        buildTask(duplicateId, " POSLAT   PODKLADY ", olderTranscriptId),
        buildTask("00000000-0000-4000-8000-000000000009", "Poslat podklady", foreignTranscriptId)
      ]
    });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await deleteRequest();

    expect(response.status).toBe(200);
    expect(admin.deleteIn).toHaveBeenCalledWith("id", [taskId, duplicateId]);
  });

  it("treats rows concurrently removed after ownership verification as an idempotent success", async () => {
    const admin = createAdminDouble({ deleted: [{ id: taskId }] });
    mocks.createAdminClient.mockReturnValue(admin.client);

    const response = await deleteRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1, ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/recordings/${recordingId}`);
  });

  it("returns a sanitized server error when owner lookup fails", async () => {
    const admin = createAdminDouble({ targetError: { message: "sensitive postgres detail" } });
    mocks.createAdminClient.mockReturnValue(admin.client);
    const response = await deleteRequest();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive postgres detail");
  });
});
