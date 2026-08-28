import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  reconcileAutomaticTimeline: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/ai/automatic-timeline.server", () => ({
  reconcileAutomaticTimeline: mocks.reconcileAutomaticTimeline
}));

import { POST } from "@/../app/api/transcripts/[transcriptId]/automatic-timeline/route";

const transcriptId = "00000000-0000-4000-8000-000000000301";

function createTranscriptQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => result)
  };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

beforeEach(() => vi.clearAllMocks());

describe("automatic timeline route", () => {
  it("authenticates and verifies transcript ownership before creating an admin client", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) }
    });

    const response = await POST(new NextRequest(`http://localhost/api/transcripts/${transcriptId}/automatic-timeline`, { method: "POST" }), {
      params: Promise.resolve({ transcriptId })
    });

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.reconcileAutomaticTimeline).not.toHaveBeenCalled();
  });

  it("ignores browser-supplied provider configuration and reconciles only the owned persisted job", async () => {
    const transcriptQuery = createTranscriptQuery({ data: { id: transcriptId }, error: null });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-id" } }, error: null })) },
      from: vi.fn(() => transcriptQuery)
    });
    const admin = { serviceRole: true };
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.reconcileAutomaticTimeline.mockResolvedValue({ status: "done" });
    const response = await POST(new NextRequest(`http://localhost/api/transcripts/${transcriptId}/automatic-timeline`, {
      body: JSON.stringify({ model: "attacker-model", processingType: "summary", prompt: "attacker" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }), { params: Promise.resolve({ transcriptId }) });

    expect(response.status).toBe(200);
    expect(mocks.reconcileAutomaticTimeline).toHaveBeenCalledWith({
      admin,
      transcriptId,
      userId: "user-id"
    });
    expect(JSON.stringify(mocks.reconcileAutomaticTimeline.mock.calls)).not.toContain("attacker");
  });

  it("does not cross the admin boundary for an unowned transcript", async () => {
    const transcriptQuery = createTranscriptQuery({ data: null, error: { message: "not found" } });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-id" } }, error: null })) },
      from: vi.fn(() => transcriptQuery)
    });

    const response = await POST(new NextRequest(`http://localhost/api/transcripts/${transcriptId}/automatic-timeline`, { method: "POST" }), {
      params: Promise.resolve({ transcriptId })
    });

    expect(response.status).toBe(404);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.reconcileAutomaticTimeline).not.toHaveBeenCalled();
  });
});
