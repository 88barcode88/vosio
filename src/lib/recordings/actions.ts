"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSafeNextPath } from "@/lib/auth/redirects";
import {
  createSaveError,
  createSaveSuccess,
  type SaveActionState
} from "@/lib/forms/save-action-state";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { continueManualPurge, ManagedMutationError, manualPurgeRequestSchema, mutateManagedRecording } from "@/lib/recordings/trash-service.server";
import { processManualPurge } from "@/lib/recordings/manual-purge-worker.server";
import { ContentEditError, setContentTitle } from "@/lib/recording-sharing/content-edits.server";

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
export type TrashMutationCode =
  | "forbidden"
  | "conflict"
  | "internal"
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

// Restores a currently managed Trash item to its DB-captured status through the locked session RPC.
export async function restoreRecordingAction(formData: FormData) {
  const parsed = parseRecordingRestoreForm(formData);
  const nextPath = getSafeNextPath(parsed.next ?? "/trash");
  const { supabase } = await requireTrashUser(nextPath);
  try {
    await mutateManagedRecording(supabase, parsed.recordingId, "restore");
  } catch (error) {
    const code = error instanceof ManagedMutationError ? error.code : "restore_failed";
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
  const { supabase } = await requireTrashUserWithoutRedirect();
  const result: TrashBulkResult = { succeededIds: [], failures: [] };

  for (const recordingId of parsed.data.recordingIds) {
    try {
      await mutateManagedRecording(supabase, recordingId, "restore");
      result.succeededIds.push(recordingId);
    } catch (error) {
      result.failures.push({
        id: recordingId,
        code: error instanceof ManagedMutationError ? error.code : "restore_failed"
      });
    }
  }
  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath("/trash");
  return result;
}

// Updates a currently editable recording through the locked title-only RPC and confirms its saved title.
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

    try {
      await setContentTitle(supabase, parsed.data);
    } catch (error) {
      if (!(error instanceof ContentEditError)) throw error;
      return createSaveError(previousState.revision, parsed.data.recordingId,
        error instanceof ContentEditError && error.stage === "permission" ? "Úprava není povolena." : "Název se nepodařilo uložit.");
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

// Moves a currently managed recording to Trash through the locked session RPC.
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

  try {
    await mutateManagedRecording(supabase, parsed.recordingId, "delete", getUserSettingsFromMetadata(user.user_metadata).trashRetentionHours);
  } catch (error) {
    redirect(appendQueryStatus("/recordings", "error", error instanceof ManagedMutationError ? error.code : "delete_failed"));
  }

  revalidatePath("/");
  revalidatePath("/recordings");
  revalidatePath(`/recordings/${parsed.recordingId}`);
  revalidatePath("/trash");

  if (parsed.next) {
    redirect(parsed.next);
  }
}

// Reads the durable caller key without generating a new key on an uncertain retry.
function parsePurgeRequest(formData: FormData) {
  if (!parseSingleRecordingMutationForm(formData)) return null;
  const parsed = manualPurgeRequestSchema.safeParse({
    recordingId: getRequiredString(formData, "recordingId"),
    requestId: getRequiredString(formData, "requestId"),
    expectedUpdatedAt: getRequiredString(formData, "expectedUpdatedAt")
  });
  return parsed.success ? parsed.data : null;
}

// Starts or recovers accepted work; Storage failures retain the durable receipt for scheduled recovery.
async function purgeRecordingForSession(supabase: Awaited<ReturnType<typeof createClient>>, formData: FormData) {
  const request = parsePurgeRequest(formData);
  if (!request) throw new ManagedMutationError("invalid_item");
  const receipt = await continueManualPurge(supabase, request, formData.get("release") === "true");
  if (receipt.phase === "started" && await processManualPurge(createAdminClient(), receipt.operationId) !== true) throw new ManagedMutationError("conflict");
}

// purgeRecordingAction preserves the existing redirecting single-item form contract.
export async function purgeRecordingAction(formData: FormData) {
  const parsed = parseRecordingPurgeForm(formData);
  const nextPath = getSafeNextPath(parsed.next ?? "/trash");
  const { supabase } = await requireTrashUser(nextPath);
  try {
    await purgeRecordingForSession(supabase, formData);
  } catch (error) {
    const code = error instanceof ManagedMutationError ? error.code : "purge_failed";
    redirect(appendQueryStatus(nextPath, "error", code));
  }
  revalidateTrashPaths(parsed.recordingId);
  redirect(clearQueryStatus(nextPath, "error"));
}

// purgeRecordingMutationAction performs one non-redirecting purge request with sanitized output.
export async function purgeRecordingMutationAction(formData: FormData): Promise<TrashItemResult> {
  const recordingId = parseSingleRecordingMutationForm(formData);
  if (!recordingId) return { id: "item", ok: false, code: "invalid_item" };

  const { supabase } = await requireTrashUserWithoutRedirect();
  try {
    await purgeRecordingForSession(supabase, formData);
    revalidateTrashPaths(recordingId);
    return { id: recordingId, ok: true };
  } catch (error) {
    return {
      id: recordingId,
      ok: false,
      code: error instanceof ManagedMutationError ? error.code : "purge_failed"
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
