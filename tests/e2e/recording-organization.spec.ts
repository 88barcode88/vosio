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
  await expect(page.getByText(name).first()).toBeVisible();
}

// checkedTag returns one real filter checkbox by its visible tag label.
function checkedTag(filters: Locator, name: string) {
  return filters.getByRole("checkbox", { name });
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
  const scope = fixtureScope;
  await page.goto(`/login/recording-organization-e2e?scope=${scope}&q=call`);
  await expect(page.getByRole("heading", { name: "Recording organization E2E fixture" })).toBeVisible();

  await createManagerEntity(page, "Přidat klienta", "Acme");
  await createManagerEntity(page, "Přidat projekt", "Project X", "Acme");
  await createManagerEntity(page, "Přidat štítek", "Important");
  await createManagerEntity(page, "Přidat štítek", "Follow-up");

  await expect(page.getByText("Foreign Client", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Foreign Project", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Foreign Tag", { exact: true })).toHaveCount(0);

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
  await expect(filters.getByLabel("Projekt")).toBeDisabled();
  await filters.getByLabel("Klient").selectOption({ label: "Acme" });
  await filters.getByLabel("Projekt").selectOption({ label: "Project X" });
  await filters.getByLabel("Klient").selectOption("");
  await expect(filters.getByLabel("Projekt")).toBeDisabled();
  await expect(filters.getByLabel("Projekt")).toHaveValue("");
  await filters.getByLabel("Klient").selectOption({ label: "Acme" });
  await filters.getByLabel("Projekt").selectOption({ label: "Project X" });
  await checkedTag(filters, "Important").check();
  await checkedTag(filters, "Follow-up").check();
  await filters.getByRole("button", { name: "Použít filtry" }).click();

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
