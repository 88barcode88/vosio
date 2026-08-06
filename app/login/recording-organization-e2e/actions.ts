"use server";

import { revalidatePath } from "next/cache";
import {
  createSaveError,
  createSaveSuccess,
  type SaveActionState
} from "@/lib/forms/save-action-state";
import type { RecordingOrganizationEntityKind } from "@/lib/recording-organization/types";
import {
  isValidCreateScope,
  parseOrganizationColor,
  parseOrganizationId,
  parseOrganizationName,
  parseRecordingAssignment
} from "@/lib/recording-organization/validation";
import { requireOrganizationFixtureAccess } from "./development-runtime";
import {
  assignFixtureRecording,
  createFixtureClient,
  createFixtureFolder,
  createFixtureProject,
  createFixtureTag,
  deleteFixtureOrganizationEntity,
  renameFixtureOrganizationEntity
} from "./fixture-store";

const fixturePath = "/login/recording-organization-e2e";
const invalidInputMessage = "Zkontrolujte zadané údaje.";
const staleEditorMessage = "Editor už není aktuální. Otevřete ho znovu.";

const messages: Record<RecordingOrganizationEntityKind, {
  create: string;
  delete: string;
  rename: string;
}> = {
  client: { create: "Klient byl vytvořen.", delete: "Klient byl smazán.", rename: "Klient byl uložen." },
  folder: { create: "Složka byla vytvořena.", delete: "Složka byla smazána.", rename: "Složka byla uložena." },
  project: { create: "Projekt byl vytvořen.", delete: "Projekt byl smazán.", rename: "Projekt byl uložen." },
  tag: { create: "Štítek byl vytvořen.", delete: "Štítek byl smazán.", rename: "Štítek byl uložen." }
};

// getFormString reads fixture form values without coercing files or absent fields.
function getFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// revalidateFixture refreshes only the isolated development page after a successful mutation.
function revalidateFixture() {
  revalidatePath(fixturePath);
}

// executeFixtureCreate validates the exact create scope before mutating the bounded fixture store.
async function executeFixtureCreate(
  fixtureScope: string,
  kind: RecordingOrganizationEntityKind,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const scope = requireOrganizationFixtureAccess(process.env.NODE_ENV, fixtureScope);
  const scopeKey = getFormString(formData, "scopeKey");
  let name: string;
  let color: string | null;
  let clientId: string | null = null;
  try {
    if (!isValidCreateScope(scopeKey, kind)) throw new Error("invalid scope");
    name = parseOrganizationName(getFormString(formData, "name"), kind);
    color = parseOrganizationColor(getFormString(formData, "color"));
    if (kind === "project") clientId = parseOrganizationId(getFormString(formData, "clientId"));
  } catch {
    return createSaveError(previousState.revision, scopeKey || null, invalidInputMessage);
  }

  try {
    if (kind === "client") createFixtureClient(scope, name, color);
    else if (kind === "project" && clientId) createFixtureProject(scope, clientId, name, color);
    else if (kind === "folder") createFixtureFolder(scope, name, color);
    else if (kind === "tag") createFixtureTag(scope, name, color);
    else throw new Error("invalid project client");
    revalidateFixture();
    return createSaveSuccess(previousState.revision, scopeKey, messages[kind].create);
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Změnu se nepodařilo uložit.");
  }
}

// executeFixtureRename enforces entity-id scope identity before changing one fixture row.
async function executeFixtureRename(
  fixtureScope: string,
  kind: RecordingOrganizationEntityKind,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const scope = requireOrganizationFixtureAccess(process.env.NODE_ENV, fixtureScope);
  const scopeKey = getFormString(formData, "scopeKey");
  let entityId: string;
  let name: string;
  let color: string | null;
  try {
    entityId = parseOrganizationId(getFormString(formData, "entityId"));
    if (scopeKey !== entityId) {
      return createSaveError(previousState.revision, scopeKey || null, staleEditorMessage);
    }
    name = parseOrganizationName(getFormString(formData, "name"), kind);
    color = parseOrganizationColor(getFormString(formData, "color"));
  } catch {
    return createSaveError(previousState.revision, scopeKey || null, invalidInputMessage);
  }

  try {
    renameFixtureOrganizationEntity(scope, kind, entityId, name, color);
    revalidateFixture();
    return createSaveSuccess(previousState.revision, scopeKey, messages[kind].rename);
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Změnu se nepodařilo uložit.");
  }
}

