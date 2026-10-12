// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupConfirmedDurableSafetyGeneration: vi.fn(),
  listDurableSafetyManifestsForOwner: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  resumeDurableSafetyPartsForOwner: vi.fn(),
  uploadLiveRecordingPart: vi.fn(),
  adoptLegacyLiveRecordingParts: vi.fn(), discardDurableSafetyGeneration: vi.fn(), deleteRecordingAction: vi.fn(),
  getUser: vi.fn(), getCaptureState: vi.fn()
}));

vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/recordings/capture", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/recordings/capture")>(), getCaptureState: mocks.getCaptureState
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/live-recording/durable-audio", () => ({
  cleanupConfirmedDurableSafetyGeneration: mocks.cleanupConfirmedDurableSafetyGeneration,
  listDurableSafetyManifestsForOwner: mocks.listDurableSafetyManifestsForOwner,
  resumeDurableSafetyPartsForOwner: mocks.resumeDurableSafetyPartsForOwner
}));
vi.mock("@/lib/recordings/upload", () => ({
  adoptLegacyLiveRecordingParts: mocks.adoptLegacyLiveRecordingParts,
  getLiveRecordingStoragePrefix: (ownerId: string, recordingId: string) =>
    `${ownerId}/${recordingId}/live/`,
  uploadLiveRecordingPart: mocks.uploadLiveRecordingPart
}));
vi.mock("@/lib/live-recording/discard", () => ({ discardDurableSafetyGeneration: mocks.discardDurableSafetyGeneration }));
vi.mock("@/lib/recordings/actions", () => ({ deleteRecordingAction: mocks.deleteRecordingAction }));

import { LiveRecordingRecoveryPanel } from "@/components/live-recording-recovery-panel";
import type { DurableAudioPartRecord, DurableSafetyManifest } from "@/lib/live-recording/durable-audio";
import { acquireDurableGenerationWriter, withDurableRecordingMutation } from "@/lib/live-recording/generation-lock";

let container: HTMLDivElement;
let root: Root;
let nativeLocks: LockManager;

// Model native immediate shared/exclusive custody across independent panel and recorder callers.
function createLocks() {
  const held = new Map<string, number>();
  return { request: async (name: string, options: { mode: string }, callback: (lock: object | null) => Promise<unknown>) => {
    if (options.mode === "exclusive" && held.has(name)) return callback(null);
    held.set(name, (held.get(name) ?? 0) + 1);
    try { return await callback({ name }); }
    finally { const count = held.get(name)! - 1; if (count === 0) held.delete(name); else held.set(name, count); }
  } } as unknown as LockManager;
}

// flushRecoveryEffect lets the initial fetch, local resume, and refreshed fetch settle.
async function flushRecoveryEffect() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
  await act(async () => {
    const disclosure = container.querySelector<HTMLDetailsElement>(".live-recovery-popover");
    if (disclosure && !disclosure.open) disclosure.querySelector<HTMLElement>("summary")?.click();
  });
}

// createLocalManifest models one current-owner IndexedDB recovery scope after reload.
function createLocalManifest(pending = false): DurableSafetyManifest {
  const blob = new Blob(["local"], { type: "audio/webm" });
  const part: DurableAudioPartRecord = {
    blob,
    createdAt: "2026-09-03T12:00:00.000Z",
    extension: "webm",
    generationId: "generation-1",
    index: 0,
    key: "owner-1/local-recording/generation-1/0",
    mimeType: "audio/webm",
    name: "part-000000.webm",
    offsetMs: 0,
    ownerId: "owner-1",
    recordingId: "local-recording",
    size: blob.size,
    uploadedAt: pending ? null : "2026-09-03T12:01:00.000Z"
  };

  return {
    createdAt: part.createdAt,
    generationId: part.generationId,
    ownerId: part.ownerId,
    partCount: 1,
    parts: [part],
    pendingPartCount: pending ? 1 : 0,
    recordingId: part.recordingId,
    totalBytes: part.size
  };
}

