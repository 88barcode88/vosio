// Upload queue (design D4/D8): create recording, register parts, signed PUT with retries, complete; resumable and idempotent.

import {
  BACKOFF_BASE_MS, BACKOFF_MAX_MS, DONE_STATUSES, PUT_ATTEMPTS, SESSION_MAX_ATTEMPTS, SESSION_MAX_ROUNDS,
  TICK_ALARM, UPLOAD_ALARM, UPLOAD_LOCK, UPLOAD_MIME
} from "../shared/constants.ts";
import { timing } from "../shared/format.ts";
import { addHistory, readPairing } from "../shared/storage.ts";
import type {
  CompleteResponse, CreateRecordingResponse, HistoryEntry, RegisterPartsResponse, StatusResponse, StoredSession
} from "../shared/types.ts";
import { getStore } from "../db/store.ts";
import { CaptureApiError, capturePost, fetchConfig, putPart } from "./capture-api.ts";
import { describeStatus, NeedsPairingError, PairingError } from "./pairing.ts";

// Callbacks the service worker installs to refresh UI and show notifications; no-ops by default (tests).
export const uploadHooks = {
  onChange: (): void => undefined,
  onDone: (_entry: HistoryEntry): void => undefined,
  onPairingNeeded: (): void => undefined
};

// Exponential backoff for session-level retries, capped at 15 minutes.
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

// Persists a partial update of a session and returns the new immutable value.
async function patch(session: StoredSession, changes: Partial<StoredSession>): Promise<StoredSession> {
  const next = { ...session, ...changes };
  await getStore().putSession(next);
  return next;
}

// Uploads one part with short in-process retries; rethrows non-retryable and exhausted failures.
async function putWithRetry(url: string, blob: Blob, apiKey: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt += 1) {
    try {
      await putPart(url, blob, apiKey);
      return;
    } catch (error) {
      lastError = error;
      if (!(error instanceof CaptureApiError) || !error.retryable) throw error;
      if (attempt < PUT_ATTEMPTS) await timing.sleep(1000 * 3 ** (attempt - 1));
    }
  }
  throw lastError;
}

// Records a confirmed upload in the history, deletes the local data and notifies the UI.
async function finishSession(session: StoredSession, detailUrl: string | null, transcription: string | null): Promise<void> {
  const entry: HistoryEntry = { id: session.id, title: session.title ?? session.platformLabel, detailUrl, at: timing.now(), transcription };
  await addHistory(entry);
  await getStore().deleteSession(session.id);
  uploadHooks.onDone(entry);
}

// Reads the server-side state after a revision conflict; returns done info or the current revision.
async function syncRevision(session: StoredSession): Promise<{ done: StatusResponse } | { revision: number }> {
  const status = await capturePost<StatusResponse>(`/recordings/${session.recordingId}/status`, {});
  if (DONE_STATUSES.includes(status.status)) return { done: status };
  if (typeof status.captureRevision !== "number") throw new CaptureApiError(503, "revision_unknown", "Nelze zjistit aktuální revizi nahrávky, zkusí se to znovu později.");
  return { revision: status.captureRevision };
}

// Runs the whole upload of one session; throws on failures that the queue classifies (retry, wait, fail).
async function uploadSession(initial: StoredSession): Promise<void> {
  const store = getStore();
  let session = await patch(initial, { status: "uploading", lastError: null });
  uploadHooks.onChange();
  const config = await fetchConfig();
  if (session.accountEmail && config.account.email && session.accountEmail !== config.account.email) {
    throw new CaptureApiError(404, "account_mismatch", `Nahrávka patří k účtu ${session.accountEmail}, ale rozšíření je spárované s ${config.account.email}.`);
  }
  const parts = await store.getPartInfos(session.id);
  if (parts.length === 0) {
    await store.deleteSession(session.id);
    return;
  }
  if (!session.recordingId) {
    const created = await capturePost<CreateRecordingResponse>("/recordings", {
      requestId: session.requestId, title: session.title, startedAt: new Date(session.startedAt).toISOString()
    });
    session = await patch(session, { recordingId: created.recordingId, captureRevision: created.captureRevision, accountEmail: config.account.email || null, detailUrl: created.detailUrl });
  }
  const recordingId = session.recordingId as string;

  for (let round = 0; round < SESSION_MAX_ROUNDS; round += 1) {
    let registration: RegisterPartsResponse;
    try {
      registration = await capturePost<RegisterPartsResponse>(`/recordings/${recordingId}/parts`, {
        captureRevision: session.captureRevision, mimeType: UPLOAD_MIME, parts: parts.map((part, index) => ({ index, sizeBytes: part.bytes }))
      });
    } catch (error) {
      if (error instanceof CaptureApiError && error.code === "revision_conflict") {
        const synced = await syncRevision(session);
        if ("done" in synced) return finishSession(session, synced.done.detailUrl, synced.done.transcriptionState);
        session = await patch(session, { captureRevision: synced.revision });
        continue;
      }
      throw error;
    }
    session = await patch(session, { captureRevision: registration.captureRevision });

    let urlRejected = false;
    for (const part of registration.parts) {
      if (part.state !== "ready") continue;
      const source = parts[part.index];
      if (!source) continue;
      try {
        await putWithRetry(part.uploadUrl, await store.getPartBlob(session.id, source.part, UPLOAD_MIME), config.storage.apiKey);
        session = await patch(session, { uploadedParts: [...new Set([...session.uploadedParts, part.index])] });
        uploadHooks.onChange();
      } catch (error) {
        if (error instanceof CaptureApiError && error.code === "upload_url_rejected") {
          urlRejected = true;
          break;
        }
        throw error;
      }
    }
    if (urlRejected) continue;

    try {
      const result = await capturePost<CompleteResponse>(`/recordings/${recordingId}/complete`, {
        requestId: session.completeRequestId, captureRevision: session.captureRevision, durationSeconds: session.durationSeconds, partCount: parts.length
      });
      return finishSession(session, result.detailUrl, result.transcription?.state ?? null);
    } catch (error) {
      if (error instanceof CaptureApiError && error.code === "incomplete_parts") continue;
      if (error instanceof CaptureApiError && error.code === "revision_conflict") {
        const synced = await syncRevision(session);
        if ("done" in synced) return finishSession(session, synced.done.detailUrl, synced.done.transcriptionState);
        session = await patch(session, { captureRevision: synced.revision });
        continue;
      }
      throw error;
    }
  }
  throw new CaptureApiError(503, "upload_incomplete", "Nahrávku se zatím nepodařilo dokončit, zkusí se to znovu později.");
}

