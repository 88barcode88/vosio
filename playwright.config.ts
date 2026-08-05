import { defineConfig, devices } from "@playwright/test";
import { assertIsolatedPlaywrightWorkspace } from "./scripts/isolated-playwright-workspace.mjs";

// getPlaywrightPort validates the optional isolated dev-server port used by concurrent test runs.
function getPlaywrightPort() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    throw new Error(
      "PLAYWRIGHT_BASE_URL is not supported; use PLAYWRIGHT_PORT with the owned isolated server."
    );
  }
  const value = process.env.PLAYWRIGHT_PORT ?? "3047";
  const port = Number(value);
  if (!/^\d{4,5}$/u.test(value) || !Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("PLAYWRIGHT_PORT must be an integer between 1024 and 65535.");
  }
  return port;
}

if (process.env.VOSIO_PLAYWRIGHT_RUNNER !== "1") {
  throw new Error("Run Playwright through `npm run test:e2e` so its Next project is isolated.");
}

const playwrightPort = getPlaywrightPort();
const isolatedProjectRoot = assertIsolatedPlaywrightWorkspace(
  process.cwd(),
  process.env.VOSIO_PLAYWRIGHT_PROJECT_ROOT ?? ""
);
const nextProjectArgument = isolatedProjectRoot.replaceAll("\\", "/");
const playwrightBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const isolatedDevCommand = `node node_modules/next/dist/bin/next dev "${nextProjectArgument}" --hostname 127.0.0.1 --port ${playwrightPort}`;

export default defineConfig({
  expect: {
    timeout: 10_000
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/e2e",
  use: {
    baseURL: playwrightBaseUrl,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure"
  },
  webServer: {
    command: isolatedDevCommand,
    reuseExistingServer: false,
    timeout: 120_000,
    url: playwrightBaseUrl
  },
  workers: process.env.CI ? 1 : undefined,
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome"
      }
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        channel: "chrome"
      }
    }
  ]
});
