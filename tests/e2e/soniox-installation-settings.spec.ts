import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

// createFixtureScope supplies the exact twelve-hex guard required by the inert fixture.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// fixturePath keeps all installation QA on a scoped development-only route.
function fixturePath(params: Record<string, string>) {
  const query = new URLSearchParams({ scope: createFixtureScope(), ...params });
  return `/login/soniox-installation-e2e?${query.toString()}`;
}

// collectRuntimeFailures rejects hydration mismatches, console errors and page exceptions.
function collectRuntimeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) failures.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  return failures;
}

// expectSafeGeometry verifies the one-scroll, 44px and horizontal containment contracts.
async function expectSafeGeometry(page: Page) {
  const report = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".content-area");
    const nestedOwners = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => {
      const style = getComputedStyle(element);
      return ["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    });
    const shortControls = Array.from(document.querySelectorAll<HTMLElement>("button, select, summary"))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== "none" && box.width > 0 && box.height > 0 && box.height < 43.5;
      })
      .map((element) => `${element.tagName}.${element.className}`);
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollOwners: Number(document.documentElement.scrollHeight > document.documentElement.clientHeight + 1)
        + nestedOwners.filter((element) => element !== content).length
        + Number(Boolean(content && ["auto", "scroll"].includes(getComputedStyle(content).overflowY)
          && content.scrollHeight > content.clientHeight + 1)),
      shortControls
    };
  });
  expect(report.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(report.scrollOwners).toBeLessThanOrEqual(1);
  expect(report.shortControls).toEqual([]);
}

