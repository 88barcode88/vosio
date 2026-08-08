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
    { client_id: clientA, color: null, created_at: timestamp, id: projectA, name: "Project X", updated_at: timestamp, user_id: userId }
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
}

// changeSelectDuringTransition starts an unresolved navigation without awaiting it.
function changeSelectDuringTransition(name: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (!select) throw new Error(`Missing select ${name}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
  vi.useRealTimers();
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("RecordingFilters URL navigation", () => {
  it("immediately changes the client, clears an incompatible project and preserves unrelated URL parameters", async () => {
    const filters = { clientId: clientA, folderId: null, projectId: projectA, tagIds: [] };
    navigation.currentSearch = `scope=fixture&q=call&client=${clientA}&project=${projectA}&page=2`;
    await act(async () => root.render(
      <RecordingFilters filters={filters} options={options} searchQuery="call" />
    ));

    await setSelect("client", clientB);

    const target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.get("scope")).toBe("fixture");
    expect(target.searchParams.get("q")).toBe("call");
    expect(target.searchParams.get("client")).toBe(clientB);
    expect(target.searchParams.has("project")).toBe(false);
    expect(target.searchParams.has("page")).toBe(false);
    expect(container.querySelector<HTMLSelectElement>('select[name="project"]')?.value).toBe("");
  });

  it("preserves an uncommitted short search draft when organization filters change", async () => {
    navigation.currentSearch = "scope=fixture";
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="" />
    ));

    await setInput("q", "ab");
    await setSelect("folder", folderA);

    const target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.get("q")).toBe("ab");
    expect(target.searchParams.get("folder")).toBe(folderA);
    expect(target.searchParams.get("scope")).toBe("fixture");
  });

  it("clears organization filters while preserving the current search draft", async () => {
    const filters = { clientId: clientA, folderId: null, projectId: projectA, tagIds: [] };
    navigation.currentSearch = `scope=fixture&q=saved&client=${clientA}&project=${projectA}`;
    await act(async () => root.render(
      <RecordingFilters filters={filters} options={options} searchQuery="saved" />
    ));

    await setInput("q", "ab");
    const clearFiltersButton = container.querySelector<HTMLButtonElement>(".recording-filter-actions button");
    await act(async () => clearFiltersButton?.click());

    const target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.get("q")).toBe("ab");
    expect(target.searchParams.has("client")).toBe(false);
    expect(target.searchParams.has("project")).toBe(false);
    expect(target.searchParams.get("scope")).toBe("fixture");
  });

  it("immediately changes folders and tags without rendering a submit action", async () => {
    navigation.currentSearch = "scope=fixture&q=call";
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="call" />
    ));

    await setSelect("folder", folderA);
    let target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.get("folder")).toBe(folderA);
    expect(target.searchParams.get("scope")).toBe("fixture");

    navigation.push.mockClear();
    const tag = container.querySelector<HTMLInputElement>(`input[name="tag"][value="${tagA}"]`);
    await act(async () => tag?.click());
    target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.getAll("tag")).toEqual([tagA]);
    expect(target.searchParams.get("q")).toBe("call");
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it("immediately changes projects and skips a duplicate push for the committed URL", async () => {
    const filters = { clientId: clientA, folderId: null, projectId: null, tagIds: [] };
    navigation.currentSearch = `scope=fixture&client=${clientA}`;
    await act(async () => root.render(
      <RecordingFilters filters={filters} options={options} searchQuery="" />
    ));

    await setSelect("project", projectA);
    const target = navigation.push.mock.calls[0]?.[0] as string;
    expect(new URL(target, "https://example.test").searchParams.get("project")).toBe(projectA);

    navigation.currentSearch = target.split("?")[1] ?? "";
    navigation.push.mockClear();
    await act(async () => root.render(
      <RecordingFilters
        filters={{ clientId: clientA, folderId: null, projectId: projectA, tagIds: [] }}
        options={options}
        searchQuery=""
      />
    ));
    await setSelect("project", projectA);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("syncs controls to an external browser history location without pushing the stale draft", async () => {
    vi.useFakeTimers();
    navigation.currentSearch = `scope=fixture&q=old&client=${clientA}`;
    await act(async () => root.render(
      <RecordingFilters
        filters={{ clientId: clientA, folderId: null, projectId: null, tagIds: [] }}
        options={options}
        searchQuery="old"
      />
    ));
    await setInput("q", "stale draft");
    navigation.push.mockClear();

    navigation.currentSearch = `scope=fixture&q=new&client=${clientB}`;
    await act(async () => root.render(
      <RecordingFilters
        filters={{ clientId: clientB, folderId: null, projectId: null, tagIds: [] }}
        options={options}
        searchQuery="new"
      />
    ));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(container.querySelector<HTMLInputElement>('input[name="q"]')?.value).toBe("new");
    expect(container.querySelector<HTMLSelectElement>('select[name="client"]')?.value).toBe(clientB);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("debounces only empty or three-character normalized searches", async () => {
    vi.useFakeTimers();
    navigation.currentSearch = "scope=fixture&q=call&page=2";
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="call" />
    ));

    await setInput("q", "ab");
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(navigation.push).not.toHaveBeenCalled();

    await setInput("q", "  call   notes  ");
    await act(async () => { await vi.advanceTimersByTimeAsync(349); });
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    let target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.get("q")).toBe("call notes");
    expect(target.searchParams.get("scope")).toBe("fixture");
    expect(target.searchParams.has("page")).toBe(false);

    await setInput("q", "   ");
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    target = new URL(navigation.push.mock.calls[1]?.[0], "https://example.test");
    expect(target.searchParams.has("q")).toBe(false);
  });

  it("does not push a duplicate target while a matching navigation is still pending", async () => {
    vi.useFakeTimers();
    const navigationRequest = createDeferred();
    navigation.push.mockImplementation(() => navigationRequest.promise);
    navigation.currentSearch = "scope=fixture";
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="" />
    ));

    await setInput("q", "call");
    changeSelectDuringTransition("client", clientA);
    expect(navigation.push).toHaveBeenCalledTimes(1);
    const target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.get("q")).toBe("call");
    expect(target.searchParams.get("client")).toBe(clientA);

    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(navigation.push).toHaveBeenCalledTimes(1);

    await act(async () => {
      navigationRequest.resolve();
      await navigationRequest.promise;
    });
  });

  it("clears search through the same debounced URL contract", async () => {
    vi.useFakeTimers();
    navigation.currentSearch = "scope=fixture&q=call";
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="call" />
    ));

    const clearSearchButton = Array.from(container.querySelectorAll<HTMLButtonElement>(
      ".recording-filter-actions button"
    )).at(-1);
    await act(async () => clearSearchButton?.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    const target = new URL(navigation.push.mock.calls[0]?.[0], "https://example.test");
    expect(target.searchParams.has("q")).toBe(false);
    expect(target.searchParams.get("scope")).toBe("fixture");
  });

  it("keeps search usable while locking organization controls during immediate navigation", async () => {
    const navigationRequest = createDeferred();
    navigation.push.mockImplementationOnce(() => navigationRequest.promise);
    await act(async () => root.render(
      <RecordingFilters filters={emptyFilters} options={options} searchQuery="" />
    ));

    changeSelectDuringTransition("client", clientA);

    const form = container.querySelector<HTMLFormElement>("form.recording-filters");
    expect(form?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector<HTMLInputElement>('input[name="q"]')?.disabled).toBe(false);
    await setInput("q", "draft call");
    expect(container.querySelector<HTMLInputElement>('input[name="q"]')?.value).toBe("draft call");
    for (const control of container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      'form.recording-filters input[name="tag"], form.recording-filters select, form.recording-filters button'
    )) {
      expect(control.disabled, control.outerHTML).toBe(true);
    }

    await act(async () => {
      navigationRequest.resolve();
      await navigationRequest.promise;
    });
    expect(form?.getAttribute("aria-busy")).toBe("false");
  });
});
