import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const systemActionItemsId = "00000000-0000-4000-8000-000000000952";
const defaultActionItemsPrompt = "Najdi v přepisu potvrzené úkoly, termíny a jejich vlastníky.";
const concurrentActionItemsPrompt = "Současná změna z jiné karty má přednost před zastaralým konceptem.";

// createFixtureScope supplies the exact guard token required by the development route.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// fixtureHref builds one isolated real-component prompt/archive surface.
function fixtureHref(view: "templates" | "ai") {
  return `/login/prompts-ai-e2e?scope=${createFixtureScope()}&view=${view}`;
}

// templateFixtureHref opens one system-owned action while preserving the isolated fixture scope.
function templateFixtureHref(templateId: string, action?: "conflict") {
  const url = new URL(fixtureHref("templates"), "https://vosio.local");
  url.searchParams.set("template", templateId);
  if (action) url.searchParams.set("action", action);
  return `${url.pathname}${url.search}`;
}

test("the prompts/archive fixture rejects missing and malformed guards", async ({ request }) => {
  expect((await request.get("/login/prompts-ai-e2e")).status()).toBe(404);
  expect((await request.get("/login/prompts-ai-e2e?scope=bad&view=templates")).status()).toBe(404);
  expect((await request.get("/login/prompts-ai-e2e?scope=a1b2c3d4e5f6&view=other")).status()).toBe(404);
});

test("desktop prompt master-detail and mobile Back preserve URL history", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(fixtureHref("templates"));
  await expect(page.getByRole("heading", { level: 1, name: "AI prompty" })).toBeVisible();
  await expect(page.locator(".prompt-master")).toBeVisible();
  await expect(page.locator(".prompt-editor-surface")).toBeVisible();
  await page.getByRole("link", { name: /Úkoly/ }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("template") === systemActionItemsId);
  await expect(page.getByRole("heading", { level: 2, name: "Úkoly" })).toBeVisible();
  await expect(page.locator(".prompt-advanced-fields")).not.toHaveAttribute("open", "");
  await page.screenshot({ caret: "initial", fullPage: true, path: testInfo.outputPath("prompts-desktop.png") });

  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.locator(".prompt-master")).toBeHidden();
  await expect(page.getByRole("link", { name: "← Zpět na AI prompty" })).toBeVisible();
  await page.getByRole("link", { name: "← Zpět na AI prompty" }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("template") && !url.searchParams.has("mode"));
  await expect(page.locator(".prompt-master")).toBeVisible();
  await expect(page.locator(".prompt-editor-surface")).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL((url) => url.searchParams.get("template") === systemActionItemsId);
});

test("a legacy mobile create deep link canonicalizes to the visible prompt list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  const href = `${fixtureHref("templates")}&mode=create`;
  await page.goto(href);

  await expect(page).toHaveURL((url) => !url.searchParams.has("mode") && !url.searchParams.has("template"));
  await expect(page.locator(".prompt-master")).toBeVisible();
  await expect(page.locator(".prompt-editor-surface")).toBeHidden();
  await expect(page.getByRole("link", { name: /Úkoly/ })).toBeVisible();
});

