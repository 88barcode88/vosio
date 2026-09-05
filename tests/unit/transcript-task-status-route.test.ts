import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { PATCH } from "../../app/api/transcript-tasks/[taskId]/status/route";

const taskId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000102";

function request(status = "done") {
  return PATCH(
    new NextRequest(`http://localhost/api/transcript-tasks/${taskId}/status`, {
      body: JSON.stringify({ status }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH"
    }),
    { params: Promise.resolve({ taskId }) }
  );
}

function createClientDouble(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result)
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => query),
    query
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/transcript-tasks/:taskId/status", () => {
  it("returns 404 and does not claim success for an absent or foreign task", async () => {
    const client = createClientDouble({ data: null, error: null });
    mocks.createClient.mockResolvedValue(client);

    const response = await request();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Úkol nebyl nalezen." });
    expect(client.query.select).toHaveBeenCalledWith("id,status");
  });

  it("returns the actually stored status after one owner-scoped update", async () => {
    const client = createClientDouble({ data: { id: taskId, status: "done" }, error: null });
    mocks.createClient.mockResolvedValue(client);

    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "done" });
    expect(client.query.update).toHaveBeenCalledWith({ status: "done" });
    expect(client.query.eq).toHaveBeenCalledWith("id", taskId);
    expect(client.query.eq).toHaveBeenCalledWith("user_id", userId);
  });

  it("sanitizes update database errors", async () => {
    const client = createClientDouble({ data: null, error: { message: "sensitive database detail" } });
    mocks.createClient.mockResolvedValue(client);

    const response = await request();

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive database detail");
  });
});
