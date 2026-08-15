import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  replaceTranscriptSearchChunks
} from "@/lib/transcripts/search-index";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING,
  getTranscriptSearchWarningPayload
} from "@/lib/transcripts/search-warning";

const savedTranscript = {
  id: "00000000-0000-4000-8000-000000000101",
  raw_text: "Dobrý den.",
  recording_id: "00000000-0000-4000-8000-000000000102",
  segments: [
    { end_ms: 800, speaker: 1, start_ms: 100, text: "Dobrý " },
    { end_ms: 1_200, speaker: 1, start_ms: 900, text: "den." }
  ],
  speakers: [],
  user_id: "00000000-0000-4000-8000-000000000103"
};

// createAdminStub provides only the RPC surface used by the search-index helper.
function createAdminStub(error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error });

  return { admin: { rpc } as unknown as SupabaseClient, rpc };
}

describe("transcript search index synchronization", () => {
  it("serializes deterministic chunks into the atomic replacement RPC", async () => {
    const { admin, rpc } = createAdminStub();

    await expect(replaceTranscriptSearchChunks(admin, savedTranscript)).resolves.toEqual({
      status: "ready",
      warning: null
    });
    expect(rpc).toHaveBeenCalledWith("replace_transcript_search_chunks_v1", {
      p_chunks: [
        {
          end_ms: 1_200,
          position: 1,
          speaker_label: "Mluvčí 1",
          start_ms: 100,
          text: "Dobrý den."
        }
      ],
      p_transcript_id: savedTranscript.id
    });
  });

  it("sends an empty replacement so stale chunks are deleted", async () => {
    const { admin, rpc } = createAdminStub();

    await replaceTranscriptSearchChunks(admin, {
      ...savedTranscript,
      raw_text: "",
      segments: [],
      speakers: []
    });

    expect(rpc).toHaveBeenCalledWith("replace_transcript_search_chunks_v1", {
      p_chunks: [],
      p_transcript_id: savedTranscript.id
    });
  });

  it("returns and logs a sanitized incomplete warning without throwing after RPC failure", async () => {
    const { admin } = createAdminStub({ message: "provider detail must stay private" });
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await replaceTranscriptSearchChunks(admin, savedTranscript);

    expect(result).toEqual({
      status: "incomplete",
      warning: TRANSCRIPT_SEARCH_INDEX_WARNING
    });
    expect(warningSpy).toHaveBeenCalledWith(
      "[Vosio transcript search] Precise transcript index is incomplete."
    );
    expect(JSON.stringify(warningSpy.mock.calls)).not.toContain("provider detail");
    expect(getTranscriptSearchWarningPayload(result)).toEqual({
      warnings: [TRANSCRIPT_SEARCH_INDEX_WARNING]
    });
    warningSpy.mockRestore();
  });

  it("settles as incomplete when the RPC client throws", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network detail must stay private"));
    const admin = { rpc } as unknown as SupabaseClient;
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(replaceTranscriptSearchChunks(admin, savedTranscript)).resolves.toEqual({
      status: "incomplete",
      warning: TRANSCRIPT_SEARCH_INDEX_WARNING
    });
    expect(JSON.stringify(warningSpy.mock.calls)).not.toContain("network detail");
    warningSpy.mockRestore();
  });

  it("rejects an invalid saved transcript identity before calling the service RPC", async () => {
    const { admin, rpc } = createAdminStub();
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await replaceTranscriptSearchChunks(admin, {
      ...savedTranscript,
      recording_id: "not-a-saved-uuid"
    });

    expect(result.status).toBe("incomplete");
    expect(rpc).not.toHaveBeenCalled();
    warningSpy.mockRestore();
  });

  it.each([
    ["manual import", "app/api/recordings/import-transcript/route.ts", 1, 1],
    ["live draft", "app/api/recordings/[recordingId]/live-draft/route.ts", 1, 1],
    ["live final", "app/api/recordings/[recordingId]/live-transcript/route.ts", 1, 0],
    ["async and segmented transcription", "app/api/recordings/[recordingId]/transcription/route.ts", 2, 2],
    ["live recovery", "app/api/recordings/[recordingId]/recover-live/route.ts", 1, 1]
  ])("synchronizes %s only from saved transcript rows and exposes failure warnings", (
    _name,
    path,
    calls,
    warningCalls
  ) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");

    expect(source).toContain("id,recording_id,user_id,raw_text,segments,speakers");
    expect(source.match(/await replaceTranscriptSearchChunks\(/g)).toHaveLength(calls);
    expect(source.match(/getTranscriptSearchWarningPayload\(/g) ?? []).toHaveLength(warningCalls);
  });

  it("awaits search synchronization before returning the speaker autosave state", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "transcripts", "actions.ts"),
      "utf8"
    );

    expect(source).toContain("id,recording_id,user_id,raw_text,segments,speakers");
    expect(source).toContain("saveTranscriptSpeakerAutosaveAction");
    expect(source.match(/await replaceTranscriptSearchChunks\(/g)).toHaveLength(1);
    expect(source).toContain("searchWarning:");
    expect(source).not.toContain("getTranscriptSearchWarningPayload(");
  });
});
