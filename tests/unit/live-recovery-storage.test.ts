import { describe, expect, it, vi } from "vitest";
import { InvalidSafetyPartListingError } from "@/lib/live-recording/safety-parts";
import {
  listStorageObjectsToExhaustion,
  summarizeSafetyPartStorageObjects
} from "@/lib/live-recording/recovery";
import { summarizeStorageObjects } from "../../app/api/recordings/recoverable/route";
import { summarizeSegments } from "../../app/api/recordings/[recordingId]/recover-live/route";
import { listSegmentStoragePaths } from "../../app/api/recordings/[recordingId]/transcription/route";

// createPartObject builds one canonical Storage object for pagination validation.
function createPartObject(index: number, extension = "webm") {
  return {
    metadata: { size: index + 1 },
    name: `part-${String(index).padStart(6, "0")}.${extension}`,
    updated_at: `2026-09-03T12:${String(index % 60).padStart(2, "0")}:00.000Z`
  };
}

// createPagedAdmin slices Storage results by the requested stable offset and limit.
function createPagedAdmin(items: ReturnType<typeof createPartObject>[]) {
  const list = vi.fn(async (_folder: string, options: { limit: number; offset: number }) => ({
    data: items.slice(options.offset, options.offset + options.limit),
    error: null
  }));

  return {
    admin: { storage: { from: vi.fn(() => ({ list })) } },
    list
  };
}

describe("live recovery storage listings", () => {
  it("summarizes only canonical contiguous parts", () => {
    expect(summarizeSafetyPartStorageObjects([
      { created_at: "2026-09-03T10:00:00.000Z", metadata: { size: 10 }, name: "part-000001.webm" },
      { created_at: "2026-09-03T09:00:00.000Z", metadata: { size: 5 }, name: "part-000000.webm" },
      { created_at: "2026-09-03T11:00:00.000Z", metadata: { size: 999 }, name: "manifest.json" }
    ])).toEqual({ count: 2, newestUpdatedAt: "2026-09-03T10:00:00.000Z", totalBytes: 15 });
  });

  it("rejects malformed part sets instead of recovering them", () => {
    expect(() => summarizeSafetyPartStorageObjects([
      { metadata: { size: 5 }, name: "part-000000.webm" },
      { metadata: { size: 10 }, name: "part-000002.webm" }
    ])).toThrow(InvalidSafetyPartListingError);
  });

  it("paginates recoverable metadata beyond 100 objects before summarizing", async () => {
    const items = Array.from({ length: 125 }, (_, index) => createPartObject(index));
    const { admin, list } = createPagedAdmin(items);

    await expect(summarizeStorageObjects({
      admin: admin as never,
      storagePrefix: "owner/recording/live/"
    })).resolves.toMatchObject({ count: 125, totalBytes: 7_875 });
    expect(list).toHaveBeenNthCalledWith(1, "owner/recording/live", expect.objectContaining({ offset: 0 }));
    expect(list).toHaveBeenNthCalledWith(2, "owner/recording/live", expect.objectContaining({ offset: 100 }));
  });

  it("rejects a later-page gap instead of accepting the valid first page", async () => {
    const items = [
      ...Array.from({ length: 100 }, (_, index) => createPartObject(index)),
      createPartObject(101)
    ];
    const { admin } = createPagedAdmin(items);

    await expect(summarizeSegments({
      admin: admin as never,
      storagePrefix: "owner/recording/live/"
    })).rejects.toBeInstanceOf(InvalidSafetyPartListingError);
  });

  it("rejects mixed extensions found only after the first page", async () => {
    const items = [
      ...Array.from({ length: 100 }, (_, index) => createPartObject(index)),
      createPartObject(100, "m4a")
    ];
    const { admin } = createPagedAdmin(items);

    await expect(listSegmentStoragePaths(admin as never, "owner/recording/live/"))
      .rejects.toBeInstanceOf(InvalidSafetyPartListingError);
  });

  it("rejects duplicate parts repeated on a later page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => createPartObject(index));
    const listPage = vi.fn(async (_folder: string, options: { offset: number }) => ({
      data: options.offset === 0 ? firstPage : [createPartObject(99), createPartObject(100)],
      error: null
    }));

    const items = await listStorageObjectsToExhaustion({
      folder: "owner/recording/live",
      listPage
    });

    expect(() => summarizeSafetyPartStorageObjects(items)).toThrow(InvalidSafetyPartListingError);
  });

  it("ignores unrelated objects returned on a later page without hiding valid parts", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => createPartObject(index));
    const unrelated = { metadata: { size: 999 }, name: "manifest.json", updated_at: null };
    const listPage = vi.fn(async (_folder: string, options: { offset: number }) => ({
      data: options.offset === 0 ? firstPage : [unrelated, createPartObject(100)],
      error: null
    }));

    const items = await listStorageObjectsToExhaustion({
      folder: "owner/recording/live",
      listPage
    });

    expect(summarizeSafetyPartStorageObjects(items)).toMatchObject({ count: 101, totalBytes: 5_151 });
  });
});
