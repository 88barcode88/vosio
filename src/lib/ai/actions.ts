"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";

const aiOutputDeleteFormSchema = z.object({
  next: z.string().optional(),
  outputIds: z.array(z.uuid()).min(1).max(20)
});

// getOptionalString reads an optional text field for AI output actions.
function getOptionalString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" && value ? value : undefined;
}

// getRequiredUuidArray reads repeatable hidden ids for grouped AI output deletion.
function getRequiredUuidArray(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

// parseAiOutputDeleteForm validates the delete form for one or grouped stored AI outputs.
function parseAiOutputDeleteForm(formData: FormData) {
  const parsed = aiOutputDeleteFormSchema.safeParse({
    next: getOptionalString(formData, "next"),
    outputIds: getRequiredUuidArray(formData, "outputIds")
  });

  if (!parsed.success) {
    const nextPath = getSafeNextPath(getOptionalString(formData, "next"));
    redirect(appendQueryStatus(nextPath, "error", "invalid_ai_output_delete"));
  }

  return parsed.data;
}

// Deletes exact manager-authorized saved artifacts through locked session RPCs, retaining job metadata.
export async function deleteAiOutputAction(formData: FormData) {
  const parsed = parseAiOutputDeleteForm(formData);
  const uniqueOutputIds = Array.from(new Set(parsed.outputIds));
  const nextPath = getSafeNextPath(parsed.next);
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  let failed = false;
  const removedOutputIds: string[] = [];
  try {
    for (const outputId of uniqueOutputIds) {
      const { data: output, error: outputError } = await supabase.from("ai_outputs")
        .select("id,transcript_id").eq("id", outputId).maybeSingle();
      if (outputError || !output) { failed = true; break; }
      const { data: transcript, error: transcriptError } = await supabase.from("transcripts")
        .select("recording_id").eq("id", output.transcript_id).maybeSingle();
      if (transcriptError || !transcript || !(await resolveRecordingCapabilities(supabase, transcript.recording_id)).delete) { failed = true; break; }
      const { data, error } = await supabase.rpc("delete_managed_ai_output_v1", { p_output_id: outputId });
      if (error || data?.deletedId !== outputId || data?.recordingId !== transcript.recording_id) { failed = true; break; }
      removedOutputIds.push(outputId);
      revalidatePath(`/recordings/${transcript.recording_id}`);
    }
  } catch { failed = true; }
  if (failed) redirect(appendQueryStatus(nextPath, "error", "ai_output_delete_failed"));

  revalidatePath("/");
  revalidatePath("/ai");
  revalidatePath("/recordings");
  revalidatePath(nextPath);
  if (formData.get("completion") === "quiet") {
    return { removed_output_ids: removedOutputIds };
  }
  redirect(nextPath);
}

// appendQueryStatus preserves existing archive filters while replacing one safe feedback value.
function appendQueryStatus(path: string, key: string, value: string) {
  const url = new URL(path, "https://vosio.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
