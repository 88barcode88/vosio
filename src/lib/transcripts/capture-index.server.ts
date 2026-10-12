import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { replaceTranscriptSearchChunks } from "@/lib/transcripts/search-index";
import { TRANSCRIPT_SEARCH_INDEX_WARNING } from "@/lib/transcripts/search-warning";

// Index only a durable receipt's transcript; the existing version fence rejects concurrent stale work.
export async function indexCapturedTranscript(admin: SupabaseClient, transcriptId: string) {
  try {
    const { data, error } = await admin.from("transcripts").select("id,recording_id,user_id,raw_text,segments,speakers,search_version")
      .eq("id", transcriptId).maybeSingle();
    if (!error && data) return await replaceTranscriptSearchChunks(admin, data);
  } catch { /* Durable text remains searchable through the transactional raw-text fallback. */ }
  return { status: "incomplete" as const, warning: TRANSCRIPT_SEARCH_INDEX_WARNING };
}
