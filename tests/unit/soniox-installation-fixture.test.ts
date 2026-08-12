import { describe, expect, it } from "vitest";
import { validateSonioxInstallationFixtureAccess } from "../../app/login/soniox-installation-e2e/development-runtime";

describe("Soniox installation E2E fixture boundary", () => {
  it("accepts only scoped development access", () => {
    expect(validateSonioxInstallationFixtureAccess("development", "a1b2c3d4e5f6")).toEqual({
      scope: "a1b2c3d4e5f6"
    });
    expect(validateSonioxInstallationFixtureAccess("development", "invalid")).toBeNull();
    expect(validateSonioxInstallationFixtureAccess("production", "a1b2c3d4e5f6")).toBeNull();
  });
});
