"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { updateTranscriptSpeakerSummary } from "@/lib/transcripts/speakers";

const speakerRoleSchema = z.enum(["client_customer", "delivery_team", "unknown"]);

const transcriptSpeakerFormSchema = z.object({
  name: z.string().trim().max(80).optional(),
  next: z.string().optional(),
  role: speakerRoleSchema,
  speakerId: z.string().trim().min(1).max(80),
  transcriptId: z.string().uuid()
});

// getRequiredString reads a required text field for transcript server actions.
function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
}

// getOptionalString reads an optional text field for transcript server actions.
function getOptionalString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" && value ? value : undefined;
}

// parseTranscriptSpeakerForm validates manual speaker assignment form data.
function parseTranscriptSpeakerForm(formData: FormData) {
  const parsed = transcriptSpeakerFormSchema.safeParse({
    name: getOptionalString(formData, "name"),
    next: getOptionalString(formData, "next"),
    role: getRequiredString(formData, "role"),
    speakerId: getRequiredString(formData, "speakerId"),
    transcriptId: getRequiredString(formData, "transcriptId")
  });

  if (!parsed.success) {
    redirect("/recordings?error=invalid_speaker_update");
  }

  return parsed.data;
}

// updateTranscriptSpeakerAction saves a user-confirmed speaker name and business role.
export async function updateTranscriptSpeakerAction(formData: FormData) {
  const parsed = parseTranscriptSpeakerForm(formData);
  const nextPath = getSafeNextPath(parsed.next);
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { data: transcript, error: transcriptError } = await supabase
    .from("transcripts")
    .select("id,recording_id,segments,speakers,user_id")
    .eq("id", parsed.transcriptId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (transcriptError || !transcript) {
    redirect(`${nextPath}?error=speaker_transcript_not_found`);
  }

  const nextSpeakers = updateTranscriptSpeakerSummary(
    transcript.speakers,
    transcript.segments,
    {
      name: parsed.name ?? null,
      role: parsed.role,
      speakerId: parsed.speakerId
    }
  );
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("transcripts")
    .update({ speakers: nextSpeakers })
    .eq("id", transcript.id)
    .eq("user_id", user.id);

  if (updateError) {
    redirect(`${nextPath}?error=speaker_update_failed`);
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath(`/recordings/${transcript.recording_id}`);
  revalidatePath(nextPath);
}
