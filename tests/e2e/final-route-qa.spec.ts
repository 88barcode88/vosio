import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { cleanupOrganizationFixture } from "./support/organization-fixture-cleanup";

type QaSurface = {
  name: string;
  path: (scope: string) => string;
};

type RuntimeFailure = {
  level: "error" | "pageerror" | "warning";
  text: string;
  url: string | null;
};

const surfaces: QaSurface[] = [
  { name: "recordings", path: (scope) => `/login/workspace-shell-e2e/recordings?scope=${scope}` },
  { name: "new", path: (scope) => `/login/new-recording-e2e?scope=${scope}&mode=success` },
  { name: "detail", path: (scope) => `/login/recording-layout-e2e?scope=${scope}&mode=blocks` },
  { name: "templates", path: (scope) => `/login/prompts-ai-e2e?scope=${scope}&view=templates` },
  { name: "ai", path: (scope) => `/login/prompts-ai-e2e?scope=${scope}&view=ai` },
  { name: "settings", path: (scope) => `/login/workspace-shell-e2e/settings?scope=${scope}` },
  { name: "trash", path: (scope) => `/login/workspace-shell-e2e/trash?scope=${scope}` },
  { name: "documentation", path: (scope) => `/login/workspace-shell-e2e/documentation?scope=${scope}` },
  { name: "404", path: (scope) => `/login/workspace-shell-e2e/unknown?scope=${scope}` }
];

// createFixtureScope supplies one valid development-only guard per route audit.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// collectRuntimeFailures records every browser warning, error and uncaught exception.
function collectRuntimeFailures(page: Page) {
  const failures: RuntimeFailure[] = [];
  page.on("console", (message) => {
    const level = message.type();
    if (level === "warning" || level === "error") {
      failures.push({
        level,
        text: message.text(),
        url: message.location().url || null
      });
    }
  });
  page.on("pageerror", (error) => failures.push({ level: "pageerror", text: error.message, url: null }));
  return failures;
}

// isExpectedFixtureNotFoundConsoleError permits only the guarded 404 navigation's own HTTP status log.
function isExpectedFixtureNotFoundConsoleError(failure: RuntimeFailure, expectedPath: string) {
  if (failure.level !== "error" || !failure.url) return false;
  const url = new URL(failure.url);
  return `${url.pathname}${url.search}` === expectedPath
    && /^Failed to load resource: the server responded with a status of 404(?: \(Not Found\))?$/u.test(failure.text);
}

// expectRouteGeometry validates the shared no-overflow and fixed-surface safety contract.
async function expectRouteGeometry(page: Page) {
  const report = await page.evaluate(() => ({
    containedSurfaceOffenders: Array.from(document.querySelectorAll<HTMLElement>([
      ".recordings-table",
      ".recordings-row",
      ".capture-card",
      ".recording-workbench",
      ".prompt-master-row",
      ".ai-archive-row",
      ".trash-recording-row",
      ".utility-panel"
    ].join(",")))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.left < -1 || rect.right > innerWidth + 1;
      })
      .map((element) => ({
        className: String(element.className),
        clientWidth: element.clientWidth,
        rectWidth: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
        tag: element.tagName,
        viewportWidth: innerWidth
      })),
    fixedOffenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        if (getComputedStyle(element).position !== "fixed") return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1;
      })
      .map((element) => ({ className: String(element.className), tag: element.tagName })),
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));

  expect(report.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(report.containedSurfaceOffenders).toEqual([]);
  expect(report.fixedOffenders).toEqual([]);
}

// expectTouchSafeControls audits semantic controls and links explicitly marked as app actions.
async function expectTouchSafeControls(page: Page) {
  const offenders = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>([
      "button",
      "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='color'])",
      "select",
      "textarea",
      "summary",
      "[role='tab']",
      "[data-touch-target='action']"
    ].join(",")));
    return controls.flatMap((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) {
        return [];
      }
      const widthRequired = element.matches("button, [role='button'], [role='tab'], .icon-button, [data-touch-target='action']");
      return rect.height + 0.5 < 44 || (widthRequired && rect.width + 0.5 < 44)
        ? [{ className: String(element.className), height: rect.height, tag: element.tagName, width: rect.width }]
        : [];
    });
  });
  expect(offenders).toEqual([]);
}

test.describe.configure({ mode: "parallel", timeout: 60_000 });

