import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn(), replaceTranscriptSearchChunks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/transcripts/search-index", () => ({ replaceTranscriptSearchChunks: mocks.replaceTranscriptSearchChunks }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveTranscriptSpeakerAutosaveAction } from "@/lib/transcripts/actions";
const input = { transcriptId: "10000000-0000-4000-8000-000000000001", speakerId: "1", name: "Eva", role: "client_customer" as const, revision: 3, expectedVersion: 7 };
// Mock session identity, transcript lineage and the versioned DB patch receipt.
function setup(outcome = "saved", canEdit = true) {
  const transcript = { id: input.transcriptId, recording_id: "recording", user_id: "owner", speakers: [{ id: "1", name: "Eva", role: input.role }], segments: [] };
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: transcript, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const rpc = vi.fn(async (name: string) => ({ error: null, data: name === "recording_capabilities_v1"
    ? { ...NO_RECORDING_CAPABILITIES, read: true, editSpeakers: canEdit }
    : { outcome, speaker: transcript.speakers[0], version: 8, searchVersion: 12 } }));
  mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "editor" } }, error: null }) }, from: vi.fn(() => query), rpc });
  mocks.createAdminClient.mockReturnValue({});
  mocks.replaceTranscriptSearchChunks.mockResolvedValue({ status: "ready" });
  return rpc;
}
beforeEach(() => vi.clearAllMocks());
describe("shared speaker patch", () => {
  it("passes the expected DB slot version and reports the saved version", async () => {
    const rpc = setup();
    expect(await saveTranscriptSpeakerAutosaveAction(input)).toMatchObject({ status: "success", version: 8, revision: 3 });
    expect(rpc).toHaveBeenCalledWith("patch_transcript_speaker_v1", { p_transcript_id: input.transcriptId, p_speaker_id: "1", p_expected_version: 7, p_name: "Eva", p_role: input.role });
  });
  it("returns a fresh conflict without overwriting or starting reindex", async () => {
    setup("conflict");
    expect(await saveTranscriptSpeakerAutosaveAction(input)).toMatchObject({ status: "conflict", version: 8, savedSpeaker: { name: "Eva" } });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.replaceTranscriptSearchChunks).not.toHaveBeenCalled();
  });
  it("denies reader/revoked updates without invoking the patch or admin", async () => {
    const rpc = setup("saved", false);
    expect(await saveTranscriptSpeakerAutosaveAction(input)).toMatchObject({ status: "error" });
    expect(rpc).not.toHaveBeenCalledWith("patch_transcript_speaker_v1", expect.anything());
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
