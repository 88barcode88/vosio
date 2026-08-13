import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createResumableRecordingUpload: vi.fn()
}));

vi.mock("@/lib/supabase/browser", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recordings/resumable-upload", () => {
  class RecordingUploadCancelledError extends Error {
    constructor() {
      super("Nahrávání bylo zrušeno.");
      this.name = "RecordingUploadCancelledError";
    }
  }

  return {
    createResumableRecordingUpload: mocks.createResumableRecordingUpload,
    RecordingUploadCancelledError
  };
});

import { RecordingUploadCancelledError } from "@/lib/recordings/resumable-upload";
import { uploadRecording } from "@/lib/recordings/upload";

function createUploadHarness(updateErrors: Array<{ message: string } | null> = []) {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const recordingsQuery = {
    insert: vi.fn((row: Record<string, unknown>) => {
      insertedRows.push(row);

      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: "recording-id" }, error: null }))
        }))
      };
    }),
    update: vi.fn((row: Record<string, unknown>) => {
      updatedRows.push(row);

      return {
        eq: vi.fn(async () => ({ error: updateErrors.shift() ?? null }))
      };
    })
  };
  mocks.createClient.mockReturnValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-id" } }, error: null })) },
    from: vi.fn(() => recordingsQuery)
  });

  return { insertedRows, updatedRows };
}

describe("uploadRecording resumable upload contract", () => {
  it("rejects a generic MIME before auth, metadata creation, or TUS transfer", async () => {
    const harness = createUploadHarness();

    await expect(
      uploadRecording({
        allowedMimeTypes: ["audio/mp4"],
        file: { name: "call.m4a", size: 42, type: "application/octet-stream" } as File,
        maxFileSizeBytes: 100,
        sourceType: "upload"
      })
    ).rejects.toThrow("Soubor nemá podporovaný MIME typ");

    expect(harness.insertedRows).toEqual([]);
    expect(mocks.createResumableRecordingUpload).not.toHaveBeenCalled();
  });

  it("creates metadata before TUS transfer, clears its task, and then finalizes the row", async () => {
    const harness = createUploadHarness();
    const task = { cancel: vi.fn(), done: Promise.resolve() };
    const phases: string[] = [];
    const controls: unknown[] = [];
    mocks.createResumableRecordingUpload.mockReturnValue(task);

    const result = await uploadRecording({
      allowedMimeTypes: ["audio/webm"],
      file: { name: "call.webm", size: 42, type: "audio/webm" } as File,
      maxFileSizeBytes: 100,
      onPhase: (phase) => phases.push(phase),
      onResumableUploadTask: (control) => controls.push(control),
      sourceType: "upload"
    });

    expect(harness.insertedRows).toEqual([
      expect.objectContaining({ status: "uploading", user_id: "user-id" })
    ]);
    expect(mocks.createResumableRecordingUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "audio/webm",
        objectName: expect.stringMatching(/^user-id\/recording-id\//)
      })
    );
    expect(controls).toEqual([task, null]);
    expect(phases).toEqual(["transferring", "finalizing"]);
    expect(harness.updatedRows).toEqual([
      { status: "uploaded", storage_path: result.storagePath }
    ]);
  });

  it("marks the created row failed and preserves deliberate cancellation", async () => {
    const harness = createUploadHarness();
    const cancellation = new RecordingUploadCancelledError();
    mocks.createResumableRecordingUpload.mockReturnValue({
      cancel: vi.fn(),
      done: Promise.reject(cancellation)
    });

    await expect(
      uploadRecording({
        allowedMimeTypes: ["audio/webm"],
        file: { name: "call.webm", size: 42, type: "audio/webm" } as File,
        maxFileSizeBytes: 100,
        sourceType: "upload"
      })
    ).rejects.toBe(cancellation);

    expect(harness.updatedRows).toEqual([
      { error_message: "Nahrávání bylo zrušeno.", status: "failed" }
    ]);
  });

  it("surfaces failed cancellation persistence while preserving cancellation identity", async () => {
    const harness = createUploadHarness([{ message: "failed-state unavailable" }]);
    const cancellation = new RecordingUploadCancelledError();
    mocks.createResumableRecordingUpload.mockReturnValue({
      cancel: vi.fn(),
      done: Promise.reject(cancellation)
    });

    await expect(
      uploadRecording({
        allowedMimeTypes: ["audio/webm"],
        file: { name: "call.webm", size: 42, type: "audio/webm" } as File,
        maxFileSizeBytes: 100,
        sourceType: "upload"
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "failed-state unavailable" }),
      message: "Nahrávání bylo zrušeno. Záznam se nepodařilo označit jako neúspěšný.",
      name: "RecordingUploadCancelledError"
    });

    expect(harness.updatedRows).toEqual([
      { error_message: "Nahrávání bylo zrušeno.", status: "failed" }
    ]);
  });

  it("marks the row failed when post-transfer metadata finalization fails", async () => {
    const harness = createUploadHarness([{ message: "metadata unavailable" }, null]);
    mocks.createResumableRecordingUpload.mockReturnValue({
      cancel: vi.fn(),
      done: Promise.resolve()
    });

    await expect(
      uploadRecording({
        allowedMimeTypes: ["audio/webm"],
        file: { name: "call.webm", size: 42, type: "audio/webm" } as File,
        maxFileSizeBytes: 100,
        sourceType: "upload"
      })
    ).rejects.toThrow("Soubor je uložený, ale metadata se neuložila.");

    expect(harness.updatedRows).toEqual([
      expect.objectContaining({ status: "uploaded" }),
      {
        error_message: "Soubor je uložený, ale metadata se neuložila.",
        status: "failed"
      }
    ]);
  });

  it("reports when the failed-state recovery update also returns an error", async () => {
    const harness = createUploadHarness([
      { message: "metadata unavailable" },
      { message: "failed-state unavailable" }
    ]);
    mocks.createResumableRecordingUpload.mockReturnValue({
      cancel: vi.fn(),
      done: Promise.resolve()
    });

    await expect(
      uploadRecording({
        allowedMimeTypes: ["audio/webm"],
        file: { name: "call.webm", size: 42, type: "audio/webm" } as File,
        maxFileSizeBytes: 100,
        sourceType: "upload"
      })
    ).rejects.toThrow(
      "Soubor je uložený, ale metadata se neuložila. Záznam se nepodařilo označit jako neúspěšný."
    );

    expect(harness.updatedRows).toEqual([
      expect.objectContaining({ status: "uploaded" }),
      {
        error_message: "Soubor je uložený, ale metadata se neuložila.",
        status: "failed"
      }
    ]);
  });
});
