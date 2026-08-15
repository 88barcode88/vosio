import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

type FixtureView =
  | "detail"
  | "documentation"
  | "new"
  | "recordings"
  | "settings"
  | "templates"
  | "trash";

// createFixtureScope supplies the exact twelve-hex token required by the guarded shell fixture.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// fixturePath builds a pathname-changing, scoped route for the real product shell fixture.
function fixturePath(view: FixtureView, scope = createFixtureScope()) {
  return `/login/workspace-shell-e2e/${view}?scope=${scope}`;
}

// expectNoHorizontalOverflow verifies the document and real shell both fit the selected viewport.
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".workspace-shell")!;
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offenders: Array.from(shell.querySelectorAll<HTMLElement>("*"))
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 6)
        .map((element) => ({ className: element.className, right: element.getBoundingClientRect().right }))
    };
  });
  expect(overflow.document, JSON.stringify(overflow)).toBe(0);
  expect(overflow.offenders, JSON.stringify(overflow)).toEqual([]);
}

// getBox requires a rendered bounding box so geometry checks never confuse visibility with viewport reachability.
async function getBox(locator: import("@playwright/test").Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

// expectRealAppHitTargets checks visible semantic controls and labelled toggles against the shared 44px contract.
async function expectRealAppHitTargets(page: Page) {
  const offenders = await page.evaluate(() => {
    const minimum = 44;
    const isVisible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const controls = Array.from(document.querySelectorAll<HTMLElement>([
      "button",
      "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='color'])",
      "select",
      "textarea",
      "summary",
      "[role='tab']",
      "[data-touch-target='action']"
    ].join(",")));
    const controlOffenders = controls.filter(isVisible).flatMap((element) => {
      const box = element.getBoundingClientRect();
      const needsWidth = element.matches("button, [role='button'], [role='tab'], .icon-button, [data-touch-target='action']");
      return box.height + 0.5 < minimum || (needsWidth && box.width + 0.5 < minimum)
        ? [`${element.tagName.toLowerCase()}.${element.className}: ${box.width}x${box.height}`]
        : [];
    });
    const toggleOffenders = Array.from(document.querySelectorAll<HTMLInputElement>(
      "input[type='checkbox'], input[type='radio']"
    )).filter(isVisible).flatMap((input) => {
      const label = input.closest("label");
      const box = label?.getBoundingClientRect();
      return !box || box.height + 0.5 < minimum
        ? [`${input.type} label: ${box?.width ?? 0}x${box?.height ?? 0}`]
        : [];
    });
    return [...controlOffenders, ...toggleOffenders];
  });
  expect(offenders).toEqual([]);
}

// expectShellSurfaceContainment keeps real rows, tables and cards inside the content column and viewport.
async function expectShellSurfaceContainment(page: Page) {
  const offenders = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".content-area")!;
    const contentBox = content.getBoundingClientRect();
    const selectors = [
      ".recordings-table",
      ".recordings-row",
      ".recording-search-result",
      "[data-primary-capture]",
      ".recording-workbench",
      ".recording-object-header",
      ".transcript-table",
      ".transcript-table-row",
      ".prompt-workspace",
      ".settings-panel",
      ".trash-recording-row",
      ".documentation-layout"
    ].join(",");
    return Array.from(document.querySelectorAll<HTMLElement>(selectors)).flatMap((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || box.width === 0 || box.height === 0) return [];
      const contained = box.left >= contentBox.left - 1
        && box.right <= contentBox.right + 1
        && box.left >= -1
        && box.right <= document.documentElement.clientWidth + 1;
      return contained
        ? []
        : [`${element.className}: ${box.left}..${box.right} outside ${contentBox.left}..${contentBox.right}`];
    });
  });
  expect(offenders).toEqual([]);
}

test("the shell fixture rejects missing, malformed and unknown scoped routes", async ({ request }) => {
  expect((await request.get("/login/workspace-shell-e2e")).status()).toBe(404);
  expect((await request.get("/login/workspace-shell-e2e/recordings?scope=invalid")).status()).toBe(404);
  expect((await request.get(`/login/workspace-shell-e2e/unknown?scope=${createFixtureScope()}`)).status())
    .toBe(404);
});

