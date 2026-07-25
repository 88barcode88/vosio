import { describe, expect, it } from "vitest";
import { getSafeNextPath } from "@/lib/auth/redirects";

describe("getSafeNextPath", () => {
  it("keeps same-app paths including query strings", () => {
    expect(getSafeNextPath("/recordings/123?tab=ai")).toBe("/recordings/123?tab=ai");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(getSafeNextPath("https://example.com")).toBe("/");
    expect(getSafeNextPath("//example.com/login")).toBe("/");
  });

  it("falls back for missing or malformed values", () => {
    expect(getSafeNextPath(null)).toBe("/");
    expect(getSafeNextPath("recordings")).toBe("/");
  });
});
