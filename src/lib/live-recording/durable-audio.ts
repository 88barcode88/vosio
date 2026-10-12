import type { FinalizedSafetyPart } from "@/lib/live-recording/rotating-safety-recorder";
import { withDurableGenerationWriter } from "@/lib/live-recording/generation-lock";
import {
  formatSafetyPartName,
  validateSafetyPartListing
} from "@/lib/live-recording/safety-parts";

const DURABLE_AUDIO_DATABASE_NAME = "vosio-live-audio";
const DURABLE_AUDIO_DATABASE_VERSION = 1;
const DURABLE_AUDIO_OWNER_INDEX = "owner_id";
const DURABLE_AUDIO_STORE_NAME = "safety_parts";

export type DurableAudioPartRecord = {
  blob: Blob;
  createdAt: string;
  extension: FinalizedSafetyPart["extension"];
  generationId: string;
  index: number;
  key: string;
  mimeType: string;
  name: string;
  offsetMs: number;
  ownerId: string;
  recordingId: string;
  size: number;
  uploadedAt: string | null;
};

export type DurableSafetyManifest = {
  createdAt: string;
  generationId: string;
  ownerId: string;
  partCount: number;
  parts: DurableAudioPartRecord[];
  pendingPartCount: number;
  recordingId: string;
  totalBytes: number;
};

export type DurableAudioRepository = {
  deleteExactGeneration?(ownerId: string, recordingId: string, generationId: string, expectedParts: readonly DurableAudioPartRecord[], canDelete: () => boolean): Promise<boolean>;
  deleteConfirmedGeneration?(ownerId: string, recordingId: string, generationId: string, expectedParts: readonly DurableAudioPartRecord[]): Promise<boolean>;
  deleteGeneration(ownerId: string, recordingId: string, generationId: string): Promise<void>;
  listForOwner(ownerId: string): Promise<DurableAudioPartRecord[]>;
  markUploaded(key: string, uploadedAt: string): Promise<void>;
  put(record: DurableAudioPartRecord): Promise<void>;
};

// Snapshot every immutable part field and its exact remote confirmation before entering asynchronous storage.
function confirmedPartIdentity(row: DurableAudioPartRecord, ownerId: string, recordingId: string, generationId: string, requireConfirmation = true) {
  if (!row || !row.blob || !Number.isInteger(row.index) || row.index < 0 || row.index > 999
    || !["webm", "m4a"].includes(row.extension)
    || row.ownerId !== ownerId || row.recordingId !== recordingId || row.generationId !== generationId
    || row.key !== getDurableAudioPartKey(row) || row.name !== formatSafetyPartName(row.index, row.extension)
    || (row.uploadedAt === null ? requireConfirmation : !Number.isFinite(Date.parse(row.uploadedAt)))
    || row.size <= 0 || row.blob.size !== row.size) return null;
  return JSON.stringify([row.key, row.ownerId, row.recordingId, row.generationId, row.index, row.name,
    row.extension, row.mimeType, row.offsetMs, row.size, row.createdAt, row.uploadedAt, row.blob.size, row.blob.type]);
}

type PersistDurableSafetyPartInput = {
  createdAt?: string;
  generationId: string;
  ownerId: string;
  part: FinalizedSafetyPart;
  recordingId: string;
  repository?: DurableAudioRepository;
};

// requestResult resolves one IndexedDB request with its typed result.
function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed.")), {
      once: true
    });
  });
}

// transactionCompletion resolves only after IndexedDB atomically commits every requested write.
function transactionCompletion(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")),
      { once: true }
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true }
    );
  });
}

// openDurableAudioDatabase lazily creates the owner-indexed browser store without server access.
async function openDurableAudioDatabase(factory?: IDBFactory) {
  const indexedDbFactory = factory ?? globalThis.indexedDB;

  if (!indexedDbFactory) {
    throw new Error("Trvalé uložení audio částí není v tomto prohlížeči dostupné.");
  }

  const request = indexedDbFactory.open(DURABLE_AUDIO_DATABASE_NAME, DURABLE_AUDIO_DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    const store = database.objectStoreNames.contains(DURABLE_AUDIO_STORE_NAME)
      ? request.transaction?.objectStore(DURABLE_AUDIO_STORE_NAME)
      : database.createObjectStore(DURABLE_AUDIO_STORE_NAME, { keyPath: "key" });

    if (store && !store.indexNames.contains(DURABLE_AUDIO_OWNER_INDEX)) {
      store.createIndex(DURABLE_AUDIO_OWNER_INDEX, "ownerId", { unique: false });
    }
  });

  return requestResult(request);
}

