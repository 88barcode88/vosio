import { expect, test, type Page } from "@playwright/test";

const previewPath = "/login/notion-warm-preview?scope=a1b2c3d4e5f";
const detailPath = (id: string) => `${previewPath}&recording=${id}`;

async function expectSingleDocumentScroll(page: Page) {
  expect(await page.evaluate(() => {
    const extraOwners = Array.from(document.querySelectorAll<HTMLElement>("*")).filter((element) => element !== document.scrollingElement && element.scrollHeight > element.clientHeight + 1 && ["auto", "scroll"].includes(getComputedStyle(element).overflowY));
    return document.documentElement.scrollWidth === document.documentElement.clientWidth && extraOwners.length === 0;
  })).toBe(true);
}
async function expectRecordingGeometry(page: Page) {
  const viewportWidth = page.viewportSize()?.width ?? 0;
  for (const article of await page.locator(".notion-warm-recording").all()) {
    const articleBox = await article.boundingBox(); expect(articleBox).not.toBeNull();
    for (const child of [article.locator(".notion-warm-recording-title"), article.locator("time"), article.locator(".notion-warm-recording-actions button")]) {
      await expect(child).toBeVisible(); const box = await child.boundingBox(); expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
      expect(box!.x).toBeGreaterThanOrEqual(articleBox!.x - 1); expect(box!.x + box!.width).toBeLessThanOrEqual(articleBox!.x + articleBox!.width + 1);
    }
  }
}
function watchHydration(page: Page) {
  const messages: string[] = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) messages.push(message.text()); });
  page.on("pageerror", (error) => messages.push(error.message));
  return messages;
}
function relativeLuminance(color: string) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  return channels.map((channel) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a); return (lighter + 0.05) / (darker + 0.05);
}
async function previewPrimitiveTheme(page: Page) {
  return page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>(".notion-warm-preview")!; const probe = document.createElement("span"); preview.append(probe);
    const resolveBackground = (variable: string) => { probe.style.background = `var(${variable})`; return getComputedStyle(probe).backgroundColor; };
    const expected = { surface: resolveBackground("--surface"), muted: resolveBackground("--surface-muted") }; probe.remove();
    const targets = [
      ["filters", ".notion-warm-filters.ui-panel", ".notion-warm-filters label", "surface"],
      ["progress", ".notion-warm-progress.ui-panel", ".notion-warm-progress p", "surface"],
      ["error", ".notion-warm-error.ui-panel", ".notion-warm-error strong", "surface"],
      ["disclosure", ".ui-disclosure-trigger", ".ui-disclosure-trigger", "surface"],
      ["empty", ".ui-empty-state", ".ui-empty-state strong", "muted"]
    ] as const;
    return { expected, targets: Object.fromEntries(targets.map(([name, surfaceSelector, textSelector, expectedToken]) => { const surface = document.querySelector<HTMLElement>(surfaceSelector)!; const text = document.querySelector<HTMLElement>(textSelector)!; return [name, { background: getComputedStyle(surface).backgroundColor, color: getComputedStyle(text).color, expectedToken }]; })) };
  });
}

test("the development gate rejects missing and malformed scopes", async ({ request }) => {
  expect((await request.get("/login/notion-warm-preview")).status()).toBe(404);
  expect((await request.get("/login/notion-warm-preview?scope=preview")).status()).toBe(404);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`the full recordings list remains responsive at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 }); await page.goto(previewPath); await expect(page.getByRole("heading", { name: "Nahrávky" })).toBeVisible();
    await expect(page.getByPlaceholder("Hledat nahrávky")).toBeVisible(); await expect(page.locator(".notion-warm-filters select").nth(0)).toBeVisible(); await expect(page.locator(".notion-warm-filters select").nth(1)).toBeVisible();
    for (const label of ["Vyčistit filtry", "Nahrávku se nepodařilo načíst"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("33 MB z 50 MB", { exact: false }).first()).toBeVisible();
    await expect(page.locator("a[href='#ai']")).toHaveCount(0); if ([768, 1024].includes(width)) await expectRecordingGeometry(page); await expectSingleDocumentScroll(page);
    await page.screenshot({ path: testInfo.outputPath(`notion-warm-list-dark-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Přepnout světlý motiv" }).click(); await page.screenshot({ path: testInfo.outputPath(`notion-warm-list-light-${width}.png`), fullPage: true });
  });
}

