import { defineConfig, devices } from "@playwright/test";

const isWindows = process.platform === "win32";

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
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3047",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure"
  },
  webServer: {
    command: isWindows ? "npm.cmd run dev" : "npm run dev",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3047"
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
