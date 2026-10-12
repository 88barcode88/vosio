import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveRecordingCapabilities } from "./resolve-capabilities";
import { structuredTaskStatusSchema } from "@/lib/ai/structured-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { replaceTranscriptSearchChunks } from "@/lib/transcripts/search-index";
import { getStoredTranscriptSpeakerSummaries } from "@/lib/transcripts/speakers";
import { SPEAKER_SAVE_ERROR, SPEAKER_SEARCH_WARNING, type TranscriptSpeakerSaveInput, type TranscriptSpeakerSaveResult } from "@/lib/transcripts/speaker-save-state";

export const titleEditSchema = z.object({ recordingId: z.string().uuid(), title: z.string().trim().min(1).max(160) }).strict();
export const speakerEditSchema = z.object({ transcriptId: z.string().uuid(), speakerId: z.string().trim().min(1).max(80), name: z.string().trim().max(80).nullable(), role: z.enum(["client_customer", "delivery_team", "unknown"]), revision: z.number().int().nonnegative(), expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const taskStatusEditSchema = z.object({ taskId: z.string().uuid(), status: structuredTaskStatusSchema }).strict();

export class ContentEditError extends Error {
  // Preserve app-facing failure stages while keeping database details private.
  constructor(public readonly code: "invalid_arguments" | "denied" | "conflict" | "unavailable", public readonly stage: "lookup" | "permission" | "write" | "readback" = "write") { super("Content edit could not be confirmed."); }
}

// Apply the existing locked title patch and require an exact persisted read-back.
export async function setContentTitle(supabase: SupabaseClient, input: z.infer<typeof titleEditSchema>) {
  const parsed = titleEditSchema.safeParse(input);
  if (!parsed.success) throw new ContentEditError("invalid_arguments");
  const { recordingId, title } = parsed.data;
  if (!(await resolveRecordingCapabilities(supabase, recordingId)).editTitle) throw new ContentEditError("denied", "permission");
  const result = await supabase.rpc("edit_recording_title_v1", { p_recording_id: recordingId, p_title: title });
  if (result.error) throw new ContentEditError(result.error.code === "42501" ? "denied" : "unavailable");
  const saved = await supabase.rpc("get_accessible_recording_v1", { p_recording_id: recordingId });
  if (saved.error || saved.data?.[0]?.id !== recordingId || saved.data[0].title !== title) throw new ContentEditError("conflict", "readback");
  return { recordingId, title };
}

// Apply the status-only locked RPC using current object permissions and persisted read-back.
export async function setContentTaskStatus(supabase: SupabaseClient, input: z.infer<typeof taskStatusEditSchema>) {
  const parsed = taskStatusEditSchema.safeParse(input);
  if (!parsed.success) throw new ContentEditError("invalid_arguments");
  const { taskId, status } = parsed.data;
  const { data: task, error: lookupError } = await supabase.from("transcript_tasks").select("id,transcripts!inner(recording_id)").eq("id", taskId).maybeSingle();
  const transcript = Array.isArray(task?.transcripts) ? task.transcripts[0] : task?.transcripts;
  if (lookupError || !task || !transcript?.recording_id) throw new ContentEditError("denied", "lookup");
  if (!(await resolveRecordingCapabilities(supabase, transcript.recording_id)).editTaskStatus) throw new ContentEditError("denied", "permission");
  const { error } = await supabase.rpc("edit_recording_task_status_v1", { p_task_id: taskId, p_status: status });
  if (error) throw new ContentEditError(error.code === "42501" ? "denied" : "unavailable");
  const { data: saved, error: readError } = await supabase.from("transcript_tasks").select("id,status").eq("id", taskId).maybeSingle();
  if (readError || saved?.id !== taskId || saved?.status !== status) throw new ContentEditError("conflict", "readback");
  return { taskId, status: saved.status };
}

// Patch the existing versioned speaker slot and rebuild search from a fresh restricted snapshot.
export async function patchContentSpeaker(supabase: SupabaseClient, input: TranscriptSpeakerSaveInput, timeoutMs?: number): Promise<TranscriptSpeakerSaveResult> {
  const parsed = speakerEditSchema.safeParse(input);
  if (!parsed.success) return { message: SPEAKER_SAVE_ERROR, revision: input.revision, status: "error" };
  const { data: transcript, error: transcriptError } = await supabase
    .from("transcripts")
    .select("id,recording_id,user_id,raw_text,segments,speakers")
    .eq("id", parsed.data.transcriptId)
    .maybeSingle();

  if (transcriptError || !transcript) {
    return { message: SPEAKER_SAVE_ERROR, revision: parsed.data.revision, status: "error" };
  }

  if (!(await resolveRecordingCapabilities(supabase, transcript.recording_id)).editSpeakers) {
    return { message: SPEAKER_SAVE_ERROR, revision: parsed.data.revision, status: "error" };
  }
  const { data: patch, error: updateError } = await supabase.rpc("patch_transcript_speaker_v1", {
    p_transcript_id: transcript.id, p_speaker_id: parsed.data.speakerId,
    p_expected_version: parsed.data.expectedVersion, p_name: parsed.data.name, p_role: parsed.data.role
  });
  if (updateError || !patch || !["saved", "conflict"].includes(patch.outcome)
    || patch.speaker?.id !== parsed.data.speakerId || !Number.isSafeInteger(patch.version) || patch.version < 0
    || !Number.isSafeInteger(patch.searchVersion) || patch.searchVersion < 0) {
    return { message: SPEAKER_SAVE_ERROR, revision: parsed.data.revision, status: "error" };
  }
  const savedSpeaker = getStoredTranscriptSpeakerSummaries(
    [patch.speaker], transcript.segments
  ).find((speaker) => speaker.id === parsed.data.speakerId);

  if (!savedSpeaker) {
    return { message: SPEAKER_SAVE_ERROR, revision: parsed.data.revision, status: "error" };
  }
  if (patch.outcome === "conflict") return {
    revision: parsed.data.revision, version: patch.version, savedSpeaker, status: "conflict",
    message: "Mluvčího mezitím upravil někdo jiný. Zkontrolujte aktuální údaje a případně uložení zopakujte."
  };
  const indexResult = await replaceTranscriptSearchChunks(timeoutMs === undefined ? createAdminClient() : createAdminClient({ fetchTimeoutMs: timeoutMs }), { ...transcript, search_version: patch.searchVersion });

  return {
    version: patch.version,
    revision: parsed.data.revision,
    savedSpeaker,
    searchWarning: indexResult.status === "incomplete" ? SPEAKER_SEARCH_WARNING : null,
    status: "success"
  };
}
