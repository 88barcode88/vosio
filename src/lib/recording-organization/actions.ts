"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient, User } from "@supabase/supabase-js";
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
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

type OrganizationActionConfig = {
  createMessage: string;
  deleteMessage: string;
  kind: RecordingOrganizationEntityKind;
  renameMessage: string;
  table: "recording_clients" | "recording_projects" | "recording_folders" | "recording_tags";
};

type DatabaseError = {
  code?: string;
  message: string;
};

const authenticationMessage = "Přihlášení vypršelo. Přihlaste se a zkuste to znovu.";
const invalidInputMessage = "Zkontrolujte zadané údaje.";
const staleEditorMessage = "Editor už není aktuální. Otevřete ho znovu.";

const organizationActionConfigs: Record<RecordingOrganizationEntityKind, OrganizationActionConfig> = {
  client: {
    createMessage: "Klient byl vytvořen.",
    deleteMessage: "Klient byl smazán.",
    kind: "client",
    renameMessage: "Klient byl uložen.",
    table: "recording_clients"
  },
  folder: {
    createMessage: "Složka byla vytvořena.",
    deleteMessage: "Složka byla smazána.",
    kind: "folder",
    renameMessage: "Složka byla uložena.",
    table: "recording_folders"
  },
  project: {
    createMessage: "Projekt byl vytvořen.",
    deleteMessage: "Projekt byl smazán.",
    kind: "project",
    renameMessage: "Projekt byl uložen.",
    table: "recording_projects"
  },
  tag: {
    createMessage: "Štítek byl vytvořen.",
    deleteMessage: "Štítek byl smazán.",
    kind: "tag",
    renameMessage: "Štítek byl uložen.",
    table: "recording_tags"
  }
};

// getFormString reads one string value without coercing files or missing fields.
function getFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// getAuthenticatedContext creates one request-scoped RLS client and resolves its user.
async function getAuthenticatedContext(): Promise<{
  supabase: SupabaseClient;
  user: User;
} | null> {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  return error || !user ? null : { supabase, user };
}

// mapDatabaseError returns stable Czech copy without exposing provider details.
function mapDatabaseError(
  error: DatabaseError | null,
  operation: "create" | "rename" | "delete",
  kind: RecordingOrganizationEntityKind
) {
  if (error?.code === "23505") {
    return "Položka se stejným názvem už existuje.";
  }

  if (error?.code === "23503" && operation === "delete" && kind === "client") {
    return "Klienta nelze smazat, dokud má přiřazené projekty nebo nahrávky.";
  }

  if (error?.code === "23503" && operation === "delete") {
    return "Položku nelze smazat, protože se stále používá.";
  }

  return "Změnu se nepodařilo uložit.";
}

// revalidateOrganizationList refreshes organization choices only after a successful mutation.
function revalidateOrganizationList() {
  revalidatePath("/recordings");
}

// executeCreateOrganization validates and creates one user-owned lookup row.
async function executeCreateOrganization(
  config: OrganizationActionConfig,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const scopeKey = getFormString(formData, "scopeKey");
  let name: string;
  let color: string | null;
  let clientId: string | null = null;

  try {
    if (!isValidCreateScope(scopeKey, config.kind)) {
      throw new Error("invalid scope");
    }
    name = parseOrganizationName(getFormString(formData, "name"), config.kind);
    color = parseOrganizationColor(getFormString(formData, "color"));
    if (config.kind === "project") {
      clientId = parseOrganizationId(getFormString(formData, "clientId"));
    }
  } catch {
    return createSaveError(previousState.revision, scopeKey || null, invalidInputMessage);
  }

  try {
    const context = await getAuthenticatedContext();
    if (!context) {
      return createSaveError(previousState.revision, scopeKey, authenticationMessage);
    }

    if (config.kind === "project" && clientId) {
      const clientResult = await context.supabase
        .from("recording_clients")
        .select("id")
        .eq("id", clientId)
        .eq("user_id", context.user.id)
        .maybeSingle();

      if (clientResult.error) {
        return createSaveError(
          previousState.revision,
          scopeKey,
          "Změnu se nepodařilo uložit."
        );
      }

      if (!clientResult.data) {
        return createSaveError(
          previousState.revision,
          scopeKey,
          "Vybraný klient nebyl nalezen."
        );
      }
    }

    const payload = config.kind === "project"
      ? { client_id: clientId, color, name, user_id: context.user.id }
      : { color, name, user_id: context.user.id };
    const result = await context.supabase
      .from(config.table)
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (result.error || !result.data) {
      return createSaveError(
        previousState.revision,
        scopeKey,
        mapDatabaseError(result.error, "create", config.kind)
      );
    }

    revalidateOrganizationList();
    return createSaveSuccess(previousState.revision, scopeKey, config.createMessage);
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Změnu se nepodařilo uložit.");
  }
}

