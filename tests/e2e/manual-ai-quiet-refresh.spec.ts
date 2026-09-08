import { randomBytes } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";

const transcriptId = "00000000-0000-4000-8000-000000000301";
const outputId = "00000000-0000-4000-8000-000000000304";
const activeJobId = "00000000-0000-4000-8000-000000000305";
const cleanupJobId = "00000000-0000-4000-8000-000000000308";
const legacyJobId = "00000000-0000-4000-8000-000000000309";
const doneJobId = "00000000-0000-4000-8000-000000000310";
const newOutputId = "00000000-0000-4000-8000-000000000311";
const pagedOutputId = "00000000-0000-4000-8000-000000000312";

// createFixtureScope supplies the exact twelve-hex token required by the guarded fixture route.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

// openQuietFixture enters the guarded development-only manual AI surface.
async function openQuietFixture(page: Page) {
  await page.goto(`/login/manual-ai-refresh-e2e?scope=${createFixtureScope()}`);
}

// manualJob returns a complete browser-safe job snapshot for route interception.
function manualJob(id: string, status: "cancelled" | "done" | "failed" | "queued" | "running", processingType: string, startedAt: string | null) {
  return {
    attempt_count: status === "queued" ? 0 : 1,
    completed_at: status === "done" || status === "failed" || status === "cancelled" ? "2026-09-08T10:00:00.000Z" : null,
    created_at: "2026-09-08T09:55:00.000Z",
    failure_code: status === "failed" ? "execution_interrupted" : null,
    id,
    lease_expires_at: status === "running" ? "2026-09-08T10:08:00.000Z" : null,
    max_attempts: id === legacyJobId ? 3 : 1,
    model: "gpt-5.6-terra",
    processing_type: processingType,
    retry_after_at: null,
    started_at: startedAt,
    status
  };
}

test("background AI polling preserves disclosure, checked task, focus and scroll", async ({ page }) => {
  let stateRequests = 0;
  await page.route("**/api/transcripts/*/ai-state", async (route) => {
    stateRequests += 1;
    const jobId = "00000000-0000-4000-8000-000000000305";
    await route.fulfill({
      contentType: "application/json",
      json: {
        classifications: stateRequests === 1
          ? [{ actions: [], cleanup_reason: "active_or_slow", job_id: jobId, poll_eligible: true }]
          : [{ actions: [], cleanup_reason: "protected_output", job_id: jobId, poll_eligible: false }],
        cleanup: { eligible_count: 0, next_cursor: null },
        jobs: [{
          attempt_count: 1, completed_at: stateRequests === 1 ? null : "2099-01-01T00:00:10.000Z",
          created_at: "2099-01-01T00:00:00.000Z", failure_code: null, id: jobId,
          lease_expires_at: "2099-01-01T00:08:00.000Z", max_attempts: 1, model: "gpt-5.6-terra",
          processing_type: "follow_up_email", retry_after_at: null,
          started_at: "2099-01-01T00:00:00.000Z", status: stateRequests === 1 ? "running" : "done"
        }],
        outputs: [{
          body_loaded: false, created_at: "2026-08-06T10:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000304",
          processing_job_id: jobId, processing_type: "follow_up_email",
          transcript_id: "00000000-0000-4000-8000-000000000301"
        }]
      },
      status: 200
    });
  });
  await page.route("**/api/transcript-tasks/*/status", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { status: string };
    await route.fulfill({ contentType: "application/json", json: { ok: true, status: body.status }, status: 200 });
  });

  await openQuietFixture(page);
  const output = page.locator(".ai-output-detail");
  await output.locator("summary").click();
  const taskToggle = page.locator(".structured-task-row").getByRole("button").first();
  await taskToggle.click();
  const copyButton = output.getByRole("button", { name: "Kopírovat" });
  await copyButton.focus();
  await output.evaluate((node) => { (node as HTMLElement).dataset.e2eStable = "yes"; });
  await page.evaluate(() => window.scrollTo(0, 160));
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await expect.poll(() => stateRequests).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(10_200);
  await expect.poll(() => stateRequests).toBeGreaterThanOrEqual(2);

  await expect(output).toHaveAttribute("data-e2e-stable", "yes");
  await expect(output).toHaveJSProperty("open", true);
  await expect(taskToggle).toHaveAttribute("aria-pressed", "true");
  await expect(copyButton).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await expect(page.locator(".ai-running-state")).not.toHaveAttribute("open", "");
});

