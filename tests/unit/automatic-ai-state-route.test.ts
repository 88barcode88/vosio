import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/ai/manual-job-cleanup.server", () => ({ getManualAiCleanupState: mocks.cleanup }));
import { GET } from "@/../app/api/transcripts/[transcriptId]/ai-state/route";

it("keeps six current automatic jobs visible beside fifty manual jobs and never sends them to cleanup", async () => {
  const manual = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, status: "done" }));
  const automatic = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, status: "queued", attempt_count: 0, max_attempts: 3, execution_mode: "automatic" }));
  const queries: { table: string; filters: Record<string, unknown>; limit?: number }[] = [];
  // from models owner/generation filters and each independent metadata bound.
  const from = (table: string) => {
    const info = { table, filters: {} as Record<string, unknown>, limit: undefined as number | undefined }; queries.push(info);
    const result = () => ({ error: null, data: table === "automatic_timeline_intents" ? automatic.map((job) => ({ automatic_idempotency_key: job.id }))
      : table === "ai_processing_jobs" ? info.filters.execution_mode === "manual" ? manual : automatic : [] });
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { info.filters[key] = value; return chain; },
      in: () => chain, order: () => chain, range: () => chain,
      limit: (n: number) => { info.limit = n; return chain; }, returns: async () => result(),
      maybeSingle: async () => ({ data: { id: "t", completion_generation_key: "generation" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return chain;
  };
  const rpc = vi.fn(); mocks.admin.mockReturnValue({ from, rpc });
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from });
  mocks.cleanup.mockResolvedValue({ classifications: [], cleanup: { eligible_count: 0, next_cursor: null } });
  const response = await GET(new NextRequest("http://localhost/ai-state"), { params: Promise.resolve({ transcriptId: "00000000-0000-4000-8000-000000000111" }) });
  expect(response.status).toBe(200); const payload = await response.json(); expect(payload.jobs).toHaveLength(56);
  expect(payload.classifications).toHaveLength(6); expect(payload.classifications.every((row: { actions: unknown[]; poll_eligible: boolean }) => row.actions.length === 0 && row.poll_eligible)).toBe(true);
  expect(mocks.cleanup).toHaveBeenCalledWith(expect.objectContaining({ jobIds: manual.map((job) => job.id) }));
  expect(queries.find((query) => query.table === "automatic_timeline_intents")?.filters).toMatchObject({ user_id: "owner", completion_generation_key: "generation" });
  expect(queries.filter((query) => query.table === "ai_processing_jobs").map((query) => query.limit)).toEqual([50, 6]);
  expect(rpc).not.toHaveBeenCalled();
});