test("an edited task prompt stays under the same AI action and resets to default", async ({ page }) => {
  await page.goto(templateFixtureHref(systemActionItemsId));
  const prompt = page.getByRole("textbox", { exact: true, name: "Prompt" });
  await expect(page.locator(".prompt-editor-heading").getByText("Výchozí", { exact: true })).toBeVisible();
  await page.getByText("Pokročilé parametry", { exact: true }).click();
  await expect(page.getByLabel("JSON schéma výstupu")).toHaveAttribute("readonly", "");
  await expect(page.getByText("Schéma je pevnou součástí výstupu a nelze je upravit.")).toBeVisible();
  await prompt.fill("Najdi pouze potvrzené úkoly, termíny a jejich vlastníky.");
  await page.getByRole("button", { name: "Uložit změny" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Úkoly" })).toBeVisible();
  await expect(page.locator(".prompt-editor-heading").getByText("Upravený", { exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => url.searchParams.get("template") === systemActionItemsId);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Obnovit výchozí" }).click();
  await expect(page.locator(".prompt-editor-heading").getByText("Výchozí", { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue(defaultActionItemsPrompt);
  await expect(page).toHaveURL((url) => url.searchParams.get("template") === systemActionItemsId);
});

test("a stale revision keeps the draft visible and does not overwrite the fixture row", async ({ page }) => {
  const href = templateFixtureHref(systemActionItemsId, "conflict");
  const draft = "Tento rozpracovaný koncept se při konfliktu nesmí tiše uložit přes novější změnu.";
  await page.goto(href);
  const prompt = page.getByRole("textbox", { exact: true, name: "Prompt" });
  await prompt.fill(draft);
  await page.getByRole("button", { name: "Uložit změny" }).click();

  await expect(page.locator(".prompt-action-state[role='alert']")).toHaveText(
    "Prompt se mezitím změnil v jiné kartě. Obnovte stránku a zkuste změnu znovu."
  );
  await expect(prompt).toHaveValue(draft);

  await page.reload();
  await expect(prompt).toHaveValue(concurrentActionItemsPrompt);
  await expect(prompt).not.toHaveValue(draft);
  await expect(page.locator(".prompt-editor-heading").getByText("Upravený", { exact: true })).toBeVisible();
});

test("archive filters use URL history and recording links distinguish active and trash", async ({ page }, testInfo) => {
  await page.goto(fixtureHref("ai"));
  await expect(page.getByRole("heading", { level: 1, name: "AI archiv" })).toBeVisible();
  await expect(page.locator(".ai-archive-row")).toHaveCount(2);
  await page.screenshot({ caret: "initial", fullPage: true, path: testInfo.outputPath("ai-archive.png") });
  await page.getByLabel("Filtrovat podle typu výstupu").selectOption("summary");
  await expect(page).toHaveURL((url) => url.searchParams.get("type") === "summary");
  await expect(page.locator(".ai-archive-row")).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL((url) => !url.searchParams.has("type"));
  await expect(page.locator(".ai-archive-row")).toHaveCount(2);

  const active = page.getByRole("link", { name: /Aktivní produktový hovor/ });
  const trashed = page.getByRole("link", { name: /Archivovaný klientský hovor V koši/ });
  await expect(active).toHaveAttribute("href", /\/recordings\/.*\?tab=ai$/);
  await expect(trashed).toHaveAttribute("href", "/trash");
});

test("archive delete failure restores only its exact card with a safe alert", async ({ page }) => {
  await page.goto(fixtureHref("ai"));
  page.on("dialog", (dialog) => dialog.accept());
  const card = page.locator(".ai-archive-row").first();
  await card.getByRole("button", { name: /Smazat celý AI výstup/ }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole("alert")).toContainText("AI výstup se nepodařilo smazat.");
  await expect(page.locator(".ai-archive-row")).toHaveCount(2);
  await expect(card).not.toContainText("fixture-private-delete-failure");
});

test("expected archive delete redirect renders one allowlisted alert and preserves filters", async ({ page }) => {
  const href = `${fixtureHref("ai")}&type=summary&error=ai_output_delete_failed`;
  await page.goto(href);

  await expect(page.locator(".ai-archive-action-alert[role='alert']")).toHaveText(
    "AI výstup se nepodařilo smazat. Zkuste to znovu."
  );
  await expect(page).toHaveURL((url) => (
    url.searchParams.get("type") === "summary"
    && url.searchParams.getAll("error").join() === "ai_output_delete_failed"
  ));
  await expect(page.locator(".ai-archive-row")).toHaveCount(1);
});

for (const width of [390, 768, 1440]) {
  test(`prompt and archive surfaces have no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    for (const view of ["templates", "ai"] as const) {
      await page.goto(fixtureHref(view));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);
    }
  });
}

test("prompt and archive content remains readable in dark and light themes", async ({ page }) => {
  await page.goto(fixtureHref("ai"));
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page.locator(".ai-archive-row").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI archiv" })).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(245, 245, 243)" : "rgb(23, 23, 23)"
    );
  }
});