test("server-authorized individual and paged bulk cleanup stay exact and truthful", async ({ page }) => {
  const postedBatches: string[][] = [];
  const cleanupGets: string[] = [];
  const bulkIds = Array.from({ length: 51 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  await page.route("**/api/transcripts/*/ai-state", async (route) => route.fulfill({
    contentType: "application/json",
    json: {
      classifications: [
        { actions: [], cleanup_reason: "active_or_slow", job_id: activeJobId, poll_eligible: true },
        { actions: [], cleanup_reason: "unsupported_legacy", job_id: legacyJobId, poll_eligible: false },
        { actions: ["delete"], cleanup_reason: "eligible_terminal_no_output", job_id: cleanupJobId, poll_eligible: false },
        { actions: [], cleanup_reason: "protected_output", job_id: doneJobId, poll_eligible: false }
      ],
      cleanup: { eligible_count: 52, next_cursor: "cursor-page-2" },
      jobs: [
        manualJob(activeJobId, "running", "summary", "2026-09-08T09:59:55.000Z"),
        manualJob(legacyJobId, "queued", "meeting_minutes", null),
        manualJob(cleanupJobId, "failed", "action_items", "2026-09-08T09:55:00.000Z"),
        manualJob(doneJobId, "done", "crm_note", "2026-09-08T09:55:00.000Z")
      ],
      outputs: []
    },
    status: 200
  }));
  await page.route("**/api/transcripts/*/manual-ai/cleanup**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      cleanupGets.push(request.url());
      const cursor = new URL(request.url()).searchParams.get("cursor");
      const ids = cursor ? bulkIds.slice(50) : bulkIds.slice(0, 50);
      await route.fulfill({
        contentType: "application/json",
        json: {
          candidates: ids.map((jobId) => ({ cleanup_reason: "eligible_terminal_no_output", job_id: jobId })),
          next_cursor: cursor ? null : "cursor-page-2"
        },
        status: 200
      });
      return;
    }

    const ids = (request.postDataJSON() as { job_ids: string[] }).job_ids;
    postedBatches.push(ids);
    if (ids.length === 1 && ids[0] === cleanupJobId) {
      await route.fulfill({ contentType: "application/json", json: {
        changed_jobs: [], removed_job_ids: [cleanupJobId], results: [{ job_id: cleanupJobId, result: "deleted" }]
      }, status: 200 });
      return;
    }
    const results = ids.map((jobId, index) => ({
      job_id: jobId,
      result: ids.length === 50 && index === 48 ? "protected" : ids.length === 50 && index === 49 ? "conflict" : "deleted"
    }));
    await route.fulfill({ contentType: "application/json", json: {
      changed_jobs: [],
      removed_job_ids: results.filter((result) => result.result === "deleted").map((result) => result.job_id),
      results
    }, status: 200 });
  });

  await openQuietFixture(page);
  const panel = page.locator(".ai-running-state");
  await expect(panel.locator("summary")).toContainText("1 aktivní · 2 chyb · 52 k vyčištění");
  await expect(panel).not.toHaveAttribute("open", "");
  await panel.locator("summary").click();
  await expect(panel.locator(".ai-job-row")).toHaveCount(3);

  const individualRow = panel.locator(".ai-job-row").filter({ hasText: "Úkoly" });
  await individualRow.getByRole("button", { name: "Vyčistit záznam" }).click();
  await expect(individualRow).toHaveCount(0);
  expect(postedBatches[0]).toEqual([cleanupJobId]);
  await expect(panel.locator(".ai-job-row")).toHaveCount(2);

  await panel.getByRole("button", { name: /Vyčistit způsobilé/ }).click();
  await expect(panel.getByRole("status")).toContainText("Kontrola dokončena: 51 záznamů");
  await expect(panel.getByRole("status")).toContainText("odstraněno 49");
  await expect(panel.getByRole("status")).toContainText("chráněno výstupem 1");
  await expect(panel.getByRole("status")).toContainText("mezitím změněno 1");
  expect(cleanupGets).toHaveLength(2);
  expect(new URL(cleanupGets[0]!).searchParams.get("cursor")).toBeNull();
  expect(new URL(cleanupGets[1]!).searchParams.get("cursor")).toBe("cursor-page-2");
  expect(postedBatches.slice(1).map((batch) => batch.length)).toEqual([50, 1]);
  expect(postedBatches.slice(1).every((batch) => batch.length <= 50)).toBe(true);
});

