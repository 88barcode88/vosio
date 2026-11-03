import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getInstallationStatus } from "@/lib/installation-status.server";
import { getAiProviderConfigurationError } from "@/lib/env.server";

const REQUIRED_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SONIOX_API_KEY",
  "OPENAI_API_KEY"
] as const;

beforeEach(() => {
  vi.stubEnv("SONIOX_ASYNC_MODEL", "");
});

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
  it("names the configured file transcription model without treating it as a secret", () => {
    vi.stubEnv("SONIOX_ASYNC_MODEL", "stt-async-v5");
    expect(getInstallationStatus().fileTranscriptionModel).toBe("stt-async-v5");
  });

  it("keeps Mistral optional while returning fixed setup guidance when its key is missing", () => {
    configureRequiredEnvironment();
    vi.stubEnv("MISTRAL_API_KEY", "");

    expect(getInstallationStatus()).toMatchObject({ mistralConfigured: false, ready: true });
    expect(getAiProviderConfigurationError("mistral")).toBe(
      "Mistral není nakonfigurovaný. Přidejte MISTRAL_API_KEY ve Vercelu, nebo zvolte jiný dostupný model."
    );
  });

  it("returns a ready Preview status without making optional Gemini required", () => {
    configureRequiredEnvironment();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("MISTRAL_API_KEY", "");

    expect(getInstallationStatus()).toEqual({
      environment: "preview",
      fileTranscriptionModel: "stt-async-v6",
      geminiConfigured: false,
      mistralConfigured: false,
      missingRequiredNames: [],
      ready: true
    });
  });

  it("reports only missing required names and the optional Gemini state", () => {
    configureRequiredEnvironment();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "  ");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "optional-test-secret");
    vi.stubEnv("MISTRAL_API_KEY", "optional-mistral-secret");
    vi.stubEnv("VERCEL_ENV", "development");

    expect(getInstallationStatus()).toEqual({
      environment: "development",
      fileTranscriptionModel: "stt-async-v6",
      geminiConfigured: true,
      mistralConfigured: true,
      missingRequiredNames: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "OPENAI_API_KEY"],
      ready: false
    });
  });

  it("falls back to a safe NODE_ENV enum and never returns configuration values", () => {
    configureRequiredEnvironment();
    vi.stubEnv("VERCEL_ENV", "unexpected-environment");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "gemini-secret-that-must-not-leak");
    vi.stubEnv("MISTRAL_API_KEY", "mistral-secret-that-must-not-leak");

    const status = getInstallationStatus();
    const serialized = JSON.stringify(status);

    expect(status.environment).toBe("production");
    expect(Object.keys(status).sort()).toEqual([
      "environment",
      "fileTranscriptionModel",
      "geminiConfigured",
      "missingRequiredNames",
      "mistralConfigured",
      "ready"
    ]);
    expect(serialized).not.toContain("test-secret");
    expect(serialized).not.toContain("gemini-secret-that-must-not-leak");
    expect(serialized).not.toContain("mistral-secret-that-must-not-leak");
  });

  it("uses unknown for unsupported runtime environment values", () => {
    configureRequiredEnvironment();
    vi.stubEnv("VERCEL_ENV", "custom");
    vi.stubEnv("NODE_ENV", "test");

    expect(getInstallationStatus().environment).toBe("unknown");
  });
});
