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

// getBorderRadii returns computed corners in clockwise order for responsive card assertions.
async function getBorderRadii(locator: Locator) {
  return locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    return [
      styles.borderTopLeftRadius,
      styles.borderTopRightRadius,
      styles.borderBottomRightRadius,
      styles.borderBottomLeftRadius
    ];
  });
}

// getInboxGeometry captures related parent and child boxes in one stable browser snapshot.
async function getInboxGeometry(inbox: Locator) {
  await expect(inbox).toBeVisible();
  return inbox.evaluate((root) => {
    // requireElement fails the snapshot instead of returning partial geometry.
    const requireElement = (selector: string) => {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing geometry element: ${selector}`);
      return element;
    };
    // getRect serializes one DOMRect while every related element shares the same layout frame.
    const getRect = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
    };
    const inboxElement = root as HTMLElement;
    const inboxStyles = getComputedStyle(inboxElement);
    const tableHead = requireElement(".recordings-table-head");
    const listMode = getComputedStyle(tableHead).display !== "none";

    return {
      actions: getRect(requireElement(".recordings-row .recordings-row-actions")),
      basicFilterRow: getRect(requireElement(".recording-filter-basic-row")),
      deleteButton: getRect(requireElement(".recordings-row .delete-recording-form button")),
      disclosure: getRect(requireElement(".recordings-toolbar > .organization-manager-trigger")),
      editButton: getRect(requireElement(".recordings-row .recording-title-edit-button")),
      headerActions: listMode
        ? getRect(requireElement(".recordings-table-head-actions"))
        : null,
      inbox: getRect(inboxElement),
      inboxContentWidth: inboxElement.clientWidth
        - Number.parseFloat(inboxStyles.paddingLeft)
        - Number.parseFloat(inboxStyles.paddingRight),
      listMode,
      main: getRect(requireElement(".recordings-row .recordings-row-main")),
      row: getRect(requireElement(".recordings-row")),
      search: getRect(requireElement('.recording-filter-search input[name="q"]')),
      searchControl: getRect(requireElement(".recording-filter-search")),
      searchIcon: getRect(requireElement(".recording-filter-search-icon")),
      searchPaddingLeft: Number.parseFloat(getComputedStyle(
        requireElement('.recording-filter-search input[name="q"]')
      ).paddingLeft),
      table: getRect(requireElement(".recordings-table")),
      toolbar: getRect(requireElement(".recordings-toolbar"))
    };
  });
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

for (const width of [375, 768, 901, 1024, 1440]) {
  test(`real recordings inbox is responsive and theme-safe at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto(fixturePath(fixtureScope));

    const disclosure = page.getByRole("button", { name: "Spravovat" });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("dialog", { name: "Správa organizace" })).toHaveCount(0);
    await disclosure.click();
    const management = page.getByRole("dialog", { name: "Správa organizace" });
    await expect(management).toBeVisible();
    await expect(management.getByRole("heading", { name: "Klienti" })).toBeVisible();
    await expect(management.getByRole("heading", { name: "Projekty" })).toBeVisible();
    await expect(management.getByRole("heading", { name: "Složky" })).toBeVisible();
    await expect(management.getByRole("heading", { name: "Štítky" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Filtrování nahrávek" })).toBeVisible();
    await page.getByRole("button", { name: "Zavřít správu organizace" }).click();
    const advancedFilters = page.getByRole("button", { name: /^Filtry \(\d+\)$/u });
    await expect(advancedFilters).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Pokročilé filtry nahrávek" })).toBeHidden();
    await expect(page.getByRole("heading", { name: /Bez klienta/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Nedokončené live nahrávky" })).toBeVisible();

    const search = page.getByRole("searchbox", { name: "Hledat v nahrávkách" });
    const row = page.locator(".recordings-row").first();
    const editButton = row.locator(".recording-title-edit-button");
    const deleteButton = row.locator(".delete-recording-form button");
    await expect(row).toBeVisible();
    await expect(search).toBeVisible();
    await expect(editButton).toHaveAccessibleName("Upravit");
    await expect(editButton.locator(".recording-action-label")).toHaveText("Upravit");
    await expect(editButton.locator(".recording-action-label")).toBeVisible();
    expect(await editButton.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
    await expect(deleteButton).toHaveAccessibleName("Koš");
    await expect(deleteButton.locator(".recording-action-label")).toHaveText("Koš");
    await expect(deleteButton.locator(".recording-action-label")).toBeVisible();

    const geometry = await getInboxGeometry(page.locator(".recordings-inbox"));
    const {
      actions: actionsBox,
      basicFilterRow: basicFilterRowBox,
      deleteButton: deleteButtonBox,
      disclosure: disclosureBox,
      editButton: editButtonBox,
      headerActions: headerActionsBox,
      inbox: inboxBox,
      inboxContentWidth,
      listMode,
      main: mainBox,
      row: rowBox,
      search: searchBox,
      searchControl: searchControlBox,
      searchIcon: searchIconBox,
      searchPaddingLeft,
      table: tableBox,
      toolbar: toolbarBox
    } = geometry;
    expect(searchBox.height).toBeGreaterThanOrEqual(44);
    expect(searchBox.width).toBeGreaterThanOrEqual(44);
    expect(disclosureBox.height).toBeGreaterThanOrEqual(44);
    expect(disclosureBox.width).toBeGreaterThanOrEqual(44);
    expect(searchIconBox.x).toBeGreaterThanOrEqual(searchControlBox.x - 0.5);
    expect(searchIconBox.y).toBeGreaterThanOrEqual(searchControlBox.y - 0.5);
    expect(searchIconBox.x + searchIconBox.width)
      .toBeLessThanOrEqual(searchControlBox.x + searchControlBox.width + 0.5);
    expect(searchIconBox.y + searchIconBox.height)
      .toBeLessThanOrEqual(searchControlBox.y + searchControlBox.height + 0.5);
    expect(searchIconBox.x).toBeGreaterThanOrEqual(searchBox.x - 0.5);
    expect(searchIconBox.x + searchIconBox.width)
      .toBeLessThanOrEqual(searchBox.x + searchPaddingLeft + 0.5);

    for (const chip of await page.locator(".recordings-status-summary a").all()) {
      expect((await getBox(chip)).height).toBeGreaterThanOrEqual(44);
    }

    for (const buttonBox of [editButtonBox, deleteButtonBox]) {
      expect(buttonBox.width).toBeGreaterThanOrEqual(44);
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
      expect(buttonBox.x).toBeGreaterThanOrEqual(actionsBox.x - 0.5);
      expect(buttonBox.y).toBeGreaterThanOrEqual(actionsBox.y - 0.5);
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(actionsBox.x + actionsBox.width + 0.5);
      expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(actionsBox.y + actionsBox.height + 0.5);
    }
    expect(listMode).toBe(width >= 1024);
    if (width === 901) {
      expect(inboxContentWidth).toBeLessThanOrEqual(680);
    }
    for (const box of [tableBox, rowBox, mainBox, actionsBox]) {
      expect(box.x).toBeGreaterThanOrEqual(inboxBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(inboxBox.x + inboxBox.width + 1);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(width + 0.5);
    if (width <= 900) {
      expect(disclosureBox.y).toBeGreaterThanOrEqual(basicFilterRowBox.y + basicFilterRowBox.height - 0.5);
      expect(disclosureBox.x).toBeCloseTo(toolbarBox.x, 0);
      expect(disclosureBox.width).toBeCloseTo(toolbarBox.width, 0);
    } else {
      expect(searchBox.y).toBeCloseTo(disclosureBox.y, 0);
      expect(disclosureBox.x).toBeGreaterThanOrEqual(searchBox.x + searchBox.width - 0.5);
    }
    if (!listMode) {
      expect(actionsBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 0.5);
      for (const control of await page.locator(
        ".recording-filters input:visible, .recording-filters select:visible, .recording-filters button:visible, .recordings-row-actions button:visible"
      ).all()) {
        const box = await getBox(control);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 768) {
        const rows = page.locator(".recordings-row");
        expect(await getBorderRadii(rows.first())).toEqual(["10px", "10px", "10px", "10px"]);
        expect(await getBorderRadii(rows.last())).toEqual(["10px", "10px", "10px", "10px"]);
      }
    } else {
      expect(actionsBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width - 0.5);
      expect(actionsBox.width).toBeCloseTo(128, 0);
      expect(headerActionsBox).not.toBeNull();
      expect(actionsBox.x).toBeCloseTo(headerActionsBox!.x, 0);
      expect(actionsBox.width).toBeCloseTo(headerActionsBox!.width, 0);
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

for (const width of [375, 901, 1024]) {
  test(`recording rename popover stays inside the inbox at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.goto(fixturePath(fixtureScope));

    const inbox = page.locator(".recordings-inbox");
    const row = page.locator(".recordings-row").last();
    await row.locator(".recording-title-edit-button").click();
    const popover = row.locator(".recording-title-popover");
    await expect(popover).toBeVisible();
    await popover.scrollIntoViewIfNeeded();

    await expect.poll(() => popover.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + (rect.width / 2), rect.bottom - 2);
      return {
        hitClass: hit instanceof HTMLElement ? hit.className : null,
        hitTag: hit?.tagName ?? null,
        ownsHit: Boolean(hit && (hit === element || element.contains(hit))),
        popoverBottom: rect.bottom,
        viewportHeight: window.innerHeight
      };
    })).toMatchObject({ ownsHit: true });

    const [inboxBox, popoverBox] = await Promise.all([getBox(inbox), getBox(popover)]);
    expect(popoverBox.x).toBeGreaterThanOrEqual(inboxBox.x - 0.5);
    expect(popoverBox.x + popoverBox.width)
      .toBeLessThanOrEqual(inboxBox.x + inboxBox.width + 0.5);
    expect(popoverBox.x).toBeGreaterThanOrEqual(-0.5);
    expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(width + 0.5);
    await expectNoHorizontalOverflow(page);
  });
}

test("URL-backed filters survive Back and Forward and the title remains the detail opener", async ({ page }) => {
  test.slow();
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
  await page.getByRole("button", { name: "Zavřít správu organizace" }).click();

  const filters = page.getByRole("form", { name: "Filtrování nahrávek" });
  await filters.getByLabel("Hledat").fill("Call");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Call");
  await filters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await filters.getByLabel("Klient").selectOption({ label: "Acme" });
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("client")));
  await filters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await filters.getByLabel("Projekt").selectOption({ label: "CRM" });
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("project")));
  await filters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await filters.getByLabel("Složka").selectOption({ label: "Hovory" });
  await expect(page).toHaveURL((url) => Boolean(url.searchParams.get("folder")));
  await filters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await filters.getByRole("checkbox", { name: "Důležité" }).check();
  await expect(page).toHaveURL((url) => url.searchParams.getAll("tag").length === 1);

  const selectedUrl = new URL(page.url());
  selectedUrl.searchParams.set("page", "2");
  await page.goto(selectedUrl.toString());
  const pageTwoUrl = page.url();
  const restoredFilters = page.getByRole("form", { name: "Filtrování nahrávek" });
  await restoredFilters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await restoredFilters.getByLabel("Složka").selectOption("");
  await expect(page).toHaveURL((url) => !url.searchParams.has("page") && !url.searchParams.has("folder"));

  await page.goBack();
  await expect(page).toHaveURL(pageTwoUrl);
  await restoredFilters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await expect(restoredFilters.getByLabel("Hledat")).toHaveValue("Call");
  await expect(restoredFilters.getByLabel("Klient")).toHaveValue(/.+/);
  await expect(restoredFilters.getByLabel("Projekt")).toHaveValue(/.+/);
  await expect(restoredFilters.getByLabel("Složka")).toHaveValue(/.+/);
  await expect(restoredFilters.getByRole("checkbox", { name: "Důležité" })).toBeChecked();
  await page.goForward();
  await restoredFilters.getByRole("button", { name: /^Filtry \(\d+\)$/u }).click();
  await expect(restoredFilters.getByLabel("Složka")).toHaveValue("");

  await filters.getByRole("button", { name: "Vyčistit filtry" }).click();
  await page.getByRole("link", { name: "Chyba 3" }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get("status") === "failed");
  await page.goBack();
  const title = page.locator(".recordings-row-title > a").first();
  await expect(title).toHaveAttribute("href", /\/recordings\/[^?]+$/u);
  await expect(title).toHaveAccessibleName(/Detail nahrávky/u);
  expect(await title.textContent()).not.toContain("Otevřít");
  const titleHref = await title.getAttribute("href");
  await expect(page.locator(`a[href="${titleHref}"]`)).toHaveCount(1);
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
      if (surface.fields) {
        expect(await getBorderRadii(target)).toEqual(width === 901
          ? ["10px", "10px", "10px", "10px"]
          : ["0px", "0px", "5px", "5px"]);
      }
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
        expect(normalActionsBox.width).toBeCloseTo(surface.fields ? 128 : 116, 0);
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
