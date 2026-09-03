import type { FinalizedSafetyPart } from "@/lib/live-recording/rotating-safety-recorder";
import { formatSafetyPartName } from "@/lib/live-recording/safety-parts";

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

export type DurableAudioRepository = {
  deleteGeneration(ownerId: string, recordingId: string, generationId: string): Promise<void>;
  listForOwner(ownerId: string): Promise<DurableAudioPartRecord[]>;
  markUploaded(key: string, uploadedAt: string): Promise<void>;
  put(record: DurableAudioPartRecord): Promise<void>;
};

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
  return {
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

  await repository.put(record);
  return record;
}

// promoteDurableSafetyParts uploads pending current-owner rows with a strict concurrency bound.
export async function promoteDurableSafetyParts(input: {
  maxConcurrent?: number;
  ownerId: string;
  repository?: DurableAudioRepository;
  uploadPart: (part: DurableAudioPartRecord) => Promise<void>;
}) {
  const repository = input.repository ?? createIndexedDbDurableAudioRepository();
  const allRows = await repository.listForOwner(input.ownerId);
  const pending = allRows
    .filter((row) => row.ownerId === input.ownerId && row.uploadedAt === null)
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
        await input.uploadPart(part);
        await repository.markUploaded(part.key, new Date().toISOString());
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
