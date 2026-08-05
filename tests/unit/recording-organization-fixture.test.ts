import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSaveActionState, type SaveActionState } from "@/lib/forms/save-action-state";
import {
  assignFixtureOrganizationAction,
  createFixtureClientAction,
  createFixtureFolderAction,
  createFixtureProjectAction,
  createFixtureTagAction,
  deleteFixtureClientAction,
  deleteFixtureFolderAction,
  deleteFixtureProjectAction,
  deleteFixtureTagAction,
  renameFixtureClientAction,
  renameFixtureFolderAction,
  renameFixtureProjectAction,
  renameFixtureTagAction
} from "../../app/login/recording-organization-e2e/actions";
import {
  requireOrganizationFixtureAccess,
  validateOrganizationFixtureAccess
} from "../../app/login/recording-organization-e2e/development-runtime";
import { DELETE } from "../../app/login/recording-organization-e2e/fixture/route";
import {
  getOrganizationFixtureMutationCount,
  getOrganizationFixtureSnapshot,
  hasOrganizationFixture,
  resetOrganizationFixture
} from "../../app/login/recording-organization-e2e/fixture-store";

const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const scopeA = "abc123def45";
const scopeB = "def456abc78";

// createForm builds one action payload while preserving repeatable tag ids.
function createForm(values: Record<string, string | string[]>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => formData.append(name, item));
    else formData.set(name, value);
  }
  return formData;
}

// expectSuccess verifies the shared scope/revision settlement contract.
function expectSuccess(result: SaveActionState, scopeKey: string) {
  expect(result).toMatchObject({ revision: 1, scopeKey, status: "success" });
}

