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
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    shell: document.querySelector<HTMLElement>(".workspace-shell")!.scrollWidth
      - document.querySelector<HTMLElement>(".workspace-shell")!.clientWidth
  }));
  expect(overflow).toEqual({ document: 0, shell: 0 });
}

// getBox requires a rendered bounding box so geometry checks never confuse visibility with viewport reachability.
async function getBox(locator: import("@playwright/test").Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test("the shell fixture rejects missing, malformed and unknown scoped routes", async ({ request }) => {
  expect((await request.get("/login/workspace-shell-e2e")).status()).toBe(404);
  expect((await request.get("/login/workspace-shell-e2e/recordings?scope=invalid")).status()).toBe(404);
  expect((await request.get(`/login/workspace-shell-e2e/unknown?scope=${createFixtureScope()}`)).status())
    .toBe(404);
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
      "Prompty",
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
      await page.screenshot({ path: testInfo.outputPath("shell-375.png") });
    }
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

  const trashLink = drawer.getByRole("link", { name: "Koš" });
  await expect(trashLink).toHaveAttribute("href", fixturePath("trash", scope));
  await trashLink.click();
  await page.waitForURL(new RegExp(`/login/workspace-shell-e2e/trash\\?scope=${scope}$`, "u"));
  await expect(page.getByRole("dialog", { name: "Další možnosti" })).toHaveCount(0);
  const activeMore = page.getByRole("navigation", { name: "Mobilní navigace" })
    .getByRole("button", { name: "Více" });
  await expect(activeMore).toHaveAttribute("aria-pressed", "true");
  await expect(activeMore).not.toHaveClass(/mobile-nav-item-pending/u);
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
    await page.screenshot({ path: testInfo.outputPath(`shell-${width}.png`), fullPage: true });
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
        await page.screenshot({ path: testInfo.outputPath(`shell-375-${theme}.png`) });
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
