// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSafeUploadFailureMessage,
  RecordingUploadForm
} from "@/components/recording-upload-form";
import { ACCEPTED_RECORDING_MIME_TYPES } from "@/lib/recordings/types";

const uploadFormProps = {
  allowedMimeTypes: ACCEPTED_RECORDING_MIME_TYPES,
  maxFileSizeBytes: 50 * 1024 * 1024
};

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  uploadRecording: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh })
}));

vi.mock("@/components/recording-navigation-guard", () => ({
  useRecordingNavigationBlocker: () => ({ registerNavigationBlocker: () => vi.fn() })
}));

vi.mock("@/lib/recordings/upload", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/recordings/upload")>();
  return { ...original, uploadRecording: mocks.uploadRecording };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.uploadRecording.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

// chooseFiles sends a browser-like file selection through the real hidden upload input.
async function chooseFiles(...files: File[]) {
  const input = container.querySelector<HTMLInputElement>("input[accept]");
  if (!input) throw new Error("Missing filtered upload input");
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

describe("recording upload form UI", () => {
  it("keeps a stable labelled status surface before and after a successful upload", async () => {
    mocks.uploadRecording.mockImplementation(async (input) => {
      input.onPhase?.("transferring");
      input.onProgress?.({ bytesSent: 17 * 1024 * 1024, bytesTotal: 33 * 1024 * 1024, percentage: 52 });
      input.onPhase?.("finalizing");
      return { id: "recording-id", storagePath: "safe/path" };
    });
    await act(async () => root.render(
      <RecordingUploadForm
        {...uploadFormProps}
        redirectAfterUpload="detail"
      />
    ));

    const statusSurface = container.querySelector("[data-upload-status]");
    expect(statusSurface).not.toBeNull();
    expect(statusSurface?.textContent).toContain("Limit 50 MB");
    expect(statusSurface?.textContent).toContain("Zatím nebyl vybrán soubor");
    expect(container.textContent).toContain("M4A, MP3, WAV, WebM, OGG, FLAC a MP4");
    expect(container.querySelectorAll("input[type='file']")).toHaveLength(1);
    expect(container.textContent).not.toContain("Vybrat jiný typ");

    await chooseFiles(new File([new Uint8Array(33)], "lucern-update.m4a", { type: "audio/mp4" }));

    expect(statusSurface?.textContent).toContain("lucern-update.m4a");
    expect(statusSurface?.textContent).toContain("Nahrávka je uložená");
    expect(statusSurface?.getAttribute("data-phase")).toBe("success");
    expect(mocks.push).toHaveBeenCalledWith("/recordings/recording-id");
  });

  it("offers retry in the same status surface after a safe upload error", async () => {
    mocks.uploadRecording
      .mockRejectedValueOnce(new Error("Nahrání souboru se nepodařilo. Zkuste to znovu."))
      .mockResolvedValueOnce({ id: "retry-id", storagePath: "safe/path" });
    await act(async () => root.render(<RecordingUploadForm {...uploadFormProps} />));

    await chooseFiles(new File(["audio"], "retry.mp3", { type: "audio/mpeg" }));
    expect(container.querySelector("[data-upload-status]")?.getAttribute("data-phase")).toBe("error");
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Zkusit znovu"));
    expect(retry).toBeDefined();

    await act(async () => retry?.click());
    expect(mocks.uploadRecording).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-upload-status]")?.getAttribute("data-phase")).toBe("success");
  });

  it("routes dropped audio through the same upload transport", async () => {
    mocks.uploadRecording.mockResolvedValue({ id: "drop-id", storagePath: "safe/path" });
    await act(async () => root.render(<RecordingUploadForm {...uploadFormProps} redirectAfterUpload="detail" />));
    const dropzone = container.querySelector<HTMLElement>(".upload-dropzone");
    const droppedFile = new File(["audio"], "drop.mp3", { type: "audio/mpeg" });
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { files: [droppedFile] } });

    await act(async () => dropzone?.dispatchEvent(dropEvent));

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(mocks.uploadRecording).toHaveBeenCalledWith(expect.objectContaining({ file: droppedFile }));
    expect(mocks.push).toHaveBeenCalledWith("/recordings/drop-id");
  });

  it("replaces unexpected provider details with safe user-facing copy", () => {
    expect(getSafeUploadFailureMessage(new Error("bucket-internal: request id secret-detail"))).toBe(
      "Nahrání souboru se nepodařilo. Zkuste to znovu."
    );
    expect(
      getSafeUploadFailureMessage(
        new Error("Nahrání souboru se nepodařilo. Zkuste to znovu. request-id=secret-123")
      )
    ).toBe("Nahrání souboru se nepodařilo. Zkuste to znovu.");
  });

  it("clears stale progress before showing a newly selected invalid file", async () => {
    mocks.uploadRecording.mockImplementation(async (input) => {
      input.onProgress?.({ bytesSent: input.file.size, bytesTotal: input.file.size, percentage: 100 });
      return { id: "first-id", storagePath: "safe/path" };
    });
    await act(async () => root.render(<RecordingUploadForm {...uploadFormProps} redirectAfterUpload="stay" />));

    await chooseFiles(new File(["audio"], "first.mp3", { type: "audio/mpeg" }));
    expect(container.querySelector<HTMLProgressElement>("progress")?.value).toBeGreaterThan(0);
    await chooseFiles(new File(["bad"], "invalid.exe", { type: "application/octet-stream" }));

    expect(container.querySelector("[data-upload-status]")?.getAttribute("data-phase")).toBe("error");
    expect(container.querySelector<HTMLProgressElement>("progress")?.value).toBe(0);
    expect(container.querySelector("[data-upload-status]")?.textContent).toContain("invalid.exe");
  });

  it("cancels the active transport and exposes a retryable cancelled state", async () => {
    mocks.uploadRecording.mockImplementation((input) => new Promise((_resolve, reject) => {
      const cancellation = new Error("Nahrávání bylo zrušeno.");
      cancellation.name = "RecordingUploadCancelledError";
      input.onResumableUploadTask?.({
        cancel: () => reject(cancellation),
        done: Promise.resolve()
      });
    }));
    await act(async () => root.render(<RecordingUploadForm {...uploadFormProps} />));
    await chooseFiles(new File(["audio"], "cancel.mp3", { type: "audio/mpeg" }));

    const cancel = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Zrušit nahrávání"));
    expect(cancel).toBeDefined();
    await act(async () => cancel?.click());

    expect(container.querySelector("[data-upload-status]")?.getAttribute("data-phase")).toBe("cancelled");
    expect(container.textContent).toContain("Nahrávání bylo zrušeno");
    expect(container.textContent).toContain("Zkusit znovu");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps partial batch success on the list contract without a false detail redirect", async () => {
    mocks.uploadRecording.mockImplementation(async (input) => {
      if (input.file.name === "second.mp3") {
        throw new Error("Nahrání souboru se nepodařilo. Zkuste to znovu.");
      }
      return { id: "first-id", storagePath: "safe/path" };
    });
    await act(async () => root.render(<RecordingUploadForm {...uploadFormProps} redirectAfterUpload="detail" />));

    await chooseFiles(
      new File(["first"], "first.mp3", { type: "audio/mpeg" }),
      new File(["second"], "second.mp3", { type: "audio/mpeg" })
    );

    const status = container.querySelector("[data-upload-status]");
    expect(status?.getAttribute("data-phase")).toBe("error");
    expect(status?.textContent).toContain("Uloženo 1 z 2 nahrávek");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Zkusit znovu");
  });
});
