import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

type FixtureMode = "blocks" | "raw" | "ai" | "timeline" | "files";

// createFixtureScope supplies the exact twelve-hex token required by the guarded fixture route.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// stubSignedAudioUrl keeps the real audio player mounted without requiring private storage access.
async function stubSignedAudioUrl(page: Page) {
  await page.route("**/api/recordings/*/audio", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        expiresIn: 300,
        mimeType: "audio/wav",
        url: "https://media.vosio.test/recording-layout.wav"
      }
    });
  });
}

// scrollDetailTabToEnd moves the active tab and any nested overflow regions to their final position.
async function scrollDetailTabToEnd(page: Page, selector: string) {
  const scrollRoot = page.locator(selector);

  await scrollRoot.evaluate((element) => {
    const elements = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];

    for (const candidate of elements) {
      candidate.scrollTop = candidate.scrollHeight;
    }
  });
}

test("the layout fixture rejects missing scope", async ({ request }) => {
  const response = await request.get("/login/recording-layout-e2e");
  expect(response.status()).toBe(404);
});

test("the layout fixture rejects malformed scope and mode", async ({ request }) => {
  const malformedScope = await request.get("/login/recording-layout-e2e?scope=not-a-token&mode=blocks");
  expect(malformedScope.status()).toBe(404);

  const malformedMode = await request.get(
    `/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=invalid`
  );
  expect(malformedMode.status()).toBe(404);
});

test("the layout fixture renders the guarded detail grid and audio element", async ({ page }) => {
  await stubSignedAudioUrl(page);
  await page.goto(`/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=blocks`);

  await expect(page.locator(".recording-workbench")).toBeVisible();
  await expect(page.locator(".recording-workbench-grid")).toBeVisible();
  await expect(page.locator(".recording-workbench-grid > .transcript-panel")).toBeVisible();
  await expect(page.locator(".recording-workbench-grid > .recording-rail")).toBeVisible();
  await expect(page.locator(".recording-audio-player audio")).toBeVisible();
});

const fixtureTabs: ReadonlyArray<readonly [FixtureMode, string]> = [
  ["blocks", "Přepis"],
  ["raw", "Přepis"],
  ["ai", "AI zpracování"],
  ["timeline", "Časová osa"],
  ["files", "Soubory"]
];

for (const [mode, tabName] of fixtureTabs) {
  test(`the ${mode} fixture mode opens its expected detail tab`, async ({ page }) => {
    await stubSignedAudioUrl(page);
    await page.goto(`/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=${mode}`);

    await expect(page.getByRole("tab", { name: tabName })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`.tab-panel-${mode === "blocks" || mode === "raw" ? "transcript" : mode}`)).toBeVisible();
    await expect(page.locator(".recording-audio-player audio")).toBeVisible();

    if (mode === "ai") {
      await expect(page.locator(".ai-markdown-preview")).toContainText("E2E AI SENTINEL");
    }

    if (mode === "timeline") {
      await expect(page.locator(".timeline-list")).toContainText("E2E TIMELINE SENTINEL");
    }

    if (mode === "files") {
      await expect(page.locator(".file-details")).toContainText("audio/e2e-sentinel");
    }

    if (mode === "ai" || mode === "timeline" || mode === "files") {
      const content = page.locator(`.tab-panel-${mode}`);
      const player = page.locator(".recording-audio-player");
      const scrollSelector = {
        ai: ".tab-panel-ai > .ai-tab-layout",
        timeline: ".tab-panel-timeline > .timeline-list",
        files: ".tab-panel-files > .file-details"
      }[mode];
      const sentinel = {
        ai: page.getByText("E2E AI SENTINEL", { exact: true }).last(),
        timeline: page.getByText("E2E TIMELINE SENTINEL", { exact: true }),
        files: page.getByText("audio/e2e-sentinel", { exact: true })
      }[mode];

      await scrollDetailTabToEnd(page, scrollSelector);
      await expect(sentinel).toBeInViewport();

      const [sentinelBox, playerBox] = await Promise.all([sentinel.boundingBox(), player.boundingBox()]);
      expect(sentinelBox).not.toBeNull();
      expect(playerBox).not.toBeNull();
      expect(sentinelBox!.y + sentinelBox!.height).toBeLessThanOrEqual(playerBox!.y);

      const [contentBox, contentPlayerBox] = await Promise.all([content.boundingBox(), player.boundingBox()]);

      expect(contentBox).not.toBeNull();
      expect(contentPlayerBox).not.toBeNull();
      expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(contentPlayerBox!.y);
    }
  });
}

test("the final transcript row scrolls fully above the audio player", async ({ page }) => {
  await stubSignedAudioUrl(page);
  const scope = createFixtureScope();
  await page.goto(`/login/recording-layout-e2e?scope=${scope}&mode=blocks`);

  await expect(page.locator(".recording-workbench")).toBeVisible();
  await expect(page.locator(".recording-workbench-grid > .transcript-panel")).toBeVisible();
  await expect(page.locator(".recording-workbench-grid > .recording-rail")).toBeVisible();

  const scroll = page.locator(".transcript-table-scroll");
  const lastRow = page.locator(".transcript-table-row", { hasText: "POSLEDNÍ VĚTA PŘEPISU" });
  const player = page.locator(".recording-audio-player");

  await expect(lastRow).toBeVisible();
  await expect(player).toBeVisible();
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(lastRow).toBeInViewport();

  const [rowBox, playerBox] = await Promise.all([lastRow.boundingBox(), player.boundingBox()]);
  expect(rowBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(playerBox!.y);
});

test("the final raw transcript line scrolls fully above the audio player", async ({ page }) => {
  await stubSignedAudioUrl(page);
  const scope = createFixtureScope();
  await page.goto(`/login/recording-layout-e2e?scope=${scope}&mode=raw`);

  const scroll = page.locator(".transcript-list-scroll");
  const rawBlock = page.locator(".transcript-raw-block");
  const player = page.locator(".recording-audio-player");

  await expect(rawBlock).toContainText("POSLEDNÍ RAW VĚTA PŘEPISU");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(rawBlock).toContainText("POSLEDNÍ RAW VĚTA PŘEPISU");
  expect(await scroll.evaluate((element) =>
    element.scrollTop + element.clientHeight >= element.scrollHeight - 1
  )).toBe(true);

  const [rawBox, playerBox] = await Promise.all([rawBlock.boundingBox(), player.boundingBox()]);
  expect(rawBox).not.toBeNull();
  expect(playerBox).not.toBeNull();
  expect(rawBox!.y + rawBox!.height).toBeLessThanOrEqual(playerBox!.y);
});