// Classifies an upload failure into waiting for pairing, permanent failure, deleted remotely or a delayed retry.
async function handleFailure(sessionId: string, error: unknown): Promise<"continue" | "stop"> {
  const store = getStore();
  const session = await store.getSession(sessionId);
  if (!session) return "continue";
  if (error instanceof NeedsPairingError) {
    await patch(session, { status: "waiting-pair", lastError: describeStatus(error.status) });
    uploadHooks.onPairingNeeded();
    return "stop";
  }
  if (error instanceof CaptureApiError && error.status === 410) {
    await patch(session, { status: "remote-deleted", lastError: "Nahrávka byla ve Vosiu smazána. Lokální kopii můžete stáhnout nebo smazat." });
    return "continue";
  }
  const transient = (error instanceof CaptureApiError && error.retryable) || (error instanceof PairingError && (error.code === "network" || error.code === "server")) || !(error instanceof CaptureApiError);
  if (!transient) {
    await patch(session, { status: "failed", lastError: (error as CaptureApiError).message });
    return "continue";
  }
  const attempts = session.attempts + 1;
  const message = error instanceof Error ? error.message : "Neznámá chyba";
  if (attempts >= SESSION_MAX_ATTEMPTS) {
    await patch(session, { status: "failed", attempts, lastError: message });
    return "continue";
  }
  await patch(session, { status: "queued", attempts, nextAttemptAt: timing.now() + backoffMs(attempts), lastError: message });
  return "continue";
}

// Schedules the next queue run at the earliest pending retry time (or clears the alarm).
export async function scheduleNext(): Promise<void> {
  const now = timing.now();
  const pending = (await getStore().listSessions()).filter((session) => session.status === "queued" && session.nextAttemptAt !== null);
  if (pending.length === 0) {
    await chrome.alarms.clear(UPLOAD_ALARM);
    return;
  }
  const earliest = Math.min(...pending.map((session) => session.nextAttemptAt as number));
  await chrome.alarms.create(UPLOAD_ALARM, { when: Math.max(earliest, now + 1000) });
}

// Processes all due sessions one by one under a cross-context lock; safe to call repeatedly.
export async function processQueue(): Promise<void> {
  await navigator.locks.request(UPLOAD_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    const store = getStore();
    for (;;) {
      const pairing = await readPairing();
      const sessions = (await store.listSessions()).filter((session) => session.endedAt !== null).sort((a, b) => a.startedAt - b.startedAt);
      if (pairing.status !== "paired") {
        for (const session of sessions.filter((item) => item.status === "queued" || item.status === "uploading")) {
          await patch(session, { status: "waiting-pair", lastError: describeStatus(pairing.status) });
        }
        break;
      }
      const now = timing.now();
      const due = sessions.find((session) => (session.status === "queued" || session.status === "uploading") && (session.nextAttemptAt ?? 0) <= now);
      if (!due) break;
      try {
        await uploadSession(due);
      } catch (error) {
        if ((await handleFailure(due.id, error)) === "stop") break;
      }
      uploadHooks.onChange();
    }
  });
  await scheduleNext();
  uploadHooks.onChange();
}

// Requeues sessions waiting for pairing or retry (resetting the backoff) and runs the queue; used after pairing and manual retry.
export async function kickQueue(sessionId?: string): Promise<void> {
  const store = getStore();
  for (const session of await store.listSessions()) {
    const eligible = session.status === "waiting-pair" || session.status === "queued" || (sessionId === session.id && session.status === "failed");
    if (eligible && (sessionId === undefined || sessionId === session.id)) {
      await patch(session, { status: "queued", nextAttemptAt: null, attempts: sessionId === session.id ? 0 : session.attempts, lastError: null });
    }
  }
  await processQueue();
}

// Deletes a pending local recording the user chose to discard (or that Vosio already deleted).
export async function discardSession(sessionId: string): Promise<void> {
  await getStore().deleteSession(sessionId);
  uploadHooks.onChange();
}

// Registers the periodic safety-net alarm so pending uploads are retried even when no event wakes the worker.
export async function ensureTickAlarm(): Promise<void> {
  await chrome.alarms.create(TICK_ALARM, { delayInMinutes: 1, periodInMinutes: 5 });
}
