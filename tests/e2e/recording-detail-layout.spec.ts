import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

type FixtureMode = "blocks" | "raw" | "ai" | "timeline" | "files";

// createFixtureScope supplies the exact twelve-hex token required by the guarded fixture route.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// createSilentWav returns deterministic media metadata for the real custom player.
function createSilentWav(durationSeconds = 2) {
  const sampleRate = 8_000;
  const dataLength = sampleRate * durationSeconds * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

// stubSignedAudioUrl keeps the real private-source and media controls deterministic.
async function stubSignedAudioUrl(page: Page) {
  await page.route("**/api/recordings/*/audio", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        expiresIn: 300,
        mimeType: "audio/wav",
        url: "https://media.vosio.test/recording-layout.wav"
      }
    });
  });
  await page.route("https://media.vosio.test/recording-layout.wav", async (route) => {
    await route.fulfill({ body: createSilentWav(), contentType: "audio/wav", status: 200 });
  });
}

// openFixture navigates to the guarded route after installing the private-audio seam.
async function openFixture(page: Page, mode: FixtureMode = "blocks") {
  await stubSignedAudioUrl(page);
  await page.goto(`/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=${mode}`);
  await expect(page.locator(".recording-workbench")).toBeVisible();
}

// readContrastReport returns rendered foreground/background pairs and WCAG text contrast ratios.
async function readContrastReport(page: Page, selectors: string[]) {
  return page.evaluate((targetSelectors) => {
    // parseColor lets Chromium resolve rgb(), color-mix() and color(srgb) through its canvas engine.
    const parseColor = (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas context is unavailable.");
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data) as [number, number, number, number];
    };

    // composite overlays one RGBA color over the effective color behind it.
    const composite = (front: number[], back: number[]) => {
      const frontAlpha = front[3]! / 255;
      const backAlpha = back[3]! / 255;
      const alpha = frontAlpha + backAlpha * (1 - frontAlpha);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (front[0]! * frontAlpha + back[0]! * backAlpha * (1 - frontAlpha)) / alpha,
        (front[1]! * frontAlpha + back[1]! * backAlpha * (1 - frontAlpha)) / alpha,
        (front[2]! * frontAlpha + back[2]! * backAlpha * (1 - frontAlpha)) / alpha,
        alpha * 255
      ];
    };

    // luminance converts rendered sRGB into the WCAG relative-luminance scale.
    const luminance = (rgb: number[]) => {
      const channels = rgb.slice(0, 3).map((value) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };

    return targetSelectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing contrast target: ${selector}`);
      const layers: number[][] = [];
      for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        layers.push(parseColor(getComputedStyle(current).backgroundColor));
      }
      let background: number[] = [255, 255, 255, 255];
      for (const layer of layers.reverse()) background = composite(layer, background);
      const foreground = composite(parseColor(getComputedStyle(element).color), background);
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      return { background: background.slice(0, 3), foreground: foreground.slice(0, 3), ratio, selector };
    });
  }, selectors);
}

test("the layout fixture rejects missing or malformed guards", async ({ request }) => {
  expect((await request.get("/login/recording-layout-e2e")).status()).toBe(404);
  expect((await request.get("/login/recording-layout-e2e?scope=not-a-token&mode=blocks")).status()).toBe(404);
  expect((await request.get(
    `/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=invalid`
  )).status()).toBe(404);
});

test("the guarded fixture renders the real full-page recording detail", async ({ page }, testInfo) => {
  await openFixture(page);

  await expect(page.getByRole("link", { name: "Zpět na nahrávky" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dlouhý testovací hovor" })).toBeVisible();
  await expect(page.locator(".recording-rail")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Přehrát nahrávku" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Pozice přehrávání" })).toBeEnabled();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("tab").allTextContents()).resolves.toEqual([
    "Přepis",
    "AI zpracování",
    "Časová osa",
    "Soubory"
  ]);
  await page.screenshot({
    caret: "initial",
    fullPage: true,
    path: testInfo.outputPath("recording-detail.png")
  });
});

for (const width of [375, 1280]) {
  test(`header, player and tabs keep exact source order at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ height: 720, width });
    await openFixture(page);

    await expect(page.locator(".recording-object-header .export-controls")).toBeVisible();
    await expect(page.locator(".recording-object-header .command-bar")).toBeVisible();
    await expect(page.locator(".tabs-row .export-controls")).toHaveCount(0);
    const order = await page.evaluate(() => {
      const header = document.querySelector(".recording-object-header");
      const player = document.querySelector(".recording-audio-player");
      const tabs = document.querySelector('[role="tablist"]');
      if (!header || !player || !tabs) throw new Error("Missing detail sequence node.");
      return {
        headerBeforePlayer: Boolean(header.compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING),
        playerBeforeTabs: Boolean(player.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)
      };
    });
    expect(order).toEqual({ headerBeforePlayer: true, playerBeforeTabs: true });
  });
}

