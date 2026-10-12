import { expect, test } from "@playwright/test";

// These UI transport fixtures do not verify real Supabase Auth, email delivery, RLS or SQL races.
test.describe("invitation acceptance UI with mocked API", () => {
  test("opening a fragment link only previews; explicit acceptance sends exactly one POST", async ({ page }) => {
    const token = "a".repeat(43);
    let accepts = 0;
    await page.route("**/api/recording-invitations", async (route) => {
      expect(route.request().method()).toBe("GET");
      expect(route.request().headers()["x-invitation-token"]).toBe(token);
      await route.fulfill({ json: { id: "10000000-0000-4000-8000-000000000001", role: "reader", scope: "recordings", expiresAt: "2030-01-01T00:00:00Z", recordingCount: 1 } });
    });
    await page.route("**/api/recording-invitations/accept", async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ token });
      accepts += 1; await route.fulfill({ json: { id: "10000000-0000-4000-8000-000000000001" } });
    });
    await page.goto(`/invitations/accept#token=${token}&type=email`);
    await expect(page.getByRole("button", { name: "Přijmout pozvánku" })).toBeVisible();
    await expect(page).toHaveURL(/\/invitations\/accept$/);
    expect(accepts).toBe(0);
    await page.getByRole("button", { name: "Přijmout pozvánku" }).click();
    await expect(page.getByRole("link", { name: "Otevřít nahrávky" })).toBeVisible();
    expect(accepts).toBe(1);
  });

  test("unavailable preview exposes no content and displays OTP-only onboarding", async ({ page }) => {
    await page.route("**/api/recording-invitations", (route) => route.fulfill({ status: 403, json: { error: "unavailable" } }));
    await page.goto(`/invitations/accept#token=${"b".repeat(43)}&type=invite`);
    await expect(page.getByLabel("E-mail z pozvánky")).toBeVisible();
    await expect(page.getByLabel("Nové heslo", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Přijmout pozvánku" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /registrovat/i })).toHaveCount(0);
  });
});
