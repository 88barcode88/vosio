"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { replaceTranscriptSearchChunks } from "@/lib/transcripts/search-index";
import {
  SPEAKER_SAVE_ERROR,
  SPEAKER_SEARCH_WARNING,
  type TranscriptSpeakerSaveInput,
  type TranscriptSpeakerSaveResult
} from "@/lib/transcripts/speaker-save-state";
import {
  getStoredTranscriptSpeakerSummaries,
  updateTranscriptSpeakerSummary
} from "@/lib/transcripts/speakers";

const speakerRoleSchema = z.enum(["client_customer", "delivery_team", "unknown"]);

const transcriptSpeakerSaveSchema = z.object({
  name: z.string().trim().max(80).nullable(),
  revision: z.number().int().nonnegative(),
  role: speakerRoleSchema,
  speakerId: z.string().trim().min(1).max(80),
  transcriptId: z.string().uuid()
});

// saveTranscriptSpeakerAutosaveAction persists one queued speaker snapshot without redirecting the editor.
export async function saveTranscriptSpeakerAutosaveAction(
  input: TranscriptSpeakerSaveInput
): Promise<TranscriptSpeakerSaveResult> {
  const parsed = transcriptSpeakerSaveSchema.safeParse(input);

  if (!parsed.success) {
    return { message: SPEAKER_SAVE_ERROR, revision: input.revision, status: "error" };
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      message: "Přihlášení vypršelo. Obnovte stránku.",
      revision: parsed.data.revision,
      status: "error"
    };
  }

  const { data: transcript, error: transcriptError } = await supabase
    .from("transcripts")
    .select("id,recording_id,user_id,raw_text,segments,speakers")
    .eq("id", parsed.data.transcriptId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (transcriptError || !transcript) {
    return { message: SPEAKER_SAVE_ERROR, revision: parsed.data.revision, status: "error" };
  }

  const nextSpeakers = updateTranscriptSpeakerSummary(
    transcript.speakers,
    transcript.segments,
    parsed.data
  );
  const admin = createAdminClient();
  const { data: savedTranscript, error: updateError } = await admin
    .from("transcripts")
    .update({ speakers: nextSpeakers })
    .eq("id", transcript.id)
    .eq("user_id", user.id)
    .select("id,recording_id,user_id,raw_text,segments,speakers")
    .single();

  if (updateError || !savedTranscript) {
    return { message: SPEAKER_SAVE_ERROR, revision: parsed.data.revision, status: "error" };
  }

  const indexResult = await replaceTranscriptSearchChunks(admin, savedTranscript);
  const savedSpeaker = getStoredTranscriptSpeakerSummaries(
    savedTranscript.speakers,
    savedTranscript.segments
  ).find((speaker) => speaker.id === parsed.data.speakerId);

  if (!savedSpeaker) {
    return { message: SPEAKER_SAVE_ERROR, revision: parsed.data.revision, status: "error" };
  }

  revalidatePath("/recordings");

  return {
    revision: parsed.data.revision,
    savedSpeaker,
    searchWarning: indexResult.status === "incomplete" ? SPEAKER_SEARCH_WARNING : null,
    status: "success"
  };
}
