import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBucket } = vi.hoisted(() => ({
  getBucket: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { getBucket }
  })
}));

import { getRecordingStorageConfig } from "@/lib/recordings/storage-config.server";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

describe("recording storage config server query", () => {
  beforeEach(() => {
    getBucket.mockReset();
  });

  it("applies the Free ceiling to the recordings bucket limit", async () => {
    getBucket.mockResolvedValue({
      data: { file_size_limit: 100 * MEBIBYTE },
      error: null
    });

    await expect(getRecordingStorageConfig("free")).resolves.toEqual({
      bucketMaxFileSizeBytes: 100 * MEBIBYTE,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: 50 * MEBIBYTE,
      planMaxFileSizeBytes: 50 * MEBIBYTE
    });
    expect(getBucket).toHaveBeenCalledWith("recordings");
  });

  it("fails closed while retaining the paid-plan ceiling when the bucket query fails", async () => {
    getBucket.mockResolvedValue({
      data: null,
      error: new Error("bucket unavailable")
    });

    await expect(getRecordingStorageConfig("paid")).resolves.toEqual({
      bucketMaxFileSizeBytes: null,
      detectedGlobalMaxFileSizeBytes: null,
      maxFileSizeBytes: null,
      planMaxFileSizeBytes: 500 * GIBIBYTE
    });
  });
});
