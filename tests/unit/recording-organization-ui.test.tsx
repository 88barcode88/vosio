// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationManager,
  type OrganizationManagerActions
} from "@/components/workspace/organization-manager";
import { RecordingOrganizationEditor } from "@/components/workspace/recording-organization-editor";
import { createSaveError, createSaveSuccess, type SaveAction, type SaveActionState } from "@/lib/forms/save-action-state";
import type {
  RecordingOrganization,
  RecordingOrganizationOptions
} from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";

const userId = "00000000-0000-4000-8000-000000000001";
const recordingA = "00000000-0000-4000-8000-000000000002";
const recordingB = "00000000-0000-4000-8000-000000000003";
const clientA = "00000000-0000-4000-8000-000000000004";
const clientB = "00000000-0000-4000-8000-000000000005";
const projectA = "00000000-0000-4000-8000-000000000006";
const projectB = "00000000-0000-4000-8000-000000000007";
const folderId = "00000000-0000-4000-8000-000000000008";
const tagA = "00000000-0000-4000-8000-000000000009";
const tagB = "00000000-0000-4000-8000-000000000010";
const timestamp = "2026-08-05T10:00:00.000Z";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

let container: HTMLDivElement;
let root: Root;
let animationFrameCallbacks: FrameRequestCallback[];

const options: RecordingOrganizationOptions = {
  clients: [
    { color: "#112233", created_at: timestamp, id: clientA, name: "Acme", updated_at: timestamp, user_id: userId },
    { color: null, created_at: timestamp, id: clientB, name: "Beta", updated_at: timestamp, user_id: userId }
  ],
  folders: [
    { color: null, created_at: timestamp, id: folderId, name: "Obchod", updated_at: timestamp, user_id: userId }
  ],
  projects: [
    { client_id: clientA, color: null, created_at: timestamp, id: projectA, name: "Projekt A", updated_at: timestamp, user_id: userId },
    { client_id: clientB, color: null, created_at: timestamp, id: projectB, name: "Projekt B", updated_at: timestamp, user_id: userId }
  ],
  tags: [
    { color: "#ABCDEF", created_at: timestamp, id: tagA, name: "Priorita", updated_at: timestamp, user_id: userId },
    { color: null, created_at: timestamp, id: tagB, name: "Follow-up", updated_at: timestamp, user_id: userId }
  ]
};

const organization: RecordingOrganization = {
  client: { color: "#112233", id: clientA, name: "Acme" },
  folder: { color: null, id: folderId, name: "Obchod" },
  project: { color: null, id: projectA, name: "Projekt A" },
  tags: [{ color: "#ABCDEF", id: tagA, name: "Priorita" }]
};

// createDeferred exposes a pending action settlement for lifecycle assertions.
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

// createManagerActions supplies a complete non-production action bundle for manager override tests.
function createManagerActions(
  overrides: Partial<OrganizationManagerActions> = {}
): OrganizationManagerActions {
  const succeed: SaveAction = async (state, formData) => createSaveSuccess(
    state.revision,
    String(formData.get("scopeKey")),
    "Uloženo."
  );
  return {
    createClient: succeed,
    createFolder: succeed,
    createProject: succeed,
    createTag: succeed,
    deleteClient: succeed,
    deleteFolder: succeed,
    deleteProject: succeed,
    deleteTag: succeed,
    renameClient: succeed,
    renameFolder: succeed,
    renameProject: succeed,
    renameTag: succeed,
    ...overrides
  };
}

// createRecording builds the minimal real RecordingRow used by the editor.
function createRecording(id = recordingA): RecordingRow {
  return {
    client_id: organization.client?.id ?? null,
    created_at: timestamp,
    duration_seconds: 120,
    error_message: null,
    file_size_bytes: null,
    folder_id: organization.folder?.id ?? null,
    id,
    mime_type: null,
    project_id: organization.project?.id ?? null,
    source_type: "realtime",
    status: "completed",
    storage_path: null,
    title: "Call",
    updated_at: timestamp,
    user_id: userId
  };
}

