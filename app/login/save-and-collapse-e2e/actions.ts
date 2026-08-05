"use server";

import { revalidatePath } from "next/cache";
import {
  createSaveError,
  createSaveSuccess,
  type SaveActionState
} from "@/lib/forms/save-action-state";
import { setFixtureTitle } from "./fixture-store";

// saveFixtureRecordingTitle provides deterministic success and failure settlements for local E2E.
export async function saveFixtureRecordingTitle(
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Save-and-collapse E2E fixture is development-only.");
  }

  const recordingId = formData.get("recordingId");
  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  const scopeKey = typeof recordingId === "string" ? recordingId : null;

  if (!scopeKey || !title || title.length > 160) {
    return createSaveError(previousState.revision, scopeKey, "Fixture nemá platný název.");
  }

  if (title.startsWith("FAIL:")) {
    return createSaveError(
      previousState.revision,
      scopeKey,
      "Testovací uložení bylo záměrně odmítnuto."
    );
  }

  setFixtureTitle(scopeKey, title);
  revalidatePath("/login/save-and-collapse-e2e");
  return createSaveSuccess(previousState.revision, scopeKey, "Název byl uložen.");
}
