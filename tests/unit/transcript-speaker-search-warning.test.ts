import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveTranscriptSpeakerAutosaveAction } from "@/lib/transcripts/actions";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(),
  replaceTranscriptSearchChunks: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/transcripts/search-index", () => ({
  replaceTranscriptSearchChunks: mocks.replaceTranscriptSearchChunks
}));

const transcriptId = "00000000-0000-4000-8000-000000000201";
const recordingId = "00000000-0000-4000-8000-000000000202";
const userId = "00000000-0000-4000-8000-000000000203";

// createQuery creates the chain shape used by both the owned lookup and saved update.
function createQuery(result: unknown, terminal: "maybeSingle" | "single") {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    update: vi.fn()
  };

  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query[terminal].mockResolvedValue(result);

  return query;
}

const speakerSave = {
  name: "Miroslav Coufalík",
  revision: 3,
  role: "delivery_team" as const,
  speakerId: "1",
  transcriptId
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("speaker update search warning", () => {
  it("returns a durable success with a nonfatal search warning", async () => {
    const transcript = {
      id: transcriptId,
      raw_text: "Dobrý den",
      recording_id: recordingId,
      segments: [{ speaker: 1, text: "Dobrý den" }],
      speakers: [],
      user_id: userId
    };
    const lookup = createQuery({ data: transcript, error: null }, "maybeSingle");
    const update = createQuery({
      data: {
        ...transcript,
        speakers: [{
          firstStartMs: null,
          id: "1",
          label: "Mluvčí 1",
          lastEndMs: null,
          name: "Miroslav Coufalík",
          role: "delivery_team",
          roleLabel: "Dodavatel / náš tým",
          source: "legacy_segment",
          tokenCount: 0
        }]
      },
      error: null
    }, "single");
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
      from: vi.fn().mockReturnValue(lookup)
    });
    mocks.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(update) });
    mocks.replaceTranscriptSearchChunks.mockResolvedValue({ status: "incomplete", warning: "index" });

    const result = await saveTranscriptSpeakerAutosaveAction(speakerSave);

    expect(update.update).toHaveBeenCalled();
    expect(result).toMatchObject({
      revision: 3,
      searchWarning: "Mluvčí je uložený, ale vyhledávací index se nepodařilo obnovit.",
      status: "success"
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns a sanitized error without navigating away", async () => {
    const transcript = {
      id: transcriptId,
      raw_text: "Dobrý den",
      recording_id: recordingId,
      segments: [{ speaker: 1, text: "Dobrý den" }],
      speakers: [],
      user_id: userId
    };
    const lookup = createQuery({ data: transcript, error: null }, "maybeSingle");
    const update = createQuery({
      data: null,
      error: { message: "secret database detail" }
    }, "single");
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
      from: vi.fn().mockReturnValue(lookup)
    });
    mocks.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(update) });

    const result = await saveTranscriptSpeakerAutosaveAction(speakerSave);

    expect(result).toEqual({
      message: "Mluvčího se nepodařilo uložit. Zkuste to znovu.",
      revision: 3,
      status: "error"
    });
    expect(JSON.stringify(result)).not.toContain("secret database detail");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
