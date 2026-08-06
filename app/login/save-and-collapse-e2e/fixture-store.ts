import "server-only";

export const SAVE_AND_COLLAPSE_FIXTURE_MAX_TITLES = 64;

export type FixtureTitleStore = {
  get: (recordingId: string) => string | undefined;
  maxEntries: number;
  set: (recordingId: string, title: string) => void;
  size: () => number;
};

type SaveAndCollapseFixtureGlobal = typeof globalThis & {
  __vosioSaveAndCollapseTitles?: unknown;
};

// createFixtureTitleStore builds a bounded insertion-ordered store for development-only E2E data.
export function createFixtureTitleStore(maxEntries: number): FixtureTitleStore {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("Fixture title store requires a positive integer limit.");
  }

  const titles = new Map<string, string>();

  return {
    get(recordingId) {
      return titles.get(recordingId);
    },
    maxEntries,
    set(recordingId, title) {
      if (!titles.has(recordingId) && titles.size >= maxEntries) {
        const oldestRecordingId = titles.keys().next().value;
        if (oldestRecordingId !== undefined) {
          titles.delete(oldestRecordingId);
        }
      }

      titles.set(recordingId, title);
    },
    size() {
      return titles.size;
    }
  };
}

// isFixtureTitleStore checks whether an HMR-persisted value still matches the bounded store contract.
function isFixtureTitleStore(value: unknown): value is FixtureTitleStore {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<FixtureTitleStore>;
  return typeof candidate.get === "function"
    && typeof candidate.set === "function"
    && typeof candidate.size === "function"
    && typeof candidate.maxEntries === "number";
}

// resolveFixtureTitleStore reuses only a compatible store with the exact active cap.
export function resolveFixtureTitleStore(
  existingStore: unknown,
  maxEntries = SAVE_AND_COLLAPSE_FIXTURE_MAX_TITLES
): FixtureTitleStore {
  return isFixtureTitleStore(existingStore) && existingStore.maxEntries === maxEntries
    ? existingStore
    : createFixtureTitleStore(maxEntries);
}

const fixtureGlobal = globalThis as SaveAndCollapseFixtureGlobal;
const fixtureTitles = resolveFixtureTitleStore(fixtureGlobal.__vosioSaveAndCollapseTitles);
fixtureGlobal.__vosioSaveAndCollapseTitles = fixtureTitles;

// getFixtureTitle reads one isolated development-only title without external persistence.
export function getFixtureTitle(recordingId: string, fallback: string): string {
  return fixtureTitles.get(recordingId) ?? fallback;
}

// setFixtureTitle persists one bounded development-only title for a revalidated fixture page.
export function setFixtureTitle(recordingId: string, title: string): void {
  fixtureTitles.set(recordingId, title);
}
