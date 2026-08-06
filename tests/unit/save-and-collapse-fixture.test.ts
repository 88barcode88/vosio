import { describe, expect, it, vi } from "vitest";
import { saveFixtureRecordingTitle } from "../../app/login/save-and-collapse-e2e/actions";
import {
  SAVE_AND_COLLAPSE_FIXTURE_MAX_TITLES,
  createFixtureTitleStore,
  resolveFixtureTitleStore
} from "../../app/login/save-and-collapse-e2e/fixture-store";
import { createInitialSaveActionState } from "@/lib/forms/save-action-state";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

describe("save-and-collapse development fixture", () => {
  it("evicts the oldest scope before a new scope exceeds the cap", () => {
    const store = createFixtureTitleStore(3);
    store.set("recording-a", "A");
    store.set("recording-b", "B");
    store.set("recording-c", "C");

    store.set("recording-d", "D");

    expect(store.size()).toBe(3);
    expect(store.get("recording-a")).toBeUndefined();
    expect(store.get("recording-b")).toBe("B");
    expect(store.get("recording-c")).toBe("C");
    expect(store.get("recording-d")).toBe("D");
  });

  it("updates an existing scope without evicting another entry", () => {
    const store = createFixtureTitleStore(2);
    store.set("recording-a", "A");
    store.set("recording-b", "B");

    store.set("recording-a", "A2");

    expect(store.size()).toBe(2);
    expect(store.get("recording-a")).toBe("A2");
    expect(store.get("recording-b")).toBe("B");
  });

  it("hard-fails in the test environment before reading submitted form data", async () => {
    const get = vi.fn();
    const formData = { get } as unknown as FormData;

    expect(process.env.NODE_ENV).toBe("test");
    await expect(
      saveFixtureRecordingTitle(createInitialSaveActionState(), formData)
    ).rejects.toThrow("Save-and-collapse E2E fixture is development-only.");
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps the explicit runtime cap at 64 entries", () => {
    expect(SAVE_AND_COLLAPSE_FIXTURE_MAX_TITLES).toBe(64);
  });

  it("reuses a compatible HMR store with the active cap", () => {
    const existingStore = createFixtureTitleStore(SAVE_AND_COLLAPSE_FIXTURE_MAX_TITLES);

    expect(resolveFixtureTitleStore(existingStore)).toBe(existingStore);
  });

  it("replaces a wrong-limit store with a bounded 64-entry store", () => {
    const wrongLimitStore = createFixtureTitleStore(3);
    const resolvedStore = resolveFixtureTitleStore(wrongLimitStore);

    for (let index = 0; index <= SAVE_AND_COLLAPSE_FIXTURE_MAX_TITLES; index += 1) {
      resolvedStore.set(`recording-${index}`, `Title ${index}`);
    }

    expect(resolvedStore).not.toBe(wrongLimitStore);
    expect(resolvedStore.maxEntries).toBe(64);
    expect(resolvedStore.size()).toBe(64);
    expect(resolvedStore.get("recording-0")).toBeUndefined();
    expect(resolvedStore.get("recording-64")).toBe("Title 64");
  });

  it("replaces a legacy Map with the current bounded store", () => {
    const legacyStore = new Map<string, string>([["recording-old", "Old title"]]);
    const resolvedStore = resolveFixtureTitleStore(legacyStore);

    expect(resolvedStore).not.toBe(legacyStore);
    expect(resolvedStore.maxEntries).toBe(64);
    expect(resolvedStore.size()).toBe(0);
  });
});
