"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import {
  createSaveError,
  createSaveSuccess,
  type SaveActionState
} from "@/lib/forms/save-action-state";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
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
const recordingRestoreFormSchema = recordingPurgeFormSchema;
const restorableRecordingStatusSchema = z.enum([
  "created",
  "uploading",
  "uploaded",
  "transcribing",
  "completed",
  "failed"
]);
// A crashed purge becomes reclaimable after 15 minutes while its unique token blocks stale actors.
const PURGE_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const PURGE_UPLOAD_FENCE_MS = 24 * 60 * 60 * 1000;
const STORAGE_LATE_CLEANUP_ROUNDS = 3;
const STORAGE_LIST_PAGE_SIZE = 100;
const STORAGE_REMOVE_BATCH_SIZE = 100;

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
    const nextPath = getSafeNextPath(getOptionalString(formData, "next") ?? "/trash");
    redirect(appendQueryStatus(nextPath, "error", "invalid_purge"));
  }

  return parsed.data;
}

// parseRecordingRestoreForm validates a restore payload and keeps feedback on a safe URL.
function parseRecordingRestoreForm(formData: FormData) {
  const parsed = recordingRestoreFormSchema.safeParse({
    next: getOptionalString(formData, "next"),
    recordingId: getRequiredString(formData, "recordingId")
  });

  if (!parsed.success) {
    const nextPath = getSafeNextPath(getOptionalString(formData, "next") ?? "/trash");
    redirect(appendQueryStatus(nextPath, "error", "invalid_restore"));
  }

  return parsed.data;
}

type RecordingStorageTarget = {
  isSegmented: boolean;
  path: string;
};

class PurgeClaimLostError extends Error {}

// getCanonicalRecordingStorageTarget accepts only objects owned by this exact recording.
function getCanonicalRecordingStorageTarget(
  storagePath: string,
  userId: string,
  recordingId: string
): RecordingStorageTarget | null {
  if (storagePath.includes("\\")) {
    return null;
  }

  const recordingPrefix = `${userId}/${recordingId}/`;
  const livePrefix = `${recordingPrefix}live/`;

  if (storagePath === livePrefix) {
    return { isSegmented: true, path: storagePath };
  }

  if (!storagePath.startsWith(recordingPrefix)) {
    return null;
  }

  const extraSegments = storagePath.slice(recordingPrefix.length).split("/");

  if (
    extraSegments.length === 0
    || extraSegments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }

  return { isSegmented: false, path: storagePath };
}

// isSafeStorageEntryName keeps recursive listing inside the already-validated live folder.
function isSafeStorageEntryName(name: unknown): name is string {
  return typeof name === "string"
    && name.length > 0
    && name !== "."
    && name !== ".."
    && !name.includes("/")
    && !name.includes("\\");
}

// listSegmentedStorageObjects collects every stable page and nested object before deletion.
async function listSegmentedStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  storagePrefix: string
) {
  const rootFolder = storagePrefix.replace(/\/$/, "");
  const pendingFolders = [rootFolder];
  const visitedFolders = new Set<string>();
  const storageObjects = new Set<string>();
  const bucket = admin.storage.from(RECORDINGS_BUCKET);

  while (pendingFolders.length > 0) {
    const folder = pendingFolders.shift();

    if (!folder || visitedFolders.has(folder)) {
      continue;
    }

    visitedFolders.add(folder);
    let offset = 0;

    while (true) {
      const { data, error } = await bucket.list(folder, {
        limit: STORAGE_LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" }
      });

      if (error) {
        throw new Error(error.message);
      }

      const entries = data ?? [];

      for (const item of entries) {
        if (!isSafeStorageEntryName(item.name)) {
          throw new Error("Unsafe segmented storage entry.");
        }

        const itemPath = `${folder}/${item.name}`;

        if (item.id === null) {
          pendingFolders.push(itemPath);
        } else {
          storageObjects.add(itemPath);
        }
      }

      if (entries.length < STORAGE_LIST_PAGE_SIZE) {
        break;
      }

      offset += STORAGE_LIST_PAGE_SIZE;
    }
  }

  return Array.from(storageObjects);
}

// getRecordingStorageObjects resolves a validated target without mutating Storage.
async function getRecordingStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  target: RecordingStorageTarget
) {
  return target.isSegmented
    ? await listSegmentedStorageObjects(admin, target.path)
    : [target.path];
}

// refreshPurgeClaim fences each destructive batch with this actor's exact lease token.
async function refreshPurgeClaim(
  admin: ReturnType<typeof createAdminClient>,
  recordingId: string,
  userId: string,
  claimId: string
) {
  const { data, error } = await admin
    .from("recordings")
    .update({ purge_started_at: new Date().toISOString() })
    .eq("id", recordingId)
    .eq("user_id", userId)
    .eq("status", "deleted")
    .eq("purge_claim_id", claimId)
    .select("id")
    .maybeSingle();

  return !error && Boolean(data);
}

