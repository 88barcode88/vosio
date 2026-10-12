import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupConfirmedDurableSafetyGeneration, createIndexedDbDurableAudioRepository,
  type DurableAudioPartRecord, type DurableSafetyManifest } from "@/lib/live-recording/durable-audio";
import { promoteDurableSafetyParts } from "@/lib/live-recording/durable-audio";
import { acquireDurableGenerationWriter, withDurableGenerationDiscard } from "@/lib/live-recording/generation-lock";
import { discardDurableSafetyGeneration } from "@/lib/live-recording/discard";

const authMocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: authMocks.createClient }));
afterEach(() => { vi.unstubAllGlobals(); });

// Model native shared/exclusive leases across independent writer and discard callers.
function locks() {
  const held = new Map<string, number>();
  return { request: async (name: string, options: { mode: string }, callback: (lock: object | null) => Promise<unknown>) => {
    if (options.mode === "exclusive" && held.has(name)) return callback(null);
    held.set(name, (held.get(name) ?? 0) + 1);
    try { return await callback({ name }); }
    finally { const count = held.get(name)! - 1; if (count === 0) held.delete(name); else held.set(name, count); }
  } } as unknown as LockManager;
}

// Verify current personal identity and expose actual auth change delivery during the storage transaction.
function authenticate(owner = "owner") {
  let change: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
  const unsubscribe = vi.fn(() => { change = undefined; });
  authMocks.createClient.mockReturnValue({ auth: {
    getUser: async () => ({ data: { user: { id: owner } }, error: null }),
    onAuthStateChange: (callback: typeof change) => { change = callback; return { data: { subscription: { unsubscribe } } }; }
  } });
  return { change: (nextOwner: string | null) => change?.("SIGNED_OUT", nextOwner ? { user: { id: nextOwner } } : null), unsubscribe };
}

// part models a fully confirmed immutable row; a new recorder persistence starts unconfirmed.
function part(index = 0): DurableAudioPartRecord {
  const blob = new Blob([`part${index}`], { type: "audio/webm" });
  return { blob, ownerId: "owner", recordingId: "recording", generationId: "generation",
    index, key: `owner/recording/generation/${index}`, name: `part-${String(index).padStart(6,"0")}.webm`,
    extension: "webm", mimeType: "audio/webm", offsetMs: index * 15000, size: blob.size,
    createdAt: "2026-10-02T10:00:00Z", uploadedAt: "2026-10-02T10:01:00Z" };
}

// indexedDb models request events and the serialized readwrite boundary used by the production repository.
function indexedDb(seed: DurableAudioPartRecord[], beforeRead?: (rows: DurableAudioPartRecord[]) => void) {
  const rows = [...seed]; const modes: string[] = []; const deletes = vi.fn();
  const database = { close: vi.fn(), transaction: (_name: string, mode = "readonly") => {
    modes.push(mode);
    const transaction = new EventTarget();
    const store = { index: () => ({ getAll: (ownerId: string) => {
      const request = new EventTarget() as EventTarget & { result: DurableAudioPartRecord[] };
      queueMicrotask(() => {
        beforeRead?.(rows);
        request.result = rows.filter((row) => row.ownerId === ownerId);
        request.dispatchEvent(new Event("success"));
        queueMicrotask(() => transaction.dispatchEvent(new Event("complete")));
      });
      return request;
    } }), delete: (key: string) => {
      if (mode !== "readwrite") throw new Error("delete outside readwrite transaction");
      deletes(key); const index = rows.findIndex((row) => row.key === key); if (index !== -1) rows.splice(index, 1);
    } };
    return Object.assign(transaction, { objectStore: () => store });
  } };
  const factory = { open: () => {
    const request = Object.assign(new EventTarget(), { result: database });
    queueMicrotask(() => request.dispatchEvent(new Event("success")));
    return request;
  } } as unknown as IDBFactory;
  return { repository: createIndexedDbDurableAudioRepository(factory), rows, modes, deletes };
}

// manifest freezes the server-confirmed scope presented to conditional recovery cleanup.
function manifest(parts: DurableAudioPartRecord[]): DurableSafetyManifest {
  return { ownerId: "owner", recordingId: "recording", generationId: "generation", createdAt: parts[0]!.createdAt,
    parts, partCount: parts.length, pendingPartCount: 0, totalBytes: parts.reduce((sum,row) => sum + row.size,0) };
}