test("C7 invalid guarded view renders the Czech product 404", async ({ page }) => {
  await page.goto(`/login/workspace-shell-e2e/unknown?scope=${createFixtureScope()}`);
  await expect(page.getByRole("heading", { name: "Stránka nebyla nalezena" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nahrávky" })).toHaveAttribute("href", "/recordings");
  await expect(page.getByRole("link", { name: "Nová nahrávka" })).toHaveAttribute("href", "/recordings/new");
});

for (const width of [375, 768, 1024, 1440]) {
  test(`C7 Trash stays compact, touch-safe and single-scroll at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(fixturePath("trash"));

    await expect(page.getByRole("heading", { name: "Koš" })).toBeVisible();
    await expect(page.locator(".trash-recording-row")).toHaveCount(2);
    for (const button of await page.locator(".trash-recording-row button").all()) {
      const box = await getBox(button);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);
    const scrollOwners = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".content-area")!;
      return Number(document.documentElement.scrollHeight > document.documentElement.clientHeight)
        + Number(["auto", "scroll"].includes(getComputedStyle(content).overflowY)
          && content.scrollHeight > content.clientHeight);
    });
    expect(scrollOwners).toBeLessThanOrEqual(1);
    if (width === 375 || width === 1024) {
      await page.screenshot({ caret: "initial", path: testInfo.outputPath(`trash-${width}.png`), fullPage: true });
      await page.evaluate(() => {
        window.localStorage.setItem("vosio-theme", "light");
        document.cookie = "vosio-theme=light; Path=/; SameSite=Lax";
      });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ caret: "initial", path: testInfo.outputPath(`trash-${width}-light.png`), fullPage: true });
    }
  });

  test(`C7 documentation keeps readable anchors without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(fixturePath("documentation"));

    const links = page.locator(".documentation-topics a");
    expect(await links.count()).toBeGreaterThan(3);
    const firstHref = await links.first().getAttribute("href");
    expect(firstHref).toMatch(/^#[a-z0-9-]+$/u);
    await links.first().click();
    await expect(page).toHaveURL(new RegExp(`${firstHref}$`, "u"));
    await expectNoHorizontalOverflow(page);
    if (width <= 900) {
      const topics = page.locator(".documentation-topics");
      expect(await topics.evaluate((element) => getComputedStyle(element).overflowX)).toBe("visible");
      expect(await topics.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const topicBox = await topics.boundingBox();
      expect(topicBox).not.toBeNull();
      for (const link of await links.all()) {
        const linkBox = await link.boundingBox();
        expect(linkBox).not.toBeNull();
        expect(linkBox!.x).toBeGreaterThanOrEqual(topicBox!.x - 1);
        expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(topicBox!.x + topicBox!.width + 1);
        expect(linkBox!.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
}

test("C7 Trash restore and purge failures restore only their exact rows with sanitized feedback", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.goto(`${fixturePath("trash")}&mode=failure`);
  const rows = page.locator(".trash-recording-row");
  const first = rows.first();
  const second = rows.nth(1);

  await first.getByRole("button", { name: "Obnovit" }).click();
  await expect(first).toHaveAttribute("data-optimistic-deleted", "true");
  await expect(second).toBeVisible();
  await expect(first.getByRole("alert")).toContainText("nepodařilo obnovit");
  await expect(first).not.toHaveAttribute("data-optimistic-deleted", "true");
  await expect(first).not.toContainText("fixture-private-trash-failure");

  await page.reload();
  const purgeRow = page.locator(".trash-recording-row").first();
  const purgeSibling = page.locator(".trash-recording-row").nth(1);
  const purgeOpener = purgeRow.getByRole("button", { name: "Smazat trvale" });
  await purgeOpener.focus();
  await purgeOpener.click();
  let dialog = page.getByRole("dialog", { name: "Trvale smazat nahrávku" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(purgeOpener).toBeFocused();

  await purgeOpener.click();
  dialog = page.getByRole("dialog", { name: "Trvale smazat nahrávku" });
  await page.locator(".ui-modal-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
  await expect(purgeOpener).toBeFocused();

  await purgeOpener.click();
  dialog = page.getByRole("dialog", { name: "Trvale smazat nahrávku" });
  await dialog.getByRole("button", { name: "Smazat trvale" }).click();
  await expect(purgeRow).toHaveAttribute("data-optimistic-deleted", "true");
  await expect(purgeRow.getByRole("alert")).toContainText("nepodařilo trvale smazat");
  await expect(purgeRow).not.toHaveAttribute("data-optimistic-deleted", "true");
  await expect(purgeSibling).toBeVisible();
});

test("C7 Trash success hides only the chosen row and empty mode offers both recovery paths", async ({ page }) => {
  const scope = createFixtureScope();
  await page.setViewportSize({ width: 768, height: 760 });
  await page.goto(fixturePath("trash", scope));
  const rows = page.locator(".trash-recording-row");
  await rows.first().getByRole("button", { name: "Obnovit" }).click();
  await expect(rows.first()).toHaveAttribute("data-optimistic-deleted", "true");
  await expect(rows.nth(1)).toBeVisible();

  await page.goto(`${fixturePath("trash", scope)}&mode=empty`);
  await expect(page.getByText("Koš je prázdný", { exact: true })).toBeVisible();
  const emptyState = page.locator(".trash-empty-state");
  await expect(emptyState.getByRole("link", { name: "Nahrávky" })).toBeVisible();
  await expect(emptyState.getByRole("link", { name: "Nová nahrávka" })).toBeVisible();
});

test("Trash bulk selection restores and purges through bounded fixture actions", async ({ page }) => {
  const scope = createFixtureScope();
  await page.goto(fixturePath("trash", scope));
  await page.getByRole("checkbox", { name: "Vybrat všechny nahrávky v Koši" }).check();
  await expect(page.getByRole("button", { name: "Obnovit vybrané (2)" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Smazat vybrané trvale (2)" })).toBeEnabled();
  await page.getByRole("button", { name: "Obnovit vybrané (2)" }).click();
  await expect(page.locator('.trash-recording-row[data-optimistic-deleted="true"]')).toHaveCount(2);

  await page.reload();
  await page.getByRole("checkbox", { name: "Vybrat všechny nahrávky v Koši" }).check();
  await page.getByRole("button", { name: "Smazat vybrané trvale (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Trvale smazat vybrané nahrávky" });
  await expect(dialog).toContainText("Audio, přepis a AI výstupy");
  await dialog.getByRole("button", { name: "Smazat trvale" }).click();
  await expect(page.getByRole("progressbar", { name: "Průběh trvalého mazání" })).toHaveAttribute("max", "2");
  await expect(page.locator('.trash-recording-row[data-optimistic-deleted="true"]')).toHaveCount(2);
});

for (const width of [375, 768]) {
  test(`mobile navigation is exact and touch-safe at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(fixturePath("settings"));

    const navigation = page.getByRole("navigation", { name: "Mobilní navigace" });
    const targets = navigation.locator(":scope > a, :scope > button");
    expect(await targets.allTextContents()).toEqual([
      "Nahrávky",
      "Nová",
      "AI prompty",
      "Nastavení",
      "Více"
    ]);
    await expect(targets).toHaveCount(5);

    for (const target of await targets.all()) {
      const box = await getBox(target);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await expect(page.locator(".sidebar")).toBeHidden();
    await expectNoHorizontalOverflow(page);
    if (width === 375) {
      await page.screenshot({ caret: "initial", path: testInfo.outputPath("shell-375.png") });
    }
  });
}

for (const width of [375, 768, 1024, 1440]) {
  test(`settings uses one reachable document scroll owner at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(fixturePath("settings"));

    const content = page.locator(".content-area");
    const save = page.getByRole("button", { name: "Uložit nastavení" });
    const coverageDetails = page.getByRole("button", { name: "Více informací" });
    const technicalDetails = page.getByRole("button", { name: "Technické informace" });

    await expect(page.getByRole("heading", { name: "AI a výstupy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Diagnostika a využití" })).toBeVisible();
    await expect(page.getByText("Neúplná data", { exact: true })).toBeVisible();
    await expect(coverageDetails).toHaveAttribute("aria-expanded", "false");
    await coverageDetails.click();
    await expect(page.getByRole("region", { name: "Pokrytí dat využití" })).toContainText("3 z 5 nahrávek má uloženou délku");
    await expect(technicalDetails).toHaveAttribute("aria-expanded", "false");
    await technicalDetails.focus();
    await page.keyboard.press("Enter");
    await expect(technicalDetails).toHaveAttribute("aria-expanded", "true");
    const technicalRegion = page.getByRole("region", { name: "Technické informace" });
    await expect(technicalRegion).toBeVisible();
    await expect(technicalRegion).toContainText("krátkodobý Soniox api_key");
    await expect(technicalRegion).not.toContainText("API klíče a region zůstávají mimo klienta");

    const scrollState = await page.evaluate(() => {
      const contentArea = document.querySelector<HTMLElement>(".content-area")!;
      return {
        bodyExtra: document.body.scrollHeight - document.body.clientHeight,
        contentExtra: contentArea.scrollHeight - contentArea.clientHeight,
        contentOverflow: getComputedStyle(contentArea).overflowY,
        documentExtra: document.documentElement.scrollHeight - document.documentElement.clientHeight
      };
    });

    if (width <= 900) {
      expect(scrollState.contentOverflow).toBe("visible");
      expect(scrollState.documentExtra).toBeGreaterThan(0);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const [saveBox, navBox] = await Promise.all([
        getBox(save),
        getBox(page.getByRole("navigation", { name: "Mobilní navigace" }))
      ]);
      expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(navBox.y);
    } else {
      expect(scrollState.bodyExtra).toBe(0);
      expect(scrollState.documentExtra).toBe(0);
      expect(scrollState.contentExtra).toBeGreaterThan(0);
      expect(scrollState.contentOverflow).toBe("auto");
      await content.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(save).toBeVisible();
    }

    await expectNoHorizontalOverflow(page);
    await page.screenshot({ caret: "initial", path: testInfo.outputPath(`settings-${width}-dark.png`), fullPage: true });

    if (width <= 900) {
      await page.getByRole("navigation", { name: "Mobilní navigace" }).getByRole("button", { name: "Více" }).click();
      await page.getByRole("dialog", { name: "Další možnosti" }).getByRole("button", { name: /Přepnout na/ }).click();
      await page.keyboard.press("Escape");
    } else {
      await page.locator(".sidebar .theme-toggle").click();
    }
    await page.screenshot({ caret: "initial", path: testInfo.outputPath(`settings-${width}-light.png`), fullPage: true });
  });
}

test("mobile More traps focus, restores it on every close, toggles theme and completes fixture navigation", async ({ page }) => {
  const scope = createFixtureScope();
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto(fixturePath("settings", scope));

  const navigation = page.getByRole("navigation", { name: "Mobilní navigace" });
  const more = navigation.getByRole("button", { name: "Více" });
  await more.click();
  let drawer = page.getByRole("dialog", { name: "Další možnosti" });
  await expect(drawer.getByRole("link", { name: "Koš" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Dokumentace" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Kup mi kafe" })).toHaveAttribute(
    "href",
    "https://donate.stripe.com/3cI7sLdRHaWJ1Lke48dZ602"
  );
  await expect(drawer).toContainText("shell@example.cz");
  await expect(drawer.getByRole("button", { name: "Odhlásit" })).toBeVisible();

  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(more).toBeFocused();

  await more.click();
  drawer = page.getByRole("dialog", { name: "Další možnosti" });
  await page.locator(".ui-drawer-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(drawer).toBeHidden();
  await expect(more).toBeFocused();

  const initialTheme = await page.locator("html").getAttribute("data-theme");
  const initialBackground = await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor);
  await more.click();
  drawer = page.getByRole("dialog", { name: "Další možnosti" });
  await drawer.getByRole("button", { name: /Přepnout na/ }).click();
  const toggledTheme = initialTheme === "dark" ? "light" : "dark";
  await expect(page.locator("html")).toHaveAttribute("data-theme", toggledTheme);
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(initialBackground);
  expect(await page.evaluate(() => window.localStorage.getItem("vosio-theme"))).toBe(toggledTheme);
  expect((await page.context().cookies()).find((cookie) => cookie.name === "vosio-theme")?.value)
    .toBe(toggledTheme);

  const trashLink = drawer.getByRole("link", { name: "Koš" });
  await expect(trashLink).toHaveAttribute("href", fixturePath("trash", scope));
  await trashLink.click();
  await page.waitForURL(new RegExp(`/login/workspace-shell-e2e/trash\\?scope=${scope}$`, "u"));
  await expect(page.getByRole("dialog", { name: "Další možnosti" })).toHaveCount(0);
  const activeMore = page.getByRole("navigation", { name: "Mobilní navigace" })
    .getByRole("button", { name: "Více" });
  await expect(activeMore).toHaveAttribute("aria-pressed", "true");
  await expect(activeMore).not.toHaveClass(/mobile-nav-item-pending/u);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", toggledTheme);
});

for (const width of [1024, 1440]) {
  test(`desktop detail preserves exact shell and one document scroll at ${width}px`, async ({ page }, testInfo) => {
    const scope = createFixtureScope();
    await page.setViewportSize({ width, height: 760 });
    await page.goto(fixturePath("detail", scope));

    const sidebar = page.locator(".sidebar");
    const content = page.locator(".content-area");
    const workbench = page.locator(".recording-workbench");
    const transcriptScroll = page.locator(".transcript-table-scroll");
    const sentinel = page.getByText("KONEC DLOUHÉHO DETAILU SHELLU", { exact: true });
    const [sidebarBox, contentBox, workbenchBox] = await Promise.all([
      getBox(sidebar),
      getBox(content),
      getBox(workbench)
    ]);

    expect(sidebarBox.x).toBe(0);
    expect(sidebarBox.y).toBe(0);
    expect(sidebarBox.width).toBeGreaterThanOrEqual(240);
    expect(sidebarBox.width).toBeLessThanOrEqual(252);
    expect(sidebarBox.height).toBe(760);
    expect(await sidebar.evaluate((element) => ({
      position: getComputedStyle(element).position,
      top: getComputedStyle(element).top
    }))).toEqual({ position: "sticky", top: "0px" });
    const desktopInternalHrefs = await sidebar.locator("a:not([target='_blank'])")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(desktopInternalHrefs).toEqual([
      fixturePath("new", scope),
      fixturePath("recordings", scope),
      fixturePath("templates", scope),
      fixturePath("trash", scope),
      fixturePath("settings", scope),
      fixturePath("documentation", scope)
    ]);
    expect(contentBox.x).toBe(sidebarBox.x + sidebarBox.width);
    expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(width);
    expect(contentBox.x + contentBox.width).toBeGreaterThanOrEqual(width - 0.5);
    expect(workbenchBox.height).toBeGreaterThan(contentBox.height);
    await expect(page.locator(".recording-rail")).toHaveCount(0);

    const scrollState = await page.evaluate(() => {
      const contentArea = document.querySelector<HTMLElement>(".content-area")!;
      const transcript = document.querySelector<HTMLElement>(".transcript-table-scroll")!;
      return {
        bodyExtra: document.body.scrollHeight - document.body.clientHeight,
        contentExtra: contentArea.scrollHeight - contentArea.clientHeight,
        contentOverflow: getComputedStyle(contentArea).overflowY,
        documentExtra: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        transcriptExtra: transcript.scrollHeight - transcript.clientHeight,
        transcriptOverflow: getComputedStyle(transcript).overflowY
      };
    });
    expect(scrollState.documentExtra).toBe(0);
    expect(scrollState.bodyExtra).toBe(0);
    expect(scrollState.contentExtra).toBeGreaterThan(0);
    expect(scrollState.contentOverflow).toBe("auto");
    expect(scrollState.transcriptExtra).toBe(0);
    expect(scrollState.transcriptOverflow).toBe("visible");

    const sidebarBeforeScroll = await getBox(sidebar);
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const [sentinelBox, sidebarAfterScroll] = await Promise.all([
      getBox(sentinel),
      getBox(sidebar)
    ]);
    expect(sentinelBox.y).toBeGreaterThanOrEqual(contentBox.y - 0.5);
    expect(sentinelBox.y + sentinelBox.height).toBeLessThanOrEqual(contentBox.y + contentBox.height + 0.5);
    expect(sentinelBox.y + sentinelBox.height).toBeLessThanOrEqual(760);
    expect(await transcriptScroll.evaluate((element) => element.scrollTop)).toBe(0);

    await page.evaluate(() => window.scrollTo(0, 500));
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(sidebarAfterScroll).toEqual(sidebarBeforeScroll);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ caret: "initial", path: testInfo.outputPath(`shell-${width}.png`), fullPage: true });
  });
}

test("desktop sidebar collapses to a persistent accessible 64px rail", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 760 });
  await page.goto(fixturePath("recordings"));

  const sidebar = page.locator(".sidebar");
  const collapseButton = page.getByRole("button", { name: "Sbalit postranní lištu" });
  await expect(collapseButton).toHaveAttribute("aria-expanded", "true");
  await collapseButton.click();

  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await getBox(sidebar)).width).toBe(64);
  await expect(page.locator('.nav-item[aria-label="Nahrávky"]')).toHaveAttribute("title", "Nahrávky");
  await expect(page.locator('.new-recording-button[aria-label="Nová nahrávka"]'))
    .toHaveAttribute("title", "Nová nahrávka");
  expect(await page.evaluate(() => window.localStorage.getItem("vosio-sidebar-collapsed"))).toBe("true");
  await expectNoHorizontalOverflow(page);
  await expectRealAppHitTargets(page);

  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await getBox(sidebar)).width).toBe(64);
  const expandButton = page.getByRole("button", { name: "Rozbalit postranní lištu" });
  await expandButton.focus();
  await expect(expandButton).toBeFocused();
  expect(await expandButton.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
});

for (const width of [375, 768]) {
  test(`stored collapsed sidebar keeps the mobile shell one-column at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.addInitScript(() => {
      window.localStorage.setItem("vosio-sidebar-collapsed", "true");
    });
    await page.goto(fixturePath("recordings"));

    const shell = page.locator(".workspace-shell");
    const sidebar = page.locator(".sidebar");
    const content = page.locator(".content-area");
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");
    await expect(sidebar).toHaveCSS("display", "none");

    const [shellBox, contentBox] = await Promise.all([getBox(shell), getBox(content)]);
    expect(contentBox.x).toBeLessThanOrEqual(shellBox.x + 0.5);
    expect(contentBox.width).toBeGreaterThanOrEqual(shellBox.width - 1);
    expect(await shell.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(/\s+/u)))
      .toHaveLength(1);
    await expectNoHorizontalOverflow(page);
  });
}

for (const width of [375, 1024, 1440]) {
  test(`light and dark shell keep one full-page canvas at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(fixturePath("recordings"));

    const expectedBackgrounds = {
      dark: "rgb(25, 25, 24)",
      light: "rgb(247, 245, 242)"
    } as const;

    const themeSequence = ["dark", "light", "dark"] as const;
    for (const [themeIndex, theme] of themeSequence.entries()) {
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(expectedBackgrounds[theme]);
      await expectNoHorizontalOverflow(page);

      const fullPageState = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>(".workspace-shell")!;
        const content = document.querySelector<HTMLElement>(".content-area")!;
        return {
          contentNestedScroller: ["auto", "scroll"].includes(getComputedStyle(content).overflowY)
            && content.scrollHeight > content.clientHeight,
          documentExtra: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          shellNestedScroller: ["auto", "scroll"].includes(getComputedStyle(shell).overflowY)
            && shell.scrollHeight > shell.clientHeight
        };
      });
      expect(fullPageState.shellNestedScroller).toBe(false);
      expect(Number(fullPageState.documentExtra > 0) + Number(fullPageState.contentNestedScroller))
        .toBeLessThanOrEqual(1);
      if (width <= 900) {
        expect(fullPageState.contentNestedScroller).toBe(false);
      } else {
        expect(fullPageState.documentExtra).toBe(0);
      }
      if (width === 375 && themeIndex < 2) {
        await page.screenshot({ caret: "initial", path: testInfo.outputPath(`shell-375-${theme}.png`) });
      }

      if (themeIndex === themeSequence.length - 1) break;

      if (width <= 900) {
        const more = page.getByRole("navigation", { name: "Mobilní navigace" })
          .getByRole("button", { name: "Více" });
        await more.click();
        await page.getByRole("dialog", { name: "Další možnosti" })
          .getByRole("button", { name: /Přepnout na/ })
          .click();
        await page.keyboard.press("Escape");
      } else {
        await page.locator(".sidebar .theme-toggle").click();
      }
    }
  });
}

for (const view of ["trash", "documentation"] as const) {
  test(`mobile More owns the active state for ${view}`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 760 });
    await page.goto(fixturePath(view));

    await expect(page.getByRole("navigation", { name: "Mobilní navigace" }).getByRole("button", { name: "Více" }))
      .toHaveAttribute("aria-pressed", "true");
  });
}

