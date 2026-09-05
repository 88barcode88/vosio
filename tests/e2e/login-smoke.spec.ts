import { expect, test } from "@playwright/test";

test.describe("internal login smoke", () => {
  test("redirects an unauthenticated visitor to the login page", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Přihlášení" })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Heslo")).toBeVisible();
  });

  test("uses the shared focus ring for login inputs", async ({ page }) => {
    await page.goto("/");

    const email = page.getByLabel("E-mail");
    await email.focus();
    const focus = await email.evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderColor: style.borderColor, boxShadow: style.boxShadow };
    });
    expect(focus).toEqual({
      borderColor: "rgb(116, 167, 255)",
      boxShadow: "rgb(116, 167, 255) 0px 0px 0px 3px"
    });
    expect(JSON.stringify(focus)).not.toContain("56, 217, 208");
  });
});
