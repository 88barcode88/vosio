import { randomBytes } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";

type Surface = "detail" | "list";

// createFixtureScope isolates every browser/project run inside the in-memory fixture store.
function createFixtureScope(): string {
  return randomBytes(6).toString("hex").slice(0, 11);
}

// getEditorTrigger returns the real trigger used by the selected production editor.
function getEditorTrigger(surface: Surface, fixture: Locator): Locator {
  return surface === "detail"
    ? fixture.locator("summary")
    : fixture.getByRole("button", { name: /Upravit/ });
}

// openFixture loads one isolated development-only title-editor fixture.
async function openFixture(page: Page, surface: Surface): Promise<Locator> {
  await page.goto(`/login/save-and-collapse-e2e?scope=${createFixtureScope()}`);
  const fixture = page.locator(`[data-e2e-surface="${surface}"]`);
  await expect(fixture).toBeVisible();
  return fixture;
}

for (const surface of ["detail", "list"] as const) {
  test(`${surface} editor persists success and preserves a failed draft`, async ({ page }) => {
    const fixture = await openFixture(page, surface);
    const trigger = getEditorTrigger(surface, fixture);
    const savedTitle = fixture.locator("[data-e2e-saved-title]");
    const form = fixture.locator("form.recording-title-form");
    const input = form.locator('input[name="title"]');
    const persistedValue = `Uložený ${surface} název`;
    const rejectedValue = `FAIL: rozepsaný ${surface} název`;

    await trigger.click();
    await expect(form).toBeVisible();
    await input.fill(persistedValue);
    await form.getByRole("button", { name: "Uložit" }).click();

    await expect(form).not.toBeVisible();
    await expect(savedTitle).toHaveText(persistedValue);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(input).toHaveValue(persistedValue);
    await input.fill(rejectedValue);
    await form.getByRole("button", { name: "Uložit" }).click();

    await expect(form).toBeVisible();
    await expect(form.getByRole("alert")).toHaveText(
      "Testovací uložení bylo záměrně odmítnuto."
    );
    await expect(input).toHaveValue(rejectedValue);
    await expect(savedTitle).toHaveText(persistedValue);
  });
}
