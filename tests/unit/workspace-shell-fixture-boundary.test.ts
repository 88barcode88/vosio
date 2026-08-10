import { describe, expect, it } from "vitest";
import { isDevelopmentWorkspaceShellFixture } from "@/lib/supabase/proxy";

describe("workspace shell fixture boundary", () => {
  it("recognizes only the development-only fixture namespace", () => {
    expect(isDevelopmentWorkspaceShellFixture("/login/workspace-shell-e2e/settings", "development")).toBe(true);
    expect(isDevelopmentWorkspaceShellFixture("/login/workspace-shell-e2e-other/settings", "development")).toBe(false);
    expect(isDevelopmentWorkspaceShellFixture("/settings", "development")).toBe(false);
    expect(isDevelopmentWorkspaceShellFixture("/login/workspace-shell-e2e/settings", "production")).toBe(false);
  });
});
