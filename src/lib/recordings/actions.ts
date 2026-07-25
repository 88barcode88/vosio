"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { RECORDINGS_BUCKET, isSegmentedRecordingStoragePath } from "@/lib/recordings/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const recordingTitleFormSchema = z.object({
  recordingId: z.string().uuid(),
  title: z.string().trim().min(1).max(160)
});

const recordingDeleteFormSchema = z.object({
  next: z.enum(["/recordings"]).optional(),
  recordingId: z.string().uuid()
});
const recordingPurgeFormSchema = z.object({
  next: z.string().optional(),
  recordingId: z.string().uuid()
});

// getRequiredString reads a required text field for recording server actions.
function getRequiredString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
}

// getOptionalString reads an optional text field for recording server actions.
function getOptionalString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" && value ? value : undefined;
}

// parseRecordingTitleForm validates the recording rename form payload.
function parseRecordingTitleForm(formData: FormData) {
  const parsed = recordingTitleFormSchema.safeParse({
    recordingId: getRequiredString(formData, "recordingId"),
    title: getRequiredString(formData, "title")
  });

  if (!parsed.success) {
    redirect("/recordings?error=invalid_title");
  }

  return parsed.data;
}

// parseRecordingDeleteForm validates the soft-delete recording form payload.
function parseRecordingDeleteForm(formData: FormData) {
  const parsed = recordingDeleteFormSchema.safeParse({
    next: getOptionalString(formData, "next"),
    recordingId: getRequiredString(formData, "recordingId")
  });

  if (!parsed.success) {
    redirect("/recordings?error=invalid_delete");
  }

  return parsed.data;
}

// parseRecordingPurgeForm validates permanent deletion for a Trash recording.
function parseRecordingPurgeForm(formData: FormData) {
  const parsed = recordingPurgeFormSchema.safeParse({
    next: getOptionalString(formData, "next"),
    recordingId: getRequiredString(formData, "recordingId")
  });

  if (!parsed.success) {
    redirect("/trash?error=invalid_purge");
  }

  return parsed.data;
}

// listSegmentedStorageObjects expands a live recording storage prefix into concrete object paths.
async function listSegmentedStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  storagePrefix: string
) {
  const folder = storagePrefix.replace(/\/$/, "");
  const { data, error } = await admin.storage.from(RECORDINGS_BUCKET).list(folder);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).filter((item) => item.name).map((item) => `${folder}/${item.name}`);
}

// removeRecordingStorageObjects deletes either one stored object or all live recording segments.
async function removeRecordingStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  storagePath: string
) {
  const storageObjects = isSegmentedRecordingStoragePath(storagePath)
    ? await listSegmentedStorageObjects(admin, storagePath)
    : [storagePath];

  if (storageObjects.length === 0) {
    return;
  }

  const { error } = await admin.storage.from(RECORDINGS_BUCKET).remove(storageObjects);

  if (error) {
    throw new Error(error.message);
  }
}

// updateRecordingTitleAction updates the user-owned recording title through Supabase RLS.
export async function updateRecordingTitleAction(formData: FormData) {
  const parsed = parseRecordingTitleForm(formData);
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/recordings");
  }

  const { data, error } = await supabase
    .from("recordings")
    .update({ title: parsed.title })
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirect("/recordings?error=title_update_failed");
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath(`/recordings/${parsed.recordingId}`);
}

// deleteRecordingAction soft-deletes a user-owned recording so it appears in Trash.
export async function deleteRecordingAction(formData: FormData) {
  const parsed = parseRecordingDeleteForm(formData);
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login?next=/recordings");
  }

  const { data, error } = await supabase
    .from("recordings")
    .update({ status: "deleted" })
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .neq("status", "deleted")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirect("/recordings?error=delete_failed");
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath(`/recordings/${parsed.recordingId}`);
  revalidatePath("/trash");

  if (parsed.next) {
    redirect(parsed.next);
  }
}

// purgeRecordingAction permanently deletes a user-owned Trash item and its storage object.
export async function purgeRecordingAction(formData: FormData) {
  const parsed = parseRecordingPurgeForm(formData);
  const nextPath = getSafeNextPath(parsed.next ?? "/trash");
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const admin = createAdminClient();
  const { data: recording, error: lookupError } = await admin
    .from("recordings")
    .select("id,storage_path")
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .eq("status", "deleted")
    .maybeSingle();

  if (lookupError || !recording) {
    redirect(`${nextPath}?error=purge_not_found`);
  }

  if (recording.storage_path) {
    try {
      await removeRecordingStorageObjects(admin, recording.storage_path);
    } catch {
      redirect(`${nextPath}?error=purge_storage_failed`);
    }
  }

  const { error: deleteError } = await admin
    .from("recordings")
    .delete()
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .eq("status", "deleted");

  if (deleteError) {
    redirect(`${nextPath}?error=purge_failed`);
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath("/trash");
  redirect(nextPath);
}
