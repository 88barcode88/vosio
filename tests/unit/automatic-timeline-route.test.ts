import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  scheduleAutomaticOutputs: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/ai/automatic-timeline.server", () => ({
  scheduleAutomaticOutputs: mocks.scheduleAutomaticOutputs,
  scheduleCaptureTimelineIntent: vi.fn(async () => false)
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
    expect(mocks.scheduleAutomaticOutputs).not.toHaveBeenCalled();
  });

  it("ignores browser-supplied provider configuration and reconciles only the owned persisted job", async () => {
    const transcriptQuery = createTranscriptQuery({ data: { id: transcriptId, recording_id: "recording-id" }, error: null });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-id" } }, error: null })) },
      from: vi.fn(() => transcriptQuery),
      rpc: vi.fn().mockResolvedValue({ data: { ...NO_RECORDING_CAPABILITIES, read: true, runPersonalAi: true }, error: null })
    });
    const admin = { serviceRole: true };
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.scheduleAutomaticOutputs.mockResolvedValue({ status: "done" });
    const response = await POST(new NextRequest(`http://localhost/api/transcripts/${transcriptId}/automatic-timeline`, {
      body: JSON.stringify({ model: "attacker-model", processingType: "summary", prompt: "attacker" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }), { params: Promise.resolve({ transcriptId }) });

    expect(response.status).toBe(200);
    expect(mocks.scheduleAutomaticOutputs).toHaveBeenCalledWith({
      admin,
      transcriptId,
      userId: "user-id"
      ,allowedProcessingTypes: []
    });
    expect(JSON.stringify(mocks.scheduleAutomaticOutputs.mock.calls)).not.toContain("attacker");
  });

  it.each(["reader", "editor", "foreign-founder", "revoked"])("never creates a provider/admin path for %s", async () => {
    const query = createTranscriptQuery({ data: { id: transcriptId, recording_id: "shared" }, error: null });
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "author" } }, error: null }) },
      from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: { ...NO_RECORDING_CAPABILITIES, read: true }, error: null }) });
    const response = await POST(new NextRequest("http://localhost/test", { method: "POST" }), { params: Promise.resolve({ transcriptId }) });
    expect(response.status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.scheduleAutomaticOutputs).not.toHaveBeenCalled();
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
    expect(mocks.scheduleAutomaticOutputs).not.toHaveBeenCalled();
  });
});