for (const width of [375, 768, 1024, 1440]) {
  test(`C8 real shell surfaces keep semantic controls touch-safe without x-overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    for (const view of ["recordings", "new", "detail", "templates", "settings", "trash", "documentation"] as const) {
      await page.goto(fixturePath(view));
      await expect(page.locator(".workspace-shell")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectRealAppHitTargets(page);
      await expectShellSurfaceContainment(page);
    }
  });
}

for (const width of [375, 768, 1024, 1440]) {
  test(`C8 real detail route contains its complete workbench at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto(`/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=blocks`);
    await expect(page.locator(".recording-workbench")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectShellSurfaceContainment(page);
    await expectRealAppHitTargets(page);
  });
}

// getLowDesktopScrollState reports every possible full-page vertical owner at the short desktop breakpoint.
async function getLowDesktopScrollState(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
    const content = document.querySelector<HTMLElement>(".content-area")!;
    const nestedOwners = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const style = getComputedStyle(element);
        return ["auto", "scroll"].includes(style.overflowY)
          && element.scrollHeight > element.clientHeight + 1;
      })
      .map((element) => element.className);
    return {
      contentOverflow: getComputedStyle(content).overflowY,
      documentExtra: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      nestedOwners,
      sidebarOverflow: getComputedStyle(sidebar).overflowY,
      sidebarPosition: getComputedStyle(sidebar).position
    };
  });
}