// createIndexedDbDurableAudioRepository provides atomic browser persistence for complete parts.
export function createIndexedDbDurableAudioRepository(factory?: IDBFactory): DurableAudioRepository {
  // Compare and delete inside one serialized transaction; auth/lifecycle changes also retain the whole scope.
  async function deleteSnapshot(ownerId: string, recordingId: string, generationId: string,
    expectedParts: readonly DurableAudioPartRecord[], requireConfirmation: boolean, canDelete: () => boolean) {
    const expected = new Map(expectedParts.map((part) => [part.key, confirmedPartIdentity(part, ownerId, recordingId, generationId, requireConfirmation)]));
    if (!canDelete() || expectedParts.length === 0 || expectedParts.length > 1000 || expected.size !== expectedParts.length
      || [...expected.values()].some((identity) => identity === null)) return false;
    const database = await openDurableAudioDatabase(factory);
    try {
      if (!canDelete()) return false;
      const transaction = database.transaction(DURABLE_AUDIO_STORE_NAME, "readwrite");
      const completion = transactionCompletion(transaction);
      const store = transaction.objectStore(DURABLE_AUDIO_STORE_NAME);
      const request = store.index(DURABLE_AUDIO_OWNER_INDEX).getAll(ownerId) as IDBRequest<DurableAudioPartRecord[]>;
      let deleted = false;
      request.addEventListener("success", () => {
        const rows = request.result.filter((row) => row.recordingId === recordingId && row.generationId === generationId);
        if (!canDelete() || rows.length !== expected.size || rows.some((row) => !expected.has(row.key)
          || expected.get(row.key) !== confirmedPartIdentity(row, ownerId, recordingId, generationId, requireConfirmation))) return;
        for (const row of rows) store.delete(row.key);
        deleted = true;
      }, { once: true });
      await completion;
      return deleted;
    } finally { database.close(); }
  }
  return {
    // Explicit local discard accepts pending parts only for an unchanged, currently authorized snapshot.
    deleteExactGeneration(ownerId, recordingId, generationId, expectedParts, canDelete) {
      return deleteSnapshot(ownerId, recordingId, generationId, expectedParts, false, canDelete);
    },
    // Recovery checks and deletes the exact confirmed snapshot inside one serialized IndexedDB transaction.
    async deleteConfirmedGeneration(ownerId, recordingId, generationId, expectedParts) {
      return deleteSnapshot(ownerId, recordingId, generationId, expectedParts, true, () => true);
    },
    // deleteGeneration removes only one authenticated owner recording generation after promotion.
    async deleteGeneration(ownerId, recordingId, generationId) {
      const database = await openDurableAudioDatabase(factory);

      try {
        const rows = await requestResult(
          database.transaction(DURABLE_AUDIO_STORE_NAME).objectStore(DURABLE_AUDIO_STORE_NAME)
            .index(DURABLE_AUDIO_OWNER_INDEX).getAll(ownerId) as IDBRequest<DurableAudioPartRecord[]>
        );
        const transaction = database.transaction(DURABLE_AUDIO_STORE_NAME, "readwrite");
        const store = transaction.objectStore(DURABLE_AUDIO_STORE_NAME);

        for (const row of rows) {
          if (row.recordingId === recordingId && row.generationId === generationId) {
            store.delete(row.key);
          }
        }

        await transactionCompletion(transaction);
      } finally {
        database.close();
      }
    },

    // listForOwner never exposes another signed-in user's recoverable browser audio.
    async listForOwner(ownerId) {
      const database = await openDurableAudioDatabase(factory);

      try {
        return await requestResult(
          database.transaction(DURABLE_AUDIO_STORE_NAME).objectStore(DURABLE_AUDIO_STORE_NAME)
            .index(DURABLE_AUDIO_OWNER_INDEX).getAll(ownerId) as IDBRequest<DurableAudioPartRecord[]>
        );
      } finally {
        database.close();
      }
    },

    // markUploaded atomically retains the Blob while recording successful remote promotion.
    async markUploaded(key, uploadedAt) {
      const database = await openDurableAudioDatabase(factory);

      try {
        const transaction = database.transaction(DURABLE_AUDIO_STORE_NAME, "readwrite");
        const store = transaction.objectStore(DURABLE_AUDIO_STORE_NAME);
        const existing = await requestResult(store.get(key) as IDBRequest<DurableAudioPartRecord | undefined>);

        if (existing) {
          store.put({ ...existing, uploadedAt });
        }

        await transactionCompletion(transaction);
      } finally {
        database.close();
      }
    },

    // put atomically commits the complete Blob and all recovery identity metadata in one row.
    async put(record) {
      const database = await openDurableAudioDatabase(factory);

      try {
        const transaction = database.transaction(DURABLE_AUDIO_STORE_NAME, "readwrite");
        transaction.objectStore(DURABLE_AUDIO_STORE_NAME).put(record);
        await transactionCompletion(transaction);
      } finally {
        database.close();
      }
    }
  };
}

