import { describe, expect, it } from "vitest";
import { buildDownloadFileName } from "@/lib/recordings/audio-download-name";

describe("buildDownloadFileName", () => {
  it("uses the recording title without diacritics and keeps the stored extension", () => {
    expect(buildDownloadFileName("Honza update 3.11 – Příprava", "u/r/recording.webm")).toBe("Honza-update-3.11-Priprava.webm");
  });

  it("falls back to a neutral name for empty or unsafe titles", () => {
    expect(buildDownloadFileName("", "u/r/recording.m4a")).toBe("nahravka.m4a");
    expect(buildDownloadFileName("../..//", "u/r/recording.m4a")).toBe("nahravka.m4a");
    expect(buildDownloadFileName(null, "u/r/noext")).toBe("nahravka");
  });

  it("limits the base name length", () => {
    expect(buildDownloadFileName("a".repeat(200), "u/r/x.webm")).toBe(`${"a".repeat(80)}.webm`);
  });
});
