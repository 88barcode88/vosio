import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveAction } from "@/lib/forms/save-action-state";
import { createInitialSaveActionState } from "@/lib/forms/save-action-state";
import {
  assignRecordingOrganizationAction,
  createRecordingClientAction,
  createRecordingFolderAction,
  createRecordingProjectAction,
  createRecordingTagAction,
  deleteRecordingClientAction,
  deleteRecordingFolderAction,
  deleteRecordingProjectAction,
  deleteRecordingTagAction,
  renameRecordingClientAction,
  renameRecordingFolderAction,
  renameRecordingProjectAction,
  renameRecordingTagAction
} from "@/lib/recording-organization/actions";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const userId = "00000000-0000-4000-8000-000000000001";
const entityId = "00000000-0000-4000-8000-000000000002";
const clientId = "00000000-0000-4000-8000-000000000003";
const projectId = "00000000-0000-4000-8000-000000000004";
const folderId = "00000000-0000-4000-8000-000000000005";
const tagId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const uppercaseTagId = tagId.toUpperCase();
const recordingId = "00000000-0000-4000-8000-000000000007";

type DbResult = {
  data: { id: string } | null;
  error: { code?: string; message: string } | null;
};

// createMutationQuery builds a chainable mutation or ownership lookup query.
function createMutationQuery(
  result: DbResult | Error = { data: { id: entityId }, error: null }
) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn(),
    select: vi.fn(),
    update: vi.fn()
  };
  query.delete.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.insert.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.update.mockReturnValue(query);
  if (result instanceof Error) {
    query.maybeSingle.mockRejectedValue(result);
  } else {
    query.maybeSingle.mockResolvedValue(result);
  }
  return query;
}

// createForm builds the common scoped organization action payload.
function createForm(values: Record<string, string | string[]>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      formData.append(key, item);
    }
  }
  return formData;
}

// arrangeSupabase installs one authenticated request-scoped client.
function arrangeSupabase({
  from = vi.fn(),
  rpc = vi.fn().mockResolvedValue({ data: null, error: null }),
  user = { id: userId },
  userError = null
}: {
  from?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
  user?: { id: string } | null;
  userError?: { message: string } | null;
} = {}) {
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: userError });
  mocks.createClient.mockResolvedValue({ auth: { getUser }, from, rpc });
  return { from, getUser, rpc };
}

