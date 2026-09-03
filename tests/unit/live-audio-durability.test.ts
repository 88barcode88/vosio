import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.createClient }));

import {
  cleanupDurableSafetyGeneration,
  listDurableSafetyManifestsForOwner,
  persistDurableSafetyPart,
  promoteDurableSafetyParts,
  resumeDurableSafetyPartsForOwner,
  type DurableAudioPartRecord,
  type DurableAudioRepository
} from "@/lib/live-recording/durable-audio";
import {
  completeLiveRecordingUpload,
  removeRemoteDurableSafetyGeneration,
  uploadLiveRecordingPart
} from "@/lib/recordings/upload";

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
      const index = rows.findIndex((candidate) => candidate.key === key);
      const row = rows[index];
      if (row) rows[index] = { ...row, uploadedAt };
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

  it("discovers owner-scoped manifests after reload and resumes only pending parts", async () => {
    const first = createPart(0);
    const second = { ...createPart(1), uploadedAt: "2026-09-03T12:05:00.000Z" };
    const foreign = createPart(0, "owner-2");
    const { repository } = createMemoryRepository([second, foreign, first]);
    const uploadPart = vi.fn(async () => undefined);

    const manifests = await listDurableSafetyManifestsForOwner({ ownerId: "owner-1", repository });
    const resumed = await resumeDurableSafetyPartsForOwner({
      maxConcurrent: 2,
      ownerId: "owner-1",
      repository,
      uploadPart
    });

    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toMatchObject({
      generationId: "generation-1",
      ownerId: "owner-1",
      partCount: 2,
      pendingPartCount: 1,
      recordingId: "recording-1",
      totalBytes: 2
    });
    expect(manifests[0]?.parts.map((part) => part.index)).toEqual([0, 1]);
    expect(uploadPart).toHaveBeenCalledOnce();
    expect(uploadPart).toHaveBeenCalledWith(first);
    expect(resumed).toMatchObject({ failed: [], promoted: [first.key] });
    expect(resumed.manifests).toHaveLength(1);
    expect(resumed.manifests[0]).toMatchObject({ pendingPartCount: 0 });
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

  it("removes only exact uploaded paths from one authenticated durable generation", async () => {
    const first = { ...createPart(0), uploadedAt: "2026-09-03T12:05:00.000Z" };
    const second = { ...createPart(1), uploadedAt: "2026-09-03T12:06:00.000Z" };
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null
    }));
    mocks.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "owner-1" } }, error: null })) },
      storage: { from: vi.fn(() => ({ remove })) }
    });

    await expect(removeRemoteDurableSafetyGeneration({
      manifest: {
        createdAt: first.createdAt,
        generationId: first.generationId,
        ownerId: first.ownerId,
        partCount: 2,
        parts: [first, second],
        pendingPartCount: 0,
        recordingId: first.recordingId,
        totalBytes: first.size + second.size
      }
    })).resolves.toEqual({ removed: 2 });
    expect(remove).toHaveBeenCalledWith([
      "owner-1/recording-1/live/part-000000.webm",
      "owner-1/recording-1/live/part-000001.webm"
    ]);
  });

  it("fails remote cleanup when Storage does not confirm every exact path", async () => {
    const part = { ...createPart(0), uploadedAt: "2026-09-03T12:05:00.000Z" };
    mocks.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "owner-1" } }, error: null })) },
      storage: { from: vi.fn(() => ({
        remove: vi.fn(async () => ({ data: [], error: null }))
      })) }
    });

    await expect(removeRemoteDurableSafetyGeneration({
      manifest: {
        createdAt: part.createdAt,
        generationId: part.generationId,
        ownerId: part.ownerId,
        partCount: 1,
        parts: [part],
        pendingPartCount: 0,
        recordingId: part.recordingId,
        totalBytes: part.size
      }
    })).rejects.toThrow("nepotvrdilo odstranění všech bezpečnostních částí");
  });

  it("confirms the exact owner-scoped metadata row before completing live upload", async () => {
    const query = {
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: { id: "recording-1" }, error: null })),
      select: vi.fn(),
      update: vi.fn()
    };
    query.eq.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.update.mockReturnValue(query);
    mocks.createClient.mockReturnValue({ from: vi.fn(() => query) });

    await expect(completeLiveRecordingUpload({
      contentType: "audio/webm",
      durationSeconds: 30,
      recording: {
        id: "recording-1",
        storagePrefix: "owner-1/recording-1/live/",
        userId: "owner-1"
      },
      storagePath: "owner-1/recording-1/archive.webm",
      totalBytes: 42
    })).resolves.toEqual({ id: "recording-1" });
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", "recording-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", "owner-1");
    expect(query.select).toHaveBeenCalledWith("id");
  });

  it("rejects live upload completion when no owned metadata row is returned", async () => {
    const query = {
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      select: vi.fn(),
      update: vi.fn()
    };
    query.eq.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.update.mockReturnValue(query);
    mocks.createClient.mockReturnValue({ from: vi.fn(() => query) });

    await expect(completeLiveRecordingUpload({
      contentType: "audio/webm",
      durationSeconds: 30,
      recording: {
        id: "recording-1",
        storagePrefix: "owner-1/recording-1/live/",
        userId: "owner-1"
      },
      storagePath: "owner-1/recording-1/archive.webm",
      totalBytes: 42
    })).rejects.toThrow("Audio je uložené, ale metadata nahrávky se neuložila.");
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
