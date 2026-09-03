// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  resumeDurableSafetyPartsForOwner: vi.fn(),
  uploadLiveRecordingPart: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/live-recording/durable-audio", () => ({
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

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
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
    expect(container.textContent).toContain("Pouze na serveru");
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
});