// removeRecordingStorageObjects fences and removes a fully collected object set in bounded batches.
async function removeRecordingStorageObjects(
  admin: ReturnType<typeof createAdminClient>,
  storageObjects: string[],
  recordingId: string,
  userId: string,
  claimId: string
) {
  if (storageObjects.length === 0) {
    return;
  }

  const bucket = admin.storage.from(RECORDINGS_BUCKET);

  for (let offset = 0; offset < storageObjects.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
    const ownsClaim = await refreshPurgeClaim(admin, recordingId, userId, claimId);

    if (!ownsClaim) {
      throw new PurgeClaimLostError("Recording purge claim was lost.");
    }

    const batch = storageObjects.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE);
    const { error } = await bucket.remove(batch);

    if (error) {
      throw new Error(error.message);
    }
  }
}

// releasePurgeClaim releases only the claim created by this exact action attempt.
async function releasePurgeClaim(
  admin: ReturnType<typeof createAdminClient>,
  recordingId: string,
  userId: string,
  claimId: string
) {
  await admin
    .from("recordings")
    .update({ purge_claim_id: null, purge_started_at: null })
    .eq("id", recordingId)
    .eq("user_id", userId)
    .eq("status", "deleted")
    .eq("purge_claim_id", claimId)
    .select("id")
    .maybeSingle();
}

