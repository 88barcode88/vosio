// IndexedDB implementation of the recording store: session metadata plus audio chunks written every few seconds.

import type { ChunkRecord, PartInfo, StoredSession } from "../shared/types.ts";
import type { RecordingStore } from "./store.ts";

const DB_NAME = "vosio-recordings";
const SESSIONS = "sessions";
const CHUNKS = "chunks";
const BY_SESSION = "bySession";

// Wraps an IDBRequest into a promise.
function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

// Resolves when a transaction commits (data is durable), rejects on abort or error.
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

// Opens (and migrates) the recordings database.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(SESSIONS, { keyPath: "id" });
      const chunks = db.createObjectStore(CHUNKS, { autoIncrement: true });
      chunks.createIndex(BY_SESSION, "sessionId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

// Creates the IndexedDB-backed store; the connection is opened lazily and reused.
export function createIdbStore(): RecordingStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  // Returns the shared database connection.
  const db = (): Promise<IDBDatabase> => (dbPromise ??= openDb());

  // Reads all chunk records of a session ordered by sequence number.
  async function readChunks(sessionId: string): Promise<ChunkRecord[]> {
    const tx = (await db()).transaction(CHUNKS, "readonly");
    const records = await wrap(tx.objectStore(CHUNKS).index(BY_SESSION).getAll(sessionId));
    return (records as ChunkRecord[]).sort((a, b) => a.seq - b.seq);
  }

  return {
    async putSession(session) {
      const tx = (await db()).transaction(SESSIONS, "readwrite");
      tx.objectStore(SESSIONS).put(session);
      await committed(tx);
    },
    async getSession(id) {
      const tx = (await db()).transaction(SESSIONS, "readonly");
      return ((await wrap(tx.objectStore(SESSIONS).get(id))) as StoredSession | undefined) ?? null;
    },
    async listSessions() {
      const tx = (await db()).transaction(SESSIONS, "readonly");
      return (await wrap(tx.objectStore(SESSIONS).getAll())) as StoredSession[];
    },
    async deleteSession(id) {
      const tx = (await db()).transaction([SESSIONS, CHUNKS], "readwrite");
      tx.objectStore(SESSIONS).delete(id);
      const chunks = tx.objectStore(CHUNKS);
      const keys = await wrap(chunks.index(BY_SESSION).getAllKeys(id));
      for (const key of keys) chunks.delete(key);
      await committed(tx);
    },
    async addChunk(chunk) {
      const tx = (await db()).transaction(CHUNKS, "readwrite");
      tx.objectStore(CHUNKS).add(chunk);
      await committed(tx);
    },
    async getPartInfos(sessionId) {
      const parts = new Map<number, PartInfo>();
      for (const chunk of await readChunks(sessionId)) {
        const info = parts.get(chunk.part) ?? { part: chunk.part, bytes: 0, lastT: 0 };
        parts.set(chunk.part, { part: chunk.part, bytes: info.bytes + chunk.blob.size, lastT: Math.max(info.lastT, chunk.t) });
      }
      return [...parts.values()].sort((a, b) => a.part - b.part);
    },
    async getPartBlob(sessionId, part, type) {
      const blobs = (await readChunks(sessionId)).filter((chunk) => chunk.part === part).map((chunk) => chunk.blob);
      return new Blob(blobs, { type });
    }
  };
}