// executeRenameOrganization validates scope identity and updates one owned lookup row.
async function executeRenameOrganization(
  config: OrganizationActionConfig,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const scopeKey = getFormString(formData, "scopeKey");
  let entityId: string;
  let name: string;
  let color: string | null;

  try {
    entityId = parseOrganizationId(getFormString(formData, "entityId"));
    if (scopeKey !== entityId) {
      return createSaveError(previousState.revision, scopeKey || null, staleEditorMessage);
    }
    name = parseOrganizationName(getFormString(formData, "name"), config.kind);
    color = parseOrganizationColor(getFormString(formData, "color"));
  } catch {
    return createSaveError(previousState.revision, scopeKey || null, invalidInputMessage);
  }

  try {
    const context = await getAuthenticatedContext();
    if (!context) {
      return createSaveError(previousState.revision, scopeKey, authenticationMessage);
    }

    const result = await context.supabase
      .from(config.table)
      .update({ color, name })
      .eq("id", entityId)
      .eq("user_id", context.user.id)
      .select("id")
      .maybeSingle();

    if (result.error || !result.data) {
      return createSaveError(
        previousState.revision,
        scopeKey,
        mapDatabaseError(result.error, "rename", config.kind)
      );
    }

    revalidateOrganizationList();
    return createSaveSuccess(previousState.revision, scopeKey, config.renameMessage);
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Změnu se nepodařilo uložit.");
  }
}

// executeDeleteOrganization validates scope identity and deletes one owned lookup row.
async function executeDeleteOrganization(
  config: OrganizationActionConfig,
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
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
    const context = await getAuthenticatedContext();
    if (!context) {
      return createSaveError(previousState.revision, scopeKey, authenticationMessage);
    }

    const result = await context.supabase
      .from(config.table)
      .delete()
      .eq("id", entityId)
      .eq("user_id", context.user.id)
      .select("id")
      .maybeSingle();

    if (result.error || !result.data) {
      return createSaveError(
        previousState.revision,
        scopeKey,
        mapDatabaseError(result.error, "delete", config.kind)
      );
    }

    revalidateOrganizationList();
    return createSaveSuccess(previousState.revision, scopeKey, config.deleteMessage);
  } catch {
    return createSaveError(previousState.revision, scopeKey, "Změnu se nepodařilo uložit.");
  }
}

// createRecordingClientAction creates one client and preserves the submitted editor scope.
export async function createRecordingClientAction(previousState: SaveActionState, formData: FormData) {
  return executeCreateOrganization(organizationActionConfigs.client, previousState, formData);
}

// renameRecordingClientAction renames one owned client.
export async function renameRecordingClientAction(previousState: SaveActionState, formData: FormData) {
  return executeRenameOrganization(organizationActionConfigs.client, previousState, formData);
}

// deleteRecordingClientAction deletes one unreferenced owned client.
export async function deleteRecordingClientAction(previousState: SaveActionState, formData: FormData) {
  return executeDeleteOrganization(organizationActionConfigs.client, previousState, formData);
}

