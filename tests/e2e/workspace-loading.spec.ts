import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
for (const view of ["recordings", "ai", "settings", "templates", "trash", "documentation"] as const) {
  test(`${theme} loading preserves workspace anchors for ${view}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "vosio-theme", value: theme, url: baseURL! }]);
    await page.goto(`/login/workspace-loading-e2e?scope=${randomBytes(6).toString("hex")}&view=${view}`, { waitUntil: "commit" });
    const pending = page.locator('[aria-busy="true"]');
    await expect(pending).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const selector = testInfo.project.name === "mobile-chrome" ? ".mobile-nav" : ".sidebar";
    const anchor = page.locator(selector);
    const before = { anchorCount: await anchor.count(), shellCount: await page.locator(".workspace-shell").count() };
    await testInfo.attach("pending-anchors", { body: JSON.stringify(before), contentType: "application/json" });
    await expect(anchor).toBeVisible({ timeout: 1_500 });
    const pendingBox = await anchor.boundingBox();
    await expect(pending).toHaveCount(0, { timeout: 15_000 });
    await expect(anchor).toBeVisible();
    const readyBox = await anchor.boundingBox();
    await testInfo.attach("anchor-geometry", { body: JSON.stringify({ pendingBox, readyBox }), contentType: "application/json" });
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(readyBox![key] - pendingBox![key])).toBeLessThanOrEqual(1);
    }
  });
  test(`${theme} error retry preserves workspace anchors for ${view}`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([{ name: "vosio-theme", value: theme, url: baseURL! }]);
    await page.addInitScript(() => {
      sessionStorage.setItem(`vosio.recordings-route-retry:${location.pathname}${location.search}`, String(Date.now() + 30_000));
    });
    await page.goto(`/login/workspace-loading-e2e?scope=${randomBytes(6).toString("hex")}&view=${view}&state=error`);
    const anchor = page.locator(testInfo.project.name === "mobile-chrome" ? ".mobile-nav" : ".sidebar");
    await expect(anchor).toBeVisible();
    const errorBox = await anchor.boundingBox();
    await page.getByRole("button", { name: "Zkusit znovu", exact: true }).click();
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    const loadingBox = await anchor.boundingBox();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const readyBox = await anchor.boundingBox();
    await testInfo.attach("error-retry-geometry", { body: JSON.stringify({ errorBox, loadingBox, readyBox }), contentType: "application/json" });
    for (const box of [loadingBox, readyBox]) for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(box![key] - errorBox![key])).toBeLessThanOrEqual(1);
    }
  });
}
}
