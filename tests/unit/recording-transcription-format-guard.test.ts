import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  createSignedUrl: vi.fn(),
  createSonioxTranscription: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/soniox/client", () => ({
  createSonioxTranscription: mocks.createSonioxTranscription,
  getSonioxTranscript: vi.fn(),
  getSonioxTranscription: vi.fn(),
  getSonioxTranscriptionOptions: vi.fn(() => ({})),
  mapSonioxStatus: vi.fn()
}));
vi.mock("@/lib/transcripts/search-index", () => ({ replaceTranscriptSearchChunks: vi.fn() }));
vi.mock("@/lib/transcripts/search-warning", () => ({ getTranscriptSearchWarningPayload: vi.fn() }));
vi.mock("@/lib/transcripts/speakers", () => ({ extractTranscriptSpeakerSummaries: vi.fn() }));
vi.mock("@/lib/transcripts/retranscription", () => ({ getRetranscriptionCleanupTranscriptId: vi.fn() }));

import { POST } from "@/../app/api/recordings/[recordingId]/transcription/route";

const recordingId = "00000000-0000-4000-8000-000000000101";

// createRecordingQuery returns the authenticated optional-recording query used before provider work starts.
function createRecordingQuery(mimeType: string) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: {
        id: recordingId,
        mime_type: mimeType,
        status: "uploaded",
        storage_path: `user-id/${recordingId}/recording.amr`,
        title: "Unsupported fixture",
        user_id: "user-id"
      },
      error: null
    })),
    select: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("recording transcription format guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 before signed URL, job creation, or Soniox for an unsupported single file", async () => {
    const recordingQuery = createRecordingQuery("audio/amr");
    const adminFrom = vi.fn();
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-id" } }, error: null })) },
      from: vi.fn(() => recordingQuery)
    });
    mocks.createAdminClient.mockReturnValue({
      from: adminFrom,
      storage: { from: vi.fn(() => ({ createSignedUrl: mocks.createSignedUrl })) }
    });

    const response = await POST(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`, { method: "POST" }),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Nahrávka nemá podporovaný formát pro přepis." });
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
    expect(mocks.createSonioxTranscription).not.toHaveBeenCalled();
  });
});
