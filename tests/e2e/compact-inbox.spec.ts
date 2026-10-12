import { randomBytes } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { cleanupOrganizationFixture } from "./support/organization-fixture-cleanup";

// compactPaint reads the actual hit area, painted inset and action glyph from production CSS.
async function compactPaint(control: Locator) {
  const geometry = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const paint = getComputedStyle(element, "::before");
    return { height: box.height, width: box.width, inset: paint.top, content: paint.content, icon: element.querySelector("svg")?.getBoundingClientRect().width };
  });
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.inset).toBe("7px");
  expect(geometry.content).toBe('""');
  if (geometry.icon !== undefined) expect(geometry.icon).toBe(15);
}

// createEntity uses only the dev fixture's in-memory save actions.
async function createEntity(page: Page, trigger: string, name: string, client?: string) {
  await page.getByRole("button", { name: trigger, exact: true }).click();
  const form = page.locator(".organization-create-form");
  if (client) await form.getByLabel("Klient").selectOption({ label: client });
  await form.getByLabel("Název").fill(name);
  await form.getByRole("button", { name: "Uložit", exact: true }).click();
  await expect(form).toBeHidden();
}

let fixtureScope = "";

test.afterEach(async ({ request }) => { if (fixtureScope) await cleanupOrganizationFixture(request, fixtureScope); });

test("compact toolbar, anchored filters and readable management retain desktop/mobile interaction", async ({ page }, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  const scope = randomBytes(6).toString("hex").slice(0, 11);
  fixtureScope = scope;
  const mutations: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.startsWith("/api/")) {
      if (route.request().method() !== "GET") mutations.push(url.pathname);
      if (url.pathname === "/api/recording-invitations") return route.fulfill({ json: { members: [], grants: [], invitations: [] } });
      return route.fulfill({ json: { ownerId: null, recordings: [] } });
    }
    return route.continue();
  });
    await page.goto(`/login/recording-organization-e2e?scope=${scope}&fixture=compact`);
    await page.getByRole("button", { name: "Spravovat", exact: true }).click();
    await createEntity(page, "Přidat klienta", "Lucern");
    await createEntity(page, "Přidat klienta", "Srdceprocanis");
    await createEntity(page, "Přidat projekt", "CRM", "Lucern");
    await createEntity(page, "Přidat štítek", "Důležité");
    await createEntity(page, "Přidat složku", "Velmi dlouhý název složky pro pracovní schůzky a následné úkoly");
    await page.getByRole("button", { name: "Zavřít správu organizace" }).click();
    for (const width of [320, 390, 768, 1024, 1440]) for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width, height: 820 });
      await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
      const filter = page.locator(".recording-filter-advanced > summary");
      const manage = page.getByRole("button", { name: "Spravovat", exact: true });
      await compactPaint(filter); await compactPaint(manage);
      await compactPaint(page.locator(".recordings-create-button"));
      const order = await manage.evaluate((element) => {
        const filter = document.querySelector(".recording-filter-advanced > summary")!;
        const first = filter.getBoundingClientRect(), second = element.getBoundingClientRect();
        return { follows: Boolean(filter.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING), sameRow: Math.abs(first.y - second.y) < 1, gap: second.x - first.right };
      });
      expect(order).toMatchObject({ follows: true, sameRow: true }); expect(order.gap).toBeGreaterThanOrEqual(7);
      for (const chip of await page.locator(".recordings-status-summary a").all()) await compactPaint(chip);
      const rowY = await page.locator(".recordings-row").first().evaluate((element) => element.getBoundingClientRect().y + scrollY);
      await filter.focus(); await filter.press("Enter");
      const popup = page.getByRole("dialog", { name: "Pokročilé filtry nahrávek" }); await expect(popup).toBeVisible();
      expect(await page.locator(".recordings-row").first().evaluate((element) => element.getBoundingClientRect().y + scrollY)).toBe(rowY);
      const box = await popup.boundingBox(); expect(box!.width).toBeLessThanOrEqual(360); expect(box!.x).toBeGreaterThanOrEqual(15); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 15);
      const controls = popup.locator("button:not(:disabled), select:not(:disabled), input:not(:disabled)");
      await controls.last().focus(); await page.keyboard.press("Tab"); await expect(controls.first()).toBeFocused();
      await controls.first().focus(); await page.keyboard.press("Shift+Tab"); await expect(controls.last()).toBeFocused();
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`filters-${width}-${theme}.png`) });
      await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0); await expect(filter).toBeFocused();
      await manage.click(); const manager = page.getByRole("dialog", { name: "Správa organizace" });
      await expect(manager).toBeVisible();
      if (width === 1440) expect((await manager.boundingBox())!.width).toBe(640);
      for (const name of ["Lucern", "Srdceprocanis", "CRM · Lucern"]) {
        const label = manager.locator(".organization-manager-badge", { hasText: name }).filter({ hasText: new RegExp(`^${name}$`, "u") });
        expect((await label.boundingBox())!.height).toBeLessThanOrEqual(32);
      }
      const access = manager.getByRole("region", { name: "Správa přístupu" });
      await expect(access).toBeVisible();
      expect((await access.boundingBox())!.width).toBeGreaterThanOrEqual((await manager.boundingBox())!.width - 90);
      await compactPaint(manager.getByRole("button", { name: "Přidat klienta", exact: true }));
      await compactPaint(manager.getByRole("button", { name: "Zavřít správu organizace" }));
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`management-${width}-${theme}.png`) });
      expect(await manager.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape"); await expect(manage).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    const filter = page.locator(".recording-filter-advanced > summary");
    await filter.click(); await page.getByRole("dialog", { name: "Pokročilé filtry nahrávek" }).getByRole("combobox", { name: "Klient", exact: true }).selectOption({ label: "Lucern" });
    await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("client")));
    if (await filter.getAttribute("aria-expanded") !== "true") await filter.click();
    await page.getByRole("checkbox", { name: "Důležité", exact: true }).check();
    await expect(page).toHaveURL((url) => url.searchParams.getAll("tag").length === 1);
    await expect(filter).toHaveText("Filtry (2)");
    if (await filter.getAttribute("aria-expanded") !== "true") await filter.click();
    await page.getByRole("button", { name: "Vyčistit filtry" }).click();
    await expect(page).toHaveURL((url) => !url.searchParams.has("client") && !url.searchParams.has("tag"));
    await expect(filter).toHaveText("Filtry (0)");
    expect(mutations).toEqual([]);
});