for (const width of [768, 1440]) test(`preview primitive aliases isolate both themes from the ambient root at ${width}px`, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width, height: 760 }); await page.goto(previewPath); await page.evaluate(() => { document.documentElement.dataset.theme = "light"; }); await expect(page.locator(".notion-warm-preview")).toHaveAttribute("data-theme", "dark"); const dark = await previewPrimitiveTheme(page);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; }); await page.getByRole("button", { name: "Přepnout světlý motiv" }).click(); await expect(page.locator(".notion-warm-preview")).toHaveAttribute("data-theme", "light"); const light = await previewPrimitiveTheme(page);
  for (const [theme, snapshot] of [["dark", dark], ["light", light]] as const) for (const [name, target] of Object.entries(snapshot.targets)) { expect(target.background, `${theme} ${name} background`).toBe(snapshot.expected[target.expectedToken]); expect(contrastRatio(target.color, target.background), `${theme} ${name} contrast`).toBeGreaterThanOrEqual(4.5); }
  for (const target of Object.values(light.targets)) expect(target.background).not.toBe(dark.expected.surface); for (const target of Object.values(dark.targets)) expect(target.background).not.toBe(light.expected.surface);
  await page.screenshot({ path: testInfo.outputPath(`notion-warm-theme-isolation-light-${width}.png`), fullPage: true });
});

test("the desktop sidebar exposes the exact external coffee support link without changing mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 }); await page.goto(previewPath); const support = page.getByRole("link", { name: "Kup mi kafe", exact: true }); await expect(support).toBeVisible(); await expect(support).toHaveAttribute("href", "https://donate.stripe.com/3cI7sLdRHaWJ1Lke48dZ602"); await expect(support).toHaveAttribute("target", "_blank"); await expect(support).toHaveAttribute("rel", "noopener noreferrer");
  await page.setViewportSize({ width: 375, height: 760 }); await expect(support).toBeHidden(); await expect(page.locator(".notion-warm-mobile-nav").getByRole("link", { name: "Kup mi kafe" })).toHaveCount(0);
});

for (const width of [375, 1440]) {
  test(`the product recording detail captures both themes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 }); await page.goto(detailPath("product-talk")); await expect(page.locator("[data-recording-id='product-talk']")).toBeVisible(); await expect(page.getByRole("tab", { selected: true })).toHaveText("Přepis");
    await page.screenshot({ path: testInfo.outputPath(`notion-warm-detail-dark-${width}.png`), fullPage: true }); await page.getByRole("button", { name: "Přepnout světlý motiv" }).click(); await page.screenshot({ path: testInfo.outputPath(`notion-warm-detail-light-${width}.png`), fullPage: true });
  });
}

for (const width of [1440, 1920]) test(`the recording detail fills the wide canvas while transcript prose stays readable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto(detailPath("product-talk")); const canvas = await page.locator(".notion-warm-detail-page").boundingBox(); expect(canvas).not.toBeNull(); expect(canvas!.x + canvas!.width).toBeGreaterThanOrEqual(width - 1); expect(canvas!.width / (width - canvas!.x)).toBeGreaterThan(0.98);
  for (const surface of [page.locator(".notion-warm-player"), page.locator(".notion-warm-detail-tabs"), page.locator(".notion-warm-detail-panel:not([hidden])")]) { const box = await surface.boundingBox(); expect(box).not.toBeNull(); expect(width - (box!.x + box!.width)).toBeGreaterThanOrEqual(15); expect(width - (box!.x + box!.width)).toBeLessThanOrEqual(64); expect(box!.width / canvas!.width).toBeGreaterThan(0.88); }
  const paragraph = await page.locator(".notion-warm-transcript-block p").first().boundingBox(); expect(paragraph).not.toBeNull(); expect(paragraph!.width).toBeLessThanOrEqual(700); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.getByRole("button", { name: "Přepnout světlý motiv" }).click(); await page.screenshot({ path: testInfo.outputPath(`notion-warm-detail-wide-light-${width}.png`), fullPage: true });
});

