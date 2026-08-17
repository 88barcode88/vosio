import { expect, type Page, test } from "@playwright/test";

type FixtureMode = "single" | "none" | "segmented" | "untimed";

// openEvidenceFixture loads the real TranscriptTabs surface for one audio availability mode.
async function openEvidenceFixture(page: Page, mode: FixtureMode) {
  await page.goto(`/login/recording-evidence-e2e?mode=${mode}`);
  await expect(page.locator(`[data-e2e-evidence-mode="${mode}"]`)).toBeVisible();
}

// expectTranscriptEvidenceOpened verifies tab selection and containing-block highlight.
async function expectTranscriptEvidenceOpened(page: Page, anchor = "#transcript-at-8000") {
  await expect(page.getByRole("tab", { name: "Přepis" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(anchor)).toBeFocused();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __evidenceHighlightAnchors?: string[] }).__evidenceHighlightAnchors ?? []
  )).toContain(anchor.slice(1));
}

// openEvidenceQuote clicks the quote itself instead of adding a separate navigation button.
async function openEvidenceQuote(page: Page) {
  const evidence = page.getByRole("button", { name: /Důkaz: Schvalili jsme termin/u });
  await expect(evidence).toBeVisible();
  await expect(page.getByRole("button", { name: "Otevřít v přepisu" })).toHaveCount(0);
  await page.evaluate(() => {
    const fixtureWindow = window as typeof window & { __evidenceHighlightAnchors?: string[] };
    fixtureWindow.__evidenceHighlightAnchors = [];
    const rememberHighlights = () => {
      for (const element of document.querySelectorAll<HTMLElement>('[aria-current="true"]')) {
        if (element.id && !fixtureWindow.__evidenceHighlightAnchors?.includes(element.id)) {
          fixtureWindow.__evidenceHighlightAnchors?.push(element.id);
        }
      }
    };
    new MutationObserver(rememberHighlights).observe(document.documentElement, {
      attributeFilter: ["aria-current"],
      attributes: true,
      childList: true,
      subtree: true
    });
  });
  await evidence.click();
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

  await openEvidenceQuote(page);

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

  await openEvidenceQuote(page);

  await expectTranscriptEvidenceOpened(page);
  await expect(page.locator("audio")).toHaveCount(0);
});

test("legacy segmented evidence resolves at runtime without attempting audio playback", async ({ page }) => {
  await openEvidenceFixture(page, "segmented");
  await expect(page.getByText('"Schvalili jsme termin"')).toBeVisible();

  await openEvidenceQuote(page);

  await expectTranscriptEvidenceOpened(page);
  await expect(page.locator("audio")).toHaveCount(0);
});

test("untimed legacy evidence opens one uniquely matching transcript block from the quote", async ({ page }) => {
  await openEvidenceFixture(page, "untimed");

  await openEvidenceQuote(page);

  await expectTranscriptEvidenceOpened(page, "#transcript-block-1");
  await expect(page.locator("audio")).toHaveCount(0);
});
