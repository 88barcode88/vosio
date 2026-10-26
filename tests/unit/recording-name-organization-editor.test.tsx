// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingNameOrganizationEditor } from "@/components/workspace/recording-name-organization-editor";
import { createSaveError, createSaveSuccess } from "@/lib/forms/save-action-state";
import type { RecordingRow } from "@/lib/recordings/types";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";

const mocks = vi.hoisted(() => ({ title: vi.fn(), organization: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/recordings/actions", () => ({ updateRecordingTitleStateAction: mocks.title }));
vi.mock("@/lib/recording-organization/actions", () => ({ assignRecordingOrganizationAction: mocks.organization }));
vi.mock("@/lib/recording-organization/load-recording-action", () => ({ loadRecordingOrganizationAction: mocks.load }));
const options: RecordingOrganizationOptions = { clients: [], projects: [], folders: [], tags: [] };
const recording = { id: "recording", title: "Původní", client_id: null, project_id: null, folder_id: null, tag_ids: [] } as unknown as RecordingRow;
let root: Root;
let container: HTMLDivElement;

// openEditor opens the single action directly and preserves the actual trigger for focus assertions.
async function openEditor(search = false) {
  await act(async () => root.render(<details open className="recordings-actions-menu"><summary>Možnosti</summary>
    <RecordingNameOrganizationEditor recordingId={recording.id} title={recording.title}
      editTitle editOrganization options={options} recording={search ? undefined : recording} /></details>));
  const trigger = container.querySelector<HTMLElement>(".recording-name-organization-popover > summary")!;
  trigger.tabIndex = 0; // jsdom does not supply the native summary tab stop.
  trigger.focus();
  await act(async () => trigger.click());
  return trigger;
}

// changeTitle exercises React's controlled input path rather than mutating its value alone.
async function changeTitle(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[name="title"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// submitSection sends exactly one of the two independent mutations.
async function submitSection(section: string) {
  await act(async () => container.querySelector<HTMLFormElement>(`form[aria-label="${section}"]`)!.requestSubmit());
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 0; });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  mocks.title.mockImplementation(async (state) => createSaveSuccess(state.revision, "recording", "Název uložen."));
  mocks.organization.mockImplementation(async (state) => createSaveSuccess(state.revision, "recording", "Zařazení uloženo."));
  mocks.load.mockResolvedValue(recording);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("unified recording name and organization editor", () => {
  it("opens both labelled sections directly, preserves drafts across Escape and restores focus", async () => {
    const trigger = await openEditor();
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Název a zařazení");
    expect(container.querySelectorAll("form")).toHaveLength(2);
    expect(container.textContent).not.toContain("Upravit+");
    await changeTitle("Rozepsaný název");
    await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    expect(container.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("Rozepsaný název");
  });

  it("keeps the other draft and failure visible after a partial save and accepts a retry", async () => {
    await openEditor();
    await changeTitle("Neuložený název");
    mocks.title.mockImplementationOnce(async (state) => createSaveError(state.revision, "recording", "Název nelze uložit."));
    await submitSection("Název");
    await submitSection("Zařazení");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Název nelze uložit.");
    expect(container.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("Neuložený název");
    expect(container.textContent).toContain("Zařazení uloženo.");
    await submitSection("Název");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Název uložen.");
  });

  it("blocks Escape and other section controls while either mutation is pending", async () => {
    let settle!: (value: ReturnType<typeof createSaveSuccess>) => void;
    mocks.organization.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    await openEditor();
    await submitSection("Zařazení");
    const titleInput = container.querySelector<HTMLInputElement>('input[name="title"]')!;
    expect(titleInput.matches(":disabled")).toBe(true);
    const menu = container.querySelector<HTMLDetailsElement>(".recordings-actions-menu")!;
    await act(async () => menu.querySelector<HTMLElement>(":scope > summary")!.click());
    expect(menu.open).toBe(true);
    await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => settle(createSaveSuccess(0, "recording", "Zařazení uloženo.")));
    expect(titleInput.matches(":disabled")).toBe(false);
  });

  it("exposes only the title section when organization capability is absent", async () => {
    await act(async () => root.render(<RecordingNameOrganizationEditor recordingId={recording.id} title={recording.title}
      editTitle editOrganization={false} options={options} />));
    await act(async () => container.querySelector<HTMLElement>("summary")!.click());
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(container.querySelector('form[aria-label="Zařazení"]')).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("loads search tags only after opening and preserves them in the assignment form", async () => {
    await openEditor(true);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("recording");
    expect(container.querySelectorAll("form")).toHaveLength(2);
    await submitSection("Zařazení");
    expect(mocks.organization).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
