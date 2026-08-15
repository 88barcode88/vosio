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
const BULK_TRASH_LIMIT = 100;
const recordingBulkFormSchema = z.object({
  recordingIds: z.array(z.string().uuid()).min(1).max(BULK_TRASH_LIMIT)
});
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

export type TrashMutationCode =
  | "invalid_bulk"
  | "invalid_item"
  | "restore_not_found"
  | "restore_failed"
  | "purge_not_found"
  | "purge_too_recent"
  | "purge_in_progress"
  | "purge_storage_failed"
  | "purge_failed";

export type TrashBulkResult = {
  succeededIds: string[];
  failures: Array<{ id: string; code: TrashMutationCode }>;
};

export type TrashItemResult =
  | { id: string; ok: true }
  | { id: string; ok: false; code: TrashMutationCode };

class TrashMutationError extends Error {
  constructor(readonly code: TrashMutationCode) {
    super(code);
  }
}

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

// parseRecordingBulkForm validates a bounded, stable and deduplicated UUID list.
function parseRecordingBulkForm(formData: FormData) {
  const recordingIds = Array.from(new Set(
    formData.getAll("recordingId").filter((value): value is string => typeof value === "string")
  ));
  return recordingBulkFormSchema.safeParse({ recordingIds });
}

// parseSingleRecordingMutationForm accepts exactly one UUID for one bounded purge request.
function parseSingleRecordingMutationForm(formData: FormData) {
  const values = formData.getAll("recordingId");
  if (values.length !== 1 || typeof values[0] !== "string") return null;
  const parsed = z.string().uuid().safeParse(values[0]);
  return parsed.success ? parsed.data : null;
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

// requireTrashUser authenticates a single redirecting form action.
async function requireTrashUser(nextPath: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) {
    redirect(`/login?next=${encodeURIComponent(clearQueryStatus(nextPath, "error"))}`);
  }
  return { supabase, user };
}

// requireTrashUserWithoutRedirect authenticates bulk actions without constructing a user-controlled redirect.
async function requireTrashUserWithoutRedirect() {
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { supabase, user };
}

// revalidateTrashPaths refreshes every list affected by a successful single mutation.
function revalidateTrashPaths(recordingId: string) {
  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath(`/recordings/${recordingId}`);
  revalidatePath("/trash");
}

// restoreRecordingForUser restores one exact deleted row while its purge lease is unclaimed.
async function restoreRecordingForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  recordingId: string
): Promise<void> {
  const { data: recording, error: lookupError } = await supabase
    .from("recordings")
    .select("id,deleted_from_status")
    .eq("id", recordingId)
    .eq("user_id", userId)
    .eq("status", "deleted")
    .is("purge_started_at", null)
    .is("purge_claim_id", null)
    .maybeSingle();
  const previousStatus = restorableRecordingStatusSchema.safeParse(recording?.deleted_from_status);

  if (lookupError || !recording || !previousStatus.success) {
    throw new TrashMutationError("restore_not_found");
  }

  const { data: restored, error: restoreError } = await supabase
    .from("recordings")
    .update({ status: previousStatus.data })
    .eq("id", recordingId)
    .eq("user_id", userId)
    .eq("status", "deleted")
    .is("purge_started_at", null)
    .is("purge_claim_id", null)
    .select("id")
    .maybeSingle();

  if (restoreError || !restored) {
    throw new TrashMutationError("restore_failed");
  }
}

// restoreRecordingAction restores a user-owned Trash item to its captured status through RLS.
export async function restoreRecordingAction(formData: FormData) {
  const parsed = parseRecordingRestoreForm(formData);
  const nextPath = getSafeNextPath(parsed.next ?? "/trash");
  const { supabase, user } = await requireTrashUser(nextPath);
  try {
    await restoreRecordingForUser(supabase, user.id, parsed.recordingId);
  } catch (error) {
    const code = error instanceof TrashMutationError ? error.code : "restore_failed";
    redirect(appendQueryStatus(nextPath, "error", code));
  }
  revalidateTrashPaths(parsed.recordingId);
  redirect(clearQueryStatus(nextPath, "error"));
}

