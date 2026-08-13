"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

// deleteAiOutputAction removes user-owned AI outputs while keeping processing usage metadata.
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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_outputs")
    .delete()
    .in("id", uniqueOutputIds)
    .eq("user_id", user.id)
    .select("id,transcript_id")
    .returns<Array<{ id: string; transcript_id: string }>>();

  if (error || !data || data.length !== uniqueOutputIds.length) {
    redirect(appendQueryStatus(nextPath, "error", "ai_output_delete_failed"));
  }

  revalidatePath("/");
  revalidatePath("/ai");
  revalidatePath("/recordings");
  revalidatePath(nextPath);
  redirect(nextPath);
}

// appendQueryStatus preserves existing archive filters while replacing one safe feedback value.
function appendQueryStatus(path: string, key: string, value: string) {
  const url = new URL(path, "https://vosio.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
