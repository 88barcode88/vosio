"use server";

import { revalidatePath } from "next/cache";
import {
  createSaveError,
  createSaveSuccess,
  type SaveActionState
} from "@/lib/forms/save-action-state";
import {
  parseOrganizationName,
  parseRecordingAssignment
} from "@/lib/recording-organization/validation";
import {
  assignFixtureRecording,
  createFixtureClient,
  createFixtureProject,
  createFixtureTag
} from "./fixture-store";

const scopePattern = /^[0-9a-f]{11}$/;
const fixturePath = "/login/recording-organization-e2e";

// assertDevelopmentFixture prevents the external-storage adapter from running outside local E2E.
function assertDevelopmentFixture(scope: string) {
  if (process.env.NODE_ENV !== "development" || !scopePattern.test(scope)) {
    throw new Error("Recording organization E2E fixture is development-only.");
  }
}

// getScopeKey preserves the real editor settlement scope in fixture responses.
function getScopeKey(formData: FormData) {
  const value = formData.get("scopeKey");
  return typeof value === "string" ? value : null;
}

// createFixtureClientAction adapts the real manager action contract to dev fixture storage.
export async function createFixtureClientAction(
  fixtureScope: string,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  assertDevelopmentFixture(fixtureScope);
  const scopeKey = getScopeKey(formData);
  try {
    if (!scopeKey) throw new Error("Missing scope.");
    createFixtureClient(fixtureScope, parseOrganizationName(formData.get("name"), "client"));
    revalidatePath(fixturePath);
    return createSaveSuccess(previousState.revision, scopeKey, "Klient vytvořen.");
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Klienta se nepodařilo vytvořit.");
  }
}

// createFixtureProjectAction adapts project creation to the isolated dev fixture store.
export async function createFixtureProjectAction(
  fixtureScope: string,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  assertDevelopmentFixture(fixtureScope);
  const scopeKey = getScopeKey(formData);
  const clientId = formData.get("clientId");
  try {
    if (!scopeKey || typeof clientId !== "string") throw new Error("Missing client or scope.");
    createFixtureProject(
      fixtureScope,
      clientId,
      parseOrganizationName(formData.get("name"), "project")
    );
    revalidatePath(fixturePath);
    return createSaveSuccess(previousState.revision, scopeKey, "Projekt vytvořen.");
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Projekt se nepodařilo vytvořit.");
  }
}

// createFixtureTagAction adapts tag creation to the isolated dev fixture store.
export async function createFixtureTagAction(
  fixtureScope: string,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  assertDevelopmentFixture(fixtureScope);
  const scopeKey = getScopeKey(formData);
  try {
    if (!scopeKey) throw new Error("Missing scope.");
    createFixtureTag(fixtureScope, parseOrganizationName(formData.get("name"), "tag"));
    revalidatePath(fixturePath);
    return createSaveSuccess(previousState.revision, scopeKey, "Štítek vytvořen.");
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Štítek se nepodařilo vytvořit.");
  }
}

// assignFixtureOrganizationAction persists the real editor payload through one dev boundary call.
export async function assignFixtureOrganizationAction(
  fixtureScope: string,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  assertDevelopmentFixture(fixtureScope);
  const scopeKey = getScopeKey(formData);
  const recordingId = formData.get("recordingId");
  try {
    if (!scopeKey || typeof recordingId !== "string") throw new Error("Missing recording or scope.");
    const assignment = parseRecordingAssignment({
      clientId: formData.get("clientId"),
      folderId: formData.get("folderId"),
      projectId: formData.get("projectId"),
      tagIds: formData.getAll("tagIds")
    });
    assignFixtureRecording(fixtureScope, assignment, recordingId);
    revalidatePath(fixturePath);
    return createSaveSuccess(previousState.revision, scopeKey, "Zařazení uloženo.");
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Zařazení se nepodařilo uložit.");
  }
}
