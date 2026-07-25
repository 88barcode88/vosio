import { expect, test } from "@playwright/test";

test.describe("internal login smoke", () => {
  test("redirects an unauthenticated visitor to the login page", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Přihlášení" })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Heslo")).toBeVisible();
  });
});
