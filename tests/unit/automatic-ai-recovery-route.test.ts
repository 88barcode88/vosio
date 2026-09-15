import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), complete: vi.fn(), schedule: vi.fn(), index: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/ai/automatic-timeline.server", () => ({ createAutomaticTimelineGenerationIdentity: ({ transcriptId }: { transcriptId: string }) => `live:${transcriptId}`,
  persistTranscriptCompletionTransition: mocks.complete, scheduleAutomaticOutputs: mocks.schedule }));
vi.mock("@/lib/transcripts/search-index", () => ({ replaceTranscriptSearchChunks: mocks.index }));
import { POST } from "@/../app/api/recordings/[recordingId]/recover-live/route";
const recordingId = "00000000-0000-4000-8000-000000000111";
beforeEach(() => { vi.clearAllMocks(); mocks.index.mockResolvedValue(null); mocks.schedule.mockResolvedValue({ status: "queued" }); });

it.each([false, true])("recovery with text keeps completed behind the sole atomic transition (failure=%s)", async (fail) => {
  const updates: Record<string, unknown>[] = []; const events: string[] = [];
  const recording = { id: recordingId, user_id: "owner", source_type: "realtime", status: "uploading", storage_path: null, duration_seconds: null };
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
    single: async () => ({ data: recording, error: null }),
    maybeSingle: async () => ({ data: { id: "transcript", raw_text: "Synthetic recovery text", segments: [], speakers: [] }, error: null }),
    update: (value: Record<string, unknown>) => { updates.push(value); events.push("audio-metadata"); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) };
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: () => query });
  mocks.admin.mockReturnValue({ from: () => query });
  mocks.complete.mockImplementation(async () => { events.push("atomic-completion"); if (fail) throw new Error("snapshot failure"); });
  const response = await POST(new NextRequest("http://localhost/recover"), { params: Promise.resolve({ recordingId }) });
  expect(response.status).toBe(fail ? 500 : 200);
  expect(updates).toHaveLength(1); expect(updates[0]).not.toHaveProperty("status");
  expect(events).toEqual(["audio-metadata", "atomic-completion"]);
  expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ generationIdentity: "live:transcript", generationKind: "live", transcriptionJobId: null }));
  expect(mocks.schedule).toHaveBeenCalledTimes(fail ? 0 : 1);
});

it("does not regress completed state when a late second metadata update precedes failed completion", async () => {
  const recording = { id: recordingId, user_id: "owner", source_type: "realtime", status: "uploading", storage_path: null, duration_seconds: null };
  const updates: Record<string, unknown>[] = [];
  let reads = 0;
  let finishReads!: () => void;
  const bothRead = new Promise<void>((resolve) => { finishReads = resolve; });
  let releaseSecondUpdate!: () => void;
  const secondUpdate = new Promise<void>((resolve) => { releaseSecondUpdate = resolve; });
  mocks.client.mockImplementation(async () => {
    const query = { select: () => query, eq: () => query, single: async () => {
      const snapshot = { ...recording };
      if (++reads === 2) finishReads();
      await bothRead;
      return { data: snapshot, error: null };
    } };
    return { auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: () => query };
  });
  let adminCount = 0;
  mocks.admin.mockImplementation(() => {
    const isSecond = ++adminCount === 2;
    let update: Record<string, unknown>;
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: { id: "transcript", raw_text: "Synthetic recovery text", segments: [], speakers: [] }, error: null }),
      update: (value: Record<string, unknown>) => { update = value; updates.push(value); return query; },
      then: async (resolve: (value: unknown) => unknown) => {
        if (isSecond) await secondUpdate;
        Object.assign(recording, update);
        return resolve({ data: null, error: null });
      } };
    return { from: () => query };
  });
  mocks.complete.mockImplementationOnce(async () => { recording.status = "completed"; })
    .mockRejectedValueOnce(new Error("second completion failed"));
  const first = POST(new NextRequest("http://localhost/recover"), { params: Promise.resolve({ recordingId }) });
  const second = POST(new NextRequest("http://localhost/recover"), { params: Promise.resolve({ recordingId }) });
  expect((await first).status).toBe(200);
  expect(reads).toBe(2);
  expect(recording.status).toBe("completed");
  releaseSecondUpdate();
  expect((await second).status).toBe(500);
  expect(recording.status).toBe("completed");
  expect(updates).toHaveLength(2);
  expect(updates[1]).not.toHaveProperty("status");
  expect(mocks.complete).toHaveBeenCalledTimes(2);
  expect(mocks.schedule).toHaveBeenCalledTimes(1);
});
