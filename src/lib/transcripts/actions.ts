"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  SPEAKER_SAVE_ERROR,
  type TranscriptSpeakerSaveInput,
  type TranscriptSpeakerSaveResult
} from "@/lib/transcripts/speaker-save-state";
import { patchContentSpeaker } from "@/lib/recording-sharing/content-edits.server";

const speakerRoleSchema = z.enum(["client_customer", "delivery_team", "unknown"]);

const transcriptSpeakerSaveSchema = z.object({
  name: z.string().trim().max(80).nullable(),
  revision: z.number().int().nonnegative(),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  role: speakerRoleSchema,
  speakerId: z.string().trim().min(1).max(80),
  transcriptId: z.string().uuid()
});

// Patch one versioned DB speaker slot; conflicts return fresh state without overwriting another writer.
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

  const result = await patchContentSpeaker(supabase, parsed.data);
  if (result.status === "success") revalidatePath("/recordings");
  return result;
}
