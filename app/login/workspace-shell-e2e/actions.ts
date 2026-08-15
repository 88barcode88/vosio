"use server";

import type { TrashBulkResult, TrashItemResult } from "@/lib/recordings/actions";

const fixtureScopePattern = /^[0-9a-f]{12}$/;

// assertDevelopmentFixtureAction keeps inert Trash actions bound to a valid local fixture scope.
function assertDevelopmentFixtureAction(formData: FormData) {
  const scope = formData.get("fixtureScope");
  if (process.env.NODE_ENV !== "development" || typeof scope !== "string" || !fixtureScopePattern.test(scope)) {
    throw new Error("Fixture is unavailable.");
  }
}

// inertTrashAction simulates a pending successful mutation without database, Storage or network access.
export async function inertTrashAction(formData: FormData): Promise<void> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 650));
}

// rejectTrashAction simulates a sanitized client-action failure without mutating external state.
export async function rejectTrashAction(formData: FormData): Promise<void> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 450));
  throw new Error("fixture-private-trash-failure");
}

// inertTrashBulkRestoreAction returns all selected fixture ids as successful without external writes.
export async function inertTrashBulkRestoreAction(formData: FormData): Promise<TrashBulkResult> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return {
    failures: [],
    succeededIds: formData.getAll("recordingId").filter((value): value is string => typeof value === "string")
  };
}

// rejectTrashBulkRestoreAction returns one sanitized failure for every selected fixture id.
export async function rejectTrashBulkRestoreAction(formData: FormData): Promise<TrashBulkResult> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return {
    failures: formData.getAll("recordingId")
      .filter((value): value is string => typeof value === "string")
      .map((id) => ({ code: "restore_failed" as const, id })),
    succeededIds: []
  };
}

// inertTrashPurgeItemAction settles one local fixture item successfully.
export async function inertTrashPurgeItemAction(formData: FormData): Promise<TrashItemResult> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const id = formData.get("recordingId");
  return typeof id === "string" ? { id, ok: true } : { code: "invalid_item", id: "item", ok: false };
}

// rejectTrashPurgeItemAction settles one local fixture item with a sanitized code.
export async function rejectTrashPurgeItemAction(formData: FormData): Promise<TrashItemResult> {
  assertDevelopmentFixtureAction(formData);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const id = formData.get("recordingId");
  return typeof id === "string"
    ? { code: "purge_failed", id, ok: false }
    : { code: "invalid_item", id: "item", ok: false };
}
