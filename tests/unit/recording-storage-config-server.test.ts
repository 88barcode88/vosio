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

describe("recording storage config server query", () => {
  beforeEach(() => {
    getBucket.mockReset();
  });

  it("loads the current limit from the recordings bucket", async () => {
    getBucket.mockResolvedValue({
      data: { file_size_limit: 100 * 1024 * 1024 },
      error: null
    });

    await expect(getRecordingStorageConfig()).resolves.toEqual({
      maxFileSizeBytes: 100 * 1024 * 1024
    });
    expect(getBucket).toHaveBeenCalledWith("recordings");
  });

  it("does not guess a limit when the bucket query fails", async () => {
    getBucket.mockResolvedValue({
      data: null,
      error: new Error("bucket unavailable")
    });

    await expect(getRecordingStorageConfig()).resolves.toEqual({
      maxFileSizeBytes: null
    });
  });
});