// createRecordingProjectAction creates one project under an owned client.
export async function createRecordingProjectAction(previousState: SaveActionState, formData: FormData) {
  return executeCreateOrganization(organizationActionConfigs.project, previousState, formData);
}

// renameRecordingProjectAction renames one owned project.
export async function renameRecordingProjectAction(previousState: SaveActionState, formData: FormData) {
  return executeRenameOrganization(organizationActionConfigs.project, previousState, formData);
}

// deleteRecordingProjectAction deletes one owned project and lets the schema clear assignments.
export async function deleteRecordingProjectAction(previousState: SaveActionState, formData: FormData) {
  return executeDeleteOrganization(organizationActionConfigs.project, previousState, formData);
}

// createRecordingFolderAction creates one flat owned folder.
export async function createRecordingFolderAction(previousState: SaveActionState, formData: FormData) {
  return executeCreateOrganization(organizationActionConfigs.folder, previousState, formData);
}

// renameRecordingFolderAction renames one owned folder.
export async function renameRecordingFolderAction(previousState: SaveActionState, formData: FormData) {
  return executeRenameOrganization(organizationActionConfigs.folder, previousState, formData);
}

// deleteRecordingFolderAction deletes one owned folder and lets the schema clear assignments.
export async function deleteRecordingFolderAction(previousState: SaveActionState, formData: FormData) {
  return executeDeleteOrganization(organizationActionConfigs.folder, previousState, formData);
}

// createRecordingTagAction creates one reusable owned tag.
export async function createRecordingTagAction(previousState: SaveActionState, formData: FormData) {
  return executeCreateOrganization(organizationActionConfigs.tag, previousState, formData);
}

// renameRecordingTagAction renames one owned tag.
export async function renameRecordingTagAction(previousState: SaveActionState, formData: FormData) {
  return executeRenameOrganization(organizationActionConfigs.tag, previousState, formData);
}

// deleteRecordingTagAction deletes one owned tag and lets the schema cascade its links.
export async function deleteRecordingTagAction(previousState: SaveActionState, formData: FormData) {
  return executeDeleteOrganization(organizationActionConfigs.tag, previousState, formData);
}

// assignRecordingOrganizationAction atomically replaces one recording's organization through one RPC.
export async function assignRecordingOrganizationAction(
  previousState: SaveActionState,
  formData: FormData
): Promise<SaveActionState> {
  const scopeKey = getFormString(formData, "scopeKey");
  let recordingId: string;
  let assignment: ReturnType<typeof parseRecordingAssignment>;

  try {
    recordingId = parseOrganizationId(getFormString(formData, "recordingId"));
    if (scopeKey !== recordingId) {
      return createSaveError(previousState.revision, scopeKey || null, staleEditorMessage);
    }
    assignment = parseRecordingAssignment({
      clientId: getFormString(formData, "clientId"),
      folderId: getFormString(formData, "folderId"),
      projectId: getFormString(formData, "projectId"),
      tagIds: formData.getAll("tagIds")
    });
  } catch {
    return createSaveError(previousState.revision, scopeKey || null, invalidInputMessage);
  }

  try {
    const context = await getAuthenticatedContext();
    if (!context) {
      return createSaveError(previousState.revision, scopeKey, authenticationMessage);
    }

    const { error } = await context.supabase.rpc("assign_recording_organization_v1", {
      p_client_id: assignment.clientId,
      p_folder_id: assignment.folderId,
      p_project_id: assignment.projectId,
      p_recording_id: recordingId,
      p_tag_ids: assignment.tagIds
    });

    if (error) {
      return createSaveError(
        previousState.revision,
        scopeKey,
        "Zařazení nahrávky se nepodařilo uložit."
      );
    }

    revalidatePath("/recordings");
    revalidatePath(`/recordings/${recordingId}`);
    return createSaveSuccess(previousState.revision, scopeKey, "Zařazení bylo uloženo.");
  } catch {
    return createSaveError(
      previousState.revision,
      scopeKey,
      "Zařazení nahrávky se nepodařilo uložit."
    );
  }
}