// restoreRecordingAction restores a user-owned Trash item to its captured status through RLS.
export async function restoreRecordingAction(formData: FormData) {
  const parsed = parseRecordingRestoreForm(formData);
  const nextPath = getSafeNextPath(parsed.next ?? "/trash");
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent(clearQueryStatus(nextPath, "error"))}`);
  }

  const { data: recording, error: lookupError } = await supabase
    .from("recordings")
    .select("id,deleted_from_status")
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .eq("status", "deleted")
    .is("purge_started_at", null)
    .is("purge_claim_id", null)
    .maybeSingle();
  const previousStatus = restorableRecordingStatusSchema.safeParse(
    recording?.deleted_from_status
  );

  if (lookupError || !recording || !previousStatus.success) {
    redirect(appendQueryStatus(nextPath, "error", "restore_not_found"));
  }

  const { data: restored, error: restoreError } = await supabase
    .from("recordings")
    .update({ status: previousStatus.data })
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .eq("status", "deleted")
    .is("purge_started_at", null)
    .is("purge_claim_id", null)
    .select("id")
    .maybeSingle();

  if (restoreError || !restored) {
    redirect(appendQueryStatus(nextPath, "error", "restore_failed"));
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath(`/recordings/${parsed.recordingId}`);
  revalidatePath("/trash");
  redirect(clearQueryStatus(nextPath, "error"));
}

// Updates a user-owned recording title and returns a scoped editor settlement.
export async function updateRecordingTitleStateAction(
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const submittedRecordingId = getRequiredString(formData, "recordingId");
  const parsed = recordingTitleFormSchema.safeParse({
    recordingId: submittedRecordingId,
    title: getRequiredString(formData, "title")
  });

  if (!parsed.success) {
    return createSaveError(
      previousState.revision,
      submittedRecordingId || null,
      "Zkontrolujte název nahrávky."
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return createSaveError(
        previousState.revision,
        parsed.data.recordingId,
        "Přihlášení vypršelo. Přihlaste se a zkuste to znovu."
      );
    }

    const result = await supabase
      .from("recordings")
      .update({ title: parsed.data.title })
      .eq("id", parsed.data.recordingId)
      .eq("user_id", user.id)
      .neq("status", "deleted")
      .select("id,title")
      .maybeSingle();

    if (result.error || !result.data) {
      return createSaveError(
        previousState.revision,
        parsed.data.recordingId,
        "Název se nepodařilo uložit."
      );
    }

    revalidatePath("/");
    revalidatePath("/recordings");
    revalidatePath(`/recordings/${parsed.data.recordingId}`);

    return createSaveSuccess(
      previousState.revision,
      parsed.data.recordingId,
      "Název byl uložen."
    );
  } catch {
    return createSaveError(
      previousState.revision,
      parsed.data.recordingId,
      "Název se nepodařilo uložit. Zkuste to znovu."
    );
  }
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
    redirect(`/login?next=${encodeURIComponent(clearQueryStatus(nextPath, "error"))}`);
  }

  const admin = createAdminClient();
  const purgeEligibleBefore = new Date(Date.now() - PURGE_UPLOAD_FENCE_MS).toISOString();
  const { data: recording, error: lookupError } = await admin
    .from("recordings")
    .select("id,storage_path,deleted_at")
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .eq("status", "deleted")
    .lte("deleted_at", purgeEligibleBefore)
    .maybeSingle();

  if (lookupError) {
    redirect(appendQueryStatus(nextPath, "error", "purge_not_found"));
  }

  if (!recording) {
    const { data: recentRecording, error: recentLookupError } = await admin
      .from("recordings")
      .select("id")
      .eq("id", parsed.recordingId)
      .eq("user_id", user.id)
      .eq("status", "deleted")
      .maybeSingle();

    if (recentLookupError || !recentRecording) {
      redirect(appendQueryStatus(nextPath, "error", "purge_not_found"));
    }

    redirect(appendQueryStatus(nextPath, "error", "purge_too_recent"));
  }

  let storageTarget: RecordingStorageTarget | null = null;

  if (recording.storage_path) {
    storageTarget = getCanonicalRecordingStorageTarget(
      recording.storage_path,
      user.id,
      parsed.recordingId
    );

    if (!storageTarget) {
      redirect(appendQueryStatus(nextPath, "error", "purge_failed"));
    }
  }

  const claimId = randomUUID();
  const claimStartedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - PURGE_CLAIM_TIMEOUT_MS).toISOString();
  let claimQuery = admin
    .from("recordings")
    .update({ purge_claim_id: claimId, purge_started_at: claimStartedAt })
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .eq("status", "deleted")
    .lte("deleted_at", purgeEligibleBefore)
    .or(`purge_started_at.is.null,purge_started_at.lt.${staleBefore}`);

  claimQuery = recording.storage_path === null
    ? claimQuery.is("storage_path", null)
    : claimQuery.eq("storage_path", recording.storage_path);

  const { data: claimed, error: claimError } = await claimQuery
    .select("id,storage_path")
    .maybeSingle();

  if (claimError) {
    redirect(appendQueryStatus(nextPath, "error", "purge_failed"));
  }

  if (!claimed || claimed.storage_path !== recording.storage_path) {
    redirect(appendQueryStatus(nextPath, "error", "purge_in_progress"));
  }

  let storageObjects: string[] = [];

  if (storageTarget) {
    try {
      storageObjects = await getRecordingStorageObjects(admin, storageTarget);
    } catch {
      await releasePurgeClaim(admin, parsed.recordingId, user.id, claimId);
      redirect(appendQueryStatus(nextPath, "error", "purge_storage_failed"));
    }

    try {
      await removeRecordingStorageObjects(
        admin,
        storageObjects,
        parsed.recordingId,
        user.id,
        claimId
      );
    } catch (error) {
      const errorCode = error instanceof PurgeClaimLostError
        ? "purge_failed"
        : "purge_storage_failed";
      redirect(appendQueryStatus(nextPath, "error", errorCode));
    }
  }

  const verificationTarget: RecordingStorageTarget = {
    isSegmented: true,
    path: `${user.id}/${parsed.recordingId}/`
  };
  let storageIsEmpty = false;

  for (let round = 0; round <= STORAGE_LATE_CLEANUP_ROUNDS; round += 1) {
    const ownsClaim = await refreshPurgeClaim(admin, parsed.recordingId, user.id, claimId);

    if (!ownsClaim) {
      redirect(appendQueryStatus(nextPath, "error", "purge_failed"));
    }

    let lateStorageObjects: string[];

    try {
      lateStorageObjects = await getRecordingStorageObjects(admin, verificationTarget);
    } catch {
      redirect(appendQueryStatus(nextPath, "error", "purge_storage_failed"));
    }

    if (lateStorageObjects.length === 0) {
      storageIsEmpty = true;
      break;
    }

    if (round === STORAGE_LATE_CLEANUP_ROUNDS) {
      break;
    }

    try {
      await removeRecordingStorageObjects(
        admin,
        lateStorageObjects,
        parsed.recordingId,
        user.id,
        claimId
      );
    } catch (error) {
      const errorCode = error instanceof PurgeClaimLostError
        ? "purge_failed"
        : "purge_storage_failed";
      redirect(appendQueryStatus(nextPath, "error", errorCode));
    }
  }

  if (!storageIsEmpty) {
    redirect(appendQueryStatus(nextPath, "error", "purge_storage_failed"));
  }

  const { data: deleted, error: deleteError } = await admin
    .from("recordings")
    .delete()
    .eq("id", parsed.recordingId)
    .eq("user_id", user.id)
    .eq("status", "deleted")
    .eq("purge_claim_id", claimId)
    .select("id")
    .maybeSingle();

  if (deleteError || !deleted) {
    redirect(appendQueryStatus(nextPath, "error", "purge_failed"));
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath("/trash");
  redirect(clearQueryStatus(nextPath, "error"));
}

// appendQueryStatus preserves existing safe URL state while replacing one feedback value.
function appendQueryStatus(path: string, key: string, value: string) {
  const url = new URL(path, "https://vosio.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

// clearQueryStatus removes stale feedback without changing other safe URL state.
function clearQueryStatus(path: string, key: string) {
  const url = new URL(path, "https://vosio.local");
  url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}