// createServerRecording models compact state returned by the owner-scoped recovery endpoint.
function createServerRecording(id: string, title: string) {
  return {
    created_at: "2026-09-03T12:00:00.000Z",
    duration_seconds: 15,
    id,
    segment_count: 1,
    storage_bytes: 5,
    title,
    transcript_chars: 0,
    canRecover: true, canDelete: false, captureRevision: 4, phase: null
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  mocks.getCaptureState.mockImplementation(async (_client, recordingId) => ({ recordingId, status: "uploading", captureRevision: 4 }));
  nativeLocks = createLocks();
  vi.stubGlobal("navigator", { locks: nativeLocks });
  mocks.cleanupConfirmedDurableSafetyGeneration.mockResolvedValue(true);
  mocks.listDurableSafetyManifestsForOwner.mockImplementation(async () =>
    (await mocks.resumeDurableSafetyPartsForOwner.mock.results[0]?.value)?.manifests ?? []);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("live recording local recovery", () => {
  it("blocks finalizing a fully confirmed part0 while its writer remains live, then permits recovery after release", async () => {
    const manifest = await renderScenario();
    const release = await acquireDurableGenerationWriter(manifest, nativeLocks);
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    await act(async () => action("Obnovit")?.click());
    expect(fetchMock).toHaveBeenCalledTimes(before);
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(container.textContent).toContain("právě nahrává");
    await release();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ recording: { id: manifest.recordingId } }) } as Response);
    mocks.cleanupConfirmedDurableSafetyGeneration.mockImplementation(async () => {
      expect(await withDurableRecordingMutation(manifest.recordingId, async () => {}, nativeLocks)).toBe(false);
      return true;
    });
    await act(async () => { action("Obnovit")?.click(); for(let i=0;i<12;i++) await Promise.resolve(); });
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith(`/recordings/${manifest.recordingId}`);
  });
  it("guards canonical manager server-only Trash against another owner's generation", async () => {
    await renderScenario({ canDelete: true }, false);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteRecordingAction.mockResolvedValue(undefined);
    const release = await acquireDurableGenerationWriter({ ownerId: "different-author", recordingId: "local-recording", generationId: "unknown-to-manager" }, nativeLocks);
    await act(async () => action("Přesunout nahrávku do Koše")?.click());
    expect(mocks.deleteRecordingAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Přesun do Koše je pozastavený");
    await release();
    await act(async () => action("Přesunout nahrávku do Koše")?.click());
    expect(mocks.deleteRecordingAction).toHaveBeenCalledOnce();
  });
  it("retains recovery and Trash without Web Locks and explains the required browser support", async () => {
    await renderScenario({ canDelete: true });
    vi.stubGlobal("navigator", {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const before = vi.mocked(fetch).mock.calls.length;
    await act(async () => action("Obnovit")?.click());
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(before);
    await act(async () => action("Přesunout nahrávku do Koše")?.click());
    expect(mocks.deleteRecordingAction).not.toHaveBeenCalled();
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(container.textContent).toContain("nepodporuje bezpečné zámky");
  });
  it("guards canonical manager server-only recovery without needing the author's generation identity", async () => {
    await renderScenario({}, false);
    const release = await acquireDurableGenerationWriter({ ownerId: "different-author", recordingId: "local-recording", generationId: "another-generation" }, nativeLocks);
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    await act(async () => action("Obnovit")?.click());
    expect(fetchMock).toHaveBeenCalledTimes(before);
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    await release();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ recording: { id: "local-recording" } }) } as Response);
    await act(async () => { action("Obnovit")?.click(); for(let i=0;i<12;i++) await Promise.resolve(); });
    expect(mocks.push).toHaveBeenCalledWith("/recordings/local-recording");
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
  });
  // Mount a real compact panel with explicit canonical server capabilities.
  async function renderScenario(overrides: Record<string, unknown> = {}, local = true) {
    const manifest = createLocalManifest();
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [], manifests: local ? [manifest] : [], promoted: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ownerId: manifest.ownerId,
      recordings: [{ ...createServerRecording(manifest.recordingId, "Test nahrávka"), ...overrides }] }) }));
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    return manifest;
  }
  // Match visible action text without coupling safety tests to layout order.
  function action(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === label);
  }
  // Model the saved-transcript endpoint's terminal receipt independently of audio recovery.
  function savedTranscriptReceipt(recordingId = "local-recording") {
    return { recording: { id: recordingId }, receipt: {
      recordingId, status: "completed", captureRevision: 5, transcriptId: "11111111-1111-4111-8111-111111111111", jobId: null
    } };
  }
  it("completes a saved transcript under custody while retaining unconfirmed local audio across reload", async () => {
    const manifest = await renderScenario({ transcript_chars: 280, canRecover: false, canDelete: true,
      missing_part_indices: [1] });
    manifest.pendingPartCount = 1;
    manifest.parts[0]!.uploadedAt = null;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(async (url, init) => {
      expect(url).toBe(`/api/recordings/${manifest.recordingId}/complete-saved-transcript`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ requestId: expect.any(String), captureRevision: 4 });
      expect(await withDurableRecordingMutation(manifest.recordingId, async () => {}, nativeLocks)).toBe(false);
      return { ok: true, json: async () => savedTranscriptReceipt() } as Response;
    });
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Chybějící nebo nepotvrzené audio se tím neopraví"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Serverové i místní části audia zůstanou zachované"));
    expect(container.textContent).not.toContain("Test nahrávka");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.uploadLiveRecordingPart).not.toHaveBeenCalled();
    expect(manifest.parts[0]!.blob.size).toBe(5);
    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.getCaptureState.mockResolvedValue({ recordingId: manifest.recordingId, status: "completed", captureRevision: 5 });
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [manifest.parts[0]!.key], manifests: [manifest], promoted: [] });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ownerId: manifest.ownerId, recordings: [] }) } as Response);
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    expect(container.querySelector("article")).toBeNull();
    expect(container.querySelector(".live-recovery-popover")).toBeNull();
    expect(mocks.getCaptureState).toHaveBeenCalledWith(expect.anything(), manifest.recordingId);
    expect(mocks.resumeDurableSafetyPartsForOwner).toHaveBeenCalledTimes(2);
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(manifest.parts).toHaveLength(1);
  });
  it("cancels saved-transcript completion without sending a request or changing either copy", async () => {
    await renderScenario({ transcript_chars: 200 });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const before = vi.mocked(fetch).mock.calls.length;
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(before);
    expect(mocks.getCaptureState).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Test nahrávka");
    expect(container.textContent).toContain("Místně v tomto prohlížeči");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(["active_transcription", "transcription_review_required", "prepared", "uncertain"])("blocks saved-transcript completion during %s", async (active) => {
    await renderScenario({ transcript_chars: 200, phase: active, recovery_issue: active });
    expect(action("Dokončit s uloženým přepisem")).toBeUndefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("blocks saved-transcript completion while a native writer is active", async () => {
    const manifest = await renderScenario({ transcript_chars: 200 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const release = await acquireDurableGenerationWriter(manifest, nativeLocks);
    const before = vi.mocked(fetch).mock.calls.length;
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(before);
    expect(container.textContent).toContain("Dokončení je pozastavené");
    expect(mocks.refresh).not.toHaveBeenCalled();
    await release();
  });
  it("retains the row on rejection and retries one immutable request distinct from recovery", async () => {
    await renderScenario({ transcript_chars: 200 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Nelze obnovit audio." }) } as Response);
    await act(async () => action("Obnovit")?.click());
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Revize se změnila." }) } as Response);
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    expect(container.textContent).toContain("Revize se změnila.");
    expect(container.textContent).toContain("Místně v tomto prohlížeči");
    expect(mocks.refresh).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => savedTranscriptReceipt() } as Response);
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts[1]![1]?.body).toBe(posts[2]![1]?.body);
    expect(JSON.parse(String(posts[0]![1]?.body)).requestId).not.toBe(JSON.parse(String(posts[1]![1]?.body)).requestId);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
  });
  it.each(["recording", "receipt", "status", "revision", "future-revision", "transcript", "invalid-uuid", "job"])("rejects a mismatched %s saved-transcript receipt without hiding the copy", async (field) => {
    await renderScenario({ transcript_chars: 200 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const payload = savedTranscriptReceipt();
    if (field === "recording") payload.recording.id = "other";
    if (field === "receipt") payload.receipt.recordingId = "other";
    if (field === "status") payload.receipt.status = "uploading";
    if (field === "revision") payload.receipt.captureRevision = 3;
    if (field === "future-revision") payload.receipt.captureRevision = 6;
    if (field === "transcript") payload.receipt.transcriptId = "";
    if (field === "invalid-uuid") payload.receipt.transcriptId = "nonempty-but-invalid";
    const invalid = field === "job" ? { ...payload, receipt: { ...payload.receipt, jobId: "unexpected-job" } } : payload;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => invalid } as Response);
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    expect(container.textContent).toContain("Dokončení nevrátilo očekávané potvrzení");
    expect(container.textContent).toContain("Místně v tomto prohlížeči");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("blocks all other actions while saved-transcript completion awaits its receipt", async () => {
    await renderScenario({ transcript_chars: 200, canDelete: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    expect(action("Dokončuji...")?.closest("fieldset")?.disabled).toBe(true);
    expect(action("Obnovit")?.closest("fieldset")?.disabled).toBe(true);
    expect(action("Přesunout nahrávku do Koše")?.closest("fieldset")?.disabled).toBe(true);
    expect(action("Odstranit místní kopii")?.closest("fieldset")?.disabled).toBe(true);
    await act(async () => action("Odstranit místní kopii")?.click());
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
    await act(async () => finish({ ok: false, json: async () => ({ error: "Připojení selhalo." }) } as Response));
    expect(action("Dokončit s uloženým přepisem")?.closest("fieldset")?.disabled).toBe(false);
  });
  it.each(["before", "receipt"])("retains the local copy when session identity changes %s completion", async (when) => {
    await renderScenario({ transcript_chars: 200 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const changed = { data: { user: { id: "other-owner" } }, error: null };
    if (when === "before") mocks.getUser.mockResolvedValueOnce(changed);
    else mocks.getUser.mockResolvedValueOnce({ data: { user: { id: "owner-1" } }, error: null }).mockResolvedValueOnce(changed);
    const before = vi.mocked(fetch).mock.calls.length;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => savedTranscriptReceipt() } as Response);
    await act(async () => action("Dokončit s uloženým přepisem")?.click());
    if (when === "before") expect(vi.mocked(fetch)).toHaveBeenCalledTimes(before);
    expect(container.textContent).toContain("Přihlášení");
    expect(container.textContent).toContain("Místně v tomto prohlížeči");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(["error", "uploading", "mismatched"])("keeps a missing local manifest visible when remote state is %s", async (state) => {
    const manifest = createLocalManifest();
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [], manifests: [manifest], promoted: [] });
    if (state === "error") mocks.getCaptureState.mockRejectedValue(new Error("unavailable"));
    else mocks.getCaptureState.mockResolvedValue({ recordingId: state === "mismatched" ? "other" : manifest.recordingId,
      status: state === "mismatched" ? "completed" : "uploading", captureRevision: 5 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ownerId: manifest.ownerId, recordings: [] }) }));
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    expect(container.textContent).toContain("Lokálně uložená live nahrávka");
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
  });
  it("shows real server gaps separately from local counts and never claims a server-only copy is local", async () => {
    await renderScenario({ canRecover: false, segment_count: 178, expected_segment_count: 179,
      storage_bytes: 4000, missing_part_indices: [177], recovery_issue: "missing_audio_parts" }, false);
    expect(container.textContent).toContain("Server: 178 / 179 částí");
    expect(container.textContent).toContain("chybí části 178");
    expect(container.textContent).toContain("zde místní kopie není");
    expect(action("Obnovit")).toBeUndefined();
    expect(action("Odstranit místní kopii")).toBeUndefined();
  });
  it("does not derive recovery or server Trash authority from the local manifest", async () => {
    await renderScenario({ canRecover: false, canDelete: false, recovery_issue: "invalid_audio_manifest" });
    expect(action("Obnovit")).toBeUndefined();
    expect(action("Přesunout nahrávku do Koše")).toBeUndefined();
    expect(container.textContent).toContain("nelze bezpečně ověřit");
  });
  it.each(["active_transcription", "transcription_review_required"])("blocks local deletion during %s", async (recovery_issue) => {
    await renderScenario({ canRecover: false, canDelete: false, recovery_issue });
    expect(action("Odstranit místní kopii")?.disabled).toBe(true);
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
  });
  it("retains local audio on cancelled confirmation without calling any delete API", async () => {
    await renderScenario();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => action("Odstranit místní kopii")?.click());
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.deleteRecordingAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Místně v tomto prohlížeči");
  });
  it.each([false, "error"])("retains local audio when exact discard returns %s", async (outcome) => {
    const manifest = await renderScenario();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    if (outcome === "error") mocks.discardDurableSafetyGeneration.mockRejectedValue(new Error("disk"));
    else mocks.discardDurableSafetyGeneration.mockResolvedValue(false);
    await act(async () => action("Odstranit místní kopii")?.click());
    expect(mocks.discardDurableSafetyGeneration).toHaveBeenCalledWith({ manifest, canDiscard: expect.any(Function) });
    expect(container.textContent).toContain("zachovaná");
    expect(container.textContent).toContain("Místně v tomto prohlížeči");
  });
  it("fences a confirmed discard after unmount and blocks concurrent recovery", async () => {
    await renderScenario();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let finish!: (value: boolean) => void;
    let fence!: () => boolean;
    mocks.discardDurableSafetyGeneration.mockImplementation(({ canDiscard }) => {
      fence = canDiscard;
      return new Promise<boolean>((resolve) => { finish = resolve; });
    });
    await act(async () => action("Odstranit místní kopii")?.click());
    expect(fence()).toBe(true);
    expect(action("Obnovit")?.closest("fieldset")?.disabled).toBe(true);
    await act(async () => root.unmount());
    expect(fence()).toBe(false);
    await act(async () => finish(false));
    root = createRoot(container);
  });
  it("removes only the confirmed local generation and preserves server metadata", async () => {
    await renderScenario();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.discardDurableSafetyGeneration.mockResolvedValue(true);
    mocks.listDurableSafetyManifestsForOwner.mockResolvedValue([]);
    await act(async () => action("Odstranit místní kopii")?.click());
    expect(container.textContent).not.toContain("Místně v tomto prohlížeči");
    expect(container.textContent).toContain("Test nahrávka");
    expect(mocks.deleteRecordingAction).not.toHaveBeenCalled();
  });
  it("server Trash reuses the authorized action and leaves a separate local discard", async () => {
    await renderScenario({ canDelete: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteRecordingAction.mockResolvedValue(undefined);
    await act(async () => { action("Přesunout nahrávku do Koše")?.click(); for(let i=0;i<8;i++) await Promise.resolve(); });
    expect(mocks.deleteRecordingAction).toHaveBeenCalledOnce();
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Serverová nahrávka je v Koši");
    expect(action("Odstranit místní kopii")).toBeDefined();
    expect(action("Přesunout nahrávku do Koše")).toBeUndefined();
  });
  it("selects only diagnosed legacy gaps and missing tail, even with historical confirmations", async () => {
    const manifest = createLocalManifest();
    const row = { ...createServerRecording(manifest.recordingId, "Legacy"), canRecover: false,
      legacy_adoption_state: "requires_local_manifest", expected_segment_count: 2, missing_part_indices: [1] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ownerId: manifest.ownerId, recordings: [row] }) }));
    mocks.resumeDurableSafetyPartsForOwner.mockImplementation(async (input) => {
      await input.prepareManifest(manifest);
      expect(input.shouldReverifyPart(manifest.parts[0])).toBe(false);
      expect(input.shouldReverifyPart({ ...manifest.parts[0], index: 1 })).toBe(true);
      expect(input.shouldReverifyPart({ ...manifest.parts[0], index: 2 })).toBe(true);
      expect(input.shouldReverifyPart({ ...manifest.parts[0], recordingId: "other" })).toBe(false);
      row.legacy_adoption_state = "";
      expect(input.shouldReverifyPart({ ...manifest.parts[0], index: 1 })).toBe(true);
      expect(input.shouldReverifyPart({ ...manifest.parts[0], index: 2 })).toBe(false);
      return { failed: [], manifests: [manifest], promoted: [] };
    });
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    expect(mocks.adoptLegacyLiveRecordingParts).toHaveBeenCalledExactlyOnceWith(manifest);
  });
  it("retains both copies when server Trash fails or its confirmation is cancelled", async () => {
    await renderScenario({ canDelete: true });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => action("Přesunout nahrávku do Koše")?.click());
    expect(mocks.deleteRecordingAction).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    mocks.deleteRecordingAction.mockRejectedValue(new Error("revoked"));
    await act(async () => action("Přesunout nahrávku do Koše")?.click());
    expect(container.textContent).toContain("nepodařilo přesunout do Koše");
    expect(container.textContent).toContain("Místně v tomto prohlížeči");
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
  });
  it("disables all mutations until automatic resume settles", async () => {
    let finish!: (value: unknown) => void;
    mocks.resumeDurableSafetyPartsForOwner.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ownerId: "owner-1",
      recordings: [{ ...createServerRecording("server", "Probíhající obnova"), canDelete: true }] }) }));
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    expect(action("Obnovit")?.closest("fieldset")?.disabled).toBe(true);
    expect(action("Přesunout nahrávku do Koše")?.closest("fieldset")?.disabled).toBe(true);
    await act(async () => finish({ manifests: [], failed: [], promoted: [] }));
    expect(action("Obnovit")?.closest("fieldset")?.disabled).toBe(false);
  });
  it("fails closed if refreshed owner changes during automatic resume", async () => {
    const manifest = createLocalManifest();
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [], manifests: [manifest], promoted: [] });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ownerId: manifest.ownerId, recordings: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ownerId: "other-owner", recordings: [] }) }));
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    expect(container.textContent).toContain("Přihlášení se změnilo");
    expect(action("Odstranit místní kopii")?.closest("fieldset")?.disabled).toBe(true);
    expect(mocks.discardDurableSafetyGeneration).not.toHaveBeenCalled();
  });
  it("keeps the copy when transaction admission detects a new row after panel precheck", async () => {
    const expected = createLocalManifest();
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [], manifests: [expected], promoted: [] });
    mocks.cleanupConfirmedDurableSafetyGeneration.mockResolvedValue(false);
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ownerId: expected.ownerId, recordings: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ownerId: expected.ownerId,
        recordings: [{ ...createServerRecording(expected.recordingId, "Obnova"), canRecover: true }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recording: { id: expected.recordingId } }) });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel))); await flushRecoveryEffect();
    await act(async () => { container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click(); for(let i=0;i<8;i++) await Promise.resolve(); });
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).toHaveBeenCalledExactlyOnceWith({ manifest: expected });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("místní části se změnily");
    expect(container.textContent).toContain("Otevřít obnovenou nahrávku");
  });
  it("rechecks local confirmation after the server receipt before deleting disk content", async () => {
    const manifest = createLocalManifest();
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [], manifests: [manifest], promoted: [] });
    mocks.listDurableSafetyManifestsForOwner.mockResolvedValue([{
      ...manifest, pendingPartCount: 1, parts: [{ ...manifest.parts[0]!, uploadedAt: null }]
    }]);
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ownerId: manifest.ownerId, recordings: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ownerId: manifest.ownerId,
        recordings: [{ ...createServerRecording(manifest.recordingId, "Obnova"), canRecover: true }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recording: { id: manifest.recordingId } }) });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel))); await flushRecoveryEffect();
    await act(async () => { container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click(); for(let i=0;i<8;i++) await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Bezpečnostní kopie zůstává zachovaná");
  });
  it.each(["partial", "unknown"])("retains remote part0 plus local part0/part1 after %s confirmation", async (kind) => {
    const manifest = createLocalManifest(true);
    manifest.parts.unshift({ ...manifest.parts[0]!, index: 0, uploadedAt: "2026-09-03T12:01:00.000Z" });
    manifest.parts[1] = { ...manifest.parts[1]!, index: 1, name: "part-000001.webm", key: "owner-1/local-recording/generation-1/1" };
    manifest.partCount = 2; manifest.totalBytes *= 2;
    if (kind === "unknown") manifest.pendingPartCount = 0;
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [manifest.parts[1]!.key], manifests: [manifest], promoted: [] });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ownerId: manifest.ownerId,
      recordings: [{ ...createServerRecording(manifest.recordingId, "Částečná obnova"), canRecover: true }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel))); await flushRecoveryEffect();
    await act(async () => { container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click(); await Promise.resolve(); });
    expect(fetchMock.mock.calls).toHaveLength(2);
    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("ještě nejsou potvrzené");
  });
  it("keeps the initial server snapshot without a redundant refresh when IndexedDB is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn(async () => ({
        ownerId: "owner-1",
        recordings: [{
          created_at: "2026-09-03T11:00:00.000Z",
          duration_seconds: 15,
          id: "server-recording",
          segment_count: 1,
          storage_bytes: 12,
          title: "Pouze na serveru",
          transcript_chars: 0
        }]
      })),
      ok: true
    });
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({
      failed: [],
      manifests: [],
      promoted: []
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.querySelector("h2")?.textContent).toBe("Nedokončené live nahrávky");
    expect(container.querySelector('[aria-label="Stav obnovy nahrávek"]')).not.toBeNull();
    expect(container.textContent).toContain("Pouze na serveru");
    expect(container.querySelector('[role="group"][aria-label="Stav obnovy nahrávek"]')).not.toBeNull();
  });

  it("resumes current-owner IndexedDB parts before refreshing server recovery state", async () => {
    const manifest = createLocalManifest();
    const serverOnly = {
      created_at: "2026-09-03T11:00:00.000Z",
      duration_seconds: 15,
      id: "server-recording",
      segment_count: 1,
      storage_bytes: 12,
      title: "Pouze na serveru",
      transcript_chars: 0
    };
    const refreshedLocal = {
      ...serverOnly,
      created_at: manifest.createdAt,
      id: manifest.recordingId,
      storage_bytes: manifest.totalBytes,
      title: "Obnovená lokální nahrávka"
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [serverOnly, refreshedLocal] })),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [serverOnly, refreshedLocal] })),
        ok: true
      });
    mocks.uploadLiveRecordingPart.mockResolvedValue({ bytes: 5, reused: false, storagePath: "path" });
    mocks.resumeDurableSafetyPartsForOwner.mockImplementation(async (input) => {
      await input.prepareManifest(manifest);
      await input.uploadPart(manifest.parts[0]);
      return { failed: [], manifests: [manifest], promoted: [manifest.parts[0]?.key] };
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();

    expect(mocks.resumeDurableSafetyPartsForOwner).toHaveBeenCalledWith(expect.objectContaining({
      maxConcurrent: 2,
      ownerId: "owner-1"
    }));
    expect(mocks.uploadLiveRecordingPart).toHaveBeenCalledWith(expect.objectContaining({
      blob: manifest.parts[0]?.blob,
      contentType: "audio/webm",
      maxFileSizeBytes: 5,
      partIndex: 0,
      recording: {
        id: "local-recording",
        storagePrefix: "owner-1/local-recording/live/",
        userId: "owner-1"
      }
    }));
    expect(mocks.adoptLegacyLiveRecordingParts).toHaveBeenCalledExactlyOnceWith(manifest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pouze na serveru");
    expect(container.textContent).toContain("Obnovená lokální nahrávka");
  });

  it("keeps local and server-only recovery visible when one promotion remains pending", async () => {
    const manifest = createLocalManifest();
    const serverOnly = {
      created_at: "2026-09-03T11:00:00.000Z",
      duration_seconds: 15,
      id: "server-recording",
      segment_count: 1,
      storage_bytes: 12,
      title: "Pouze na serveru",
      transcript_chars: 0
    };
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [serverOnly] })),
      ok: true
    });
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({
      failed: [manifest.parts[0]?.key],
      manifests: [manifest],
      promoted: []
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();

    expect(container.textContent).toContain("Pouze na serveru");
    expect(container.textContent).toContain("Lokálně uložená live nahrávka");
    expect(container.textContent).toContain("části zůstávají bezpečně uložené v tomto prohlížeči");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cleans the exact local generation after matching recovery and does not restore a stale row", async () => {
    const manifest = createLocalManifest();
    const recovered = createServerRecording(manifest.recordingId, "Obnovená lokální nahrávka");
    let cleaned = false;
    mocks.resumeDurableSafetyPartsForOwner.mockImplementation(async () => cleaned
      ? { failed: [], manifests: [], promoted: [] }
      : { failed: [], manifests: [manifest], promoted: [] });
    mocks.cleanupConfirmedDurableSafetyGeneration.mockImplementation(async () => {
      cleaned = true;
      return true;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [] })),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [recovered] })),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ recording: { id: manifest.recordingId } })),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [] })),
        ok: true
      });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupConfirmedDurableSafetyGeneration).toHaveBeenCalledWith({ manifest });
    expect(mocks.push).toHaveBeenCalledWith(`/recordings/${manifest.recordingId}`);

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();

    expect(container.textContent).not.toContain("Obnovená lokální nahrávka");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retains the local generation when the recovery request fails", async () => {
    const manifest = createLocalManifest();
    const recovered = createServerRecording(manifest.recordingId, "Lokální recovery");
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({
      failed: [],
      manifests: [manifest],
      promoted: []
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [] })), ok: true })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [recovered] })),
        ok: true
      })
      .mockResolvedValueOnce({ json: vi.fn(async () => ({ error: "Není co obnovit." })), ok: false });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Lokální recovery");
    expect(container.textContent).toContain("Není co obnovit.");
  });

  it("retains the local generation when recovery returns a different recording identity", async () => {
    const manifest = createLocalManifest();
    const recovered = createServerRecording(manifest.recordingId, "Lokální recovery");
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({
      failed: [],
      manifests: [manifest],
      promoted: []
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [] })), ok: true })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [recovered] })),
        ok: true
      })
      .mockResolvedValueOnce({ json: vi.fn(async () => ({ recording: { id: "other-recording" } })), ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Obnova nevrátila očekávanou nahrávku.");
  });

  it("does not delete local data after a successful server-only recovery", async () => {
    const serverOnly = createServerRecording("server-recording", "Pouze na serveru");
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({ failed: [], manifests: [], promoted: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [serverOnly] })),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ recording: { id: serverOnly.id } })),
        ok: true
      });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupConfirmedDurableSafetyGeneration).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(`/recordings/${serverOnly.id}`);
  });

  it("shows a nonfatal warning and retains the row when local cleanup fails", async () => {
    const manifest = createLocalManifest();
    const recovered = createServerRecording(manifest.recordingId, "Lokální recovery");
    mocks.resumeDurableSafetyPartsForOwner.mockResolvedValue({
      failed: [],
      manifests: [manifest],
      promoted: []
    });
    mocks.cleanupConfirmedDurableSafetyGeneration.mockRejectedValue(new Error("IndexedDB unavailable"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [] })), ok: true })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [recovered] })),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ recording: { id: manifest.recordingId } })),
        ok: true
      });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(createElement(LiveRecordingRecoveryPanel)));
    await flushRecoveryEffect();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".live-recovery-panel article button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("lokální bezpečnostní kopii se nepodařilo odstranit");
    expect(container.textContent).toContain("Lokální recovery");
    expect(mocks.push).not.toHaveBeenCalled();
    const openButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Otevřít obnovenou nahrávku");
    expect(openButton).toBeDefined();

    await act(async () => openButton?.click());

    expect(mocks.push).toHaveBeenCalledWith(`/recordings/${manifest.recordingId}`);
  });
});
