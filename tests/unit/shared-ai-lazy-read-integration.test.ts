import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), types: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/ai/queries", () => ({ getAccessibleOutputTypes: mocks.types }));
import { GET as state } from "../../app/api/transcripts/[transcriptId]/ai-state/route";
import { GET as body } from "../../app/api/ai-outputs/[outputId]/route";
const transcriptId = "00000000-0000-4000-8000-000000000801";
const outputId = "00000000-0000-4000-8000-000000000802";
const recordingId = "00000000-0000-4000-8000-000000000803";
// Model session RLS data with real capability parsing, without a personal-state bypass.
function client(read: boolean) {
  const selections: Array<{ table: string; columns: string }> = [];
  const from = vi.fn((table: string) => {
    const result = table === "transcripts" ? { id: transcriptId, recording_id: recordingId, completion_generation_key: "capture:fixture" }
      : table === "ai_outputs" ? { id: outputId, transcript_id: transcriptId, created_at: "2026-10-02", processing_job_id: null, output_text: "saved", output_json: null } : null;
    const query = { select: (columns: string) => { selections.push({ table, columns }); return query; },
      eq: vi.fn(), order: vi.fn(), range: vi.fn(), maybeSingle: vi.fn(async () => ({ data: result, error: null })),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result ? [result] : [], error: null }).then(resolve) };
    query.eq.mockReturnValue(query); query.order.mockReturnValue(query); query.range.mockReturnValue(query);
    return query;
  });
  const rpc = vi.fn().mockResolvedValue({ data: { read, editTitle: false, editSpeakers: false, editTaskStatus: false,
    manageAccess: false, delete: false, restore: false, purge: false, runPersonalAi: false, usePrivateChat: false }, error: null });
  mocks.client.mockResolvedValue({ from, rpc, auth: { getUser: async () => ({ data: { user: { id: "reader" } }, error: null }) } });
  return { from, rpc, selections };
}
beforeEach(() => { vi.clearAllMocks(); mocks.types.mockResolvedValue(new Map([[outputId, "summary"]])); });
it("shared saved metadata and lazy body never read personal jobs, intents, provider configuration or cleanup", async () => {
  const c = client(true);
  const response = await state(new NextRequest("http://localhost/api"), { params: Promise.resolve({ transcriptId }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ jobs: [], classifications: [], cleanup: { eligible_count: 0 } });
  const saved = await body(new NextRequest(`http://localhost/api?transcriptId=${transcriptId}`), { params: Promise.resolve({ outputId }) });
  expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ output: { output_text: "saved", processing_type: "summary" } });
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(c.selections.every(({ columns }) => !columns.includes("*") && !columns.includes("ai_processing_jobs") && !columns.includes("provider"))).toBe(true);
  expect(c.from.mock.calls.flat()).not.toContain("ai_processing_jobs");
  expect(c.rpc).toHaveBeenCalledWith("recording_capabilities_v1", { p_recording_id: recordingId });
});
it("revocation denies refresh and lazy body before artifact/projection or privileged reads", async () => {
  const c = client(false);
  expect((await state(new NextRequest("http://localhost/api"), { params: Promise.resolve({ transcriptId }) })).status).toBe(403);
  expect((await body(new NextRequest(`http://localhost/api?transcriptId=${transcriptId}`), { params: Promise.resolve({ outputId }) })).status).toBe(404);
  expect(c.from.mock.calls).toEqual([["transcripts"], ["transcripts"]]);
  expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.types).not.toHaveBeenCalled();
});