const fixtureTabs: ReadonlyArray<readonly [FixtureMode, string]> = [
  ["blocks", "Přepis"],
  ["raw", "Přepis"],
  ["ai", "AI zpracování"],
  ["timeline", "Časová osa"],
  ["files", "Soubory"]
];

for (const [mode, tabName] of fixtureTabs) {
  test(`the ${mode} fixture opens its persisted detail tab`, async ({ page }) => {
    await openFixture(page, mode);
    await expect(page.getByRole("tab", { name: tabName })).toHaveAttribute("aria-selected", "true");

    if (mode === "ai") {
      await expect(page.locator(".ai-markdown-preview")).toContainText("E2E AI SENTINEL");
    }
    if (mode === "timeline") {
      await expect(page.locator(".timeline-list")).toContainText("E2E TIMELINE SENTINEL");
    }
    if (mode === "files") {
      await expect(page.locator(".file-details")).toContainText("audio/e2e-sentinel");
    }
    if (mode === "raw") {
      await expect(page.locator(".transcript-raw-block")).toContainText("POSLEDNÍ RAW VĚTA PŘEPISU");
    }
  });
}

test("the custom progress control accepts repeated seeks without mouse movement or autoplay", async ({ page }) => {
  await page.addInitScript(() => {
    (window as typeof window & { __vosioPlayCalls: number }).__vosioPlayCalls = 0;
    HTMLMediaElement.prototype.play = function play() {
      (window as typeof window & { __vosioPlayCalls: number }).__vosioPlayCalls += 1;
      return Promise.resolve();
    };
  });
  await openFixture(page);
  const slider = page.getByRole("slider", { name: "Pozice přehrávání" });
  const audio = page.locator(".recording-audio-element");

  await expect(slider).toBeEnabled();
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).duration))
    .toBeCloseTo(2, 0);
  await audio.evaluate((element) => {
    Object.defineProperty(element, "currentTime", { configurable: true, value: 0, writable: true });
  });
  const sliderBox = await slider.boundingBox();
  expect(sliderBox).not.toBeNull();
  await page.mouse.click(sliderBox!.x + sliderBox!.width * 0.25, sliderBox!.y + sliderBox!.height / 2);
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime))
    .toBeGreaterThan(0.2);
  const firstSeek = await audio.evaluate((element) => (element as HTMLAudioElement).currentTime);

  await page.mouse.click(sliderBox!.x + sliderBox!.width * 0.75, sliderBox!.y + sliderBox!.height / 2);
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime))
    .toBeGreaterThan(firstSeek + 0.4);
  expect(await page.evaluate(() => (
    window as typeof window & { __vosioPlayCalls: number }
  ).__vosioPlayCalls)).toBe(0);
  expect(await audio.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true);
});

test("the focused progress slider repeats Arrow, Home and End seeks with current ARIA values", async ({ page }) => {
  await openFixture(page);
  const slider = page.getByRole("slider", { name: "Pozice přehrávání" });
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveAttribute("aria-valuemax", "2");
  await expect(slider).toHaveAttribute("aria-valuemin", "0");
  await page.locator(".recording-audio-element").evaluate((element) => {
    Object.defineProperty(element, "currentTime", { configurable: true, value: 0, writable: true });
  });
  await slider.focus();
  await expect(slider).toBeFocused();

  for (const [key, expectedValue] of [
    ["End", "2"],
    ["Home", "0"],
    ["ArrowRight", "0.01"],
    ["ArrowRight", "0.02"],
    ["ArrowLeft", "0.01"]
  ] as const) {
    await page.keyboard.press(key);
    await expect(slider).toBeFocused();
    await expect(slider).toHaveValue(expectedValue);
    await expect(slider).toHaveAttribute("aria-valuenow", expectedValue);
  }
  await expect(slider).toHaveAttribute("aria-valuetext", /z 00:02/);
});

