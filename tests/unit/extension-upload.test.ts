import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffMs, discardSession, kickQueue, processQueue, uploadHooks } from "../../extension/src/background/upload.ts";
import { recoverOrphans } from "../../extension/src/background/sessions.ts";
import { setStore } from "../../extension/src/db/store.ts";
import { readHistory, readPairing, readTranscriptionRetries, writePairing, writeTranscriptionRetries } from "../../extension/src/shared/storage.ts";
import type { HistoryEntry, StoredSession } from "../../extension/src/shared/types.ts";
import { createMemoryStore, installChrome, installFakeVosio, pairFully, useFastTiming, type ChromeStub, type FakeVosio } from "./extension-test-utils";

let chromeStub: ChromeStub;
let server: FakeVosio;
let store: ReturnType<typeof createMemoryStore>;
let done: HistoryEntry[];
let pairingNeeded: number;

const CAPTURE = "POST /functions/v1/vosio-mcp/capture";
const jsonError = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: `${code} (test)` } }), { status, headers: { "content-type": "application/json" } });

// Creates a finished local recording (stopped, titled, with request ids) whose parts have the given sizes.
async function makeSession(partSizes = [10, 20, 30], overrides: Partial<StoredSession> = {}): Promise<StoredSession> {
  const session: StoredSession = {
    id: "local-1", platform: "meet", platformLabel: "Google Meet", startedAt: Date.UTC(2026, 10, 6, 13, 0), endedAt: Date.UTC(2026, 10, 6, 13, 30), status: "queued",
    title: "Google Meet – 06.11.2026 14:00", requestId: "11111111-1111-4111-8111-111111111111", completeRequestId: "22222222-2222-4222-8222-222222222222",
    durationSeconds: 1800, partCount: partSizes.length, recordingId: null, captureRevision: null, accountEmail: null, attempts: 0, nextAttemptAt: null, lastError: null, uploadedParts: [], detailUrl: null, ...overrides
  };
  await store.putSession(session);
  for (const [part, size] of partSizes.entries()) await store.addChunk({ sessionId: session.id, part, seq: part, t: session.startedAt + 1000, blob: new Blob([new Uint8Array(size)]) });
  return session;
}

// Installs a one-shot interceptor for the first request whose route ends with the given suffix.
function once(suffix: string, action: (request: { body: unknown }) => Response | undefined): void {
  let fired = false;
  server.intercept = (route, request) => {
    if (fired || !route.endsWith(suffix)) return undefined;
    fired = true;
    return action(request);
  };
}

beforeEach(async () => {
  chromeStub = installChrome();
  server = installFakeVosio(chromeStub);
  store = createMemoryStore();
  setStore(store);
  await useFastTiming();
  await pairFully();
  server.calls.length = 0;
  done = [];
  pairingNeeded = 0;
  uploadHooks.onDone = (entry) => done.push(entry);
  uploadHooks.onPairingNeeded = () => { pairingNeeded += 1; };
});

afterEach(() => {
  uploadHooks.onDone = () => undefined;
  uploadHooks.onPairingNeeded = () => undefined;
  vi.unstubAllGlobals();
  setStore(null);
});

describe("upload queue: happy path", () => {
  it("creates the recording, registers all parts, uploads them and completes; then deletes local data", async () => {
    await makeSession();
    await processQueue();
    const recording = server.recordings.get("rec-1");
    expect(recording).toMatchObject({ requestId: "11111111-1111-4111-8111-111111111111", title: "Google Meet – 06.11.2026 14:00", completeRequestId: "22222222-2222-4222-8222-222222222222" });
    expect([...server.objects.values()].sort()).toEqual([10, 20, 30]);
    expect(server.calls.filter((route) => route === "PUT storage")).toHaveLength(3);
    expect(store.sessions.size).toBe(0);
    expect(store.chunks).toHaveLength(0);
    expect(done).toHaveLength(1);
    expect((await readHistory())[0]).toMatchObject({ title: "Google Meet – 06.11.2026 14:00", detailUrl: "https://vosio.example/recordings/rec-1", transcription: "queued" });
  });

  it("uploads from a recovered orphaned session", async () => {
    await store.putSession({ ...(await makeSession([40])), status: "recording", endedAt: null, title: null, requestId: null, completeRequestId: null });
    await recoverOrphans(null);
    await processQueue();
    expect(server.recordings.size).toBe(1);
    expect(store.sessions.size).toBe(0);
  });
});