test("favicon is a real ICO asset with the expected MIME type", async ({ request }) => {
  const response = await request.get("/favicon.ico");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/x-icon");
  expect(Array.from((await response.body()).subarray(0, 6))).toEqual([0, 0, 1, 0, 1, 0]);
});

for (const surface of surfaces) {
  test(`${surface.name} is clean on direct load, reload, both themes and every target width`, async ({ page }) => {
    const failures = collectRuntimeFailures(page);
    const scope = createFixtureScope();
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ height: width === 1024 ? 640 : 760, width });
      await page.goto(surface.path(scope));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

      for (const theme of ["dark", "light"] as const) {
        await page.locator("html").evaluate((element, nextTheme) => {
          element.dataset.theme = nextTheme;
        }, theme);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expectRouteGeometry(page);
        await expectTouchSafeControls(page);
      }

      if (width === 1024) {
        await page.reload();
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expectRouteGeometry(page);
      }

    }

    const unexpectedFailures = surface.name === "404"
      ? failures.filter((failure) => !isExpectedFixtureNotFoundConsoleError(failure, surface.path(scope)))
      : failures;
    expect(unexpectedFailures, JSON.stringify(unexpectedFailures)).toEqual([]);
  });
}

for (const snapshot of [
  { name: "recordings", path: surfaces[0].path, width: 375 },
  { name: "detail", path: surfaces[2].path, width: 1024 }
] as const) {
  test(`${snapshot.name} final QA screenshot at ${snapshot.width}px`, async ({ page }, testInfo) => {
    const failures = collectRuntimeFailures(page);
    await page.setViewportSize({ height: 760, width: snapshot.width });
    await page.goto(snapshot.path(createFixtureScope()));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectRouteGeometry(page);
    await page.screenshot({
      caret: "initial",
      fullPage: true,
      path: testInfo.outputPath(`${snapshot.name}-${snapshot.width}.png`)
    });
    expect(failures, JSON.stringify(failures)).toEqual([]);
  });
}

test("settings and detail stay reachable in 375px landscape with enlarged root text", async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  const scope = createFixtureScope();
  await page.setViewportSize({ height: 375, width: 667 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const surface of surfaces.filter(({ name }) => name === "settings" || name === "detail")) {
    await page.goto(surface.path(scope));
    await page.addStyleTag({ content: "html { font-size: 125% !important; }" });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectRouteGeometry(page);
    await expectTouchSafeControls(page);
  }
  await page.screenshot({
    caret: "initial",
    fullPage: true,
    path: testInfo.outputPath("settings-landscape-large-text.png")
  });
  expect(failures, JSON.stringify(failures)).toEqual([]);
});

test("recording, search, pagination, AI archive and mail action links keep 44px targets", async ({ page, request }) => {
  const scope = createFixtureScope();
  const organizationScope = randomBytes(6).toString("hex").slice(0, 11);
  await page.setViewportSize({ height: 760, width: 375 });

  const checks: Array<{ openSelector?: string; path: string; selector: string }> = [
    {
      path: surfaces[0].path(scope),
      selector: ".recordings-row-title > [data-touch-target='action']"
    },
    {
      path: `/login/recording-organization-e2e?scope=${organizationScope}&fixture=indexed&q=Call`,
      selector: ".recording-search-result [data-touch-target='action'], .recording-search-pagination [data-touch-target='action']"
    },
    {
      path: `/login/prompts-ai-e2e?scope=${scope}&view=ai`,
      selector: ".ai-archive-recording-link[data-touch-target='action']"
    },
    {
      openSelector: ".ai-output-detail summary",
      path: `/login/recording-layout-e2e?scope=${scope}&mode=ai`,
      selector: ".ai-output-actions a[data-touch-target='action']"
    }
  ];

  try {
    for (const check of checks) {
      await page.goto(check.path);
      if (check.openSelector) await page.locator(check.openSelector).click();
      const links = page.locator(check.selector);
      await expect(links.first()).toBeVisible();
      const boxes = await links.evaluateAll((elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { height: box.height, text: element.textContent?.trim(), width: box.width };
      }));
      const offenders = boxes.filter(({ height, width }) => height < 43.5 || width < 43.5);
      expect(offenders, `${check.path}: ${JSON.stringify(offenders)}`).toEqual([]);
    }
  } finally {
    await cleanupOrganizationFixture(request, organizationScope);
  }
});
