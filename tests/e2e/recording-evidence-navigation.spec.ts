import { expect, type Page, test } from "@playwright/test";

type FixtureMode = "single" | "none" | "segmented";

// openEvidenceFixture loads the real TranscriptTabs surface for one audio availability mode.
async function openEvidenceFixture(page: Page, mode: FixtureMode) {
  await page.goto(`/login/recording-evidence-e2e?mode=${mode}`);
  await expect(page.locator(`[data-e2e-evidence-mode="${mode}"]`)).toBeVisible();
}

// expectTranscriptEvidenceOpened verifies tab selection and containing-block highlight.
async function expectTranscriptEvidenceOpened(page: Page) {
  await expect(page.getByRole("tab", { name: "Přepis" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#transcript-at-8000")).toHaveAttribute("aria-current", "true");
}

test("single audio evidence seeks and plays from a direct click", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 60 });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    const fixtureWindow = window as typeof window & {
      __evidencePlayCalls?: number;
      __evidenceSeekSeconds?: number;
    };
    fixtureWindow.__evidencePlayCalls = 0;
    fixtureWindow.__evidenceSeekSeconds = 0;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => fixtureWindow.__evidenceSeekSeconds ?? 0,
      set: (value: number) => {
        fixtureWindow.__evidenceSeekSeconds = value;
      }
    });
    HTMLMediaElement.prototype.play = async function play() {
      fixtureWindow.__evidencePlayCalls = (fixtureWindow.__evidencePlayCalls ?? 0) + 1;
    };
  });
  await page.route("**/api/recordings/*/audio", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        expiresIn: 300,
        mimeType: "audio/wav",
        url: "https://media.vosio.test/evidence.wav"
      }
    });
  });
  await page.route("https://media.vosio.test/evidence.wav", async (route) => {
    await route.fulfill({
      body: Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", "base64"),
      contentType: "audio/wav"
    });
  });
  await openEvidenceFixture(page, "single");

  await page.getByRole("button", { name: "Otevřít v přepisu" }).click();

  await expectTranscriptEvidenceOpened(page);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __evidenceSeekSeconds?: number }).__evidenceSeekSeconds ?? 0
  )).toBe(8);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __evidencePlayCalls?: number }).__evidencePlayCalls ?? 0
  )).toBe(1);
});

test("transcript-only evidence scrolls and highlights without an audio player", async ({ page }) => {
  await openEvidenceFixture(page, "none");

  await page.getByRole("button", { name: "Otevřít v přepisu" }).click();

  await expectTranscriptEvidenceOpened(page);
  await expect(page.locator("audio")).toHaveCount(0);
});

test("legacy segmented evidence resolves at runtime without attempting audio playback", async ({ page }) => {
  await openEvidenceFixture(page, "segmented");
  await expect(page.getByText('"Schvalili jsme termin"')).toBeVisible();

  await page.getByRole("button", { name: "Otevřít v přepisu" }).click();

  await expectTranscriptEvidenceOpened(page);
  await expect(page.locator("audio")).toHaveCount(0);
});
