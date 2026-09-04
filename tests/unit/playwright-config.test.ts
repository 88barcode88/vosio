import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Playwright isolated project configuration", () => {
  it("uses the runner-owned ready server without Playwright webServer teardown", async () => {
    const workspace = path.join(process.cwd(), ".tmp", "next-playwright-Ab12Cd");
    vi.stubEnv("PLAYWRIGHT_PORT", "3171");
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "");
    vi.stubEnv("VOSIO_PLAYWRIGHT_PROJECT_ROOT", workspace);
    vi.stubEnv("VOSIO_PLAYWRIGHT_RUNNER", "1");
    vi.stubEnv("VOSIO_PLAYWRIGHT_SERVER_READY", "1");
    const config = (await import("../../playwright.config")).default;

    expect(config.globalTeardown).toBeUndefined();
    expect(config.use?.baseURL).toBe("http://127.0.0.1:3171");
    expect(config.webServer).toBeUndefined();
  });

  it("rejects a runner invocation before its owned server is ready", async () => {
    vi.stubEnv("VOSIO_PLAYWRIGHT_PROJECT_ROOT", path.join(process.cwd(), ".tmp", "next-playwright-Ab12Cd"));
    vi.stubEnv("VOSIO_PLAYWRIGHT_RUNNER", "1");
    vi.stubEnv("VOSIO_PLAYWRIGHT_SERVER_READY", "");

    await expect(import("../../playwright.config"))
      .rejects.toThrow("owned Next server");
  });

  it("rejects direct Playwright invocation without the outer runner", async () => {
    vi.stubEnv("VOSIO_PLAYWRIGHT_RUNNER", "");

    await expect(import("../../playwright.config"))
      .rejects.toThrow("npm run test:e2e");
  });

  it("rejects the removed external base URL mode", async () => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "http://127.0.0.1:9999");
    vi.stubEnv("VOSIO_PLAYWRIGHT_RUNNER", "1");

    await expect(import("../../playwright.config"))
      .rejects.toThrow("PLAYWRIGHT_BASE_URL is not supported");
  });
});