test("stored settings save with pending, safe failure drafts and a no-JS EU warning", async ({ browser, page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  const noJsContext = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto(new URL(
    fixturePath({ installation: "ready", region: "global", save: "success", surface: "settings" }),
    String(testInfo.project.use.baseURL)
  ).href);
  const noJsRegion = noJsPage.getByLabel("Region Soniox");
  const noJsWarning = noJsPage.locator(".settings-region-warning");
  await expect(noJsWarning).not.toBeVisible();
  await noJsRegion.selectOption("eu");
  await expect(noJsWarning).toBeVisible();
  await noJsRegion.selectOption("global");
  await expect(noJsWarning).not.toBeVisible();
  await noJsContext.close();

  await page.goto(fixturePath({ installation: "ready", region: "global", save: "success", surface: "settings" }));
  const region = page.getByLabel("Region Soniox");
  await expect(region).toHaveValue("global");
  await expect(page.locator(".settings-region-warning")).not.toBeVisible();

  await region.selectOption("eu");
  const warning = page.locator(".settings-region-warning");
  await expect(warning).toContainText("Soniox EU projekt");
  await expect(warning.getByRole("link", { name: "support@soniox.com" })).toHaveAttribute(
    "href",
    "mailto:support@soniox.com"
  );
  await page.getByRole("button", { name: "Uložit nastavení" }).click();
  await expect(page.getByRole("button", { name: "Ukládám nastavení…" })).toBeDisabled();
  await page.waitForURL(/region=eu.*saved=1|saved=1.*region=eu/u);
  await expect(page.locator(".settings-alert-success")).toContainText("Nastavení je uložené");
  await expect(region).toHaveValue("eu");

  await region.selectOption("global");
  await page.getByRole("button", { name: "Uložit nastavení" }).click();
  await page.waitForURL(/region=global.*saved=1|saved=1.*region=global/u);
  await expect(page.locator(".settings-alert-success")).toContainText("Nastavení je uložené");
  await expect(region).toHaveValue("global");
  await page.reload();
  await expect(region).toHaveValue("global");

  await page.goto(fixturePath({ installation: "missing", region: "global", save: "error", surface: "settings" }));
  const failedDraft = {
    defaultOpenaiModel: "gpt-5.6-sol",
    sonioxRealtimeLanguage: "de",
    sonioxRealtimeModel: "stt-rt-v5",
    sonioxRegion: "eu",
    supabaseStoragePlan: "paid"
  };
  for (const [name, value] of Object.entries(failedDraft)) {
    await page.locator(`select[name="${name}"]`).selectOption(value);
  }
  const technicalDisclosure = page.getByRole("button", { name: "Technické informace" });
  await technicalDisclosure.click();
  await expect(technicalDisclosure).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Uložit nastavení" }).click();
  const pendingFields = page.locator("fieldset[data-settings-fields]");
  await expect(pendingFields).toHaveAttribute("disabled", "");
  const pendingSnapshot = await pendingFields.evaluate((fieldset) => ({
    busy: fieldset.getAttribute("aria-busy"),
    controlsDisabled: Array.from(fieldset.querySelectorAll("select, button"))
      .every((control) => control.matches(":disabled"))
  }));
  expect(pendingSnapshot).toEqual({ busy: "true", controlsDisabled: true });
  await expect(page).toHaveURL(/region=global/u);
  await expect(page).not.toHaveURL(/error=|sonioxRegion=/u);
  await expect(page.locator(".settings-alert-error")).toContainText("Nastavení se nepodařilo uložit");
  await expect(page.locator(".settings-alert-error")).toBeFocused();
  await expect(technicalDisclosure).toHaveAttribute("aria-expanded", "true");
  for (const [name, value] of Object.entries(failedDraft)) {
    await expect(page.locator(`select[name="${name}"]`)).toHaveValue(value);
  }
  const failedSettingsUrl = page.url();
  await page.goto(fixturePath({ configuration: "ready", surface: "configuration" }));
  await page.goBack();
  await expect(page).toHaveURL(failedSettingsUrl);
  const restoredNavigationState = await page.evaluate(() => ({
    errorVisible: Boolean(document.querySelector(".settings-alert-error")),
    region: (document.querySelector<HTMLSelectElement>('select[name="sonioxRegion"]'))?.value
  }));
  expect(restoredNavigationState).toEqual(
    restoredNavigationState.region === "eu"
      ? { errorVisible: true, region: "eu" }
      : { errorVisible: false, region: "global" }
  );
  await page.reload();
  await expect(page.getByLabel("Region Soniox")).toHaveValue("global");
  await expect(page.locator('select[name="defaultOpenaiModel"]')).toHaveValue("gpt-5.6-terra");
  await expect(page.locator('select[name="sonioxRealtimeLanguage"]')).toHaveValue("auto");
  await expect(page.locator('select[name="sonioxRealtimeModel"]')).toHaveValue("stt-rt-v5");
  await expect(page.locator('select[name="supabaseStoragePlan"]')).toHaveValue("free");
  await expect(page.locator(".settings-alert-error")).toHaveCount(0);
  expect(failures.filter((failure) => /hydration|#418/iu.test(failure))).toEqual([]);
  expect(failures).toEqual([]);
});

test("technical information returns only readiness, missing names and optional Gemini state", async ({ page }) => {
  await page.goto(fixturePath({ gemini: "configured", installation: "missing", region: "eu", surface: "settings" }));
  await page.getByRole("button", { name: "Technické informace" }).click();
  const details = page.getByRole("region", { name: "Technické informace" });
  await expect(details).toContainText("Chybí konfigurace");
  await expect(details).toContainText("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  await expect(details).toContainText("OPENAI_API_KEY");
  await expect(details).toContainText("GEMINI_API_KEY (volitelné)Nastaveno");
  await expect(details).not.toContainText(/test-secret|https:\/\/|eyJ|sk-/u);

  await page.goto(fixturePath({ installation: "ready", region: "global", surface: "settings" }));
  await page.getByRole("button", { name: "Technické informace" }).click();
  await expect(page.getByRole("region", { name: "Technické informace" })).toContainText("Připraveno");
});

test("safe configuration diagnostics cover one, both and no missing public variables", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  for (const configuration of ["key", "both", "ready"] as const) {
    await page.goto(fixturePath({ configuration, surface: "configuration" }));
    await expect(page.getByRole("heading", { name: "Konfigurace aplikace" })).toBeVisible();
    if (configuration === "ready") {
      await expect(page.getByText("Veřejná konfigurace je připravená.", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText("Chybí veřejná konfigurace Supabase.", { exact: true })).toBeVisible();
      await expect(page.getByText("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", { exact: true })).toBeVisible();
      await expect(page.getByText("NEXT_PUBLIC_SUPABASE_URL", { exact: true }))
        .toHaveCount(configuration === "both" ? 1 : 0);
    }
    await page.reload();
    await expect(page).toHaveURL(/soniox-installation-e2e/u);
    await expectSafeGeometry(page);
  }
  expect(failures).toEqual([]);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`settings and configuration remain single-scroll, touch-safe and hydration-clean at ${width}px`, async ({ page }, testInfo) => {
    const failures = collectRuntimeFailures(page);
    await page.setViewportSize({ height: 760, width });
    for (const surface of ["settings", "configuration"] as const) {
      await page.goto(fixturePath({ configuration: "both", installation: "missing", region: "eu", surface }));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      for (const theme of ["dark", "light"] as const) {
        await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
        await expectSafeGeometry(page);
      }
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`installation-${width}.png`) });
    expect(failures.filter((failure) => /hydration|#418/iu.test(failure))).toEqual([]);
    expect(failures).toEqual([]);
  });
}