describe("atomic conditional IndexedDB recovery cleanup", () => {
  it("retains every row when another tab inserts pending part1 after panel precheck", async () => {
    const confirmed = part(); const expected = manifest([confirmed]);
    const db = indexedDb([confirmed], (rows) => rows.push({ ...part(1), uploadedAt: null }));
    expect(await cleanupConfirmedDurableSafetyGeneration({ manifest: expected, repository: db.repository })).toBe(false);
    expect(db.rows).toHaveLength(2); expect(db.deletes).not.toHaveBeenCalled();
    expect(db.modes).toEqual(["readwrite"]);
  });
  it("deletes exactly an unchanged confirmed generation in the same readwrite transaction", async () => {
    const confirmed = part(); const other = { ...part(1), generationId: "other", key: "owner/recording/other/1" };
    const db = indexedDb([confirmed,other]);
    expect(await cleanupConfirmedDurableSafetyGeneration({ manifest: manifest([confirmed]), repository: db.repository })).toBe(true);
    expect(db.rows).toEqual([other]); expect(db.deletes).toHaveBeenCalledExactlyOnceWith(confirmed.key);
    expect(db.modes).toEqual(["readwrite"]);
  });
  it.each(["pending", "identity", "confirmation", "scope"])("retains all rows after %s changed under the transaction", async (change) => {
    const confirmed = part(); const db = indexedDb([confirmed], (rows) => {
      rows[0] = { ...confirmed, ...(change === "pending" ? { uploadedAt: null }
        : change === "identity" ? { offsetMs: 5 }
          : change === "confirmation" ? { uploadedAt: "2026-10-02T10:02:00Z" } : { generationId: "other" }) };
    });
    expect(await cleanupConfirmedDurableSafetyGeneration({ manifest: manifest([confirmed]), repository: db.repository })).toBe(false);
    expect(db.rows).toHaveLength(1); expect(db.deletes).not.toHaveBeenCalled();
  });
  it("rejects a scope-mismatched expected snapshot before opening a write transaction", async () => {
    const confirmed = part(); const db = indexedDb([confirmed]);
    expect(await cleanupConfirmedDurableSafetyGeneration({ manifest: { ...manifest([confirmed]), ownerId: "foreign" }, repository: db.repository })).toBe(false);
    expect(db.modes).toEqual([]); expect(db.rows).toEqual([confirmed]);
  });
});

describe("explicit exact local generation discard", () => {
  it("deletes the reviewed pending snapshot atomically while preserving every other generation and owner", async () => {
    const row = { ...part(), uploadedAt: null };
    const other = { ...part(1), generationId: "other", key: "owner/recording/other/1" };
    const foreign = { ...part(), ownerId: "foreign", key: "foreign/recording/generation/0" };
    const db = indexedDb([row, other, foreign]); const auth = authenticate();
    expect(await discardDurableSafetyGeneration({ manifest: { ...manifest([row]), pendingPartCount: 1 }, repository: db.repository, locks: locks() })).toBe(true);
    expect(db.rows).toEqual([other, foreign]); expect(db.modes).toEqual(["readwrite"]);expect(auth.unsubscribe).toHaveBeenCalledOnce();
  });
  it.each(["foreign", "signout", "changed", "newpart", "writer"])("retains the entire snapshot after %s changes", async (change) => {
    const row = { ...part(), uploadedAt: null }; const auth = authenticate(change === "foreign" ? "foreign" : "owner");
    let idle = true;
    const db = indexedDb([row], (rows) => {
      if (change === "signout") auth.change(null);
      if (change === "changed") rows[0] = { ...row, uploadedAt: "2026-10-05T00:00:00Z" };
      if (change === "newpart") rows.push({ ...part(1), uploadedAt: null });
      if (change === "writer") idle = false;
    });
    expect(await discardDurableSafetyGeneration({ manifest: { ...manifest([row]), pendingPartCount: 1 }, repository: db.repository,
      locks: locks(), canDiscard: () => idle })).toBe(false);
    expect(db.deletes).not.toHaveBeenCalled(); expect(db.rows.length).toBeGreaterThan(0);
  });
  it("retains pending data when Web Locks are unavailable", async () => {
    const row = { ...part(), uploadedAt: null }; const db = indexedDb([row]);authenticate();
    vi.stubGlobal("navigator", {});
    expect(await discardDurableSafetyGeneration({ manifest: { ...manifest([row]), pendingPartCount: 1 }, repository: db.repository })).toBe(false);
    expect(db.modes).toEqual([]);
  });
  it("refuses a busy generation until the capture writer releases its full lease", async () => {
    const row = part(); const manager = locks(); const release = await acquireDurableGenerationWriter(row, manager);
    const remove = vi.fn(async () => true);
    expect(await withDurableGenerationDiscard(row, remove, manager)).toBe(false);expect(remove).not.toHaveBeenCalled();
    await release();
    expect(await withDurableGenerationDiscard(row, remove, manager)).toBe(true);
  });
  it("holds resumed promotion custody until remote upload and local confirmation settle", async () => {
    const row = { ...part(), uploadedAt: null }; const manager = locks(); vi.stubGlobal("navigator", { locks: manager });
    let finish!: () => void;let started!: () => void;
    const uploading = new Promise<void>((resolve) => { finish = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const repository = { listForOwner: async () => [row], markUploaded: vi.fn(async () => {}), put: vi.fn(), deleteGeneration: vi.fn() };
    const promotion = promoteDurableSafetyParts({ ownerId: "owner", repository, uploadPart: async () => { started();await uploading; } });
    await ready;
    expect(await withDurableGenerationDiscard(row, async () => true, manager)).toBe(false);
    finish();await promotion;
    expect(repository.markUploaded).toHaveBeenCalledOnce();
    expect(await withDurableGenerationDiscard(row, async () => true, manager)).toBe(true);
  });
});
