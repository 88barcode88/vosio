import { describe, expect, it } from "vitest";
import {
  getLiveRecordingStoragePath,
  getLiveRecordingStoragePrefix,
  validateAudioFile
} from "@/lib/recordings/upload";

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

    expect(validateAudioFile(sixtyMegabyteFile, 50 * 1024 * 1024)).toBe(
      "Soubor je větší než 50 MB."
    );
    expect(validateAudioFile(sixtyMegabyteFile, 100 * 1024 * 1024)).toBeNull();
  });

  it("fails closed when the bucket limit is unavailable", () => {
    const file = {
      name: "call.webm",
      size: 1024,
      type: "audio/webm"
    } as File;

    expect(validateAudioFile(file, null)).toBe(
      "Nahrávání souborů teď není dostupné."
    );
  });
});
