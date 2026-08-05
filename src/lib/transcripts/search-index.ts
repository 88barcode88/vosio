import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTranscriptSearchChunks } from "@/lib/transcripts/search-chunks";
import { TRANSCRIPT_SEARCH_INDEX_WARNING } from "@/lib/transcripts/search-warning";

export type SavedTranscriptSearchSource = {
  id: string;
  raw_text: unknown;
  recording_id: string;
  segments: unknown;
  speakers: unknown;
  user_id: string;
};

export type TranscriptSearchIndexResult =
  | { status: "ready"; warning: null }
  | { status: "incomplete"; warning: typeof TRANSCRIPT_SEARCH_INDEX_WARNING };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// hasSavedTranscriptIdentity verifies that indexing is tied to one persisted owner/recording row.
function hasSavedTranscriptIdentity(transcript: SavedTranscriptSearchSource) {
  return uuidPattern.test(transcript.id)
    && uuidPattern.test(transcript.recording_id)
    && uuidPattern.test(transcript.user_id);
}

// getIncompleteIndexResult logs no provider detail and preserves the durable transcript result.
function getIncompleteIndexResult(): TranscriptSearchIndexResult {
  console.warn("[Vosio transcript search] Precise transcript index is incomplete.");

  return { status: "incomplete", warning: TRANSCRIPT_SEARCH_INDEX_WARNING };
}

// replaceTranscriptSearchChunks atomically replaces precise chunks for one persisted transcript.
export async function replaceTranscriptSearchChunks(
  admin: SupabaseClient,
  transcript: SavedTranscriptSearchSource
): Promise<TranscriptSearchIndexResult> {
  if (!hasSavedTranscriptIdentity(transcript)) {
    return getIncompleteIndexResult();
  }

  try {
    const chunks = buildTranscriptSearchChunks({
      rawText: transcript.raw_text,
      segments: transcript.segments,
      speakers: transcript.speakers
    }).map((chunk) => ({
      end_ms: chunk.endMs,
      position: chunk.position,
      speaker_label: chunk.speakerLabel,
      start_ms: chunk.startMs,
      text: chunk.text
    }));
    const { error } = await admin.rpc("replace_transcript_search_chunks_v1", {
      p_chunks: chunks,
      p_transcript_id: transcript.id
    });

    if (error) {
      return getIncompleteIndexResult();
    }
  } catch {
    return getIncompleteIndexResult();
  }

  return { status: "ready", warning: null };
}
