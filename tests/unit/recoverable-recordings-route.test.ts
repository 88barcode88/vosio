import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "../../app/api/recordings/recoverable/route";

const userId = "00000000-0000-4000-8000-000000000001";
const recordingId = "00000000-0000-4000-8000-000000000002";

function createClientDouble() {
  const query = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [{
        created_at: "2026-09-04T10:00:00.000Z",
        duration_seconds: 12,
        id: recordingId,
        source_type: "in_app_recording",
        status: "failed",
        storage_path: null,
        title: "Obnovitelná nahrávka"
      }],
      error: null
    }),
    order: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis()
  };

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => query)
  };
}

function createAdminDouble(transcriptResult: { data: unknown; error: unknown }) {
  const transcriptQuery = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis()
  };
  transcriptQuery.select.mockReturnValue(transcriptQuery);
  transcriptQuery.eq
    .mockReturnValueOnce(transcriptQuery)
    .mockResolvedValue(transcriptResult);

  const storageBucket = {
    list: vi.fn().mockResolvedValue({ data: [], error: null })
  };
  const admin = {
    from: vi.fn(() => transcriptQuery),
    storage: { from: vi.fn(() => storageBucket) }
  };
  return { admin, transcriptQuery };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(createClientDouble());
});

describe("GET /api/recordings/recoverable", () => {
  it("returns retryable 503 instead of hiding a transcript query failure as empty recovery", async () => {
    const { admin } = createAdminDouble({ data: null, error: { message: "sensitive database detail" } });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await GET();

    expect(response).toBeInstanceOf(NextResponse);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "Nepodařilo se načíst obnovitelnou nahrávku. Zkuste to znovu." });
    expect(body).not.toContain("sensitive database detail");
  });

  it("keeps an actual empty transcript result valid and filters the row without storage", async () => {
    const { admin } = createAdminDouble({ data: [], error: null });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ownerId: userId, recordings: [] });
  });
});
