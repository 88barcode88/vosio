import { expect, type Page, test } from "@playwright/test";

const screenshotDir = process.env.STRUCTURED_COPY_SCREENSHOT_DIR;

// openEvidenceFixture loads the real TranscriptTabs surface with one structured row and clipboard access.
async function openEvidenceFixture(page: Page, mode: "single" | "none" | "segmented") {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/login/recording-evidence-e2e?mode=${mode}`);
  await expect(page.locator(`[data-e2e-evidence-mode="${mode}"]`)).toBeVisible();
}

// readClipboard returns the text the page last wrote to the system clipboard (Windows stores CRLF line ends).
async function readClipboard(page: Page) {
  return (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/gu, "\n");
}

test("task title has a light text-only copy and the row copies the whole item before delete", async ({ page }) => {
  await openEvidenceFixture(page, "single");
  const row = page.locator(".structured-task-row");
  const actions = row.locator(".structured-item-actions > button");
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toHaveClass(/structured-item-copy/u);
  await expect(actions.nth(1)).toHaveClass(/structured-task-delete/u);

  await row.getByRole("button", { name: "Kopírovat text: Potvrdit termin" }).click();
  await expect.poll(() => readClipboard(page)).toBe("Potvrdit termin");

  await actions.nth(0).click();
  await expect.poll(() => readClipboard(page)).toMatch(/^Potvrdit termin\nMoje práce\nDůkaz \(00:08[^)]*\): "Schvalili jsme termin"$/u);
  if (screenshotDir) await row.screenshot({ path: `${screenshotDir}/task-row.png` });
});

test("decision and risk rows get the same copy and delete actions", async ({ page }) => {
  await openEvidenceFixture(page, "segmented");
  const decision = page.locator("li[data-decision-status]");
  await expect(decision.locator(".structured-item-actions > button")).toHaveCount(2);
  await decision.locator(".structured-item-copy").click();
  await expect.poll(() => readClipboard(page)).toMatch(/^Legacy segmented rozhodnuti\nDohodnuto\nDůkaz/u);
  if (screenshotDir) await decision.screenshot({ path: `${screenshotDir}/decision-row.png` });

  await openEvidenceFixture(page, "none");
  const risk = page.locator("li[data-risk-row]");
  await expect(risk.getByRole("button", { name: "Smazat riziko: Transcript-only riziko" })).toBeVisible();
  await risk.getByRole("button", { name: "Kopírovat text: Transcript-only riziko" }).click();
  await expect.poll(() => readClipboard(page)).toBe("Transcript-only riziko");
  if (screenshotDir) await risk.screenshot({ path: `${screenshotDir}/risk-row.png` });
});

test("a hidden structured row is not displayed while its delete is pending", async ({ page }) => {
  await openEvidenceFixture(page, "none");
  const risk = page.locator("li[data-risk-row]");
  await expect(risk).toBeVisible();
  await risk.evaluate((element) => { (element as HTMLElement).hidden = true; });
  await expect(risk).toBeHidden();
});