test("C8 low desktop uses one document scroll owner for reachable sidebar, detail and settings content", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 520 });
  await page.goto(fixturePath("detail"));

  const state = await getLowDesktopScrollState(page);
  expect(state).toMatchObject({
    contentOverflow: "visible",
    nestedOwners: [],
    sidebarOverflow: "visible",
    sidebarPosition: "static"
  });
  expect(state.documentExtra).toBeGreaterThan(0);

  const sidebarTargets = page.locator(".sidebar .nav-item, .sidebar-support-link, .sidebar .sign-out-form button");
  for (const target of await sidebarTargets.all()) {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
    expect(await page.evaluate(() => ({
      content: document.querySelector<HTMLElement>(".content-area")!.scrollTop,
      sidebar: document.querySelector<HTMLElement>(".sidebar")!.scrollTop
    }))).toEqual({ content: 0, sidebar: 0 });
  }

  const detailEnd = page.getByText("KONEC DLOUHÉHO DETAILU SHELLU", { exact: true });
  await detailEnd.scrollIntoViewIfNeeded();
  await expect(detailEnd).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await page.evaluate(() => ({
    content: document.querySelector<HTMLElement>(".content-area")!.scrollTop,
    sidebar: document.querySelector<HTMLElement>(".sidebar")!.scrollTop
  }))).toEqual({ content: 0, sidebar: 0 });
  await expectNoHorizontalOverflow(page);

  await page.goto(fixturePath("settings"));
  const settingsState = await getLowDesktopScrollState(page);
  expect(settingsState).toMatchObject({
    contentOverflow: "visible",
    nestedOwners: [],
    sidebarOverflow: "visible",
    sidebarPosition: "static"
  });
  expect(settingsState.documentExtra).toBeGreaterThan(0);
  const settingsEnd = page.getByRole("button", { name: "Uložit nastavení" });
  await settingsEnd.scrollIntoViewIfNeeded();
  await expect(settingsEnd).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await page.evaluate(() => ({
    content: document.querySelector<HTMLElement>(".content-area")!.scrollTop,
    sidebar: document.querySelector<HTMLElement>(".sidebar")!.scrollTop
  }))).toEqual({ content: 0, sidebar: 0 });
  await expectNoHorizontalOverflow(page);
});
