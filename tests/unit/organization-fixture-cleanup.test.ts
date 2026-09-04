import { describe, expect, it, vi } from "vitest";
import { cleanupOrganizationFixture } from "../e2e/support/organization-fixture-cleanup";

// response builds the minimal Playwright response contract used by the cleanup helper.
function response(status: number) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status
  };
}

describe("organization fixture cleanup", () => {
  it("retries one ECONNRESET and encodes the exact scope", async () => {
    const deleteRequest = vi.fn()
      .mockRejectedValueOnce(new Error("apiRequestContext.delete: read ECONNRESET"))
      .mockResolvedValueOnce(response(200));

    await cleanupOrganizationFixture({ delete: deleteRequest }, "scope with&delimiters");

    expect(deleteRequest).toHaveBeenCalledTimes(2);
    expect(deleteRequest).toHaveBeenNthCalledWith(
      1,
      "/login/recording-organization-e2e/fixture?scope=scope%20with%26delimiters"
    );
    expect(deleteRequest).toHaveBeenNthCalledWith(
      2,
      "/login/recording-organization-e2e/fixture?scope=scope%20with%26delimiters"
    );
  });

  it.each([400, 500])("fails immediately for HTTP %s", async (status) => {
    const deleteRequest = vi.fn().mockResolvedValue(response(status));

    await expect(cleanupOrganizationFixture({ delete: deleteRequest }, "abcdef12345"))
      .rejects.toThrow(`Organization fixture cleanup failed with HTTP ${status}.`);
    expect(deleteRequest).toHaveBeenCalledTimes(1);
  });

  it("does not retry another transport error", async () => {
    const deleteRequest = vi.fn().mockRejectedValue(new Error("read ETIMEDOUT"));

    await expect(cleanupOrganizationFixture({ delete: deleteRequest }, "abcdef12345"))
      .rejects.toThrow("read ETIMEDOUT");
    expect(deleteRequest).toHaveBeenCalledTimes(1);
  });
});