// getDurableAudioPartKey creates a deterministic owner, recording, generation, and index key.
export function getDurableAudioPartKey(input: {
  generationId: string;
  index: number;
  ownerId: string;
  recordingId: string;
}) {
  return `${input.ownerId}/${input.recordingId}/${input.generationId}/${input.index}`;
}

// persistDurableSafetyPart commits one complete finalized part before any upload is attempted.
export async function persistDurableSafetyPart(input: PersistDurableSafetyPartInput) {
  if (!input.ownerId || !input.recordingId || !input.generationId) {
    throw new Error("Audio část nemá úplnou identitu pro obnovu.");
  }

  if (
    input.part.name !== formatSafetyPartName(input.part.index, input.part.extension) ||
    input.part.size !== input.part.blob.size ||
    input.part.size <= 0
  ) {
    throw new Error("Audio část není úplně finalizovaná.");
  }

  const repository = input.repository ?? createIndexedDbDurableAudioRepository();
  const record: DurableAudioPartRecord = {
    ...input.part,
    createdAt: input.createdAt ?? new Date().toISOString(),
    generationId: input.generationId,
    key: getDurableAudioPartKey({
      generationId: input.generationId,
      index: input.part.index,
      ownerId: input.ownerId,
      recordingId: input.recordingId
    }),
    ownerId: input.ownerId,
    recordingId: input.recordingId,
    uploadedAt: null
  };

  await withDurableGenerationWriter(record, () => repository.put(record));
  return record;
}

// promoteDurableSafetyParts uploads pending current-owner rows with a strict concurrency bound.
export async function promoteDurableSafetyParts(input: {
  shouldReverifyPart?: (part: DurableAudioPartRecord) => boolean;
  maxConcurrent?: number;
  ownerId: string;
  repository?: DurableAudioRepository;
  uploadPart: (part: DurableAudioPartRecord) => Promise<void>;
}) {
  const repository = input.repository ?? createIndexedDbDurableAudioRepository();
  const allRows = await repository.listForOwner(input.ownerId);
  const pending = allRows
    .filter((row) => row.ownerId === input.ownerId && (row.uploadedAt === null || input.shouldReverifyPart?.(row) === true))
    .sort((left, right) => (
      left.recordingId.localeCompare(right.recordingId) ||
      left.generationId.localeCompare(right.generationId) ||
      left.index - right.index
    ));
  const concurrency = Math.max(1, Math.min(4, Math.floor(input.maxConcurrent ?? 2)));
  const outcomes = new Array<"failed" | "promoted">(pending.length);
  let cursor = 0;

  // promoteWorker claims one pending row at a time while respecting the shared bounded cursor.
  async function promoteWorker() {
    while (cursor < pending.length) {
      const position = cursor;
      cursor += 1;
      const part = pending[position];

      try {
        await withDurableGenerationWriter(part, async () => {
          await input.uploadPart(part);
          await repository.markUploaded(part.key, new Date().toISOString());
        });
        outcomes[position] = "promoted";
      } catch {
        outcomes[position] = "failed";
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, promoteWorker));

  return pending.reduce(
    (result, part, index) => {
      result[outcomes[index]].push(part.key);
      return result;
    },
    { failed: [] as string[], promoted: [] as string[] }
  );
}

// listDurableSafetyManifestsForOwner reconstructs validated recovery scopes from current-owner rows.
export async function listDurableSafetyManifestsForOwner(input: {
  ownerId: string;
  repository?: DurableAudioRepository;
}) {
  const repository = input.repository ?? createIndexedDbDurableAudioRepository();
  const rows = (await repository.listForOwner(input.ownerId))
    .filter((row) => row.ownerId === input.ownerId);
  const grouped = new Map<string, DurableAudioPartRecord[]>();

  for (const row of rows) {
    const groupKey = `${row.recordingId}\u0000${row.generationId}`;
    const group = grouped.get(groupKey) ?? [];
    group.push(row);
    grouped.set(groupKey, group);
  }

  return [...grouped.values()].map((group) => {
    const parts = validateSafetyPartListing(group).map(({ item }) => item);
    const first = parts[0];

    if (!first || parts.some((part) => (
      part.ownerId !== input.ownerId ||
      part.recordingId !== first.recordingId ||
      part.generationId !== first.generationId ||
      part.key !== getDurableAudioPartKey(part) ||
      part.name !== formatSafetyPartName(part.index, part.extension) ||
      part.size <= 0 ||
      part.size !== part.blob.size
    ))) {
      throw new Error("Lokálně uložené části audia nemají platnou identitu.");
    }

    return {
      createdAt: parts.reduce(
        (earliest, part) => part.createdAt < earliest ? part.createdAt : earliest,
        first.createdAt
      ),
      generationId: first.generationId,
      ownerId: first.ownerId,
      partCount: parts.length,
      parts,
      pendingPartCount: parts.filter((part) => part.uploadedAt === null).length,
      recordingId: first.recordingId,
      totalBytes: parts.reduce((total, part) => total + part.size, 0)
    } satisfies DurableSafetyManifest;
  }).sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) ||
    left.recordingId.localeCompare(right.recordingId) ||
    left.generationId.localeCompare(right.generationId)
  ));
}