// executeFixtureDelete enforces entity-id scope identity before schema-equivalent deletion.
async function executeFixtureDelete(
  fixtureScope: string,
  kind: RecordingOrganizationEntityKind,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const scope = requireOrganizationFixtureAccess(process.env.NODE_ENV, fixtureScope);
  const scopeKey = getFormString(formData, "scopeKey");
  let entityId: string;
  try {
    entityId = parseOrganizationId(getFormString(formData, "entityId"));
    if (scopeKey !== entityId) {
      return createSaveError(previousState.revision, scopeKey || null, staleEditorMessage);
    }
  } catch {
    return createSaveError(previousState.revision, scopeKey || null, invalidInputMessage);
  }

  try {
    deleteFixtureOrganizationEntity(scope, kind, entityId);
    revalidateFixture();
    return createSaveSuccess(previousState.revision, scopeKey, messages[kind].delete);
  } catch {
    const message = kind === "client"
      ? "Klienta nelze smazat, dokud má přiřazené projekty nebo nahrávky."
      : "Změnu se nepodařilo uložit.";
    return createSaveError(previousState.revision, scopeKey, message);
  }
}

// createFixtureClientAction creates one client without any production persistence fallback.
export async function createFixtureClientAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureCreate(scope, "client", state, data);
}

// createFixtureProjectAction creates one project under an owned fixture client.
export async function createFixtureProjectAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureCreate(scope, "project", state, data);
}

// createFixtureFolderAction creates one flat fixture folder.
export async function createFixtureFolderAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureCreate(scope, "folder", state, data);
}

// createFixtureTagAction creates one reusable fixture tag.
export async function createFixtureTagAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureCreate(scope, "tag", state, data);
}

// renameFixtureClientAction renames one fixture client with exact scope identity.
export async function renameFixtureClientAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureRename(scope, "client", state, data);
}

// renameFixtureProjectAction renames one fixture project with exact scope identity.
export async function renameFixtureProjectAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureRename(scope, "project", state, data);
}

// renameFixtureFolderAction renames one fixture folder with exact scope identity.
export async function renameFixtureFolderAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureRename(scope, "folder", state, data);
}

// renameFixtureTagAction renames one fixture tag with exact scope identity.
export async function renameFixtureTagAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureRename(scope, "tag", state, data);
}

// deleteFixtureClientAction applies client restriction semantics in fixture storage.
export async function deleteFixtureClientAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureDelete(scope, "client", state, data);
}

// deleteFixtureProjectAction deletes a project and clears only project assignments.
export async function deleteFixtureProjectAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureDelete(scope, "project", state, data);
}

// deleteFixtureFolderAction deletes a folder and clears only folder assignments.
export async function deleteFixtureFolderAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureDelete(scope, "folder", state, data);
}

// deleteFixtureTagAction deletes a tag and cascades its fixture links.
export async function deleteFixtureTagAction(scope: string, state: SaveActionState, data: FormData) {
  return executeFixtureDelete(scope, "tag", state, data);
}

// assignFixtureOrganizationAction atomically replaces one fixture recording assignment.
export async function assignFixtureOrganizationAction(
  fixtureScope: string,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const scope = requireOrganizationFixtureAccess(process.env.NODE_ENV, fixtureScope);
  const scopeKey = getFormString(formData, "scopeKey");
  let recordingId: string;
  try {
    recordingId = parseOrganizationId(getFormString(formData, "recordingId"));
    if (scopeKey !== recordingId) {
      return createSaveError(previousState.revision, scopeKey || null, staleEditorMessage);
    }
    const assignment = parseRecordingAssignment({
      clientId: getFormString(formData, "clientId"),
      folderId: getFormString(formData, "folderId"),
      projectId: getFormString(formData, "projectId"),
      tagIds: formData.getAll("tagIds")
    });
    assignFixtureRecording(scope, assignment, recordingId);
    revalidateFixture();
    return createSaveSuccess(previousState.revision, scopeKey, "Zařazení bylo uloženo.");
  } catch {
    return createSaveError(
      previousState.revision,
      scopeKey || null,
      "Zařazení nahrávky se nepodařilo uložit."
    );
  }
}
