import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDevelopmentRecordingFactoryAllowed } from "@/components/browser-recorder/development-runtime";
import type { DevelopmentRecordingFactory } from "@/components/browser-recorder/types";

const factory = (() => ({})) as unknown as DevelopmentRecordingFactory;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browser recorder development runtime", () => {
  it.each(["production", "test"])("rejects a fixture factory in %s", (environment) => {
    vi.stubEnv("NODE_ENV", environment);

    expect(() => assertDevelopmentRecordingFactoryAllowed(factory))
      .toThrow("development-only");
  });

  it("allows the production default and a factory only in development", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertDevelopmentRecordingFactoryAllowed(undefined)).not.toThrow();

    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertDevelopmentRecordingFactoryAllowed(factory)).not.toThrow();
  });
});
