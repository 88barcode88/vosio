import { describe, expect, it } from "vitest";
import { getRecordingStorageLimitSummary } from "@/lib/recordings/storage-copy";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

describe("recording Storage copy", () => {
  it("shows that the Free preference tightens a larger configured bucket", () => {
    expect(
      getRecordingStorageLimitSummary(
        {
          allowedMimeTypes: ["audio/mpeg"],
          bucketMaxFileSizeBytes: 100 * MEBIBYTE,
          detectedGlobalMaxFileSizeBytes: null,
          maxFileSizeBytes: 50 * MEBIBYTE,
          planMaxFileSizeBytes: 50 * MEBIBYTE
        },
        "free"
      )
    ).toEqual({
      bucketLimit: "100 MB",
      globalLimit: "Nezjištěn",
      liveAudioLimit: "50 MB",
      manualUploadLimit: "50 MB",
      planLabel: "Free",
      warning: "Globální limit projektu nelze bezpečně zjistit. Preference Free proto upload zpřísňuje na 50 MB; Supabase konfiguraci nemění."
    });
  });

  it("makes a low configured bucket visible for a paid preference", () => {
    expect(
      getRecordingStorageLimitSummary(
        {
          allowedMimeTypes: ["audio/mpeg"],
          bucketMaxFileSizeBytes: 50 * MEBIBYTE,
          detectedGlobalMaxFileSizeBytes: null,
          maxFileSizeBytes: 50 * MEBIBYTE,
          planMaxFileSizeBytes: 500 * GIBIBYTE
        },
        "paid"
      )
    ).toMatchObject({
      bucketLimit: "50 MB",
      liveAudioLimit: "50 MB",
      manualUploadLimit: "50 MB",
      planLabel: "Paid",
      warning: "Je vybraný placený tarif, ale bucket recordings je omezený na 50 MB. Preference Supabase konfiguraci nezvyšuje."
    });
  });

  it("keeps unavailable automatic limits explicit and fail-closed", () => {
    expect(
      getRecordingStorageLimitSummary(
        {
          allowedMimeTypes: null,
          bucketMaxFileSizeBytes: null,
          detectedGlobalMaxFileSizeBytes: null,
          maxFileSizeBytes: null,
          planMaxFileSizeBytes: null
        },
        "auto"
      )
    ).toMatchObject({
      bucketLimit: "Nezjištěn",
      globalLimit: "Nezjištěn",
      liveAudioLimit: "Nedostupný",
      manualUploadLimit: "Nedostupný",
      planLabel: "Auto"
    });
  });
});
