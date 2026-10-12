import { z } from "zod";

const KEY_PREFIX = "vosio:manual-purge:";
const requestSchema = z.object({ recordingId: z.uuid(), requestId: z.uuid(), expectedUpdatedAt: z.string().datetime({ offset: true }) });
export type RetainedPurgeRequest = z.infer<typeof requestSchema>;

// Persists an opaque retry key before the first prepare; uncertain replies must never rotate it.
export function retainPurgeRequest(recordingId: string, expectedUpdatedAt: string): RetainedPurgeRequest {
  const saved = listRetainedPurgeRequests().find((request) => request.recordingId === recordingId);
  if (saved) return saved;
  const request = requestSchema.parse({ recordingId, expectedUpdatedAt, requestId: crypto.randomUUID() });
  const key = `${KEY_PREFIX}${request.requestId}`;
  localStorage.setItem(key, JSON.stringify(request));
  if (localStorage.getItem(key) !== JSON.stringify(request)) throw new Error("Purge request was not retained");
  return request;
}

// Lists only opaque local retry requests so the original actor can recover after access loss.
export function listRetainedPurgeRequests(): RetainedPurgeRequest[] {
  const requests: RetainedPurgeRequest[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(KEY_PREFIX)) continue;
    try {
      const value = requestSchema.parse(JSON.parse(localStorage.getItem(key) ?? "null"));
      if (key === `${KEY_PREFIX}${value.requestId}`) requests.push(value);
    } catch { /* An invalid local entry never becomes a server request. */ }
  }
  return requests;
}

// Clears only the exact confirmed-completed or explicitly released local request.
export function forgetPurgeRequest(recordingId: string, requestId: string) {
  const key = `${KEY_PREFIX}${requestId}`;
  const saved = localStorage.getItem(key);
  if (saved) {
    const request = requestSchema.parse(JSON.parse(saved));
    if (request.requestId === requestId && request.recordingId === recordingId) localStorage.removeItem(key);
  }
}
