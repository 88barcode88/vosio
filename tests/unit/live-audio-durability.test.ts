import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.createClient }));

import {
  cleanupDurableSafetyGeneration,
  persistDurableSafetyPart,
  promoteDurableSafetyParts,
  type DurableAudioPartRecord,
  type DurableAudioRepository
} from "@/lib/live-recording/durable-audio";
import { uploadLiveRecordingPart } from "@/lib/recordings/upload";

// createMemoryRepository exposes persistence ordering and owner-scoped promotion to unit tests.
function createMemoryRepository(seed: DurableAudioPartRecord[] = []) {
  const rows = [...seed];
  const repository: DurableAudioRepository = {
    deleteGeneration: vi.fn(async (ownerId, recordingId, generationId) => {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (row?.ownerId === ownerId && row.recordingId === recordingId && row.generationId === generationId) {
          rows.splice(index, 1);
        }
      }
    }),
    listForOwner: vi.fn(async (ownerId) => rows.filter((row) => row.ownerId === ownerId)),
    markUploaded: vi.fn(async (key, uploadedAt) => {
      const row = rows.find((candidate) => candidate.key === key);
      if (row) row.uploadedAt = uploadedAt;
    }),
    put: vi.fn(async (row) => {
      rows.push(row);
    })
  };
  return { repository, rows };
}

// createPart builds one finalized safety part for durable promotion tests.
function createPart(index: number, ownerId = "owner-1"): DurableAudioPartRecord {
  const blob = new Blob([String(index)], { type: "audio/webm" });
  return {
    blob,
    createdAt: "2026-09-03T12:00:00.000Z",
    extension: "webm",
    generationId: "generation-1",
    index,
    key: `${ownerId}/recording-1/generation-1/${index}`,
    mimeType: "audio/webm",
    name: `part-${String(index).padStart(6, "0")}.webm`,
    offsetMs: index * 5_000,
    ownerId,
    recordingId: "recording-1",
    size: blob.size,
    uploadedAt: null
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("durable live audio", () => {
  it("atomically stores the complete Blob and ownership metadata before promotion", async () => {
    const { repository } = createMemoryRepository();
    const blob = new Blob(["complete"], { type: "audio/webm" });

    const record = await persistDurableSafetyPart({
      createdAt: "2026-09-03T12:00:00.000Z",
      generationId: "generation-1",
      ownerId: "owner-1",
      part: {
        blob,
        extension: "webm",
        index: 0,
        mimeType: "audio/webm",
        name: "part-000000.webm",
        offsetMs: 0,
        size: blob.size
      },
      recordingId: "recording-1",
      repository
    });

    expect(repository.put).toHaveBeenCalledOnce();
    expect(record).toMatchObject({
      blob,
      generationId: "generation-1",
      index: 0,
      offsetMs: 0,
      ownerId: "owner-1",
      recordingId: "recording-1",
      size: blob.size,
      uploadedAt: null
    });
  });

  it("promotes only the current owner with bounded concurrency and leaves failures durable", async () => {
    const first = createPart(0);
    const second = createPart(1);
    const third = createPart(2);
    const foreign = createPart(0, "owner-2");
    const { repository } = createMemoryRepository([first, second, third, foreign]);
    let active = 0;
    let maximumActive = 0;
    const uploadPart = vi.fn(async (part: DurableAudioPartRecord) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      if (part.index === 2) throw new Error("offline");
    });

    const result = await promoteDurableSafetyParts({
      maxConcurrent: 2,
      ownerId: "owner-1",
      repository,
      uploadPart
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(uploadPart).toHaveBeenCalledTimes(3);
    expect(uploadPart).not.toHaveBeenCalledWith(foreign);
    expect(repository.markUploaded).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ failed: [third.key], promoted: [first.key, second.key] });
  });

  it("cleans only the promoted owner, recording, and generation", async () => {
    const target = createPart(0);
    const foreign = createPart(0, "owner-2");
    const { repository, rows } = createMemoryRepository([target, foreign]);

    await cleanupDurableSafetyGeneration({
      generationId: "generation-1",
      ownerId: "owner-1",
      recordingId: "recording-1",
      repository
    });

    expect(rows).toEqual([foreign]);
  });
});

describe("idempotent safety part upload", () => {
  it("reuses an existing exact owner-scoped object without overwrite", async () => {
    const upload = vi.fn();
    const list = vi.fn(async () => ({
      data: [{ metadata: { mimetype: "audio/webm", size: 5 }, name: "part-000000.webm" }],
      error: null
    }));
    mocks.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "owner-1" } }, error: null })) },
      storage: { from: vi.fn(() => ({ list, upload })) }
    });

    const result = await uploadLiveRecordingPart({
      blob: new Blob(["first"], { type: "audio/webm" }),
      contentType: "audio/webm",
      maxFileSizeBytes: 1_000,
      partIndex: 0,
      recording: {
        id: "recording-1",
        storagePrefix: "owner-1/recording-1/live/",
        userId: "owner-1"
      }
    });

    expect(result).toEqual({ bytes: 5, reused: true, storagePath: "owner-1/recording-1/live/part-000000.webm" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("fails safely when the deterministic path already has different bytes", async () => {
    mocks.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "owner-1" } }, error: null })) },
      storage: { from: vi.fn(() => ({
        list: vi.fn(async () => ({
          data: [{ metadata: { mimetype: "audio/webm", size: 99 }, name: "part-000000.webm" }],
          error: null
        })),
        upload: vi.fn()
      })) }
    });

    await expect(uploadLiveRecordingPart({
      blob: new Blob(["first"], { type: "audio/webm" }),
      contentType: "audio/webm",
      maxFileSizeBytes: 1_000,
      partIndex: 0,
      recording: {
        id: "recording-1",
        storagePrefix: "owner-1/recording-1/live/",
        userId: "owner-1"
      }
    })).rejects.toThrow("Uložená část audia neodpovídá tomuto záznamu.");
  });
});
