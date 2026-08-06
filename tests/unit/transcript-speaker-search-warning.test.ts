import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTranscriptSpeakerAction } from "@/lib/transcripts/actions";
import { TRANSCRIPT_SEARCH_INDEX_WARNING } from "@/lib/transcripts/search-warning";

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

// createSpeakerForm builds one valid client-side speaker update submission.
function createSpeakerForm() {
  const formData = new FormData();
  formData.set("name", "Anna");
  formData.set("next", `/recordings/${recordingId}`);
  formData.set("role", "client_customer");
  formData.set("speakerId", "1");
  formData.set("transcriptId", transcriptId);
  return formData;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("speaker update search warning", () => {
  it("keeps the speaker save durable and redirects to the accessible warning path", async () => {
    const transcript = {
      id: transcriptId,
      raw_text: "Dobrý den",
      recording_id: recordingId,
      segments: [{ speaker: 1, text: "Dobrý den" }],
      speakers: [],
      user_id: userId
    };
    const lookup = createQuery({ data: transcript, error: null }, "maybeSingle");
    const update = createQuery({ data: transcript, error: null }, "single");
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
      from: vi.fn().mockReturnValue(lookup)
    });
    mocks.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(update) });
    mocks.replaceTranscriptSearchChunks.mockResolvedValue({
      status: "incomplete",
      warning: TRANSCRIPT_SEARCH_INDEX_WARNING
    });

    await updateTranscriptSpeakerAction(createSpeakerForm());

    expect(update.update).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/recordings/${recordingId}`);
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/recordings/${recordingId}?warning=${TRANSCRIPT_SEARCH_INDEX_WARNING}`
    );
  });

  it("finishes a successful speaker save without adding a stale warning URL", async () => {
    const transcript = {
      id: transcriptId,
      raw_text: "Dobrý den",
      recording_id: recordingId,
      segments: [{ speaker: 1, text: "Dobrý den" }],
      speakers: [],
      user_id: userId
    };
    const lookup = createQuery({ data: transcript, error: null }, "maybeSingle");
    const update = createQuery({ data: transcript, error: null }, "single");
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
      from: vi.fn().mockReturnValue(lookup)
    });
    mocks.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(update) });
    mocks.replaceTranscriptSearchChunks.mockResolvedValue({ status: "ready", warning: null });

    await updateTranscriptSpeakerAction(createSpeakerForm());

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/recordings/${recordingId}`);
  });
});