test("poll cadence and lifecycle storms keep one request and the original deadline", async ({ page }) => {
  const clockStart = new Date("2026-09-08T10:00:00.000Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(await page.evaluate(() => Date.now()));
  await page.addInitScript(() => {
    const target = window as typeof window & { __manualAiRequestTimes?: number[] };
    target.__manualAiRequestTimes = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/ai-state")) target.__manualAiRequestTimes!.push(Date.now());
      return nativeFetch(input, init);
    };
  });
  let requestCount = 0;
  let firstRequestTime = 0;
  let heldRoute: Route | null = null;
  let holdNext = false;
  let concurrent = 0;
  let maxConcurrent = 0;
  const payload = (startedAt: string) => ({
    classifications: [{ actions: [], cleanup_reason: "active_or_slow", job_id: activeJobId, poll_eligible: true }],
    cleanup: { eligible_count: 0, next_cursor: null },
    jobs: [manualJob(activeJobId, "running", "summary", startedAt)],
    outputs: []
  });
  await page.route("**/api/transcripts/*/ai-state", async (route) => {
    requestCount += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    if (holdNext) {
      holdNext = false;
      heldRoute = route;
      return;
    }
    const startedAt = requestCount === 1
      ? "2026-09-08T10:00:00.000Z"
      : requestCount === 2
        ? new Date(firstRequestTime - 20_000).toISOString()
        : new Date(firstRequestTime - 80_000).toISOString();
    await route.fulfill({ contentType: "application/json", json: payload(startedAt), status: 200 });
    concurrent -= 1;
  });

  await openQuietFixture(page);
  await expect.poll(() => requestCount).toBe(1);
  firstRequestTime = (await page.evaluate(() => (window as typeof window & { __manualAiRequestTimes: number[] }).__manualAiRequestTimes[0]))!;

  await page.clock.runFor(5_000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(4_999);
  expect(requestCount).toBe(1);
  await page.clock.runFor(1);
  await expect.poll(() => requestCount).toBe(2);
  await page.clock.runFor(29_999);
  expect(requestCount).toBe(2);
  await page.clock.runFor(1);
  await expect.poll(() => requestCount).toBe(3);
  await page.clock.runFor(59_999);
  expect(requestCount).toBe(3);
  await page.clock.runFor(1);
  await expect.poll(() => requestCount).toBe(4);

  const times = await page.evaluate(() => (window as typeof window & { __manualAiRequestTimes: number[] }).__manualAiRequestTimes.slice(0, 4));
  expect(times.slice(1).map((time, index) => time - times[index]!)).toEqual([10_000, 30_000, 60_000]);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
  });
  await page.clock.runFor(120_000);
  expect(requestCount).toBe(4);
  holdNext = true;
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requestCount).toBe(5);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(requestCount).toBe(5);
  expect(maxConcurrent).toBe(1);
  expect(heldRoute).not.toBeNull();
  await heldRoute!.fulfill({ contentType: "application/json", json: payload(new Date(firstRequestTime - 80_000).toISOString()), status: 200 });
  concurrent -= 1;

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(120_000);
  expect(requestCount).toBe(5);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => requestCount).toBe(6);
  expect(maxConcurrent).toBe(1);
});

