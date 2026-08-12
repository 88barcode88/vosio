import { afterEach, describe, expect, it, vi } from "vitest";
import { getInstallationStatus } from "@/lib/installation-status.server";

const REQUIRED_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SONIOX_API_KEY",
  "OPENAI_API_KEY"
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

// configureRequiredEnvironment sets complete fake credentials without using real installation secrets.
function configureRequiredEnvironment() {
  for (const [index, name] of REQUIRED_NAMES.entries()) {
    vi.stubEnv(name, `test-secret-${index + 1}`);
  }
}

describe("installation status", () => {
  it("returns a ready Preview status without making optional Gemini required", () => {
    configureRequiredEnvironment();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("GEMINI_API_KEY", "");

    expect(getInstallationStatus()).toEqual({
      environment: "preview",
      geminiConfigured: false,
      missingRequiredNames: [],
      ready: true
    });
  });

  it("reports only missing required names and the optional Gemini state", () => {
    configureRequiredEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "  ");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "optional-test-secret");
    vi.stubEnv("VERCEL_ENV", "development");

    expect(getInstallationStatus()).toEqual({
      environment: "development",
      geminiConfigured: true,
      missingRequiredNames: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "OPENAI_API_KEY"],
      ready: false
    });
  });

  it("falls back to a safe NODE_ENV enum and never returns configuration values", () => {
    configureRequiredEnvironment();
    vi.stubEnv("VERCEL_ENV", "unexpected-environment");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "gemini-secret-that-must-not-leak");

    const status = getInstallationStatus();
    const serialized = JSON.stringify(status);

    expect(status.environment).toBe("production");
    expect(Object.keys(status).sort()).toEqual([
      "environment",
      "geminiConfigured",
      "missingRequiredNames",
      "ready"
    ]);
    expect(serialized).not.toContain("test-secret");
    expect(serialized).not.toContain("gemini-secret-that-must-not-leak");
  });

  it("uses unknown for unsupported runtime environment values", () => {
    configureRequiredEnvironment();
    vi.stubEnv("VERCEL_ENV", "custom");
    vi.stubEnv("NODE_ENV", "test");

    expect(getInstallationStatus().environment).toBe("unknown");
  });
});
