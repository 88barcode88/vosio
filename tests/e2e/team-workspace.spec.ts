import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

// fixturePath selects only the development-only inert transport; real Team endpoints are forbidden below.
function fixturePath(role = "owner") { return `/login/team-e2e?scope=${randomBytes(6).toString("hex")}&role=${role}`; }

test("approved compact Team keeps inline selection, confirmation and mobile More accessible", async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(fixturePath());
  await expect(page.getByRole("heading", { name: "Tým", exact: true })).toBeVisible();
  const mobile = (page.viewportSize()?.width ?? 1440) <= 900;
  const compactPointer = await page.evaluate(() => matchMedia("(min-width:901px) and (pointer:fine)").matches && !matchMedia("(any-pointer:coarse)").matches);
  if (mobile) {
    await page.getByRole("button", { name: "Více", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Další možnosti" }).getByRole("link", { name: "Tým", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Více", exact: true })).toBeFocused();
    await page.getByRole("button", { name: /anna.novotna@example.test/ }).click();
  }
  await expect(page.getByRole("region", { name: "Detail osoby" }).getByRole("article").filter({ hasText: "Studio Sever / Web 2026" })).toBeVisible();
  await page.getByRole("button", { name: "Přidělit přístup", exact: true }).click();
  if (compactPointer) {
    for (const control of [page.getByRole("button", { name: "Přidělit přístup", exact: true }), page.getByRole("button", { name: "Odebrat přístup: Web 2026", exact: true }), page.getByRole("button", { name: "Otevřít Web 2026", exact: true })]) {
      expect(await control.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(32);
    }
  }
  await expect(page.getByRole("form", { name: "Přidělit přístup" })).toBeVisible();
  await page.getByRole("button", { name: "Otevřít Web 2026", exact: true }).click();
  await page.getByRole("button", { name: "Otevřít Obchodní hovory / Web 2026", exact: true }).click();
  await page.getByRole("checkbox", { name: "Vybrat Úvodní schůzka s velmi dlouhým názvem pro ověření zalamování", exact: true }).check();
  await expect(page.getByRole("status").filter({ hasText: "Nově sdílené soukromé: 1" })).toContainText("anna.novotna@example.test");
  await page.getByRole("button", { name: "Web 2026", exact: true }).click();
  await page.getByRole("checkbox", { name: "Vybrat Web 2026", exact: true }).check();
  const smallTargets = await page.getByRole("region", { name: "Tým", exact: true }).locator("button, input:not([type=checkbox]), select, summary, label:has(input[type=checkbox])").evaluateAll((elements, minimum) => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.height < minimum || box.width < minimum) ? [{ name: element.textContent, width: box.width, height: box.height }] : [];
  }), mobile ? 43.5 : 27.5);
  expect(smallTargets).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("team-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Přepnout na světlý režim", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: testInfo.outputPath("team-light.png"), fullPage: true });
  await page.getByRole("combobox", { name: "Oprávnění pro celý výběr", exact: true }).selectOption("editor");
  await page.getByRole("button", { name: "Uložit přístupy", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Požadavek je potvrzený" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Detail osoby" }).getByRole("article").getByText("Editor", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Odebrat přístup: Studio Sever / Web 2026", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Odebrat tento přístup" })).toContainText("Jiný platný přístup");
  await page.getByRole("button", { name: "Odebrat přístup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aktivní přístupy · 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Odebrat přístup: Web 2026", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  expect(requests).toEqual([]);
});

test("wide touch Team keeps 44px targets above the mobile layout breakpoint", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "One explicit wide touch context covers both configured projects.");
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, hasTouch: true });
  const page = await context.newPage();
  const requests: string[] = [];
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  try {
    await page.goto(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3047"}${fixturePath()}`);
    expect(await page.evaluate(() => matchMedia("(any-pointer:coarse)").matches)).toBe(true);
    await page.getByRole("button", { name: "Přidělit přístup", exact: true }).click();
    const smallTargets = await page.getByRole("region", { name: "Tým", exact: true }).locator("button, input:not([type=checkbox]), select, summary, label:has(input[type=checkbox])").evaluateAll(elements => elements.flatMap(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.height < 43.5 || box.width < 43.5) ? [{ name: element.textContent, width: box.width, height: box.height }] : [];
    }));
    expect(smallTargets).toEqual([]);
    expect(requests).toEqual([]);
  } finally { await context.close(); }
});

test("ordinary member has neither desktop Team nor Team under More", async ({ page }) => {
  await page.goto(fixturePath("ordinary"));
  await expect(page.getByRole("heading", { name: "Ukázka běžného člena" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tým", exact: true })).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1440) <= 900) {
    await page.getByRole("button", { name: "Více", exact: true }).click();
    await expect(page.getByRole("link", { name: "Tým", exact: true })).toHaveCount(0);
  }
});
