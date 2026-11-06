// Lifecycle helpers for locally stored recording sessions: creation, finalization after stop and crash recovery.

import { formatTitle, timing } from "../shared/format.ts";
import type { PlatformId, StoredSession } from "../shared/types.ts";
import { getStore } from "../db/store.ts";

// Creates the metadata record of a session that starts recording now.
export function newSession(params: { id: string; platform: PlatformId; platformLabel: string; startedAt: number }): StoredSession {
  return {
    id: params.id,
    platform: params.platform,
    platformLabel: params.platformLabel,
    startedAt: params.startedAt,
    endedAt: null,
    status: "recording",
    title: null,
    requestId: null,
    completeRequestId: null,
    durationSeconds: null,
    partCount: 0,
    recordingId: null,
    captureRevision: null,
    accountEmail: null,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    uploadedParts: [],
    detailUrl: null
  };
}

// Persists title, request ids and duration for a stopped session so uploads are idempotent; drops sessions without audio.
export async function finalizeSession(id: string, endedAt: number | null): Promise<StoredSession | null> {
  const store = getStore();
  const session = await store.getSession(id);
  if (!session) return null;
  const parts = await store.getPartInfos(id);
  if (parts.length === 0) {
    await store.deleteSession(id);
    return null;
  }
  const end = endedAt ?? Math.max(...parts.map((part) => part.lastT));
  const finalized: StoredSession = {
    ...session,
    status: "queued",
    endedAt: end,
    title: session.title ?? formatTitle(session.platformLabel, new Date(session.startedAt)),
    requestId: session.requestId ?? crypto.randomUUID(),
    completeRequestId: session.completeRequestId ?? crypto.randomUUID(),
    durationSeconds: Math.max(1, Math.round((end - session.startedAt) / 1000)),
    partCount: parts.length,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null
  };
  await store.putSession(finalized);
  return finalized;
}

// Turns orphaned "recording" sessions (browser crash, killed worker) into pending uploads and requeues interrupted uploads.
export async function recoverOrphans(liveSessionId: string | null): Promise<StoredSession[]> {
  const store = getStore();
  const recovered: StoredSession[] = [];
  for (const session of await store.listSessions()) {
    if (session.status === "recording" && session.id !== liveSessionId) {
      const finalized = await finalizeSession(session.id, null);
      if (finalized) recovered.push(finalized);
    } else if (session.status === "uploading") {
      await store.putSession({ ...session, status: "queued", nextAttemptAt: timing.now() });
    }
  }
  return recovered;
}
