import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const transcriptId = "00000000-0000-4000-8000-000000000301";
const outputId = "00000000-0000-4000-8000-000000000304";
const hiddenOutputId = "00000000-0000-4000-8000-000000000311";
const taskId = "00000000-0000-4000-8000-000000000307";
const hiddenTaskId = "00000000-0000-4000-8000-000000000399";
const snapshot = { transcriptId, generation: null, transcriptVersion: "1",
  outputs: [outputId, hiddenOutputId].map((id) => ({ id, version: "1" })),
  tasks: [taskId, hiddenTaskId].map((id) => ({ id, version: "1", updatedAt: "2026-10-03", status: "new" })) };

for (const theme of ["light", "dark"] as const) {
  test(`${theme} whole checklist review includes unloaded sources and stale props cannot restore tasks`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "vosio-theme", value: theme, url: baseURL! }]);
    let deleteBody: unknown;
    await page.route("**/api/transcripts/*/automatic-timeline", (route) => route.fulfill({ json: { status: "not_scheduled" } }));
    await page.route("**/api/transcripts/*/ai-state", (route) => route.fulfill({ json: { jobs: [], outputs: [] } }));
    await page.route("**/api/transcripts/*/checklist", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { snapshot, rowCount: 2, logicalCount: 2 } });
      deleteBody = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true, transcriptId, deletedIds: [taskId, hiddenTaskId], suppressionIds: [outputId, hiddenOutputId], deletedCount: 2 } });
    });
    await page.goto(`/login/manual-ai-refresh-e2e?scope=${randomBytes(6).toString("hex")}`);
    await expect(page.locator(".structured-task-row")).toHaveCount(1);
    let confirmation = "";
    page.once("dialog", async (dialog) => { confirmation = dialog.message(); await dialog.accept(); });
    await page.getByRole("button", { name: "Smazat celý checklist", exact: true }).click();
    await expect(page.locator(".structured-task-row")).toHaveCount(0);
    expect(deleteBody).toEqual({ snapshot }); expect(confirmation).toContain("(2 položek)");
    await page.getByRole("button", { name: "Přehrát staré server props" }).click();
    await expect(page.locator(".structured-task-row")).toHaveCount(0);
    const source = page.locator(".ai-output-detail");
    await source.locator("summary").click();
    await expect(source).toContainText("E2E AI SENTINEL");
    await expect(source).toContainText("Původní AI výstup");
  });
}

test("a checklist delete committed while another tab is open stays deleted on return", async ({ page }) => {
  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
  await page.route("**/api/transcripts/*/automatic-timeline", (route) => route.fulfill({ json: { status: "not_scheduled" } }));
  await page.route("**/api/transcripts/*/ai-state", (route) => route.fulfill({ json: { jobs: [], outputs: [] } }));
  await page.route("**/api/transcripts/*/checklist", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { snapshot, rowCount: 2, logicalCount: 2 } });
    await deleteGate;
    await route.fulfill({ json: { ok: true, transcriptId, deletedIds: [taskId, hiddenTaskId], suppressionIds: [outputId, hiddenOutputId], deletedCount: 2 } });
  });
  await page.goto(`/login/manual-ai-refresh-e2e?scope=${randomBytes(6).toString("hex")}`);
  await expect(page.locator(".structured-task-row")).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  const deleteRequested = page.waitForRequest((request) => request.url().endsWith("/checklist") && request.method() === "DELETE");
  await page.getByRole("button", { name: "Smazat celý checklist", exact: true }).click();
  await deleteRequested;
  await page.getByRole("tab", { name: "Přepis", exact: true }).click();
  const deleteCompleted = page.waitForResponse((response) => response.url().endsWith("/checklist") && response.request().method() === "DELETE");
  releaseDelete();
  await deleteCompleted;
  await page.getByRole("tab", { name: "AI zpracování", exact: true }).click();
  await expect(page.locator(".structured-task-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Přehrát staré server props" }).click();
  await expect(page.locator(".structured-task-row")).toHaveCount(0);
  await expect(page.locator(".ai-output-detail")).toHaveCount(1);
});