const createCases: Array<{
  action: SaveAction;
  kind: string;
  table: string;
}> = [
  { action: createRecordingClientAction, kind: "client", table: "recording_clients" },
  { action: createRecordingFolderAction, kind: "folder", table: "recording_folders" },
  { action: createRecordingTagAction, kind: "tag", table: "recording_tags" }
];
const renameCases: Array<{ action: SaveAction; table: string }> = [
  { action: renameRecordingClientAction, table: "recording_clients" },
  { action: renameRecordingProjectAction, table: "recording_projects" },
  { action: renameRecordingFolderAction, table: "recording_folders" },
  { action: renameRecordingTagAction, table: "recording_tags" }
];
const deleteCases: Array<{ action: SaveAction; table: string }> = [
  { action: deleteRecordingClientAction, table: "recording_clients" },
  { action: deleteRecordingProjectAction, table: "recording_projects" },
  { action: deleteRecordingFolderAction, table: "recording_folders" },
  { action: deleteRecordingTagAction, table: "recording_tags" }
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("recording organization actions", () => {
  it.each(createCases)("creates $table with an exact stable create scope", async ({ action, kind, table }) => {
    const query = createMutationQuery();
    const from = vi.fn().mockReturnValue(query);
    arrangeSupabase({ from });
    const scopeKey = `create:${kind}:editor-1`;

    const result = await action(createInitialSaveActionState(), createForm({
      color: "",
      name: "  Acme  ",
      scopeKey
    }));

    expect(result.status).toBe("success");
    expect(result.scopeKey).toBe(scopeKey);
    expect(from).toHaveBeenCalledWith(table);
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      color: null,
      name: "Acme",
      user_id: userId
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/recordings");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("creates a project only after checking that its client is owned", async () => {
    const clientQuery = createMutationQuery({ data: { id: clientId }, error: null });
    const projectQuery = createMutationQuery();
    const from = vi.fn((table: string) => (
      table === "recording_clients" ? clientQuery : projectQuery
    ));
    arrangeSupabase({ from });
    const scopeKey = "create:project:editor-1";

    const result = await createRecordingProjectAction(
      createInitialSaveActionState(),
      createForm({ clientId, color: "#123ABC", name: " Projekt ", scopeKey })
    );

    expect(result).toMatchObject({ scopeKey, status: "success" });
    expect(clientQuery.eq).toHaveBeenNthCalledWith(1, "id", clientId);
    expect(clientQuery.eq).toHaveBeenNthCalledWith(2, "user_id", userId);
    expect(projectQuery.insert).toHaveBeenCalledWith({
      client_id: clientId,
      color: "#123ABC",
      name: "Projekt",
      user_id: userId
    });
  });

  it.each(renameCases)("renames only an owned $table row", async ({ action, table }) => {
    const query = createMutationQuery();
    const from = vi.fn().mockReturnValue(query);
    arrangeSupabase({ from });

    const result = await action(createInitialSaveActionState(), createForm({
      color: "#AABBCC",
      entityId,
      name: " Nový název ",
      scopeKey: entityId
    }));

    expect(result).toMatchObject({ scopeKey: entityId, status: "success" });
    expect(from).toHaveBeenCalledWith(table);
    expect(query.update).toHaveBeenCalledWith({ color: "#AABBCC", name: "Nový název" });
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", entityId);
    expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", userId);
  });

  it.each(deleteCases)("deletes only an owned $table row", async ({ action, table }) => {
    const query = createMutationQuery();
    const from = vi.fn().mockReturnValue(query);
    arrangeSupabase({ from });

    const result = await action(createInitialSaveActionState(), createForm({
      entityId,
      scopeKey: entityId
    }));

    expect(result).toMatchObject({ scopeKey: entityId, status: "success" });
    expect(from).toHaveBeenCalledWith(table);
    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", entityId);
    expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", userId);
  });

  it("blocks a mismatched rename scope before authentication or mutation", async () => {
    const formData = createForm({
      color: "",
      entityId,
      name: "Acme",
      scopeKey: clientId
    });

    await expect(
      renameRecordingClientAction(createInitialSaveActionState(), formData)
    ).resolves.toMatchObject({ scopeKey: clientId, status: "error" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns the unchanged create scope for authentication errors", async () => {
    arrangeSupabase({ user: null });
    const scopeKey = "create:client:editor-9";

    await expect(createRecordingClientAction(
      createInitialSaveActionState(),
      createForm({ color: "", name: "Acme", scopeKey })
    )).resolves.toMatchObject({ scopeKey, status: "error" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("treats an auth provider error as scoped and performs no mutation", async () => {
    const from = vi.fn();
    arrangeSupabase({
      from,
      userError: { message: "token internals" }
    });
    const scopeKey = "create:tag:editor-2";

    const result = await createRecordingTagAction(
      createInitialSaveActionState(),
      createForm({ color: "", name: "Priorita", scopeKey })
    );

    expect(result).toMatchObject({ scopeKey, status: "error" });
    expect(result.message).toBe("Přihlášení vypršelo. Přihlaste se a zkuste to znovu.");
    expect(result.message).not.toContain("internals");
    expect(from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not create a project when the owned-client precheck has no row", async () => {
    const clientQuery = createMutationQuery({ data: null, error: null });
    const projectQuery = createMutationQuery();
    const from = vi.fn((table: string) => (
      table === "recording_clients" ? clientQuery : projectQuery
    ));
    arrangeSupabase({ from });

    const result = await createRecordingProjectAction(
      createInitialSaveActionState(),
      createForm({
        clientId,
        color: "",
        name: "Projekt",
        scopeKey: "create:project:editor-3"
      })
    );

    expect(result).toMatchObject({ status: "error" });
    expect(projectQuery.insert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      "returned database error",
      { data: null, error: { code: "42501", message: "provider permission secret" } }
    ],
    ["thrown database error", new Error("provider transport secret")]
  ])("maps a project client precheck %s to a generic error without mutation", async (_label, precheckResult) => {
    const clientQuery = createMutationQuery(precheckResult);
    const projectQuery = createMutationQuery();
    const from = vi.fn((table: string) => (
      table === "recording_clients" ? clientQuery : projectQuery
    ));
    arrangeSupabase({ from });

    const result = await createRecordingProjectAction(
      createInitialSaveActionState(),
      createForm({
        clientId,
        color: "",
        name: "Projekt",
        scopeKey: "create:project:precheck-error"
      })
    );

    expect(result.message).toBe("Změnu se nepodařilo uložit.");
    expect(result.message).not.toContain("secret");
    expect(projectQuery.insert).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unique and foreign-key errors to sanitized Czech messages", async () => {
    const uniqueQuery = createMutationQuery({
      data: null,
      error: { code: "23505", message: "recording_clients_user_name_ci_uidx secret" }
    });
    arrangeSupabase({ from: vi.fn().mockReturnValue(uniqueQuery) });
    const uniqueResult = await createRecordingClientAction(
      createInitialSaveActionState(),
      createForm({ color: "", name: "Acme", scopeKey: "create:client:one" })
    );
    expect(uniqueResult.message).toBe("Položka se stejným názvem už existuje.");
    expect(uniqueResult.message).not.toContain("secret");

    vi.resetAllMocks();
    const foreignKeyQuery = createMutationQuery({
      data: null,
      error: { code: "23503", message: "recordings_client_user_fk secret" }
    });
    arrangeSupabase({ from: vi.fn().mockReturnValue(foreignKeyQuery) });
    const deleteResult = await deleteRecordingClientAction(
      createInitialSaveActionState(),
      createForm({ entityId, scopeKey: entityId })
    );
    expect(deleteResult.message).toBe(
      "Klienta nelze smazat, dokud má přiřazené projekty nebo nahrávky."
    );
    expect(deleteResult.message).not.toContain("secret");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("assigns normalized organization through exactly one RPC and revalidates only success paths", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn();
    arrangeSupabase({ from, rpc });
    const formData = createForm({
      clientId,
      folderId,
      projectId,
      recordingId,
      scopeKey: recordingId,
      tagIds: [uppercaseTagId, tagId]
    });

    await expect(assignRecordingOrganizationAction(
      createInitialSaveActionState(),
      formData
    )).resolves.toMatchObject({ scopeKey: recordingId, status: "success" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("assign_recording_organization_v1", {
      p_client_id: clientId,
      p_folder_id: folderId,
      p_project_id: projectId,
      p_recording_id: recordingId,
      p_tag_ids: [tagId]
    });
    expect(from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/recordings"],
      [`/recordings/${recordingId}`]
    ]);
  });

  it("does not revalidate or make partial calls when assignment RPC fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "foreign row secret" }
    });
    const from = vi.fn();
    arrangeSupabase({ from, rpc });

    const result = await assignRecordingOrganizationAction(
      createInitialSaveActionState(),
      createForm({
        clientId: "",
        folderId: "",
        projectId: "",
        recordingId,
        scopeKey: recordingId,
        tagIds: []
      })
    );

    expect(result).toMatchObject({ scopeKey: recordingId, status: "error" });
    expect(result.message).toBe("Zařazení nahrávky se nepodařilo uložit.");
    expect(result.message).not.toContain("secret");
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("blocks an assignment scope mismatch before auth and RPC", async () => {
    const rpc = vi.fn();
    arrangeSupabase({ rpc });

    const result = await assignRecordingOrganizationAction(
      createInitialSaveActionState(),
      createForm({
        clientId: "",
        folderId: "",
        projectId: "",
        recordingId,
        scopeKey: entityId,
        tagIds: []
      })
    );

    expect(result).toMatchObject({ scopeKey: entityId, status: "error" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("settles a thrown RPC failure without leaking details or revalidating", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("database transport secret"));
    arrangeSupabase({ rpc });

    const result = await assignRecordingOrganizationAction(
      createInitialSaveActionState(),
      createForm({
        clientId: "",
        folderId: "",
        projectId: "",
        recordingId,
        scopeKey: recordingId,
        tagIds: []
      })
    );

    expect(result.message).toBe("Zařazení nahrávky se nepodařilo uložit.");
    expect(result.message).not.toContain("secret");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("uses no admin client and exports only SaveAction-compatible editor actions", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "recording-organization", "actions.ts"),
      "utf8"
    );
    expect(source).not.toContain("supabase/admin");
    expect(source).not.toContain('select("*")');
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect([...createCases, ...renameCases, ...deleteCases]).toHaveLength(11);
  });
});