test("every recording has isolated detail content and handover remains pending", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  for (const [id, date, duration, transcript, ai] of [["product-talk", "9. srpna 2026, 10:24", "42:18", "během první minuty", "Doplnit tři ukázky"], ["team-plan", "8. srpna 2026, 16:10", "31:06", "Nejdřív sjednotíme podklady", "Sjednotit podklady od týmu"], ["handover", "6. srpna 2026, 09:03", "18:42", "Přepis nahrávky Předání projektu", "AI výstupy budou dostupné"]] as const) {
    await page.goto(detailPath(id)); const detail = page.locator(`[data-recording-id='${id}']`); await expect(detail).toContainText(date); await expect(detail).toContainText(duration); await expect(detail).toContainText(transcript);
    await page.getByRole("tab", { name: "AI zpracování" }).click(); await expect(page.getByRole("tabpanel")).toContainText(ai);
    if (id === "handover") { await expect(page.locator(".notion-warm-quick-actions button:disabled")).toHaveCount(6); await expect(page.getByRole("tabpanel")).not.toContainText("Doplnit tři ukázky"); }
  }
});

test("direct reload, client history and visible Back preserve a full-page detail without hydration errors", async ({ page }) => {
  const messages = watchHydration(page); await page.goto(detailPath("team-plan")); await page.reload(); await expect(page.locator("[data-recording-id='team-plan']")).toBeVisible();
  await page.getByRole("button", { name: "← Zpět na nahrávky" }).click(); await expect(page.locator("[data-recording-id]")).toHaveCount(0); await expect(page).not.toHaveURL(/recording=/);
  await page.goto(previewPath); const opener = page.getByRole("button", { name: "Interní plánování", exact: true }); await opener.click(); await page.getByRole("button", { name: "← Zpět na nahrávky" }).click(); await expect(page.locator("[data-recording-id]")).toHaveCount(0); await page.goBack(); await expect(page.locator("[data-recording-id]")).toHaveCount(0);
  await page.goto(previewPath); await opener.click(); await page.goBack(); await expect(opener).toBeFocused(); expect(messages.join("\n")).not.toMatch(/hydration|did not match|#418/i);
});

test("a direct detail Back restores a stable list focus target after reload", async ({ page }) => {
  await page.goto(detailPath("team-plan")); await page.reload(); await expect(page.locator("[data-recording-id='team-plan']")).toBeVisible();
  await page.locator(".notion-warm-back").click(); await expect(page.locator("[data-recording-id]")).toHaveCount(0); await expect(page).not.toHaveURL(/recording=/);
  await expect(page.locator(".notion-warm-header h1")).toBeFocused();
});

test("an invalid recording deep link reloads to the deterministic list fallback", async ({ page }) => {
  const messages = watchHydration(page); await page.goto(detailPath("unknown")); await expect(page.locator("[data-recording-id]")).toHaveCount(0); await expect(page.locator(".notion-warm-header h1")).toBeVisible(); await expect(page).toHaveURL(/recording=unknown/);
  await page.reload(); await expect(page.locator("[data-recording-id]")).toHaveCount(0); await expect(page.locator(".notion-warm-header h1")).toBeVisible(); await expect(page).toHaveURL(/recording=unknown/); expect(messages.join("\n")).not.toMatch(/hydration|did not match|#418/i);
});

test("outside picker clicks retain the organization disclosure and native target focus", async ({ page }) => {
  await page.goto(previewPath); const management = page.locator(".notion-warm-manage"); await management.getByRole("button").first().click(); await expect(management).toBeVisible();
  const trigger = management.locator("button[aria-controls='preview-color-picker']"); await trigger.click(); const picker = page.locator("#preview-color-picker"); await expect(picker).toBeVisible();
  const outsideTarget = page.locator("button.notion-warm-clear"); await outsideTarget.click(); await expect(picker).toBeHidden(); await expect(management).toBeVisible(); await expect(outsideTarget).toBeFocused();
});

test("tabs, title editor, artifacts, picker and explicit delete remain accessible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 }); await page.goto(detailPath("product-talk")); const transcript = page.getByRole("tab", { name: "Přepis" }); await transcript.press("ArrowRight"); await expect(page.getByRole("tab", { name: "AI zpracování" })).toBeFocused();
  const editTitle = page.getByRole("button", { name: "Upravit název nahrávky" }); await editTitle.click(); const input = page.getByRole("textbox", { name: "Název nahrávky", exact: true }); await input.fill("Schválený produktový rozhovor"); await input.press("Enter"); await expect(page.getByRole("heading", { name: "Schválený produktový rozhovor" })).toBeVisible();
  await editTitle.click(); await input.fill("Tento název zahodit"); await input.press("Escape"); await expect(page.getByRole("heading", { name: "Schválený produktový rozhovor" })).toBeVisible(); await expect(editTitle).toBeFocused();
  await page.getByRole("tab", { name: "AI zpracování" }).click(); await expect(page.locator(".notion-warm-artifacts details")).toHaveCount(5); await page.locator(".notion-warm-artifacts details").first().locator("summary").click(); await expect(page.getByRole("button", { name: /Kopírovat/ }).first()).toBeVisible(); const mailArtifact = page.locator(".notion-warm-artifacts details", { hasText: "Follow-up e-mail" }); await mailArtifact.locator("summary").click(); await expect(page.getByRole("link", { name: "Otevřít e-mail" })).toBeVisible();
  await page.getByRole("button", { name: "Smazat nahrávku" }).click(); await expect(page.getByRole("dialog", { name: /Potvrdit smazání/ })).toBeVisible(); await page.getByRole("button", { name: "Zrušit" }).click();
  await page.goto(previewPath); await page.getByRole("button", { name: "Spravovat" }).click(); const management = page.getByRole("region", { name: "Správa organizace" }); const trigger = management.getByRole("button", { name: "Priorita", exact: true }); await trigger.click(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Barva štítku" })).toBeHidden(); await expect(trigger).toBeFocused(); await expect(management).toBeVisible();
  const emptyDialogTrigger = page.getByRole("button", { name: "Otevřít ukázkový dialog" }); await emptyDialogTrigger.scrollIntoViewIfNeeded(); await expect(emptyDialogTrigger).toBeVisible(); await emptyDialogTrigger.click(); await expect(page.getByRole("dialog", { name: "Ukázkový dialog bez akcí" })).toBeVisible(); await page.keyboard.press("Escape"); await expect(emptyDialogTrigger).toBeFocused();
});

for (const width of [375, 768]) test(`the long transcript keeps its fixed player and final block readable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 760 }); await page.goto(detailPath("product-talk")); const player = page.locator(".notion-warm-player"); const navigation = page.locator(".notion-warm-mobile-nav"); const before = await player.boundingBox(); expect(before).not.toBeNull();
  await page.getByRole("button", { name: "Přejít na 41:52" }).scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await expectSingleDocumentScroll(page);
  const [after, navBox, finalBlock] = await Promise.all([player.boundingBox(), navigation.boundingBox(), page.locator("#timestamp-product-talk-41-52").boundingBox()]); expect(after).not.toBeNull(); expect(navBox).not.toBeNull(); expect(finalBlock).not.toBeNull();
  expect(after!.y).toBeGreaterThanOrEqual(0); expect(after!.y + after!.height).toBeLessThanOrEqual(navBox!.y + 1); expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  expect(finalBlock!.y).toBeGreaterThanOrEqual(0); expect(finalBlock!.y + finalBlock!.height).toBeLessThanOrEqual(after!.y - 8); await expect(page.getByRole("button", { name: "Přejít na 41:52" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`notion-warm-detail-scrolled-${width}.png`) });
});
