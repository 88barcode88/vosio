import { describe, expect, it } from "vitest";
import {
  getLiveRecordingStoragePath,
  getLiveRecordingStoragePrefix,
  validateAudioFile
} from "@/lib/recordings/upload";
import { ACCEPTED_RECORDING_MIME_TYPES } from "@/lib/recordings/types";

describe("recording upload storage helpers", () => {
  it("creates one final live recording object path without segmenting it", () => {
    expect(
      getLiveRecordingStoragePath({
        extension: ".webm",
        storagePrefix: "user-id/recording-id/live/"
      })
    ).toBe("user-id/recording-id/live/recording.webm");
  });

  it("creates the live recording storage prefix under the user folder", () => {
    expect(getLiveRecordingStoragePrefix("user-id", "recording-id")).toBe(
      "user-id/recording-id/live/"
    );
  });

  it("validates each file against the detected bucket limit", () => {
    const sixtyMegabyteFile = {
      name: "call.webm",
      size: 60 * 1024 * 1024,
      type: "audio/webm"
    } as File;

    expect(validateAudioFile(sixtyMegabyteFile, 50 * 1024 * 1024, ACCEPTED_RECORDING_MIME_TYPES)).toBe(
      "Soubor je větší než 50 MB."
    );
    expect(validateAudioFile(sixtyMegabyteFile, 100 * 1024 * 1024, ACCEPTED_RECORDING_MIME_TYPES)).toBeNull();
  });

  it("rejects a generic MIME even when the extension is supported", () => {
    const phoneRecording = {
      name: "lucern-update-33mb.m4a",
      size: 33 * 1024 * 1024,
      type: "application/octet-stream"
    } as File;

    expect(validateAudioFile(phoneRecording, 50 * 1024 * 1024, ACCEPTED_RECORDING_MIME_TYPES)).toBe(
      "Soubor nemá podporovaný MIME typ. Vyberte M4A, MP3, WAV, WebM, OGG, FLAC nebo MP4."
    );
  });

  it.each(ACCEPTED_RECORDING_MIME_TYPES)("accepts bucket MIME %s without an extension fallback", (mimeType) => {
    const file = { name: "recording", size: 1024, type: mimeType } as File;

    expect(validateAudioFile(file, 50 * 1024 * 1024, ACCEPTED_RECORDING_MIME_TYPES)).toBeNull();
  });

  it("uses an inclusive maximum-size boundary", () => {
    const boundaryFile = {
      name: "call.m4a",
      size: 50 * 1024 * 1024,
      type: "audio/mp4"
    } as File;

    expect(validateAudioFile(boundaryFile, boundaryFile.size, ACCEPTED_RECORDING_MIME_TYPES)).toBeNull();
    expect(validateAudioFile(
      { ...boundaryFile, size: boundaryFile.size + 1 } as File,
      boundaryFile.size,
      ACCEPTED_RECORDING_MIME_TYPES
    )).toBe(
      "Soubor je větší než 50 MB."
    );
  });

  it("fails closed when the bucket limit is unavailable", () => {
    const file = {
      name: "call.webm",
      size: 1024,
      type: "audio/webm"
    } as File;

    expect(validateAudioFile(file, null, ACCEPTED_RECORDING_MIME_TYPES)).toBe(
      "Nahrávání souborů teď není dostupné."
    );
  });

  it("fails closed when the bucket MIME allowlist is unavailable", () => {
    const file = { name: "call.mp3", size: 1024, type: "audio/mpeg" } as File;

    expect(validateAudioFile(file, 50 * 1024 * 1024, null)).toBe(
      "Nahrávání souborů teď není dostupné."
    );
  });
});
