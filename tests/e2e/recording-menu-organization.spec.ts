import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupOrganizationFixture } from "./support/organization-fixture-cleanup";

test("row menu opens assignment controls within the viewport and cancels without saving", async ({ page }, testInfo) => {
  const scope = randomBytes(6).toString("hex").slice(0, 11);
  try {
    await page.goto(`/login/recording-organization-e2e?scope=${scope}`);
    const menu = page.locator(".recordings-row").first().locator(".recordings-actions-menu");
    await menu.locator(":scope > summary").click();
    await menu.getByText("Upravit zařazení", { exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Zařazení nahrávky" });
    await expect(dialog).toBeVisible();
    for (const name of ["Klient", "Projekt", "Složka"]) {
      await expect(dialog.getByRole("combobox", { name, exact: true })).toBeVisible();
    }
    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.screenshot({ path: testInfo.outputPath("assignment-menu.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Zrušit", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(menu.getByText("Upravit zařazení", { exact: true })).toBeFocused();
  } finally {
    await cleanupOrganizationFixture(page.request, scope);
  }
});
