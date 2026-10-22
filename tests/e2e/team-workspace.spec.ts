import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

// fixturePath selects only the development-only inert transport; real Team endpoints are forbidden below.
function fixturePath(role = "owner") { return `/login/team-e2e?scope=${randomBytes(6).toString("hex")}&role=${role}`; }

test("selected A Team keeps scopes, confirmation, focus and mobile More accessible", async ({ page }, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/**", route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(fixturePath());
  await expect(page.getByRole("heading", { name: "Tým", exact: true })).toBeVisible();
  const mobile = (page.viewportSize()?.width ?? 1440) <= 900;
  if (mobile) {
    await page.getByRole("button", { name: "Více", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Další možnosti" }).getByRole("link", { name: "Tým", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Více", exact: true })).toBeFocused();
    await page.getByRole("button", { name: /anna.novotna@example.test/ }).click();
  }
  await expect(page.getByRole("region", { name: "Detail osoby" }).getByRole("article").filter({ hasText: "Studio Sever" }).getByText("Současné i budoucí sdílené nahrávky; soukromé zůstávají soukromé.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Přidělit přístup", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Přidělit přístup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Přidělit přístup", exact: true })).toBeFocused();
  const smallTargets = await page.getByRole("region", { name: "Tým", exact: true }).locator("button, input, select, summary").evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (box.height < 43.5 || box.width < 43.5) ? [{ name: element.textContent, width: box.width, height: box.height }] : [];
  }));
  expect(smallTargets).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("team-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "Přepnout na světlý režim", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: testInfo.outputPath("team-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Odebrat přístup: Studio Sever", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Odebrat tento přístup" })).toContainText("Jiný platný přístup");
  await page.getByRole("button", { name: "Odebrat přístup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aktivní přístupy · 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Odebrat přístup: Web 2026", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  expect(requests).toEqual([]);
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