test("same-transcript props and stale hydration preserve local state while new output loads", async ({ page }) => {
  let stateRequestCount = 0;
  let pagedRequestCount = 0;
  let delayedRoute: Route | null = null;
  await page.route("**/api/transcripts/*/ai-state**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("outputOffset") === "50") {
      pagedRequestCount += 1;
      await route.fulfill({ contentType: "application/json", json: {
        classifications: [], cleanup: { eligible_count: 0, next_cursor: null }, jobs: [], nextOutputOffset: null,
        outputs: [{ body_loaded: false, created_at: "2026-09-08T10:02:00.000Z", id: pagedOutputId, processing_job_id: activeJobId, processing_type: "timeline_chapters", transcript_id: transcriptId }]
      }, status: 200 });
      return;
    }
    stateRequestCount += 1;
    if (stateRequestCount === 3) {
      delayedRoute = route;
      return;
    }
    await route.fulfill({ contentType: "application/json", json: {
      classifications: [{ actions: ["delete"], cleanup_reason: "eligible_terminal_no_output", job_id: cleanupJobId, poll_eligible: false }],
      cleanup: { eligible_count: 1, next_cursor: null },
      jobs: [manualJob(cleanupJobId, "failed", "summary", "2026-09-08T09:55:00.000Z")],
      nextOutputOffset: 50,
      outputs: [{ body_loaded: false, created_at: "2026-09-08T10:01:00.000Z", id: newOutputId, processing_job_id: activeJobId, processing_type: "crm_note", transcript_id: transcriptId }]
    }, status: 200 });
  });
  await page.route(`**/api/ai-outputs/${newOutputId}**`, async (route) => route.fulfill({ contentType: "application/json", json: {
    output: { created_at: "2026-09-08T10:01:00.000Z", id: newOutputId, output_json: { markdown: "NOVÝ HYDRATOVANÝ OBSAH" }, output_text: null, processing_job_id: activeJobId, processing_type: "crm_note", transcript_id: transcriptId, user_id: "00000000-0000-4000-8000-000000000303" },
    structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] }
  }, status: 200 }));
  await page.route(`**/api/ai-outputs/${pagedOutputId}**`, async (route) => route.fulfill({ contentType: "application/json", json: {
    output: { created_at: "2026-09-08T10:02:00.000Z", id: pagedOutputId, output_json: { markdown: "STRÁNKOVANÝ HYDRATOVANÝ OBSAH" }, output_text: null, processing_job_id: activeJobId, processing_type: "timeline_chapters", transcript_id: transcriptId, user_id: "00000000-0000-4000-8000-000000000303" },
    structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] }
  }, status: 200 }));
  await page.route("**/api/transcript-tasks/*/status", async (route) => route.fulfill({ contentType: "application/json", json: { ok: true, status: "done" }, status: 200 }));
  await page.route("**/api/transcript-tasks/*", async (route) => {
    if (route.request().method() === "DELETE") await route.fulfill({ contentType: "application/json", json: { ok: true }, status: 200 });
    else await route.fallback();
  });
  await page.route("**/api/transcripts/*/manual-ai/cleanup", async (route) => route.fulfill({ contentType: "application/json", json: {
    changed_jobs: [], removed_job_ids: [cleanupJobId], results: [{ job_id: cleanupJobId, result: "deleted" }]
  }, status: 200 }));
  page.on("dialog", (dialog) => void dialog.accept());

  await openQuietFixture(page);
  const initialOutput = page.locator(".ai-output-detail").filter({ hasText: "E-mail po hovoru" });
  await initialOutput.locator("summary").click();
  await initialOutput.evaluate((node) => { (node as HTMLElement).dataset.e2eStable = "yes"; });
  const newOutput = page.locator(".ai-output-detail").filter({ hasText: "CRM poznámka" });
  await expect(newOutput).toBeVisible();
  await newOutput.locator("summary").click();
  await expect(newOutput).toContainText("NOVÝ HYDRATOVANÝ OBSAH");
  await page.getByRole("button", { name: "Načíst všechny AI výstupy" }).evaluate((button: HTMLButtonElement) => button.click());
  const pagedOutput = page.locator(".ai-output-detail").filter({ hasText: "Časová osa" });
  await expect.poll(() => pagedRequestCount).toBe(1);
  await expect(pagedOutput).toContainText("STRÁNKOVANÝ HYDRATOVANÝ OBSAH");

  const taskToggle = page.locator(".structured-task-row").getByRole("button").first();
  await taskToggle.click();
  await expect(taskToggle).toHaveAttribute("aria-pressed", "true");
  const copyButton = initialOutput.getByRole("button", { name: "Kopírovat" });
  await copyButton.focus();
  await page.evaluate(() => window.scrollTo(0, 160));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Použít ekvivalentní server props" }).evaluate((button: HTMLButtonElement) => button.click());

  await expect(taskToggle).toHaveAttribute("aria-pressed", "true");
  await expect(initialOutput).toHaveAttribute("data-e2e-stable", "yes");
  await expect(initialOutput).toHaveJSProperty("open", true);
  await expect(newOutput).toHaveJSProperty("open", true);
  await expect(newOutput).toContainText("NOVÝ HYDRATOVANÝ OBSAH");
  await expect(pagedOutput).toContainText("STRÁNKOVANÝ HYDRATOVANÝ OBSAH");
  await expect(copyButton).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  await page.getByRole("button", { name: "Načíst AI metadata" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => stateRequestCount).toBe(3);
  const panel = page.locator(".ai-running-state");
  await panel.locator("summary").click();
  await panel.locator(".ai-job-row").filter({ hasText: "Shrnutí" }).getByRole("button", { name: "Vyčistit záznam" }).click();
  await expect(panel.locator(".ai-job-row").filter({ hasText: "Shrnutí" })).toHaveCount(0);
  await page.getByRole("button", { name: "Smazat úkol: E2E úkol" }).click();
  await expect(page.getByText("E2E úkol", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Odstranit výstup lokálně" }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole("button", { name: "Přehrát staré server props" }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(delayedRoute).not.toBeNull();
  await delayedRoute!.fulfill({ contentType: "application/json", json: {
    classifications: [{ actions: ["delete"], cleanup_reason: "eligible_terminal_no_output", job_id: cleanupJobId, poll_eligible: false }],
    cleanup: { eligible_count: 1, next_cursor: null },
    jobs: [manualJob(cleanupJobId, "failed", "summary", "2026-09-08T09:55:00.000Z")],
    outputs: [{ body_loaded: true, created_at: "2026-08-06T10:00:00.000Z", id: outputId, processing_job_id: activeJobId, processing_type: "follow_up_email", transcript_id: transcriptId }]
  }, status: 200 });

  await expect(initialOutput).toHaveCount(0);
  await expect(page.getByText("E2E úkol", { exact: true })).toHaveCount(0);
  await expect(panel.locator(".ai-job-row").filter({ hasText: "Shrnutí" })).toHaveCount(0);
  await expect(newOutput).toBeVisible();
  await expect(newOutput).toHaveJSProperty("open", true);
  await expect(newOutput).toContainText("NOVÝ HYDRATOVANÝ OBSAH");
  await expect(pagedOutput).toContainText("STRÁNKOVANÝ HYDRATOVANÝ OBSAH");
});