// resumeDurableSafetyPartsForOwner discovers manifests before retrying pending uploads with a bound.
export async function resumeDurableSafetyPartsForOwner(input: {
  shouldReverifyPart?: (part: DurableAudioPartRecord) => boolean;
  maxConcurrent?: number;
  ownerId: string;
  repository?: DurableAudioRepository;
  prepareManifest?: (manifest: DurableSafetyManifest) => Promise<void>;
  uploadPart: (part: DurableAudioPartRecord) => Promise<void>;
}) {
  const initialManifests = await listDurableSafetyManifestsForOwner(input);
  const preparationFailures = new Map<string, unknown>();
  for (const manifest of initialManifests) {
    const key = `${manifest.recordingId}/${manifest.generationId}`;
    // Prepare the full scope once; a rejected scope retains every browser part.
    try { await input.prepareManifest?.(manifest); }
    catch (error) { preparationFailures.set(key, error); }
  }
  // Upload only a successfully prepared scope and retain all failed scope rows for recovery.
  const uploadPart = async (part: DurableAudioPartRecord) => {
    const key = `${part.recordingId}/${part.generationId}`;
    if (preparationFailures.has(key)) throw preparationFailures.get(key);
    await input.uploadPart(part);
  };
  const promotion = await promoteDurableSafetyParts({ ...input, uploadPart });
  const manifests = await listDurableSafetyManifestsForOwner(input);

  return { manifests, ...promotion };
}

// cleanupDurableSafetyGeneration removes one promoted scope without touching another owner or retry generation.
export async function cleanupDurableSafetyGeneration(input: {
  generationId: string;
  ownerId: string;
  recordingId: string;
  repository?: DurableAudioRepository;
}) {
  const repository = input.repository ?? createIndexedDbDurableAudioRepository();
  await repository.deleteGeneration(input.ownerId, input.recordingId, input.generationId);
}

// Recovery alone uses fail-closed conditional cleanup; legacy recorder cleanup semantics are unchanged.
export async function cleanupConfirmedDurableSafetyGeneration(input: {
  manifest: DurableSafetyManifest;
  repository?: DurableAudioRepository;
}) {
  const { manifest } = input;
  if (manifest.pendingPartCount !== 0 || manifest.partCount !== manifest.parts.length
    || manifest.totalBytes !== manifest.parts.reduce((total, part) => total + part.size, 0)) return false;
  const repository = input.repository ?? createIndexedDbDurableAudioRepository();
  return repository.deleteConfirmedGeneration?.(manifest.ownerId, manifest.recordingId, manifest.generationId, manifest.parts) ?? false;
}
