// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingFilters } from "@/components/workspace/recording-filters";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";

const navigation = vi.hoisted(() => ({
  currentSearch: "",
  push: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/recordings",
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.currentSearch)
}));

const userId = "00000000-0000-4000-8000-000000000001";
const clientA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const projectB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const folderA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const tagA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const timestamp = "2026-08-05T10:00:00.000Z";

const options: RecordingOrganizationOptions = {
  clients: [
    { color: null, created_at: timestamp, id: clientA, name: "Acme", updated_at: timestamp, user_id: userId },
    { color: null, created_at: timestamp, id: clientB, name: "Beta", updated_at: timestamp, user_id: userId }
  ],
  folders: [
    { color: null, created_at: timestamp, id: folderA, name: "Calls", updated_at: timestamp, user_id: userId }
  ],
  projects: [
    { client_id: clientA, color: null, created_at: timestamp, id: projectA, name: "Project X", updated_at: timestamp, user_id: userId },
    { client_id: clientB, color: null, created_at: timestamp, id: projectB, name: "Project Y", updated_at: timestamp, user_id: userId }
  ],
  tags: [
    { color: null, created_at: timestamp, id: tagA, name: "Important", updated_at: timestamp, user_id: userId }
  ]
};

const emptyFilters: RecordingOrganizationFilters = {
  clientId: null,
  folderId: null,
  projectId: null,
  tagIds: []
};

let container: HTMLDivElement;
let root: Root;

// setInput changes a controlled text input through React's native input path.
async function setInput(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(`Missing input ${name}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

// setSelect changes a controlled select through React's native change path.
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

// clickButton activates one filter action by exact visible text.
async function clickButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}

// clickButtonDuringTransition starts an unresolved navigation without waiting for its action.
function clickButtonDuringTransition(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing button ${label}`);
  act(() => button.click());
}

// createDeferred lets navigation tests control when a transition settles.
function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  navigation.currentSearch = "";
  navigation.push.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("RecordingFilters draft composition", () => {
  it("clears applied organization filters while preserving an unsaved q draft", async () => {
    const filters = { clientId: clientA, folderId: null, projectId: projectA, tagIds: [tagA] };
    navigation.currentSearch = `q=saved&client=${clientA}&project=${projectA}&tag=${tagA}`;
    await act(async () => root.render(
      <RecordingFilters filters={filters} options={options} searchQuery="saved" />
    ));

    await setInput("q", "draft query");
    await clickButton("Vyčistit filtry");

    const target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.get("q")).toBe("draft query");
    expect(target.searchParams.has("client")).toBe(false);
    expect(target.searchParams.has("project")).toBe(false);
    expect(target.searchParams.has("tag")).toBe(false);
  });

  it("clears q while preserving the current unsaved canonical organization draft", async () => {
    navigation.currentSearch = "q=saved";
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="saved" />
    ));

    await setSelect("client", clientA);
    await setSelect("project", projectA);
    await setSelect("folder", folderA);
    const tag = container.querySelector<HTMLInputElement>(`input[name="tag"][value="${tagA}"]`);
    await act(async () => tag?.click());
    await clickButton("Vyčistit hledání");

    const target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.has("q")).toBe(false);
    expect(target.searchParams.get("client")).toBe(clientA);
    expect(target.searchParams.get("project")).toBe(projectA);
    expect(target.searchParams.get("folder")).toBe(folderA);
    expect(target.searchParams.getAll("tag")).toEqual([tagA]);
  });

  it("locks every control during navigation without losing the submitted draft", async () => {
    const navigationRequest = createDeferred();
    navigation.push.mockImplementationOnce(() => navigationRequest.promise);
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="" />
    ));
    await setInput("q", "draft call");
    await setSelect("client", clientA);
    await setSelect("project", projectA);
    const tag = container.querySelector<HTMLInputElement>(`input[name="tag"][value="${tagA}"]`);
    await act(async () => tag?.click());
    clickButtonDuringTransition("Použít filtry");

    const form = container.querySelector<HTMLFormElement>("form.recording-filters");
    expect(form?.getAttribute("aria-busy")).toBe("true");
    for (const control of container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      "form.recording-filters input, form.recording-filters select, form.recording-filters button"
    )) {
      expect(control.disabled, control.outerHTML).toBe(true);
    }
    expect(container.querySelector<HTMLInputElement>('input[name="q"]')?.value).toBe("draft call");
    expect(container.querySelector<HTMLSelectElement>('select[name="client"]')?.value).toBe(clientA);
    expect(container.querySelector<HTMLSelectElement>('select[name="project"]')?.value).toBe(projectA);
    expect(tag?.checked).toBe(true);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Aktualizuji");

    await act(async () => {
      navigationRequest.resolve();
      await navigationRequest.promise;
    });
    expect(form?.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector<HTMLInputElement>('input[name="q"]')?.disabled).toBe(false);
  });

  it("settles a canonical URL commit on the same component instance and skips a same-URL push", async () => {
    const navigationRequest = createDeferred();
    navigation.currentSearch = "q=%20%20call%20%20notes%20%20&q=ignored&page=2";
    navigation.push.mockImplementationOnce(() => navigationRequest.promise);
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="call notes" />
    ));

    clickButtonDuringTransition("Použít filtry");
    const target = navigation.push.mock.calls[0]?.[0] as string;
    expect(target).toBe("/recordings?q=call+notes&page=2");
    expect(container.querySelector("form.recording-filters")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      navigation.currentSearch = target.split("?")[1] ?? "";
      root.render(<RecordingFilters filters={emptyFilters} options={options} searchQuery="call notes" />);
      navigationRequest.resolve();
      await navigationRequest.promise;
    });
    expect(container.querySelector("form.recording-filters")?.getAttribute("aria-busy")).toBe("false");

    navigation.push.mockClear();
    await clickButton("Použít filtry");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(container.querySelector("form.recording-filters")?.getAttribute("aria-busy")).toBe("false");
  });
});
