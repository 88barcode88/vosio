import { randomBytes } from "node:crypto";
import { expect, type Locator, type Page, test } from "@playwright/test";

// createFixtureScope isolates the guarded recordings inbox fixture in the dev server store.
function createFixtureScope() {
  return randomBytes(6).toString("hex").slice(0, 11);
}

// fixturePath builds a development-only recordings inbox URL for one isolated test scope.
function fixturePath(scope: string, suffix = "") {
  return `/login/recording-organization-e2e?scope=${scope}${suffix}`;
}

// getBox requires a rendered geometry box before making row/card assertions.
async function getBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

// expectNoHorizontalOverflow checks both the document and one explicit recordings surface.
async function expectNoHorizontalOverflow(page: Page, surfaceSelector = ".recordings-inbox") {
  expect(await page.evaluate((selector) => {
    const inbox = document.querySelector<HTMLElement>(selector)!;
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inbox: inbox.scrollWidth - inbox.clientWidth
    };
  }, surfaceSelector)).toEqual({ document: 0, inbox: 0 });
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

for (const width of [375, 768, 1024, 1440]) {
  test(`real recordings inbox is responsive and theme-safe at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto(fixturePath(fixtureScope));

    const disclosure = page.getByRole("button", { name: "Spravovat" });
    const management = page.getByRole("region", { name: "Správa organizace" });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(management).toBeHidden();
    await disclosure.click();
    await expect(management).toBeVisible();
    await expect(management.getByRole("heading", { name: "Klienti" })).toBeVisible();
    await expect(management.getByRole("heading", { name: "Projekty" })).toBeVisible();
    await expect(management.getByRole("heading", { name: "Složky" })).toBeVisible();
    await expect(management.getByRole("heading", { name: "Štítky" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Filtrování nahrávek" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Bez klienta/ })).toBeVisible();

    const row = page.locator(".recordings-row").first();
    const main = row.locator(".recordings-row-main");
    const actions = row.locator(".recordings-row-actions");
    const [rowBox, mainBox, actionsBox] = await Promise.all([getBox(row), getBox(main), getBox(actions)]);
    const [inboxBox, tableBox] = await Promise.all([
      getBox(page.locator(".recordings-inbox")),
      getBox(page.locator(".recordings-table"))
    ]);
    for (const box of [tableBox, rowBox, mainBox, actionsBox]) {
      expect(box.x).toBeGreaterThanOrEqual(inboxBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(inboxBox.x + inboxBox.width + 1);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(width + 0.5);
    if (width <= 900) {
      expect(actionsBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 0.5);
      for (const control of await page.locator(
        ".recording-filters input, .recording-filters select, .recording-filters button, .recordings-row-actions button"
      ).all()) {
        const box = await getBox(control);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      expect(actionsBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width - 0.5);
    }

    const colors: string[] = [];
    for (const theme of ["dark", "light"] as const) {
      await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      colors.push(await page.locator(".recordings-inbox").evaluate((element) =>
        getComputedStyle(element).backgroundColor
      ));
      await expectNoHorizontalOverflow(page);
    }
    expect(colors[0]).not.toBe(colors[1]);
    await page.screenshot({ caret: "initial", path: testInfo.outputPath(`recordings-${width}.png`), fullPage: true });
  });
}

test("URL-backed filters survive Back and Forward and the title remains the detail opener", async ({ page }) => {
  const scope = fixtureScope;
  await page.goto(fixturePath(scope));
  await page.getByRole("button", { name: "Spravovat" }).click();

  const create = async (trigger: string, name: string, client?: string) => {
    await page.getByRole("button", { name: trigger, exact: true }).click();
    const form = page.locator("form.organization-create-form");
    if (client) await form.getByLabel("Klient").selectOption({ label: client });
    await form.getByLabel("Název").fill(name);
    await form.getByRole("button", { name: "Uložit" }).click();
    await expect(form).toBeHidden();
  };
  await create("Přidat klienta", "Acme");
  await create("Přidat projekt", "CRM", "Acme");
  await create("Přidat složku", "Hovory");
  await create("Přidat štítek", "Důležité");

  const filters = page.getByRole("form", { name: "Filtrování nahrávek" });
  await filters.getByLabel("Hledat").fill("Call");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Call");
  await filters.getByLabel("Klient").selectOption({ label: "Acme" });
  await filters.getByLabel("Projekt").selectOption({ label: "CRM" });
  await filters.getByLabel("Složka").selectOption({ label: "Hovory" });
  await filters.getByRole("checkbox", { name: "Důležité" }).check();
  await expect(page).toHaveURL((url) => url.searchParams.getAll("tag").length === 1);

  const selectedUrl = new URL(page.url());
  selectedUrl.searchParams.set("page", "2");
  await page.goto(selectedUrl.toString());
  const pageTwoUrl = page.url();
  const restoredFilters = page.getByRole("form", { name: "Filtrování nahrávek" });
  await restoredFilters.getByLabel("Složka").selectOption("");
  await expect(page).toHaveURL((url) => !url.searchParams.has("page") && !url.searchParams.has("folder"));

  await page.goBack();
  await expect(page).toHaveURL(pageTwoUrl);
  await expect(restoredFilters.getByLabel("Hledat")).toHaveValue("Call");
  await expect(restoredFilters.getByLabel("Klient")).toHaveValue(/.+/);
  await expect(restoredFilters.getByLabel("Projekt")).toHaveValue(/.+/);
  await expect(restoredFilters.getByLabel("Složka")).toHaveValue(/.+/);
  await expect(restoredFilters.getByRole("checkbox", { name: "Důležité" })).toBeChecked();
  await page.goForward();
  await expect(restoredFilters.getByLabel("Složka")).toHaveValue("");

  await filters.getByRole("button", { name: "Vyčistit filtry" }).click();
  const title = page.getByRole("link", { name: /Detail nahrávky Call Acme hlavní/ });
  await expect(title).toHaveAttribute("href", /\/recordings\/[^?]+$/u);
  expect(await title.textContent()).not.toContain("Otevřít");
});

test("indexed deep links, filtered empty and sanitized search errors expose recovery actions", async ({ page }) => {
  await page.goto(fixturePath(fixtureScope, "&fixture=indexed&q=Call"));
  const result = page.getByRole("link", { name: /Otevřít nalezenou nahrávku/ }).first();
  await expect(result).toHaveAttribute("href", /\?tab=transcript&at=1200&highlight=Call$/u);

  await page.goto(fixturePath(fixtureScope, "&q=nenalezeno"));
  await expect(page.getByText("Žádné odpovídající nahrávky", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vyčistit hledání a filtry" })).toBeVisible();

  await page.goto(fixturePath(fixtureScope, "&fixture=search-error&q=Call"));
  await expect(page.locator(".recordings-search-error .recordings-alert"))
    .toContainText("Hledání se nepodařilo načíst.");
  await expect(page.getByRole("button", { name: "Zkusit znovu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vyčistit hledání a filtry" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("provider detail");
});

for (const width of [901, 1024, 1440]) {
  test(`failed delete feedback reserves visible desktop space at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(fixturePath(fixtureScope, "&fixture=delete-failure"));
    const shell = page.locator("[data-delete-failure-shell]");
    const content = page.locator("[data-delete-failure-content]");
    const inbox = page.locator("[data-delete-failure-harness]");
    const [contentBox, shellBox] = await Promise.all([getBox(content), getBox(shell)]);
    expect(shellBox.width).toBeCloseTo(width, 0);
    expect(contentBox.width).toBeCloseTo(width - 248, 0);

    for (const surface of [
      {
        buttonName: "Smazat fixture řádek",
        boundary: "[data-delete-failure-table]",
        fields: ".recordings-row-main > *",
        main: ".recordings-row-main",
        next: "[data-after-delete-failure-table]",
        target: "[data-delete-failure-row]"
      },
      {
        buttonName: "Smazat fixture search kartu",
        boundary: "[data-delete-failure-search-card]",
        fields: null,
        main: ".recording-search-result-main",
        next: "[data-after-delete-failure-search-card]",
        target: "[data-delete-failure-search-card]"
      }
    ]) {
      const target = page.locator(surface.target);
      const actions = target.locator(".recordings-row-actions");
      const main = target.locator(surface.main);
      const button = target.getByRole("button", { name: surface.buttonName });
      await target.scrollIntoViewIfNeeded();
      const [normalActionsBox, normalMainBox, normalTargetBox] = await Promise.all([
        getBox(actions),
        getBox(main),
        getBox(target)
      ]);
      const normalGridColumns = await target.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns
      );
      expect(normalMainBox.x).toBeGreaterThanOrEqual(normalTargetBox.x - 0.5);
      expect(normalMainBox.x + normalMainBox.width)
        .toBeLessThanOrEqual(normalTargetBox.x + normalTargetBox.width + 0.5);
      if (width === 901) {
        expect(normalActionsBox.y)
          .toBeGreaterThanOrEqual(normalMainBox.y + normalMainBox.height - 0.5);
        expect(normalActionsBox.width).toBeGreaterThanOrEqual(normalTargetBox.width - 2.5);
      } else {
        expect(normalActionsBox.x)
          .toBeGreaterThanOrEqual(normalMainBox.x + normalMainBox.width - 0.5);
        expect(normalActionsBox.width).toBeCloseTo(116, 0);
      }
      if (surface.fields) {
        const fieldBoxes = await Promise.all(
          (await target.locator(surface.fields).all()).map((field) => getBox(field))
        );
        for (const fieldBox of fieldBoxes) {
          expect(fieldBox.x).toBeGreaterThanOrEqual(normalMainBox.x - 0.5);
          expect(fieldBox.x + fieldBox.width)
            .toBeLessThanOrEqual(normalMainBox.x + normalMainBox.width + 0.5);
        }
        for (let left = 0; left < fieldBoxes.length; left += 1) {
          for (let right = left + 1; right < fieldBoxes.length; right += 1) {
            const a = fieldBoxes[left];
            const b = fieldBoxes[right];
            const overlap = a.x < b.x + b.width - 0.5
              && a.x + a.width > b.x + 0.5
              && a.y < b.y + b.height - 0.5
              && a.y + a.height > b.y + 0.5;
            expect(overlap).toBe(false);
          }
        }
      }
      await expectNoHorizontalOverflow(page, "[data-delete-failure-harness]");
      await button.click();
      await expect(target).toHaveAttribute("data-optimistic-deleted", "true");
      await expect(target).toHaveCSS("opacity", "0", { timeout: 600 });
      const [pendingActionsBox, pendingMainBox, pendingTargetBox, pendingLayout] = await Promise.all([
        getBox(actions),
        getBox(main),
        getBox(target),
        target.evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            gridTemplateColumns: styles.gridTemplateColumns,
            pointerEvents: styles.pointerEvents
          };
        })
      ]);
      expect(Math.abs(pendingActionsBox.width - normalActionsBox.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(pendingMainBox.width - normalMainBox.width)).toBeLessThanOrEqual(2);
      const normalTracks = normalGridColumns.split(" ").map(Number.parseFloat);
      const pendingTracks = pendingLayout.gridTemplateColumns.split(" ").map(Number.parseFloat);
      expect(pendingTracks).toHaveLength(normalTracks.length);
      for (let track = 0; track < normalTracks.length; track += 1) {
        expect(Math.abs(pendingTracks[track] - normalTracks[track])).toBeLessThanOrEqual(2);
      }
      expect(pendingLayout.pointerEvents).toBe("none");
      for (const box of [pendingMainBox, pendingActionsBox]) {
        expect(box.x).toBeGreaterThanOrEqual(pendingTargetBox.x - 0.5);
        expect(box.x + box.width)
          .toBeLessThanOrEqual(pendingTargetBox.x + pendingTargetBox.width + 0.5);
      }
      await expectNoHorizontalOverflow(page, "[data-delete-failure-harness]");

      const alert = target.getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(target).not.toHaveAttribute("data-optimistic-deleted", "true");
      const [actionsBox, alertBox, boundaryBox, buttonBox, mainBox, nextBox, targetBox] = await Promise.all([
        getBox(actions),
        getBox(alert),
        getBox(page.locator(surface.boundary)),
        getBox(button),
        getBox(target.locator(surface.main)),
        getBox(page.locator(surface.next)),
        getBox(target)
      ]);
      expect(actionsBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 0.5);
      expect(actionsBox.width).toBeGreaterThanOrEqual(targetBox.width - 2.5);
      expect(alertBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 0.5);
      expect(alertBox.y).toBeGreaterThanOrEqual(-0.5);
      expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(820.5);
      expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(targetBox.y + targetBox.height + 0.5);
      expect(alertBox.y + alertBox.height).toBeLessThanOrEqual(boundaryBox.y + boundaryBox.height + 0.5);
      expect(nextBox.y).toBeGreaterThanOrEqual(boundaryBox.y + boundaryBox.height - 0.5);
    }

    await expectNoHorizontalOverflow(page, "[data-delete-failure-harness]");
    expect(await content.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    expect(await inbox.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
  });
}
