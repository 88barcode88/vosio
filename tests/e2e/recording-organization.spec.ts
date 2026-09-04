import { randomBytes } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";

// createFixtureScope isolates desktop and mobile projects in the dev-only server store.
function createFixtureScope() {
  return randomBytes(6).toString("hex").slice(0, 11);
}

// createManagerEntity completes one real manager disclosure and waits for its persisted row.
async function createManagerEntity(
  page: Page,
  triggerName: string,
  name: string,
  clientName?: string
) {
  await page.getByRole("button", { name: triggerName, exact: true }).click();
  const form = page.locator("form.organization-create-form");
  await expect(form).toBeVisible();
  if (clientName) await form.getByLabel("Klient").selectOption({ label: clientName });
  await form.getByLabel("Název").fill(name);
  await form.getByRole("button", { name: "Uložit" }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "Správa organizace" })
    .locator(".organization-manager-badge", { hasText: name })).toBeVisible();
}

// checkedTag returns one real filter checkbox by its visible tag label.
function checkedTag(filters: Locator, name: string) {
  return filters.getByRole("checkbox", { name });
}

// ensureAdvancedFiltersOpen restores the disclosure after URL-driven server rerenders.
async function ensureAdvancedFiltersOpen(filters: Locator) {
  const trigger = filters.getByRole("button", { name: /^Filtry \(\d+\)$/u });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
}

let fixtureScope = "";

test.beforeEach(() => {
  fixtureScope = createFixtureScope();
});

test.afterEach(async ({ request }) => {
  if (fixtureScope) {
    await request.delete(`/login/recording-organization-e2e/fixture?scope=${fixtureScope}`);
  }
});

test("creates, assigns and preserves canonical ALL-tag filters across refresh", async ({ page }) => {
  test.slow();
  const scope = fixtureScope;
  await page.goto(`/login/recording-organization-e2e?scope=${scope}&q=call`);
  await expect(page.getByRole("heading", { name: "Recording organization E2E fixture" })).toBeVisible();
  await page.getByRole("button", { name: "Spravovat" }).click();

  await createManagerEntity(page, "Přidat klienta", "Acme");
  await createManagerEntity(page, "Přidat projekt", "Project X", "Acme");
  await createManagerEntity(page, "Přidat štítek", "Important");
  await createManagerEntity(page, "Přidat štítek", "Follow-up");

  await expect(page.getByText("Foreign Client", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Foreign Project", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Foreign Tag", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Zavřít správu organizace" }).click();

  const assignment = page.locator('[data-e2e-surface="assignment"]');
  await assignment.getByRole("button", { name: "Upravit zařazení" }).click();
  const assignmentForm = assignment.locator("form.recording-organization-form");
  await assignmentForm.getByLabel("Klient").selectOption({ label: "Acme" });
  await assignmentForm.getByLabel("Projekt").selectOption({ label: "Project X" });
  await assignmentForm.getByRole("checkbox", { name: "Important" }).check();
  await assignmentForm.getByRole("checkbox", { name: "Follow-up" }).check();
  await assignmentForm.getByRole("button", { name: "Uložit" }).click();
  await expect(assignmentForm).not.toBeVisible();
  await expect(assignment).toContainText("Acme");
  await expect(assignment).toContainText("Project X");
  await expect(assignment).toContainText("Important");
  await expect(assignment).toContainText("Follow-up");

  const filters = page.getByRole("form", { name: "Filtrování nahrávek" });
  await ensureAdvancedFiltersOpen(filters);
  await expect(filters.getByLabel("Projekt")).toBeDisabled();
  await filters.getByLabel("Klient").selectOption({ label: "Acme" });
  await expect(page).toHaveURL((url) => url.searchParams.get("scope") === scope
    && url.searchParams.get("q") === "call"
    && Boolean(url.searchParams.get("client"))
    && !url.searchParams.has("project"));
  await ensureAdvancedFiltersOpen(filters);
  await filters.getByLabel("Projekt").selectOption({ label: "Project X" });
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("project")));
  await ensureAdvancedFiltersOpen(filters);
  await filters.getByLabel("Klient").selectOption("");
  await expect(page).toHaveURL((url) => !url.searchParams.has("client")
    && !url.searchParams.has("project"));
  await ensureAdvancedFiltersOpen(filters);
  await expect(filters.getByLabel("Projekt")).toBeDisabled();
  await expect(filters.getByLabel("Projekt")).toHaveValue("");
  await filters.getByLabel("Klient").selectOption({ label: "Acme" });
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("client")));
  await ensureAdvancedFiltersOpen(filters);
  await filters.getByLabel("Projekt").selectOption({ label: "Project X" });
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("project")));
  await ensureAdvancedFiltersOpen(filters);
  await checkedTag(filters, "Important").check();
  await expect(page).toHaveURL((url) => url.searchParams.getAll("tag").length === 1);
  await ensureAdvancedFiltersOpen(filters);
  await checkedTag(filters, "Follow-up").check();
  await expect(page).toHaveURL((url) => url.searchParams.getAll("tag").length === 2);

  await expect(page).toHaveURL((url) => {
    const params = url.searchParams;
    return params.get("scope") === scope
      && params.get("q") === "call"
      && Boolean(params.get("client"))
      && Boolean(params.get("project"))
      && params.getAll("tag").length === 2;
  });
  await expect(page.getByText("Call Acme hlavní", { exact: true })).toBeVisible();
  await expect(page.getByText("Call jen jeden štítek", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Acme/ }).last()).toBeVisible();
  await expect(page.getByText("Filtrovaný výsledek: 1 nahrávka.")).toBeVisible();

  await page.reload();
  const refreshedFilters = page.getByRole("form", { name: "Filtrování nahrávek" });
  await ensureAdvancedFiltersOpen(refreshedFilters);
  await expect(refreshedFilters.getByLabel("Hledat")).toHaveValue("call");
  await expect(refreshedFilters.getByLabel("Klient")).toHaveValue(/.+/);
  await expect(refreshedFilters.getByLabel("Projekt")).toHaveValue(/.+/);
  await expect(checkedTag(refreshedFilters, "Important")).toBeChecked();
  await expect(checkedTag(refreshedFilters, "Follow-up")).toBeChecked();
  await expect(page.getByText("Call Acme hlavní", { exact: true })).toBeVisible();
  await expect(page.getByText("Call jen jeden štítek", { exact: true })).toHaveCount(0);

  await refreshedFilters.getByRole("button", { name: "Vyčistit filtry" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "call"
    && !url.searchParams.has("client")
    && !url.searchParams.has("project")
    && !url.searchParams.has("folder")
    && !url.searchParams.has("tag"));
  await expect(page.getByText("Call Acme hlavní", { exact: true })).toBeVisible();
  await expect(page.getByText("Call jen jeden štítek", { exact: true })).toBeVisible();
  await expect(page.getByText("Filtrovaný výsledek: 2 nahrávky.")).toBeVisible();
});

