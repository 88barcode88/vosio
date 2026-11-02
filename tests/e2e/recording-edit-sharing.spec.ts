import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const recordingId = "00000000-0000-4000-8000-000000000302";
const recipients = [
  { userId: "00000000-0000-4000-8000-000000000321", email: "reader-a@example.test", role: "reader" },
  { userId: "00000000-0000-4000-8000-000000000322", email: "reader-b@example.test", role: "editor" }
];

// UI fixtures expose no real accounts; every access read and sharing mutation is intercepted locally.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: { members: [], grants: [], invitations: [], ownerId: null, recordings: [] } }));
  await page.route("**/rest/v1/rpc/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/list_confirmed_recording_recipients_v1") || path.endsWith("/list_project_capture_recipients_v1")) return route.fulfill({ json: recipients });
    return route.fulfill({ status: 403, json: { code: "fixture_unavailable" } });
  });
});

test("one editor exposes tags and locks sharing while assignment is a draft", async ({ page }, testInfo) => {
  await page.goto(`/login/recording-layout-e2e?scope=${randomBytes(6).toString("hex")}&mode=editor`);
  const header = page.getByRole("region", { name: "Informace a akce nahrávky" });
  const trigger = header.getByRole("button", { name: "Upravit a sdílení", exact: true });
  await expect(trigger).toHaveCount(1);
  await expect(header.getByRole("button", { name: /^(Upravit název|Upravit zařazení|Sdílet)$/ })).toHaveCount(0);
  await expect(header).toContainText("Soukromá");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Upravit a sdílení", exact: true });
  await expect(dialog.getByRole("textbox", { name: /^Název nahrávky/ })).toBeVisible();
  const tags = dialog.getByRole("group", { name: "Štítky", exact: true });
  const lucern = tags.getByRole("checkbox", { name: /Lucern/ });
  const okna = tags.getByRole("checkbox", { name: /Okna/ });
  await expect(lucern).toBeVisible();
  await expect(lucern).toBeChecked();
  await expect(okna).not.toBeChecked();
  await okna.check();
  await expect(okna).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Uložit sdílení", exact: true })).toBeDisabled();
  await expect(dialog).toContainText(/Nejprve.*zařazení/);
  await page.screenshot({ path: testInfo.outputPath("unified-editor-tags.png"), fullPage: true });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("multiple recipients share one preserved attempt across an uncertain response", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/rpc/bulk_share_recordings_v1", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill(requests.length === 1 ? { status: 503, json: { error: "fixture_unavailable" } }
      : { json: [{ recording_id: recordingId, visibility: "selected" }] });
  });
  await page.goto(`/login/recording-layout-e2e?scope=${randomBytes(6).toString("hex")}&mode=editor`);
  const trigger = page.getByRole("button", { name: "Upravit a sdílení", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Upravit a sdílení", exact: true });
  await dialog.getByRole("button", { name: "Vybraní lidé", exact: true }).click();
  for (const recipient of recipients) await dialog.getByRole("checkbox", { name: new RegExp(recipient.email) }).check();
  await dialog.getByRole("button", { name: "Uložit sdílení", exact: true }).click();
  const retry = dialog.getByRole("button", { name: /Zopakovat stejné sdílení/ });
  await expect(retry).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ p_recording_ids: [recordingId], p_visibility: "selected", p_recipients: recipients.map(({ userId, role }) => ({ userId, role })) });
  await expect(dialog.getByRole("textbox", { name: /^Název nahrávky/ })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await trigger.click();
  await dialog.getByRole("button", { name: /Zopakovat stejné sdílení/ }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual(requests[0]);
  await expect(dialog.getByRole("textbox", { name: /^Název nahrávky/ })).toBeEnabled();
});

test("a reader has no edit controls and a title editor cannot manage sharing", async ({ page }) => {
  const scope = randomBytes(6).toString("hex");
  await page.goto(`/login/recording-layout-e2e?scope=${scope}&mode=editor-reader`);
  await expect(page.getByRole("button", { name: "Upravit a sdílení", exact: true })).toHaveCount(0);
  await page.goto(`/login/recording-layout-e2e?scope=${scope}&mode=editor-title-only`);
  await page.getByRole("button", { name: "Upravit a sdílení", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upravit a sdílení", exact: true });
  await expect(dialog.getByRole("textbox", { name: /^Název nahrávky/ })).toBeVisible();
  await expect(dialog.getByRole("form", { name: "Zařazení", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Uložit sdílení", exact: true })).toHaveCount(0);
});
