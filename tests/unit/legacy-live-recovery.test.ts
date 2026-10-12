import { describe, expect, it, vi } from "vitest";
import type { DurableAudioPartRecord, DurableAudioRepository } from "@/lib/live-recording/durable-audio";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.createClient }));
import { adoptLegacyLiveRecordingParts } from "@/lib/recordings/upload";
import { listDurableSafetyManifestsForOwner, resumeDurableSafetyPartsForOwner } from "@/lib/live-recording/durable-audio";
const recordingId = "00000000-0000-4000-8000-000000000711";
// Build real complete blobs and deterministic names without touching browser IndexedDB.
function fixture() {
  const rows: DurableAudioPartRecord[] = [0, 1, 2].map((index) => ({
    blob: new Blob(["part"]), size: 4, mimeType: "audio/webm", extension: "webm",
    index, name: `part-${String(index).padStart(6, "0")}.webm`, offsetMs: index * 15000,
    ownerId: "owner", recordingId, generationId: "generation", key: `owner/${recordingId}/generation/${index}`,
    createdAt: "2026-10-05T00:00:00Z", uploadedAt: index === 0 ? "2026-10-05T00:00:00Z" : null
  }));
  const repository: DurableAudioRepository = {
    listForOwner: vi.fn(async () => rows), markUploaded: vi.fn(async () => {}),
    put: vi.fn(async () => {}), deleteGeneration: vi.fn(async () => {})
  };
  return { rows, repository };
}
describe("legacy live recovery", () => {
  it("rechecks only diagnosed gaps despite historical local confirmations, after full preparation", async () => {
    const { rows, repository } = fixture();
    rows.forEach((row) => { row.uploadedAt = "2026-10-05T00:00:00Z"; });
    const prepareManifest = vi.fn(async () => {});
    const uploadPart = vi.fn(async (_part: DurableAudioPartRecord) => { expect(prepareManifest).toHaveBeenCalledOnce(); });
    const result = await resumeDurableSafetyPartsForOwner({ ownerId: "owner", repository, prepareManifest,
      shouldReverifyPart: (part) => part.index === 1 || part.index >= 2, uploadPart });
    expect(uploadPart.mock.calls.map(([part]) => part.index)).toEqual([1, 2]);
    expect(result.failed).toEqual([]);
    expect(repository.deleteGeneration).not.toHaveBeenCalled();
    expect(rows[0].uploadedAt).toBe("2026-10-05T00:00:00Z");
  });
  it("retains failed historical confirmation and retries its registered gap after adoption", async () => {
    const { rows, repository } = fixture();
    rows.forEach((row) => { row.uploadedAt = "2026-10-05T00:00:00Z"; });
    const prepareManifest = vi.fn(async () => {});
    const uploadPart = vi.fn(async (_part: DurableAudioPartRecord) => {});
    uploadPart.mockRejectedValueOnce(new Error("offline"));
    const input = { ownerId: "owner", repository, prepareManifest,
      shouldReverifyPart: (part: DurableAudioPartRecord) => part.index === 1, uploadPart };
    const failed = await resumeDurableSafetyPartsForOwner(input);
    expect(failed.failed).toEqual([rows[1].key]);
    expect(rows[1].uploadedAt).toBe("2026-10-05T00:00:00Z");
    expect(repository.markUploaded).not.toHaveBeenCalled();
    const retry = await resumeDurableSafetyPartsForOwner(input);
    expect(retry.failed).toEqual([]);
    expect(retry.promoted).toEqual([rows[1].key]);
    expect(repository.deleteGeneration).not.toHaveBeenCalled();
  });
  it("adopts the full expected manifest including already uploaded parts before pending upload", async () => {
    const { repository } = fixture();
    const rpc = vi.fn(async () => ({ data: { recordingId, status: "uploading", captureRevision: 0 }, error: null }));
    mocks.createClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, rpc });
    const uploadPart = vi.fn(async () => { expect(rpc).toHaveBeenCalledWith("adopt_legacy_live_parts_v1", expect.anything()); });
    const result = await resumeDurableSafetyPartsForOwner({ ownerId: "owner", repository, prepareManifest: adoptLegacyLiveRecordingParts, uploadPart });
    expect(result.failed).toEqual([]);
    expect(uploadPart).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("adopt_legacy_live_parts_v1", {
      p_recording_id: recordingId, p_expected_capture_revision: 0,
      p_parts: [0, 1, 2].map((index) => ({ index, mimeType: "audio/webm", bytes: 4 }))
    });
  });
  it("retains all parts and prevents upload/confirmation when adoption is denied", async () => {
    const { repository } = fixture();
    const uploadPart = vi.fn(async () => {});
    const result = await resumeDurableSafetyPartsForOwner({ ownerId: "owner", repository,
      prepareManifest: async () => { throw new Error("denied"); }, uploadPart });
    expect(result.failed).toHaveLength(2);
    expect(uploadPart).not.toHaveBeenCalled();
    expect(repository.markUploaded).not.toHaveBeenCalled();
    expect(repository.deleteGeneration).not.toHaveBeenCalled();
  });
  it("rejects changed blob metadata before calling adoption", async () => {
    const { repository } = fixture();
    const [manifest] = await listDurableSafetyManifestsForOwner({ ownerId: "owner", repository });
    manifest.parts[1].size = 5;
    mocks.createClient.mockClear();
    await expect(adoptLegacyLiveRecordingParts(manifest)).rejects.toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