// restoreRecordingsBulkAction restores a bounded ordered set and reports sanitized partial results.
export async function restoreRecordingsBulkAction(formData: FormData): Promise<TrashBulkResult> {
  const parsed = parseRecordingBulkForm(formData);
  if (!parsed.success) {
    return { succeededIds: [], failures: [{ id: "bulk", code: "invalid_bulk" }] };
  }
  const { supabase, user } = await requireTrashUserWithoutRedirect();
  const result: TrashBulkResult = { succeededIds: [], failures: [] };

  for (const recordingId of parsed.data.recordingIds) {
    try {
      await restoreRecordingForUser(supabase, user.id, recordingId);
      result.succeededIds.push(recordingId);
    } catch (error) {
      result.failures.push({
        id: recordingId,
        code: error instanceof TrashMutationError ? error.code : "restore_failed"
      });
    }
  }
  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath("/trash");
  return result;
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

// purgeRecordingForUser permanently deletes one exact user-owned row and its verified storage prefix.
async function purgeRecordingForUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  recordingId: string,
  nowMs: number
): Promise<void> {
  const purgeEligibleBefore = new Date(nowMs - PURGE_UPLOAD_FENCE_MS).toISOString();
  const { data: recording, error: lookupError } = await admin
    .from("recordings")
    .select("id,storage_path,deleted_at")
    .eq("id", recordingId)
    .eq("user_id", userId)
    .eq("status", "deleted")
    .lte("deleted_at", purgeEligibleBefore)
    .maybeSingle();

  if (lookupError) {
    throw new TrashMutationError("purge_not_found");
  }

  if (!recording) {
    const { data: recentRecording, error: recentLookupError } = await admin
      .from("recordings")
      .select("id")
      .eq("id", recordingId)
      .eq("user_id", userId)
      .eq("status", "deleted")
      .maybeSingle();

    if (recentLookupError || !recentRecording) {
      throw new TrashMutationError("purge_not_found");
    }

    throw new TrashMutationError("purge_too_recent");
  }

  let storageTarget: RecordingStorageTarget | null = null;

  if (recording.storage_path) {
    storageTarget = getCanonicalRecordingStorageTarget(
      recording.storage_path,
      userId,
      recordingId
    );

    if (!storageTarget) {
      throw new TrashMutationError("purge_failed");
    }
  }

  const claimId = randomUUID();
  const claimStartedAt = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - PURGE_CLAIM_TIMEOUT_MS).toISOString();
  let claimQuery = admin
    .from("recordings")
    .update({ purge_claim_id: claimId, purge_started_at: claimStartedAt })
    .eq("id", recordingId)
    .eq("user_id", userId)
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
    throw new TrashMutationError("purge_failed");
  }

  if (!claimed || claimed.storage_path !== recording.storage_path) {
    throw new TrashMutationError("purge_in_progress");
  }

  let storageObjects: string[] = [];

  if (storageTarget) {
    try {
      storageObjects = await getRecordingStorageObjects(admin, storageTarget);
    } catch {
      await releasePurgeClaim(admin, recordingId, userId, claimId);
      throw new TrashMutationError("purge_storage_failed");
    }

    try {
      await removeRecordingStorageObjects(
        admin,
        storageObjects,
        recordingId,
        userId,
        claimId
      );
    } catch (error) {
      const errorCode = error instanceof PurgeClaimLostError
        ? "purge_failed"
        : "purge_storage_failed";
      throw new TrashMutationError(errorCode);
    }
  }

  const verificationTarget: RecordingStorageTarget = {
    isSegmented: true,
    path: `${userId}/${recordingId}/`
  };
  let storageIsEmpty = false;

  for (let round = 0; round <= STORAGE_LATE_CLEANUP_ROUNDS; round += 1) {
    const ownsClaim = await refreshPurgeClaim(admin, recordingId, userId, claimId);

    if (!ownsClaim) {
      throw new TrashMutationError("purge_failed");
    }

    let lateStorageObjects: string[];

    try {
      lateStorageObjects = await getRecordingStorageObjects(admin, verificationTarget);
    } catch {
      throw new TrashMutationError("purge_storage_failed");
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
        recordingId,
        userId,
        claimId
      );
    } catch (error) {
      const errorCode = error instanceof PurgeClaimLostError
        ? "purge_failed"
        : "purge_storage_failed";
      throw new TrashMutationError(errorCode);
    }
  }

  if (!storageIsEmpty) {
    throw new TrashMutationError("purge_storage_failed");
  }

  const { data: deleted, error: deleteError } = await admin
    .from("recordings")
    .delete()
    .eq("id", recordingId)
    .eq("user_id", userId)
    .eq("status", "deleted")
    .eq("purge_claim_id", claimId)
    .select("id")
    .maybeSingle();

  if (deleteError || !deleted) {
    throw new TrashMutationError("purge_failed");
  }
}

// purgeRecordingAction preserves the existing redirecting single-item form contract.
export async function purgeRecordingAction(formData: FormData) {
  const parsed = parseRecordingPurgeForm(formData);
  const nextPath = getSafeNextPath(parsed.next ?? "/trash");
  const { user } = await requireTrashUser(nextPath);
  const admin = createAdminClient();
  try {
    await purgeRecordingForUser(admin, user.id, parsed.recordingId, Date.now());
  } catch (error) {
    const code = error instanceof TrashMutationError ? error.code : "purge_failed";
    redirect(appendQueryStatus(nextPath, "error", code));
  }
  revalidateTrashPaths(parsed.recordingId);
  redirect(clearQueryStatus(nextPath, "error"));
}

// purgeRecordingMutationAction performs one non-redirecting purge request with sanitized output.
export async function purgeRecordingMutationAction(formData: FormData): Promise<TrashItemResult> {
  const recordingId = parseSingleRecordingMutationForm(formData);
  if (!recordingId) return { id: "item", ok: false, code: "invalid_item" };

  const { user } = await requireTrashUserWithoutRedirect();
  const admin = createAdminClient();
  try {
    await purgeRecordingForUser(admin, user.id, recordingId, Date.now());
    revalidateTrashPaths(recordingId);
    return { id: recordingId, ok: true };
  } catch (error) {
    return {
      id: recordingId,
      ok: false,
      code: error instanceof TrashMutationError ? error.code : "purge_failed"
    };
  }
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
