import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  reconcileManualAiJob: vi.fn(),
  runManualAiJob: vi.fn()
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (callback: () => unknown) => mocks.afterCallbacks.push(callback)
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/ai/manual-reconciliation.server", () => ({ reconcileManualAiJob: mocks.reconcileManualAiJob }));
vi.mock("@/lib/ai/manual-processing.server", () => ({ runManualAiJob: mocks.runManualAiJob }));

import { POST } from "../../app/api/transcripts/[transcriptId]/manual-ai/reconcile/route";

const transcriptId = "00000000-0000-4000-8000-000000000941";
const jobId = "00000000-0000-4000-8000-000000000942";

// post invokes the owner-authenticated reconciliation route with one exact job identity.
function post(action: "interrupt" | "reconcile") {
  return POST(new NextRequest(`https://vosio.test/api/transcripts/${transcriptId}/manual-ai/reconcile`, {
    body: JSON.stringify({ action, jobId }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }), { params: Promise.resolve({ transcriptId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.afterCallbacks.length = 0;
  const query = { eq: vi.fn(), maybeSingle: vi.fn(), select: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { id: transcriptId }, error: null });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => query)
  });
  mocks.createAdminClient.mockReturnValue({ rpc: vi.fn() });
});

describe("manual AI reconciliation route", () => {
  it("authenticates ownership before admin creation and schedules only an eligible queued result", async () => {
    mocks.reconcileManualAiJob.mockResolvedValue({ jobId, status: "schedule" });

    const response = await post("reconcile");
    expect(response.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]!();
    expect(mocks.runManualAiJob).toHaveBeenCalledWith({ jobId, transcriptId, userId: "user-1" });
    expect(await response.json()).toEqual({ jobId, status: "schedule" });
  });

  it("never schedules interrupted, terminal, operator-required or missing results", async () => {
    for (const status of ["interrupted", "terminal", "operator_required", "missing"] as const) {
      mocks.reconcileManualAiJob.mockResolvedValueOnce({ jobId, status });
      const response = await post("interrupt");
      expect(response.status).toBe(200);
    }
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("returns conflict for interrupt busy without scheduling or claiming provider work", async () => {
    mocks.reconcileManualAiJob.mockResolvedValue({ jobId, status: "busy" });

    const response = await post("interrupt");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ jobId, status: "busy" });
    expect(mocks.reconcileManualAiJob).toHaveBeenCalledOnce();
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.runManualAiJob).not.toHaveBeenCalled();
  });

  it("does not create an admin client before transcript ownership succeeds", async () => {
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) }
    });
    const response = await post("reconcile");
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