beforeEach(() => {
  mocks.revalidatePath.mockReset();
  vi.stubEnv("NODE_ENV", "development");
  resetOrganizationFixture(scopeA);
  resetOrganizationFixture(scopeB);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recording organization fixture development boundary", () => {
  it("rejects production and test before any fixture mutation", async () => {
    expect(validateOrganizationFixtureAccess("production", scopeA)).toEqual({
      ok: false,
      reason: "environment"
    });
    expect(validateOrganizationFixtureAccess("test", scopeA)).toEqual({
      ok: false,
      reason: "environment"
    });
    expect(() => requireOrganizationFixtureAccess("test", scopeA)).toThrow("development-only");

    vi.stubEnv("NODE_ENV", "test");
    await expect(createFixtureClientAction(
      scopeA,
      createInitialSaveActionState(),
      createForm({ color: "", name: "Blocked", scopeKey: "create:client:test" })
    )).rejects.toThrow("development-only");
    expect(getOrganizationFixtureMutationCount(scopeA)).toBe(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns safe route responses for invalid scopes and deletes only one valid dev scope", async () => {
    for (const suffix of ["", "?scope=bad", `?scope=${scopeA}&scope=${scopeB}`]) {
      const response = await DELETE(new Request(`http://example.test/login/recording-organization-e2e/fixture${suffix}`, {
        method: "DELETE"
      }));
      expect(response.status).toBe(400);
      expect(getOrganizationFixtureMutationCount(scopeA)).toBe(0);
      expect(hasOrganizationFixture(scopeA)).toBe(true);
    }

    vi.stubEnv("NODE_ENV", "production");
    const hidden = await DELETE(new Request(
      `http://example.test/login/recording-organization-e2e/fixture?scope=${scopeA}`,
      { method: "DELETE" }
    ));
    expect(hidden.status).toBe(404);
    expect(hasOrganizationFixture(scopeA)).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    const deleted = await DELETE(new Request(
      `http://example.test/login/recording-organization-e2e/fixture?scope=${scopeA}`,
      { method: "DELETE" }
    ));
    expect(deleted.status).toBe(200);
    expect(hasOrganizationFixture(scopeA)).toBe(false);
    expect(hasOrganizationFixture(scopeB)).toBe(true);
  });

  it("rejects malformed save scopes without changing the bounded store", async () => {
    const missing = await createFixtureClientAction(
      scopeA,
      createInitialSaveActionState(),
      createForm({ color: "", name: "Acme", scopeKey: "" })
    );
    expect(missing).toMatchObject({ scopeKey: null, status: "error" });

    const mismatch = await renameFixtureClientAction(
      scopeA,
      createInitialSaveActionState(),
      createForm({
        color: "",
        entityId: "00000000-0000-4000-8000-000000000003",
        name: "Acme",
        scopeKey: "00000000-0000-4000-8000-000000000004"
      })
    );
    expect(mismatch).toMatchObject({ status: "error" });
    expect(getOrganizationFixtureMutationCount(scopeA)).toBe(0);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("recording organization fixture action bundle", () => {
  it("covers every create, rename and delete action with isolated schema semantics", async () => {
    const state = createInitialSaveActionState();
    const createClientScope = "create:client:test";
    expectSuccess(await createFixtureClientAction(
      scopeA,
      state,
      createForm({ color: "#112233", name: "Acme", scopeKey: createClientScope })
    ), createClientScope);
    expectSuccess(await createFixtureClientAction(
      scopeA,
      state,
      createForm({ color: "", name: "Unused", scopeKey: createClientScope })
    ), createClientScope);

    let snapshot = getOrganizationFixtureSnapshot(scopeA);
    const client = snapshot.options.clients.find((row) => row.name === "Acme")!;
    const unusedClient = snapshot.options.clients.find((row) => row.name === "Unused")!;
    const projectScope = "create:project:test";
    const folderScope = "create:folder:test";
    const tagScope = "create:tag:test";
    expectSuccess(await createFixtureProjectAction(
      scopeA,
      state,
      createForm({ clientId: client.id, color: "", name: "Project X", scopeKey: projectScope })
    ), projectScope);
    expectSuccess(await createFixtureFolderAction(
      scopeA,
      state,
      createForm({ color: "#445566", name: "Calls", scopeKey: folderScope })
    ), folderScope);
    expectSuccess(await createFixtureTagAction(
      scopeA,
      state,
      createForm({ color: "", name: "Important", scopeKey: tagScope })
    ), tagScope);

    snapshot = getOrganizationFixtureSnapshot(scopeA);
    const project = snapshot.options.projects.find((row) => row.name === "Project X")!;
    const folder = snapshot.options.folders.find((row) => row.name === "Calls")!;
    const tag = snapshot.options.tags.find((row) => row.name === "Important")!;
    const renameCases = [
      [renameFixtureClientAction, client.id, "Acme Updated"],
      [renameFixtureProjectAction, project.id, "Project Updated"],
      [renameFixtureFolderAction, folder.id, "Calls Updated"],
      [renameFixtureTagAction, tag.id, "Important Updated"]
    ] as const;
    for (const [action, entityId, name] of renameCases) {
      expectSuccess(await action(
        scopeA,
        state,
        createForm({ color: "", entityId, name, scopeKey: entityId })
      ), entityId);
    }

    const recordingId = snapshot.primary.id;
    expectSuccess(await assignFixtureOrganizationAction(
      scopeA,
      state,
      createForm({
        clientId: client.id,
        folderId: folder.id,
        projectId: project.id,
        recordingId,
        scopeKey: recordingId,
        tagIds: [tag.id]
      })
    ), recordingId);

    const deleteCases = [
      [deleteFixtureProjectAction, project.id],
      [deleteFixtureFolderAction, folder.id],
      [deleteFixtureTagAction, tag.id],
      [deleteFixtureClientAction, unusedClient.id]
    ] as const;
    for (const [action, entityId] of deleteCases) {
      expectSuccess(await action(
        scopeA,
        state,
        createForm({ entityId, scopeKey: entityId })
      ), entityId);
    }

    const restrictedClientDelete = await deleteFixtureClientAction(
      scopeA,
      state,
      createForm({ entityId: client.id, scopeKey: client.id })
    );
    expect(restrictedClientDelete).toMatchObject({ scopeKey: client.id, status: "error" });
    expect(restrictedClientDelete.message).toContain("projekty nebo nahrávky");

    snapshot = getOrganizationFixtureSnapshot(scopeA);
    expect(snapshot.options.clients.map((row) => row.name)).toEqual(["Acme Updated"]);
    expect(snapshot.options.projects).toEqual([]);
    expect(snapshot.options.folders).toEqual([]);
    expect(snapshot.options.tags).toEqual([]);
    expect(snapshot.primary).toMatchObject({ client_id: client.id, folder_id: null, project_id: null });
    expect(snapshot.organization.tags).toEqual([]);
    expect(getOrganizationFixtureMutationCount(scopeA)).toBe(14);
    expect(getOrganizationFixtureMutationCount(scopeB)).toBe(0);
    expect(getOrganizationFixtureSnapshot(scopeB).options.clients).toEqual([]);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(14);
  });

  it("wires a complete fixture bundle and never imports or merges production actions", () => {
    const pageSource = readFileSync(
      join(process.cwd(), "app", "login", "recording-organization-e2e", "page.tsx"),
      "utf8"
    );
    const actionSource = readFileSync(
      join(process.cwd(), "app", "login", "recording-organization-e2e", "actions.ts"),
      "utf8"
    );
    const managerSource = readFileSync(
      join(process.cwd(), "src", "components", "workspace", "organization-manager.tsx"),
      "utf8"
    );
    for (const actionName of [
      "createClient", "createProject", "createFolder", "createTag",
      "renameClient", "renameProject", "renameFolder", "renameTag",
      "deleteClient", "deleteProject", "deleteFolder", "deleteTag"
    ]) {
      expect(pageSource).toContain(`${actionName}:`);
    }
    expect(pageSource).not.toContain("@/lib/recording-organization/actions");
    expect(actionSource).not.toContain("@/lib/supabase/");
    expect(managerSource).toContain("const resolvedActions = actions ?? defaultActions;");
    expect(managerSource).not.toContain("{ ...defaultActions, ...actions }");
  });
});
