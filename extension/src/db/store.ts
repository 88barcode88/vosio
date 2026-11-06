// Storage interface for locally recorded sessions and audio chunks, with a replaceable instance (IndexedDB in production, memory in tests).

import type { ChunkRecord, PartInfo, StoredSession } from "../shared/types.ts";
import { createIdbStore } from "./idb-store.ts";

export interface RecordingStore {
  putSession(session: StoredSession): Promise<void>;
  getSession(id: string): Promise<StoredSession | null>;
  listSessions(): Promise<StoredSession[]>;
  deleteSession(id: string): Promise<void>;
  addChunk(chunk: ChunkRecord): Promise<void>;
  getPartInfos(sessionId: string): Promise<PartInfo[]>;
  getPartBlob(sessionId: string, part: number, type: string): Promise<Blob>;
}

let current: RecordingStore | null = null;

// Returns the active recording store, creating the IndexedDB-backed one on first use.
export function getStore(): RecordingStore {
  if (!current) current = createIdbStore();
  return current;
}

// Replaces the active store (used by tests to inject an in-memory implementation).
export function setStore(store: RecordingStore | null): void {
  current = store;
}