describe("upload queue: failures and retries", () => {
  it("keeps everything locally and schedules a retry when the network is down", async () => {
    await makeSession();
    server.intercept = () => { throw new TypeError("offline"); };
    await processQueue();
    const session = (await store.getSession("local-1"))!;
    expect(session).toMatchObject({ status: "queued", attempts: 1 });
    expect(session.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(chromeStub.alarms.created.has("vosio-upload")).toBe(true);
    expect(store.chunks).toHaveLength(3);

    server.intercept = null;
    await kickQueue();
    expect(store.sessions.size).toBe(0);
    expect(server.recordings.size).toBe(1);
  });

  it("does not create a duplicate recording when the create response was lost", async () => {
    await makeSession();
    server.dropResponseFor.add(`${CAPTURE}/recordings`);
    await processQueue();
    expect(server.recordings.size).toBe(1);
    expect((await store.getSession("local-1"))?.recordingId).toBeNull();
    await kickQueue();
    expect(server.recordings.size).toBe(1);
    expect(store.sessions.size).toBe(0);
  });

  it("refreshes the token once on a 401 in the middle of the upload and continues", async () => {
    await makeSession();
    once("/complete", () => {
      server.expiredTokens.add([...server.grant.tokens].at(-1) as string);
      return undefined;
    });
    await processQueue();
    expect(server.refreshes).toBe(1);
    expect(store.sessions.size).toBe(0);
    expect(done).toHaveLength(1);
  });

  it("waits for re-pairing after a failed refresh and then continues into the SAME recording with the same request ids", async () => {
    await makeSession();
    const bodies: Array<Record<string, unknown>> = [];
    server.intercept = (route, request) => {
      if (route.endsWith("/complete")) {
        bodies.push(request.body as Record<string, unknown>);
        if (bodies.length === 1) server.grant.revoked = true;
      }
      return undefined;
    };
    await processQueue();
    const waiting = (await store.getSession("local-1"))!;
    expect(waiting.status).toBe("waiting-pair");
    expect(waiting.recordingId).toBe("rec-1");
    expect(pairingNeeded).toBe(1);
    expect((await readPairing()).status).toBe("disconnected");
    expect(store.chunks).toHaveLength(3);

    await pairFully();
    await kickQueue();
    expect(server.recordings.size).toBe(1);
    expect(server.putCount).toBe(3);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].requestId).toBe(bodies[0].requestId);
    expect(bodies[1].requestId).toBe("22222222-2222-4222-8222-222222222222");
    expect(store.sessions.size).toBe(0);
  });

  it("marks queued sessions as waiting for pairing without any network call while unpaired", async () => {
    await makeSession();
    await writePairing({ ...(await readPairing()), status: "expired", accessToken: null, refreshToken: null });
    await processQueue();
    expect(server.calls).toEqual([]);
    expect(await store.getSession("local-1")).toMatchObject({ status: "waiting-pair" });
    expect(store.chunks).toHaveLength(3);
  });

  it("repeats the complete call after a lost response with the same persisted request id (no second transcription)", async () => {
    await makeSession();
    const bodies: Array<Record<string, unknown>> = [];
    server.intercept = (route, request) => {
      if (route.endsWith("/complete")) bodies.push(request.body as Record<string, unknown>);
      return undefined;
    };
    server.dropResponseFor.add(`${CAPTURE}/recordings/rec-1/complete`);
    await processQueue();
    expect((await store.getSession("local-1"))?.status).toBe("queued");
    await kickQueue();
    expect(bodies.map((body) => body.requestId)).toEqual(["22222222-2222-4222-8222-222222222222", "22222222-2222-4222-8222-222222222222"]);
    expect(done).toHaveLength(1);
    expect(store.sessions.size).toBe(0);
  });

  it("skips parts that already exist on the server when resuming", async () => {
    await makeSession();
    let blocked = true;
    server.intercept = (route, request) => (blocked && route.startsWith("PUT ") && request.url.includes("part-2") ? (() => { throw new TypeError("offline"); })() : undefined);
    await processQueue();
    expect(server.putCount).toBe(2);
    blocked = false;
    await kickQueue();
    expect(server.putCount).toBe(3);
    expect(store.sessions.size).toBe(0);
  });

  it("treats a rejected upload of an already stored object (409 Duplicate) as stored and completes", async () => {
    await makeSession([10]);
    once("/part-0", () => {
      server.objects.set("rec-1/part-0", 10);
      return undefined;
    });
    await processQueue();
    expect(server.calls.filter((route) => route === "PUT storage")).toHaveLength(1);
    expect(store.sessions.size).toBe(0);
    expect(done).toHaveLength(1);
  });

  it("re-registers and re-uploads the affected part after 409 incomplete_parts", async () => {
    await makeSession();
    once("/complete", () => {
      server.objects.delete("rec-1/part-1");
      return undefined;
    });
    await processQueue();
    expect(server.putCount).toBe(4);
    expect(store.sessions.size).toBe(0);
  });

  it("recovers from 409 revision_conflict by reading /status and continuing with the current revision", async () => {
    await makeSession();
    once("/parts", () => {
      server.recordings.get("rec-1")!.revision += 5;
      return undefined;
    });
    await processQueue();
    expect(server.calls).toContain(`${CAPTURE}/recordings/rec-1/status`);
    expect(store.sessions.size).toBe(0);
  });

  it("stops retrying when the recording was deleted in Vosio (410) and keeps the local copy for download/delete", async () => {
    await makeSession();
    once("/parts", () => {
      server.recordings.get("rec-1")!.deleted = true;
      return undefined;
    });
    await processQueue();
    const session = (await store.getSession("local-1"))!;
    expect(session.status).toBe("remote-deleted");
    expect(session.lastError).toContain("smazána");
    expect(store.chunks).toHaveLength(3);
    server.calls.length = 0;
    await processQueue();
    expect(server.calls).toEqual([]);
    await discardSession("local-1");
    expect(store.sessions.size).toBe(0);
    expect(store.chunks).toHaveLength(0);
  });

  it("treats a bare 404 (no D8 envelope: config unavailable, rolled-back Function) as retryable, while an enveloped not_found stays permanent", async () => {
    await makeSession();
    once("/parts", () => new Response(null, { status: 404 }));
    await processQueue();
    expect(await store.getSession("local-1")).toMatchObject({ status: "queued", attempts: 1 });
    expect(store.chunks).toHaveLength(3);
    server.intercept = null;
    await kickQueue();
    expect(store.sessions.size).toBe(0);
    expect(done).toHaveLength(1);

    await makeSession();
    once("/parts", () => jsonError(404, "not_found"));
    await processQueue();
    expect(await store.getSession("local-1")).toMatchObject({ status: "failed" });
  });

  it("keeps a scheduled transcription-start retry across a bare 404 and drops it after an enveloped not_found", async () => {
    await writeTranscriptionRetries([{ recordingId: "rec-1", requestId: "22222222-2222-4222-8222-222222222222", captureRevision: 1, durationSeconds: 60, partCount: 1, attempts: 0 }]);
    server.intercept = (route) => (route.endsWith("/complete") ? new Response(null, { status: 404 }) : undefined);
    await processQueue();
    expect(await readTranscriptionRetries()).toMatchObject([{ attempts: 1 }]);
    server.intercept = (route) => (route.endsWith("/complete") ? jsonError(404, "not_found") : undefined);
    await processQueue();
    expect(await readTranscriptionRetries()).toHaveLength(0);
  });

  it("fails permanently on part_too_large and on a recording that belongs to another account", async () => {
    await makeSession();
    once("/parts", () => jsonError(413, "part_too_large"));
    await processQueue();
    expect(await store.getSession("local-1")).toMatchObject({ status: "failed", lastError: expect.stringContaining("part_too_large") });
    expect(store.chunks).toHaveLength(3);

    await store.putSession({ ...(await store.getSession("local-1"))!, status: "queued", lastError: null, accountEmail: "someone@else.example" });
    server.intercept = null;
    await processQueue();
    expect(await store.getSession("local-1")).toMatchObject({ status: "failed", lastError: expect.stringContaining("someone@else.example") });
  });

  it("deletes local data only after the server confirmed completion (503 on complete keeps it)", async () => {
    await makeSession();
    once("/complete", () => jsonError(503, "unavailable"));
    await processQueue();
    expect(store.sessions.size).toBe(1);
    expect(store.chunks).toHaveLength(3);
    expect(done).toHaveLength(0);
  });

  it("on 409 incomplete_parts resends the FULL contiguous part list from index 0 (existing parts come back as exists)", async () => {
    await makeSession([10, 20, 30]);
    const lists: number[][] = [];
    let completes = 0;
    server.intercept = (route, request) => {
      if (route.endsWith("/parts")) lists.push((request.body as { parts: Array<{ index: number }> }).parts.map((part) => part.index));
      if (route.endsWith("/complete") && (completes += 1) === 1) server.objects.delete("rec-1/part-2");
      return undefined;
    };
    await processQueue();
    expect(lists).toEqual([[0, 1, 2], [0, 1, 2]]);
    expect(server.putCount).toBe(4);
    expect(store.sessions.size).toBe(0);
  });

  it("fails with incomplete_parts semantics when the registered part count differs from partCount (server side)", async () => {
    await makeSession([10, 20]);
    server.intercept = (route, request) => {
      if (route.endsWith("/complete")) (request.body as { partCount: number }).partCount = 3;
      return undefined;
    };
    await processQueue();
    expect((await store.getSession("local-1"))?.status).toBe("queued");
    expect(done).toHaveLength(0);
  });

  it("re-registers once when a signed upload URL was rejected (expired token) and then succeeds", async () => {
    await makeSession([10]);
    once("/part-0", () => new Response("expired", { status: 403 }));
    await processQueue();
    expect(server.calls.filter((route) => route.endsWith("/parts"))).toHaveLength(2);
    expect(store.sessions.size).toBe(0);
  });

  it("marks the recording failed when the storage keeps rejecting the upload after one re-registration", async () => {
    await makeSession([10]);
    server.intercept = (route) => (route.startsWith("PUT ") ? new Response("denied", { status: 401 }) : undefined);
    await processQueue();
    expect(server.calls.filter((route) => route.endsWith("/parts"))).toHaveLength(2);
    expect(await store.getSession("local-1")).toMatchObject({ status: "failed" });
    expect(store.chunks).toHaveLength(1);
  });

  it("refuses upload URLs outside the paired server origin (no PUT is sent)", async () => {
    await makeSession([10]);
    server.intercept = async (route) => {
      if (!route.endsWith("/parts")) return undefined;
      return new Response(JSON.stringify({ captureRevision: 9, parts: [{ index: 0, state: "ready", uploadUrl: "https://evil.example/upload?token=t" }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await processQueue();
    expect(await store.getSession("local-1")).toMatchObject({ status: "failed", lastError: expect.stringContaining("neplatnou adresu") });
    expect(server.putCount).toBe(0);
  });

  it("does not keep or open a detail URL outside the Vosio web origin", async () => {
    await makeSession([10]);
    server.intercept = async (route) => {
      if (!route.endsWith("/complete")) return undefined;
      return new Response(JSON.stringify({ recordingId: "rec-1", status: "uploaded", transcription: { state: "queued", operationId: null }, detailUrl: "https://evil.example/x" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await processQueue();
    expect((await readHistory())[0].detailUrl).toBeNull();
  });

  it("treats transcription not_started as saved (local data deleted) and retries /complete with the same requestId", async () => {
    await makeSession([10]);
    server.transcriptionState = "not_started";
    const completes: string[] = [];
    server.intercept = (route, request) => {
      if (route.endsWith("/complete")) completes.push((request.body as { requestId: string }).requestId);
      return undefined;
    };
    await processQueue();
    expect(done).toHaveLength(1);
    expect(store.sessions.size).toBe(0);
    expect(store.chunks).toHaveLength(0);
    expect(completes.length).toBeGreaterThanOrEqual(2);
    expect(new Set(completes)).toEqual(new Set(["22222222-2222-4222-8222-222222222222"]));
    expect((await readHistory())[0].transcription).toBe("not_started");
  });

  it("treats a recording already closed by the web (409 revision_conflict, status uploaded) as done", async () => {
    await makeSession([10]);
    once("/parts", () => {
      const recording = server.recordings.get("rec-1")!;
      recording.revision += 3;
      recording.completeRequestId = "closed-by-web";
      return undefined;
    });
    await processQueue();
    expect(store.sessions.size).toBe(0);
    expect(done).toHaveLength(1);
    expect(server.putCount).toBe(0);
  });

  it("picks up a session queued while the lock is held in the same run (no wait for the next tick)", async () => {
    await makeSession([10]);
    let injected = false;
    server.intercept = async (route) => {
      if (route.endsWith("/complete") && !injected) {
        injected = true;
        const first = (await store.getSession("local-1"))!;
        await store.putSession({ ...first, id: "local-2", status: "queued", recordingId: null, captureRevision: null, uploadedParts: [], startedAt: first.startedAt + 1, requestId: "33333333-3333-4333-8333-333333333333", completeRequestId: "44444444-4444-4444-8444-444444444444" });
        await store.addChunk({ sessionId: "local-2", part: 0, seq: 0, t: 2, blob: new Blob([new Uint8Array(5)]) });
        void processQueue();
      }
      return undefined;
    };
    await processQueue();
    expect(store.sessions.size).toBe(0);
    expect(server.recordings.size).toBe(2);
  });

  it("backs off exponentially up to 15 minutes", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([5000, 10000, 20000]);
    expect(backoffMs(40)).toBe(15 * 60 * 1000);
  });
});