// setSelect changes a controlled select through React's input path.
async function setSelect(name: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (!select) throw new Error(`Missing select ${name}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return select;
}

// clickButton activates a button selected by visible text.
async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label)
  );
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
  return button;
}

// submitForm requests a mounted form by class name.
async function submitForm(className: string) {
  const form = container.querySelector<HTMLFormElement>(`form.${className}`);
  if (!form) throw new Error(`Missing form ${className}`);
  await act(async () => form.requestSubmit());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  animationFrameCallbacks = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrameCallbacks.push(callback);
    return animationFrameCallbacks.length;
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("RecordingOrganizationEditor", () => {
  it("renders colored detail chips while leaving neutral chips uncolored", async () => {
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording()} saveAction={vi.fn()} />
    ));

    const clientChip = Array.from(container.querySelectorAll<HTMLElement>(".organization-chip"))
      .find((chip) => chip.textContent === "Acme");
    const folderChip = Array.from(container.querySelectorAll<HTMLElement>(".organization-chip"))
      .find((chip) => chip.textContent === "Obchod");
    expect(clientChip?.classList.contains("organization-chip-colored")).toBe(true);
    expect(clientChip?.style.getPropertyValue("--organization-color")).toBe("#112233");
    expect(folderChip?.classList.contains("organization-chip-colored")).toBe(false);
  });

  it("shows current chips and enforces client-dependent project choices", async () => {
    await act(async () => root.render(
      <RecordingOrganizationEditor
        organization={organization}
        options={options}
        recording={createRecording()}
        saveAction={vi.fn()}
      />
    ));
    expect(container.textContent).toContain("Acme");
    expect(container.textContent).toContain("Projekt A");
    await clickButton("Upravit zařazení");

    const projectSelect = container.querySelector<HTMLSelectElement>('select[name="projectId"]');
    expect(projectSelect?.disabled).toBe(false);
    await setSelect("clientId", clientB);
    expect(projectSelect?.value).toBe("");
    expect(Array.from(projectSelect?.options ?? []).map((item) => item.value)).toContain(projectB);
    expect(Array.from(projectSelect?.options ?? []).map((item) => item.value)).not.toContain(projectA);
    await setSelect("clientId", "");
    expect(projectSelect?.disabled).toBe(true);
  });

  it("clears every assignment and supports multiple controlled tags", async () => {
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording()} saveAction={vi.fn()} />
    ));
    await clickButton("Upravit zařazení");
    await clickButton("Vyčistit zařazení");
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')?.value).toBe("");
    expect(container.querySelector<HTMLSelectElement>('select[name="folderId"]')?.value).toBe("");
    expect(container.querySelectorAll<HTMLInputElement>('input[name="tagIds"]:checked')).toHaveLength(0);

    const tagInputs = container.querySelectorAll<HTMLInputElement>('input[name="tagIds"]');
    await act(async () => {
      tagInputs.forEach((input) => input.click());
    });
    expect(container.querySelectorAll('input[name="tagIds"]:checked')).toHaveLength(2);
  });

  it("supports labeled controls and idle Escape dismissal", async () => {
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording()} saveAction={vi.fn()} />
    ));
    await clickButton("Upravit zařazení");
    for (const name of ["clientId", "projectId", "folderId"]) {
      expect(container.querySelector(`select[name="${name}"]`)?.closest("label")).not.toBeNull();
    }
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector(".recording-organization-editor-panel")).toBeNull();
  });

  it("blocks dismiss and duplicate submit while pending, then preserves values on error", async () => {
    const deferred = createDeferred<SaveActionState>();
    const saveAction = vi.fn().mockReturnValue(deferred.promise);
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording()} saveAction={saveAction} />
    ));
    await clickButton("Upravit zařazení");
    await setSelect("clientId", clientB);
    await submitForm("recording-organization-form");
    await submitForm("recording-organization-form");
    expect(saveAction).toHaveBeenCalledOnce();
    expect((await clickButton("Zrušit")).disabled).toBe(true);
    expect(container.querySelector(".recording-organization-editor-panel")).not.toBeNull();

    await act(async () => {
      deferred.resolve(createSaveError(0, recordingA, "Uložení selhalo."));
      await deferred.promise;
    });
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')?.value).toBe(clientB);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Uložení selhalo.");
  });

  it("preserves the entire open draft across fresh same-recording props", async () => {
    const recording = createRecording();
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={recording} saveAction={vi.fn()} />
    ));
    await clickButton("Upravit zařazení");
    await setSelect("clientId", clientB);
    await setSelect("projectId", projectB);
    await setSelect("folderId", "");
    const secondTag = container.querySelectorAll<HTMLInputElement>('input[name="tagIds"]')[1];
    await act(async () => secondTag?.click());

    await act(async () => root.render(
      <RecordingOrganizationEditor
        organization={{ ...organization, tags: organization.tags.map((tag) => ({ ...tag })) }}
        options={{
          clients: options.clients.map((client) => ({ ...client })),
          folders: options.folders.map((folder) => ({ ...folder })),
          projects: options.projects.map((project) => ({ ...project })),
          tags: options.tags.map((tag) => ({ ...tag }))
        }}
        recording={{ ...recording }}
        saveAction={vi.fn()}
      />
    ));

    expect(container.querySelector(".recording-organization-editor-panel")).not.toBeNull();
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')?.value).toBe(clientB);
    expect(container.querySelector<HTMLSelectElement>('select[name="projectId"]')?.value).toBe(projectB);
    expect(container.querySelector<HTMLSelectElement>('select[name="folderId"]')?.value).toBe("");
    expect(container.querySelectorAll('input[name="tagIds"]:checked')).toHaveLength(2);
  });

  it("preserves a pending draft across same-recording refreshes", async () => {
    const deferred = createDeferred<SaveActionState>();
    const saveAction = vi.fn().mockReturnValue(deferred.promise);
    const recording = createRecording();
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={recording} saveAction={saveAction} />
    ));
    await clickButton("Upravit zařazení");
    await setSelect("clientId", clientB);
    await setSelect("projectId", projectB);
    await submitForm("recording-organization-form");

    await act(async () => root.render(
      <RecordingOrganizationEditor
        organization={{ ...organization, tags: organization.tags.map((tag) => ({ ...tag })) }}
        options={{ ...options, projects: options.projects.map((project) => ({ ...project })) }}
        recording={{ ...recording }}
        saveAction={saveAction}
      />
    ));

    expect(container.querySelector(".recording-organization-editor-panel")).not.toBeNull();
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')?.value).toBe(clientB);
    expect(container.querySelector<HTMLSelectElement>('select[name="projectId"]')?.value).toBe(projectB);
    await act(async () => {
      deferred.resolve(createSaveError(0, recordingA, "Uložení selhalo."));
      await deferred.promise;
    });
  });

  it("syncs fresh persisted props while closed and resets only for a new recording identity", async () => {
    const recording = createRecording();
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={recording} saveAction={vi.fn()} />
    ));
    const betaOrganization: RecordingOrganization = {
      client: { color: null, id: clientB, name: "Beta" },
      folder: null,
      project: { color: null, id: projectB, name: "Projekt B" },
      tags: [{ color: null, id: tagB, name: "Follow-up" }]
    };
    const betaRecording = {
      ...recording,
      client_id: clientB,
      folder_id: null,
      project_id: projectB
    };
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={betaOrganization} options={options} recording={betaRecording} saveAction={vi.fn()} />
    ));
    await clickButton("Upravit zařazení");
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')?.value).toBe(clientB);
    expect(container.querySelector<HTMLInputElement>(`input[name="tagIds"][value="${tagB}"]`)?.checked).toBe(true);

    await setSelect("clientId", clientA);
    await act(async () => root.render(
      <RecordingOrganizationEditor
        organization={organization}
        options={options}
        recording={{ ...createRecording(recordingB) }}
        saveAction={vi.fn()}
      />
    ));
    expect(container.querySelector(".recording-organization-editor-panel")).toBeNull();
    await clickButton("Upravit zařazení");
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')?.value).toBe(clientA);
    expect(container.querySelector<HTMLInputElement>(`input[name="tagIds"][value="${tagA}"]`)?.checked).toBe(true);
  });

  it("reopens with the settled draft when success arrives before refreshed server props", async () => {
    const saveAction: SaveAction = async (state) => createSaveSuccess(state.revision, recordingA, "Zařazení uloženo.");
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording()} saveAction={saveAction} />
    ));
    await clickButton("Upravit zařazení");
    await setSelect("clientId", clientB);
    await setSelect("projectId", projectB);
    await submitForm("recording-organization-form");
    await clickButton("Upravit zařazení");
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')?.value).toBe(clientB);
    expect(container.querySelector<HTMLSelectElement>('select[name="projectId"]')?.value).toBe(projectB);
  });

  it("closes only a matching success, restores focus and keeps success in an external live region", async () => {
    const saveAction: SaveAction = async (state) => createSaveSuccess(state.revision, recordingA, "Zařazení uloženo.");
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording()} saveAction={saveAction} />
    ));
    const trigger = await clickButton("Upravit zařazení");
    await submitForm("recording-organization-form");
    animationFrameCallbacks.forEach((callback) => callback(0));
    expect(container.querySelector(".recording-organization-editor-panel")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Zařazení uloženo.");
  });

  it("ignores a stale success after switching to another recording", async () => {
    const deferred = createDeferred<SaveActionState>();
    const saveAction = vi.fn().mockReturnValue(deferred.promise);
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording(recordingA)} saveAction={saveAction} />
    ));
    await clickButton("Upravit zařazení");
    await submitForm("recording-organization-form");
    await act(async () => root.render(
      <RecordingOrganizationEditor organization={organization} options={options} recording={createRecording(recordingB)} saveAction={saveAction} />
    ));
    await act(async () => {
      deferred.resolve(createSaveSuccess(0, recordingA, "Stará odpověď."));
      await deferred.promise;
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).not.toContain("Stará odpověď.");
  });
});

describe("OrganizationManager", () => {
  it("renders all four empty management groups", async () => {
    await act(async () => root.render(
      <OrganizationManager options={{ clients: [], folders: [], projects: [], tags: [] }} />
    ));
    for (const label of ["Klienti", "Projekty", "Složky", "Štítky"]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).toContain("Zatím bez položek");
  });

  it("uses a stable create scope, preserves failed input and uses entity id for rename", async () => {
    const createAction = vi.fn(async (state: SaveActionState, formData: FormData) =>
      createSaveError(state.revision, String(formData.get("scopeKey")), "Vytvoření selhalo.")
    );
    const renameAction = vi.fn(async (state: SaveActionState, formData: FormData) =>
      createSaveSuccess(state.revision, String(formData.get("scopeKey")), "Přejmenováno.")
    );
    await act(async () => root.render(
      <OrganizationManager
        actions={createManagerActions({ createClient: createAction, renameClient: renameAction })}
        options={options}
      />
    ));
    await clickButton("Přidat klienta");
    const nameInput = container.querySelector<HTMLInputElement>('.organization-create-form input[name="name"]');
    expect(nameInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(nameInput, "Nový klient");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm("organization-create-form");
    const submittedScope = String(createAction.mock.calls[0]?.[1].get("scopeKey"));
    expect(submittedScope).toMatch(/^create:client:/);
    expect(nameInput?.value).toBe("Nový klient");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Vytvoření selhalo.");

    await clickButton("Přejmenovat Acme");
    const renameForm = container.querySelector<HTMLFormElement>("form.organization-rename-form");
    await act(async () => renameForm?.requestSubmit());
    expect(renameAction.mock.calls[0]?.[1].get("scopeKey")).toBe(clientA);
  });

  it("uses a visual color picker and submits a blank hidden color after choosing neutral", async () => {
    const createAction = vi.fn(async (state: SaveActionState, formData: FormData) =>
      createSaveSuccess(state.revision, String(formData.get("scopeKey")), "VytvoĹ™eno.")
    );
    await act(async () => root.render(
      <OrganizationManager actions={createManagerActions({ createClient: createAction })} options={options} />
    ));
    const createClientButton = container.querySelector<HTMLButtonElement>(
      ".organization-manager-group:first-child .organization-save-editor > button"
    );
    await act(async () => createClientButton?.click());

    const form = container.querySelector<HTMLFormElement>("form.organization-create-form");
    const picker = form?.querySelector<HTMLInputElement>('input[type="color"]');
    const hiddenColor = form?.querySelector<HTMLInputElement>('input[type="hidden"][name="color"]');
    const nameInput = form?.querySelector<HTMLInputElement>('input[name="name"]');
    expect(picker).not.toBeNull();
    expect(hiddenColor?.value).toBe("");
    expect(form?.querySelector('input[type="text"][name="color"]')).toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(picker, "#224466");
      picker?.dispatchEvent(new Event("input", { bubbles: true }));
      picker?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(hiddenColor?.value).toBe("#224466");
    await clickButton("Bez barvy");
    expect(hiddenColor?.value).toBe("");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(nameInput, "Nový klient");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await submitForm("organization-create-form");
    expect(createAction.mock.calls[0]?.[1].get("color")).toBe("");
  });

  it("renders each manager row as one colored badge without a separate color dot", async () => {
    await act(async () => root.render(<OrganizationManager options={options} />));
    const badge = Array.from(container.querySelectorAll<HTMLElement>(".organization-manager-badge"))
      .find((item) => item.textContent === "Acme");
    expect(badge?.style.getPropertyValue("--organization-color")).toBe("#112233");
    expect(container.querySelector(".organization-manager-row-label > span")).toBeNull();
  });

  it("requires destructive confirmation and explains client restrictions", async () => {
    const deleteClient = vi.fn(async (state: SaveActionState) =>
      createSaveSuccess(state.revision, clientA, "Smazáno.")
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => root.render(
      <OrganizationManager actions={createManagerActions({ deleteClient })} options={options} />
    ));
    await clickButton("Smazat Acme");
    expect(deleteClient).not.toHaveBeenCalled();
    await clickButton("Smazat Acme");
    expect(confirm.mock.calls[0]?.[0]).toContain("projektů nebo nahrávek");
    expect(deleteClient).toHaveBeenCalledOnce();
  });
  it("disambiguates duplicate project names by client and targets the selected row", async () => {
    const duplicateOptions: RecordingOrganizationOptions = {
      ...options,
      projects: [
        { ...options.projects[0], name: "Společný projekt" },
        { ...options.projects[1], name: "Společný projekt" }
      ]
    };
    const renameProject = vi.fn(async (state: SaveActionState, formData: FormData) =>
      createSaveSuccess(state.revision, String(formData.get("scopeKey")), "Přejmenováno.")
    );
    const deleteProject = vi.fn(async (state: SaveActionState, formData: FormData) =>
      createSaveSuccess(state.revision, String(formData.get("scopeKey")), "Smazáno.")
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => root.render(
      <OrganizationManager
        actions={createManagerActions({ deleteProject, renameProject })}
        options={duplicateOptions}
      />
    ));

    expect(container.textContent).toContain("Společný projekt · Acme");
    expect(container.textContent).toContain("Společný projekt · Beta");
    await clickButton("Přejmenovat Společný projekt · Beta");
    await submitForm("organization-rename-form");
    expect(renameProject.mock.calls[0]?.[1].get("entityId")).toBe(projectB);

    await clickButton("Smazat Společný projekt · Beta");
    expect(confirm.mock.calls.at(-1)?.[0]).toContain("Společný projekt · Beta");
    expect(deleteProject.mock.calls[0]?.[1].get("entityId")).toBe(projectB);
  });

  it("focuses the required client when creating a project", async () => {
    await act(async () => root.render(<OrganizationManager options={options} />));
    await clickButton("Přidat projekt");
    expect(document.activeElement).toBe(
      container.querySelector<HTMLSelectElement>('.organization-create-form select[name="clientId"]')
    );
  });
});

describe("organization UI integration", () => {
  it("keeps organization cards compact without overflowing the responsive layout", () => {
    const recordingStyles = readFileSync(
      join(process.cwd(), "app", "styles", "documentation-recordings.css"),
      "utf8"
    );
    const responsiveStyles = readFileSync(join(process.cwd(), "app", "styles", "responsive.css"), "utf8");

    expect(recordingStyles).toMatch(/\.organization-manager-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(responsiveStyles).toMatch(/@media \(max-width: 1180px\)\s*\{[\s\S]*?\.organization-manager-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(responsiveStyles).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*?\.organization-manager-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    expect(recordingStyles).toMatch(/\.organization-create-form,[\s\S]*?\.organization-rename-form\s*\{[\s\S]*?box-sizing:\s*border-box/);
    expect(recordingStyles).toMatch(/\.organization-manager-group > header\s*\{[\s\S]*?position:\s*relative/);
    expect(recordingStyles).toMatch(/\.organization-manager-group > header \.organization-save-editor,[\s\S]*?\.organization-manager-row-actions \.organization-save-editor\s*\{[\s\S]*?position:\s*static/);
    expect(recordingStyles).toMatch(/\.organization-manager-group li\s*\{[\s\S]*?position:\s*relative/);
    expect(recordingStyles).toMatch(/\.organization-create-form\s*\{[\s\S]*?position:\s*absolute[\s\S]*?width:\s*min\(280px, 100%, calc\(100vw - 52px\)\)/);
    expect(recordingStyles).toMatch(/\.organization-rename-form\s*\{[\s\S]*?width:\s*min\(280px, 100%, calc\(100vw - 52px\)\)[\s\S]*?top:\s*calc\(100% \+ 6px\)/);
  });

  it("keeps the existing title editor and loads organization data outside recording row loops", () => {
    const workbenchSource = readFileSync(
      join(process.cwd(), "src", "components", "workspace", "recording-workbench.tsx"),
      "utf8"
    );
    const listPageSource = readFileSync(join(process.cwd(), "app", "recordings", "page.tsx"), "utf8");
    const detailPageSource = readFileSync(
      join(process.cwd(), "app", "recordings", "[recordingId]", "page.tsx"),
      "utf8"
    );

    expect(workbenchSource).toContain("<RecordingDetailTitleEditor");
    expect(workbenchSource).toContain("<RecordingOrganizationEditor");
    expect(workbenchSource).toContain('key={`organization-${activeRecordingRow.id}`}');
    expect(listPageSource.match(/listRecordingOrganizationOptions\(supabase\)/g)).toHaveLength(1);
    expect(detailPageSource.match(/listRecordingOrganizationOptions\(supabase\)/g)).toHaveLength(1);
    expect(detailPageSource.match(/getRecordingOrganization\(supabase, recording\)/g)).toHaveLength(1);
    expect(detailPageSource).not.toMatch(/recordings\.map[\s\S]*getRecordingOrganization/);
  });
});
