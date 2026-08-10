import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

// createFixtureScope supplies the exact guard token required by the development route.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// fixtureHref builds one isolated real-component prompt/archive surface.
function fixtureHref(view: "templates" | "ai") {
  return `/login/prompts-ai-e2e?scope=${createFixtureScope()}&view=${view}`;
}

test("the prompts/archive fixture rejects missing and malformed guards", async ({ request }) => {
  expect((await request.get("/login/prompts-ai-e2e")).status()).toBe(404);
  expect((await request.get("/login/prompts-ai-e2e?scope=bad&view=templates")).status()).toBe(404);
  expect((await request.get("/login/prompts-ai-e2e?scope=a1b2c3d4e5f6&view=other")).status()).toBe(404);
});

test("desktop prompt master-detail and mobile Back preserve URL history", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(fixtureHref("templates"));
  await expect(page.getByRole("heading", { level: 1, name: "Prompty" })).toBeVisible();
  await expect(page.locator(".prompt-master")).toBeVisible();
  await expect(page.locator(".prompt-editor-surface")).toBeVisible();
  await page.getByRole("link", { name: /Obchodní follow-up/ }).click();
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("template")));
  await expect(page.getByRole("heading", { level: 2, name: "Obchodní follow-up" })).toBeVisible();
  await expect(page.locator(".prompt-advanced-fields")).not.toHaveAttribute("open", "");
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("prompts-desktop.png") });

  await page.setViewportSize({ width: 375, height: 760 });
  await expect(page.locator(".prompt-master")).toBeHidden();
  await expect(page.getByRole("link", { name: "← Zpět na prompty" })).toBeVisible();
  await page.getByRole("link", { name: "← Zpět na prompty" }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("template") && !url.searchParams.has("mode"));
  await expect(page.locator(".prompt-master")).toBeVisible();
  await expect(page.locator(".prompt-editor-surface")).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("template")));
});

test("system prompt is read-only and copy submits only an inert authoritative id", async ({ page }) => {
  await page.goto(fixtureHref("templates"));
  await page.getByRole("link", { name: /Systémové shrnutí/ }).click();
  await expect(page.getByText(/Systémový prompt · pouze pro čtení/)).toBeVisible();
  await expect(page.locator(".prompt-template-form-readonly textarea").first()).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Vytvořit vlastní kopii" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("template") === "00000000-0000-4000-8000-000000000902");
});

test("prompt error settles safely and preserves the exact mounted draft", async ({ page }) => {
  await page.goto(`${fixtureHref("templates")}&action=error`);
  await page.getByRole("link", { name: /Obchodní follow-up/ }).click();
  const name = page.locator(".prompt-editor-form input[name='name']");
  const prompt = page.locator(".prompt-editor-form textarea[name='promptText']");
  await name.fill("Rozpracovaný prompt");
  await prompt.fill("Rozpracovaný obsah promptu zůstane po bezpečně zpracované chybě beze změny.");
  await page.getByRole("button", { name: "Uložit změny" }).click();
  await expect(page.locator("fieldset[data-prompt-editor-fields]")).toHaveAttribute("disabled", "");
  await expect(page.locator("[data-prompt-surface]")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".prompt-mobile-back")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".prompt-action-state[role='alert']")).toContainText("Prompt se nepodařilo uložit.");
  await expect(name).toHaveValue("Rozpracovaný prompt");
  await expect(prompt).toHaveValue("Rozpracovaný obsah promptu zůstane po bezpečně zpracované chybě beze změny.");
});

test("deferred prompt update locks navigation and keeps the successful submitted snapshot", async ({ page }) => {
  await page.goto(fixtureHref("templates"));
  await page.getByRole("link", { name: /Obchodní follow-up/ }).click();
  const name = page.locator(".prompt-editor-form input[name='name']");
  const prompt = page.locator(".prompt-editor-form textarea[name='promptText']");
  await name.fill("Přesný úspěšný snapshot");
  await prompt.fill("Přesný obsah úspěšně odeslaného snapshotu zůstane stabilní během celé akce.");
  await page.getByRole("button", { name: "Uložit změny" }).click();

  await expect(page.locator("fieldset[data-prompt-editor-fields]")).toHaveAttribute("disabled", "");
  await expect(page.locator(".prompt-mobile-back")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".prompt-action-state[role='status']")).toHaveText("Fixture zůstala pouze lokální.");
  await expect(name).toHaveValue("Přesný úspěšný snapshot");
  await expect(prompt).toHaveValue("Přesný obsah úspěšně odeslaného snapshotu zůstane stabilní během celé akce.");
});

test("deferred prompt create locks its editable snapshot until success", async ({ page }) => {
  await page.goto(fixtureHref("templates"));
  await page.getByRole("link", { name: "Nový" }).click();
  await page.locator("input[name='name']").fill("Nový snapshot");
  await page.locator("textarea[name='promptText']").fill(
    "Nový vytvořený prompt má dostatečně dlouhý a stabilní obsah pro odloženou akci."
  );
  await page.getByRole("button", { name: "Vytvořit prompt" }).click();

  await expect(page.locator("fieldset[data-prompt-editor-fields]")).toHaveAttribute("disabled", "");
  await expect(page.locator(".prompt-mobile-back")).toHaveAttribute("aria-disabled", "true");
  await expect(page).toHaveURL((url) => url.searchParams.get("template") === "00000000-0000-4000-8000-000000000902");
});

test("archive filters use URL history and recording links distinguish active and trash", async ({ page }, testInfo) => {
  await page.goto(fixtureHref("ai"));
  await expect(page.getByRole("heading", { level: 1, name: "AI archiv" })).toBeVisible();
  await expect(page.locator(".ai-archive-row")).toHaveCount(2);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("ai-archive.png") });
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

for (const width of [375, 768, 1024, 1440]) {
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
      theme === "dark" ? "rgb(243, 240, 234)" : "rgb(37, 36, 33)"
    );
  }
});