test("uses the accessible color popover, preserves focus and renders badges in both themes", async ({ page }) => {
  test.slow();
  await page.goto(`/login/recording-organization-e2e?scope=${fixtureScope}`);
  await expect(page.getByRole("heading", { name: "Recording organization E2E fixture" })).toBeVisible();
  await page.getByRole("button", { name: "Spravovat" }).click();

  await createManagerEntity(page, "Přidat klienta", "Neutral");
  await page.getByRole("button", { name: "Přidat klienta", exact: true }).click();
  const colorPicker = page.getByRole("button", { name: "Vybrat barvu Přidat klienta" });
  const hiddenColor = page.locator('input[type="hidden"][name="color"]');
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await expect(colorPicker).toHaveAttribute("aria-haspopup", "dialog");
  await expect(colorPicker).toHaveAttribute("aria-expanded", "false");
  await colorPicker.click();
  const colorDialog = page.getByRole("dialog", { name: "Barva Přidat klienta" });
  await expect(colorDialog).toBeVisible();
  const pickerBackgrounds: string[] = [];
  for (const theme of ["dark", "light"] as const) {
    await page.locator("html").evaluate((element, nextTheme) => { element.dataset.theme = nextTheme; }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    pickerBackgrounds.push(await colorDialog.evaluate((element) => getComputedStyle(element).backgroundColor));
    const controlHeights = await colorDialog.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height)
    );
    expect(controlHeights.every((height) => height >= 44)).toBe(true);
  }
  expect(pickerBackgrounds[0]).not.toBe(pickerBackgrounds[1]);
  const customColor = colorDialog.getByLabel("Vlastní HEX barva");
  const applyCustomColor = colorDialog.getByRole("button", { name: "Použít" });
  await expect(customColor).toHaveCSS("min-height", "44px");
  await customColor.fill("#12GG45");
  await applyCustomColor.click();
  await expect(hiddenColor).toHaveValue("");
  await expect(colorDialog).toBeVisible();
  await expect(colorDialog.getByRole("alert")).toContainText("#RRGGBB");
  await customColor.fill("#13579B");
  await applyCustomColor.click();
  await expect(hiddenColor).toHaveValue("#13579B");
  await expect(colorDialog).toHaveCount(0);
  await expect(colorPicker).toBeFocused();
  const nameInput = page.getByRole("textbox", { name: "Název" });
  await nameInput.fill("Palette");

  await colorPicker.click();
  await nameInput.click();
  await expect(colorDialog).toHaveCount(0);
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveValue("Palette");

  await colorPicker.click();
  await colorDialog.press("Escape");
  await expect(colorDialog).toHaveCount(0);
  await expect(colorPicker).toBeFocused();
  await expect(page.locator("form.organization-create-form")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Správa organizace" })).toBeVisible();
  await expect(colorPicker).toHaveCSS("min-height", "44px");
  await page.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByRole("textbox", { name: "Název" })).toHaveCount(0);

  const manager = page.getByRole("dialog", { name: "Správa organizace" });
  const badge = manager.locator(".organization-manager-badge", { hasText: "Palette" });
  const neutralBadge = manager.locator(".organization-manager-badge", { hasText: "Neutral" });
  await expect(badge).toBeVisible();
  await expect(neutralBadge).toBeVisible();
  await expect(badge).toHaveClass(/organization-manager-badge-colored/);
  await expect(neutralBadge).not.toHaveClass(/organization-manager-badge-colored/);
  await expect(badge).toHaveCSS("--organization-color", "#13579B");
  for (const theme of ["dark", "light"] as const) {
    await page.locator("html").evaluate((element, nextTheme) => { element.dataset.theme = nextTheme; }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const coloredBackground = await badge.evaluate((element) => getComputedStyle(element).backgroundColor);
    const neutralBackground = await neutralBadge.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(coloredBackground).not.toBe(neutralBackground);
  }

  await page.getByRole("button", { name: "Přejmenovat Palette", exact: true }).click();
  await page.getByRole("button", { name: "Vybrat barvu Přejmenovat Palette" }).click();
  await expect(page.getByLabel("Vlastní HEX barva")).toHaveValue("#13579B");
  await page.getByRole("button", { name: "Bez barvy" }).click();
  await expect(page.locator('input[type="hidden"][name="color"]')).toHaveValue("");
  await page.getByRole("button", { name: "Uložit" }).click();
  await expect(page.getByRole("button", { name: "Bez barvy" })).toHaveCount(0);
  await expect(badge).not.toHaveClass(/organization-manager-badge-colored/);
});
