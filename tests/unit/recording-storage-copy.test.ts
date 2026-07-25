import { describe, expect, it } from "vitest";
import {
  getLiveAudioStorageCopy,
  getManualUploadStorageCopy,
  getUnavailableRecordingStorageCopy
} from "@/lib/recordings/storage-copy";

describe("recording Storage copy", () => {
  it("describes the live audio policy separately from the connected bucket limit", () => {
    expect(getLiveAudioStorageCopy(128 * 1024 * 1024)).toBe(
      "Audio se uloží do 128 MB. Přepis se uloží vždy."
    );
  });

  it("uses the connected bucket limit for manually uploaded files", () => {
    expect(getManualUploadStorageCopy(500 * 1024 * 1024)).toBe(
      "Soubor můžete nahrát do 500 MB."
    );
  });

  it("keeps transcript-only paths understandable when the limit is unavailable", () => {
    expect(getLiveAudioStorageCopy(null)).toBe("Přepis se uloží vždy; audio se teď neukládá.");
    expect(getManualUploadStorageCopy(null)).toBe(getUnavailableRecordingStorageCopy());
    expect(getUnavailableRecordingStorageCopy()).toBe(
      "Audio soubory teď nelze ukládat. Live přepis i vložení hotového přepisu fungují dál."
    );
  });
});
