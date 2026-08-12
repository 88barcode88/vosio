import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicEnv, getPublicEnvironmentIssues } from "@/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

// configurePublicEnvironment provides valid fake public values for each isolated test.
function configurePublicEnvironment() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
}

describe("public environment diagnostics", () => {
  it("returns only the exact missing public variable names", () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "  ");

    expect(getPublicEnvironmentIssues()).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    ]);
  });

  it("treats an invalid public URL as an issue without exposing its value", () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url-secret-marker");

    const serialized = JSON.stringify(getPublicEnvironmentIssues());

    expect(getPublicEnvironmentIssues()).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(serialized).not.toContain("not-a-url-secret-marker");
  });

  it.each([
    "ftp://example.supabase.co",
    "javascript:alert('secret-marker')",
    "data:text/plain,secret-marker"
  ])("rejects the unsupported public URL scheme in %s", (unsupportedUrl) => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", unsupportedUrl);

    expect(getPublicEnvironmentIssues()).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(() => getPublicEnv()).toThrow("Missing or invalid public Supabase environment variables.");
  });

  it("keeps an HTTP localhost Supabase URL valid for local development", () => {
    configurePublicEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");

    expect(getPublicEnvironmentIssues()).toEqual([]);
    expect(getPublicEnv().supabaseUrl).toBe("http://127.0.0.1:54321");
  });

  it("returns no issues for healthy public configuration and keeps strict parsing", () => {
    configurePublicEnvironment();

    expect(getPublicEnvironmentIssues()).toEqual([]);
    expect(getPublicEnv()).toEqual({
      supabasePublishableKey: "test-publishable-key",
      supabaseUrl: "https://example.supabase.co"
    });
  });
});
