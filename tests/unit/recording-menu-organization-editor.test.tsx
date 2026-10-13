// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingMenuOrganizationEditor } from "@/components/workspace/recording-menu-organization-editor";
import { createSaveSuccess } from "@/lib/forms/save-action-state";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/recording-organization/load-recording-action", () => ({ loadRecordingOrganizationAction: mocks.load }));
vi.mock("@/lib/recording-organization/actions", () => ({ assignRecordingOrganizationAction: mocks.save }));

const options: RecordingOrganizationOptions = {
  clients: ["a", "b"].map((id) => ({ id, name: id, color: null, created_at: "", updated_at: "", user_id: "user" })),
  projects: ["a", "b"].map((id) => ({ id: `project-${id}`, client_id: id, name: id, color: null, created_at: "", updated_at: "" })),
  folders: [{ id: "folder", name: "Folder", color: null, created_at: "", updated_at: "", user_id: "user" }],
  tags: [{ id: "tag", name: "Tag", color: null, created_at: "", updated_at: "", user_id: "user" }]
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mocks.load.mockResolvedValue({ id: "recording", client_id: "a", project_id: "project-a", folder_id: "folder", tag_ids: ["tag"] });
  mocks.save.mockImplementation(async (state, form) => createSaveSuccess(state.revision, String(form.get("scopeKey")), "Uloženo."));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); });

// changeSelect exercises the controlled assignment draft through React's change event.
async function changeSelect(name: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("search row assignment editor", () => {
  it("loads only on demand, changes client/project and retains folder/tags when saving", async () => {
    await act(async () => root.render(<RecordingMenuOrganizationEditor recordingId="recording" options={options} />));
    expect(mocks.load).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector('[role="dialog"][aria-label="Zařazení nahrávky"]')).not.toBeNull();
    await changeSelect("clientId", "b");
    expect(container.querySelector<HTMLSelectElement>('select[name="projectId"]')!.value).toBe("");
    await changeSelect("projectId", "project-b");
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    const form = mocks.save.mock.calls[0][1] as FormData;
    expect(form.get("clientId")).toBe("b");
    expect(form.get("projectId")).toBe("project-b");
    expect(form.get("folderId")).toBe("folder");
    expect(form.getAll("tagIds")).toEqual(["tag"]);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => container.querySelector<HTMLElement>('summary')!.click());
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')!.value).toBe("b");
    await changeSelect("clientId", "a");
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("Zrušit"))!.click());
    await act(async () => container.querySelector<HTMLElement>('summary')!.click());
    expect(container.querySelector<HTMLSelectElement>('select[name="clientId"]')!.value).toBe("b");
  });
  it("shows a retryable error without opening an incomplete editor when the read fails", async () => {
    mocks.load.mockResolvedValue(null);
    await act(async () => root.render(<RecordingMenuOrganizationEditor recordingId="recording" options={options} />));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("nepodařilo načíst");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  });
});
