import { expect, test } from "@playwright/test";
test("capture keeps its approved snapshot and bulk retry never presents partial success", async ({ page }) => {
  await page.goto("/login/project-sharing-e2e?scope=123456abcdef");
  await page.getByLabel("Schválený výběr").check();
  await page.getByRole("button", { name: "Zahájit místní pokus" }).click();
  await page.getByLabel("Schválený výběr").uncheck();
  await expect(page.getByLabel("Scope relace")).toContainText('"visibility":"selected"');
  await expect(page.getByLabel("Scope relace")).toContainText("99000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Sdílet nebo zopakovat celý výběr" }).click();
  await expect(page.getByLabel("Bulk výsledek")).toContainText("Sdíleno 0");
  await page.getByRole("button", { name: "Sdílet nebo zopakovat celý výběr" }).click();
  await expect(page.getByLabel("Bulk výsledek")).toContainText("Sdíleno 2, request 99000000-0000-4000-8000-000000000001");
});
