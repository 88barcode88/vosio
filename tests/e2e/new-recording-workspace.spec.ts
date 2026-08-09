import { expect, test } from "@playwright/test";

// createFixtureScope supplies the exact twelve-hex token required by the development route.
function createFixtureScope() {
  return Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

// openFixture navigates to one isolated in-memory upload adapter.
async function openFixture(page: import("@playwright/test").Page, mode: "success" | "error" = "success") {
  await page.goto(`/login/new-recording-e2e?scope=${createFixtureScope()}&mode=${mode}`);
  await expect(page.getByRole("heading", { level: 1, name: "Nová nahrávka" })).toBeVisible();
}

test("the new-recording fixture rejects missing or malformed access", async ({ request }) => {
  expect((await request.get("/login/new-recording-e2e")).status()).toBe(404);
  expect((await request.get("/login/new-recording-e2e?scope=bad&mode=success")).status()).toBe(404);
  expect((await request.get("/login/new-recording-e2e?scope=a1b2c3d4e5f6&mode=other")).status()).toBe(404);
});

test("real primary capture cards stay equal on desktop and ordered when stacked", async ({ page }) => {
  await openFixture(page);
  const widths = [1440, 1024, 768, 375];

  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 768 ? 900 : 860 });
    const cards = page.locator("[data-primary-capture]");
    await expect(cards).toHaveCount(2);
    const live = await cards.nth(0).boundingBox();
    const upload = await cards.nth(1).boundingBox();
    expect(live).not.toBeNull();
    expect(upload).not.toBeNull();

    if (width > 900) {
      expect(Math.abs((live?.width ?? 0) - (upload?.width ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((live?.y ?? 0) - (upload?.y ?? 0))).toBeLessThanOrEqual(1);
    } else {
      expect((upload?.y ?? 0)).toBeGreaterThan((live?.y ?? 0) + (live?.height ?? 0) - 2);
    }

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 8)
        .map((element) => ({ className: element.className, right: element.getBoundingClientRect().right, tag: element.tagName })),
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.clientWidth);
  }

  await expect(page.locator("[data-primary-capture='live']")).toContainText("Nahrávat live");
  await expect(page.locator("[data-primary-capture='upload']")).toContainText("Nahrát soubor");
  await expect(page.locator("[data-secondary-capture='transcript']")).toContainText("Vložit přepis");
  await expect(page.getByText("Capture console")).toHaveCount(0);
});

test("a generic-MIME 33 MiB M4A shows monotonic phases in one stable surface", async ({ page }) => {
  await openFixture(page);
  const status = page.locator("[data-upload-status]");
  const initialBox = await status.boundingBox();
  await expect(status).toContainText("Limit 50 MB");
  await expect(status).toContainText("Zatím nebyl vybrán soubor");

  await page.locator(".real-upload input[accept]").setInputFiles({
    buffer: Buffer.alloc(33 * 1024 * 1024),
    mimeType: "application/octet-stream",
    name: "lucern-update-33mb.m4a"
  });
  await expect(status).toHaveAttribute("data-phase", "transferring");
  await expect(status).toContainText("42 %");
  await expect(status).toHaveAttribute("data-phase", "finalizing");
  await expect(status).toHaveAttribute("data-phase", "success");
  await expect(status).toContainText("lucern-update-33mb.m4a");
  await expect(status).toContainText("Nahrávka je uložená");

  const finalBox = await status.boundingBox();
  expect(Math.abs((finalBox?.height ?? 0) - (initialBox?.height ?? 0))).toBeLessThanOrEqual(1);
});

test("an upload failure stays local, safe and retryable", async ({ page }) => {
  await openFixture(page, "error");
  await page.locator(".real-upload input[accept]").setInputFiles({
    buffer: Buffer.from("fixture-audio"),
    mimeType: "audio/mpeg",
    name: "retry.mp3"
  });

  const status = page.locator("[data-upload-status]");
  await expect(status).toHaveAttribute("data-phase", "error");
  await expect(status).toContainText("Nahrání souboru se nepodařilo. Zkuste to znovu.");
  const retry = page.getByRole("button", { name: "Zkusit znovu" });
  await expect(retry).toBeVisible();
  expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await retry.click();
  await expect(status).toHaveAttribute("data-phase", "transferring");
  await expect(status).toHaveAttribute("data-phase", "error");
});

test("the workspace remains readable in both themes", async ({ page }) => {
  await openFixture(page);
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((nextTheme) => { document.documentElement.dataset.theme = nextTheme; }, theme);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("color", theme === "dark" ? "rgb(243, 240, 234)" : "rgb(37, 36, 33)");
    await expect(page.locator("[data-primary-capture='upload']")).toBeVisible();
  }
});

for (const width of [1024, 1440]) {
  test(`the actual shell owns new-recording document scrolling at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1024 ? 520 : 700 });
    await openFixture(page);
    const content = page.locator(".content-area");
    await expect(content).toHaveClass(/content-area-document/u);
    const before = await page.evaluate(() => {
      const contentArea = document.querySelector<HTMLElement>(".content-area")!;
      const shell = document.querySelector<HTMLElement>(".workspace-shell")!;
      return {
        bodyExtra: document.body.scrollHeight - document.body.clientHeight,
        contentExtra: contentArea.scrollHeight - contentArea.clientHeight,
        contentOverflow: getComputedStyle(contentArea).overflowY,
        documentExtra: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        shellExtra: shell.scrollHeight - shell.clientHeight
      };
    });
    expect(before.documentExtra).toBe(0);
    expect(before.bodyExtra).toBe(0);
    expect(before.shellExtra).toBe(0);
    expect(before.contentExtra).toBeGreaterThan(0);
    expect(before.contentOverflow).toBe("auto");

    await page.locator(".transcript-import-disclosure > summary").click();
    const importButton = page.getByRole("button", { name: "Uložit testovací přepis" });
    await page.getByLabel("Testovací přepis").fill("Kontrola dosažitelného spodního obsahu");
    await importButton.scrollIntoViewIfNeeded();
    await expect(importButton).toBeVisible();
    await importButton.click();
    await expect(page.getByText("Testovací přepis zůstal jen v prohlížeči.")).toBeVisible();
    expect(await content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`new-recording-shell-${width}.png`) });
  });
}

test("fixture live and transcript controls are inert local presentation", async ({ page }) => {
  const browserRequests: string[] = [];
  await openFixture(page);
  page.on("request", (request) => browserRequests.push(request.url()));
  await expect(page.locator(".browser-recorder, .transcript-import-form")).toHaveCount(0);

  await page.getByRole("button", { name: "Spustit testovací live stav" }).click();
  await expect(page.getByText("Testovací live stav je aktivní pouze lokálně.")).toBeVisible();
  await page.locator(".transcript-import-disclosure > summary").click();
  await page.getByLabel("Testovací přepis").fill("Jen lokální fixture text");
  await page.getByRole("button", { name: "Uložit testovací přepis" }).click();
  await expect(page.getByText("Testovací přepis zůstal jen v prohlížeči.")).toBeVisible();

  expect(browserRequests.filter((url) => /\/api\/|supabase|soniox/iu.test(url))).toEqual([]);
});
