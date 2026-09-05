// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupDurableSafetyGeneration: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  resumeDurableSafetyPartsForOwner: vi.fn(),
  uploadLiveRecordingPart: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/live-recording/durable-audio", () => ({
  cleanupDurableSafetyGeneration: mocks.cleanupDurableSafetyGeneration,
  resumeDurableSafetyPartsForOwner: mocks.resumeDurableSafetyPartsForOwner
}));
vi.mock("@/lib/recordings/upload", () => ({
  getLiveRecordingStoragePrefix: (ownerId: string, recordingId: string) =>
    `${ownerId}/${recordingId}/live/`,
  uploadLiveRecordingPart: mocks.uploadLiveRecordingPart
}));

import { LiveRecordingRecoveryPanel } from "@/components/live-recording-recovery-panel";
import type { DurableAudioPartRecord, DurableSafetyManifest } from "@/lib/live-recording/durable-audio";

let container: HTMLDivElement;
let root: Root;

// flushRecoveryEffect lets the initial fetch, local resume, and refreshed fetch settle.
async function flushRecoveryEffect() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

// createLocalManifest models one current-owner IndexedDB recovery scope after reload.
function createLocalManifest(): DurableSafetyManifest {
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
    uploadedAt: null
  };

  return {
    createdAt: part.createdAt,
    generationId: part.generationId,
    ownerId: part.ownerId,
    partCount: 1,
    parts: [part],
    pendingPartCount: 1,
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
    transcript_chars: 0
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  mocks.cleanupDurableSafetyGeneration.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("live recording local recovery", () => {
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
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [serverOnly] })),
        ok: true
      })
      .mockResolvedValueOnce({
        json: vi.fn(async () => ({ ownerId: "owner-1", recordings: [serverOnly, refreshedLocal] })),
        ok: true
      });
    mocks.uploadLiveRecordingPart.mockResolvedValue({ bytes: 5, reused: false, storagePath: "path" });
    mocks.resumeDurableSafetyPartsForOwner.mockImplementation(async (input) => {
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
    mocks.cleanupDurableSafetyGeneration.mockImplementation(async () => {
      cleaned = true;
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
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupDurableSafetyGeneration).toHaveBeenCalledWith({
      generationId: manifest.generationId,
      ownerId: manifest.ownerId,
      recordingId: manifest.recordingId
    });
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
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupDurableSafetyGeneration).not.toHaveBeenCalled();
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
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupDurableSafetyGeneration).not.toHaveBeenCalled();
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
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cleanupDurableSafetyGeneration).not.toHaveBeenCalled();
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
    mocks.cleanupDurableSafetyGeneration.mockRejectedValue(new Error("IndexedDB unavailable"));
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
      container.querySelector<HTMLButtonElement>("button")?.click();
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