test("tabs support arrow, Home and End keyboard navigation", async ({ page }) => {
  await openFixture(page);
  const transcript = page.getByRole("tab", { name: "Přepis" });
  await transcript.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "AI zpracování" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Soubory" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(transcript).toBeFocused();
});

test("mobile icon controls expose 44px touch targets", async ({ page }) => {
  await page.setViewportSize({ height: 640, width: 375 });
  await openFixture(page, "ai");

  for (const control of [
    page.getByRole("button", { name: "Přehrát nahrávku" }),
    page.getByRole("button", { name: "Označit úkol jako hotový" }),
    page.getByRole("button", { name: "Smazat úkol: E2E úkol" })
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const sliderBox = await page.getByRole("slider", { name: "Pozice přehrávání" }).boundingBox();
  const backBox = await page.getByRole("link", { name: "Zpět na nahrávky" }).boundingBox();
  expect(sliderBox).not.toBeNull();
  expect(sliderBox!.height).toBeGreaterThanOrEqual(44);
  expect(backBox).not.toBeNull();
  expect(backBox!.height).toBeGreaterThanOrEqual(44);
});

for (const width of [375, 768]) {
  test(`${width}px seek slider keeps a 44px hit area and remains repeatable`, async ({ page }) => {
    await page.setViewportSize({ height: 640, width });
    await openFixture(page);
    const slider = page.getByRole("slider", { name: "Pozice přehrávání" });
    const audio = page.locator(".recording-audio-element");
    await expect(slider).toBeEnabled();
    await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).duration))
      .toBeCloseTo(2, 0);
    await audio.evaluate((element) => {
      Object.defineProperty(element, "currentTime", { configurable: true, value: 0, writable: true });
    });
    const box = await slider.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.mouse.click(box!.x + box!.width * 0.25, box!.y + box!.height / 2);
    const first = Number(await slider.inputValue());
    await page.mouse.click(box!.x + box!.width * 0.75, box!.y + box!.height / 2);
    const second = Number(await slider.inputValue());
    expect(second).toBeGreaterThan(first);
  });
}

for (const viewport of [
  { height: 640, width: 375 },
  { height: 640, width: 768 },
  { height: 640, width: 1024 },
  { height: 900, width: 1440 }
]) {
  test(`long detail remains reachable without page x-overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openFixture(page);
    const lastRow = page.locator(".transcript-table-row", { hasText: "POSLEDNÍ VĚTA PŘEPISU" });
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeInViewport();

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - window.innerWidth,
      document: document.documentElement.scrollWidth - window.innerWidth
    }));
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.document).toBeLessThanOrEqual(1);

    if (viewport.width <= 900) {
      const [playerBox, navBox, rowBox] = await Promise.all([
        page.locator(".recording-audio-player").boundingBox(),
        page.locator(".mobile-nav").boundingBox(),
        lastRow.boundingBox()
      ]);
      expect(playerBox).not.toBeNull();
      expect(navBox).not.toBeNull();
      expect(rowBox).not.toBeNull();
      expect(playerBox!.y + playerBox!.height).toBeLessThanOrEqual(navBox!.y + 2);
      expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(playerBox!.y + 2);
    }
  });
}

test("direct load and reload do not emit React hydration mismatch #418", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openFixture(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dlouhý testovací hovor" })).toBeVisible();
  expect(errors.filter((message) => /hydration|#418|Minified React error #418/i.test(message))).toEqual([]);
});

test("light and dark themes override opposite ambient theme with WCAG text contrast", async ({ page }, testInfo) => {
  await openFixture(page);
  const reports: Record<string, Awaited<ReturnType<typeof readContrastReport>>> = {};

  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".recording-object-header")).toBeVisible();
    await expect(page.locator(".recording-detail-sticky")).toBeVisible();
    reports[theme] = await readContrastReport(page, [
      ".recording-audio-copy strong",
      ".tabs .active-tab",
      ".transcript-table-row p"
    ]);
    for (const result of reports[theme]) expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      caret: "initial",
      fullPage: true,
      path: testInfo.outputPath(`recording-detail-${theme}.png`)
    });
  }

  expect(reports.dark?.map((result) => result.background))
    .not.toEqual(reports.light?.map((result) => result.background));
  expect(reports.dark?.map((result) => result.foreground))
    .not.toEqual(reports.light?.map((result) => result.foreground));
});
