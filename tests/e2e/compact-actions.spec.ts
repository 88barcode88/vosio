import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const recordingId = "00000000-0000-4000-8000-000000000302";
const disabledMessage = "Přepis není na tomto nasazení zapnutý. Správce musí aktivovat přepisovací službu.";
const widths = [320, 390, 768, 1024, 1440];

// isolate blocks all real API/provider requests before loading guarded local UI fixtures.
async function isolate(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/rpc/get_recording_capture_state_v1")) return route.fulfill({ json: { recordingId, status: "uploaded", captureRevision: 1 } });
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname === "/api/recordings/recoverable") return route.fulfill({ json: { ownerId: null, recordings: [] } });
    if (url.pathname === "/api/recording-invitations") return route.fulfill({ json: { members: [], grants: [], invitations: [] } });
    if (url.pathname.includes("/chat")) return route.fulfill({ json: { thread: null, turns: [] } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Inert fixture" } });
    return route.continue();
  });
}

// openDetail renders the production hierarchy using development-only deterministic data.
async function openDetail(page: Page, mode = "blocks") {
  await page.goto(`/login/recording-layout-e2e?scope=${randomBytes(6).toString("hex")}&mode=${mode}`);
  await expect(page.locator(".recording-workbench")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

// geometry reports document coordinates, unaffected by automatic focus scrolling.
async function geometry(page: Page) {
  return page.evaluate(() => Object.fromEntries([".recording-audio-player", ".tabs-row", ".recording-chat-composer", ".transcription-actions", ".transcription-actions > button:first-child", ".transcription-actions > button:first-child svg"]
    .map((selector) => { const box = document.querySelector(selector)?.getBoundingClientRect(); return [selector, box ? { x: box.x, y: box.y + scrollY, width: box.width, height: box.height } : null]; })));
}

// compactAction proves the real hit rectangle, compact painted surface and action icon dimensions.
async function compactAction(page: Page, selector: string) {
  const action = page.locator(selector).first();
  await expect(action).toBeVisible();
  const size = await action.evaluate((element) => {
    const box = element.getBoundingClientRect(); const paint = getComputedStyle(element, "::before");
    const icon = element.querySelector("svg")?.getBoundingClientRect();
    return { height: box.height, width: box.width, inset: paint.top, content: paint.content, icon: icon?.width };
  });
  expect(size.height).toBeGreaterThanOrEqual(44); expect(size.width).toBeGreaterThanOrEqual(44);
  expect(size.inset).toBe("7px"); expect(size.content).toBe('""');
  if (size.icon !== undefined) expect(size.icon).toBe(15);
}

test("organization and title popups retain compact controls and stable player in both themes", async ({ page }, info) => {
  await isolate(page); await openDetail(page);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 780 });
    for (const theme of ["dark", "light"]) {
      await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
      for (const selector of [".recording-organization-popover > summary", ".recording-inline-edit > summary"]) {
        const trigger = page.locator(selector); await trigger.focus();
        const before = await geometry(page); await trigger.press("Enter");
        const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
        expect(await geometry(page)).toEqual(before);
        await compactAction(page, "[role='dialog'] button[type='submit']");
        await compactAction(page, "[role='dialog'] button:has-text('Zrušit')");
        const controls = dialog.locator("button:not(:disabled), input:not([type='hidden']), select");
        await controls.last().focus(); await page.keyboard.press("Tab"); await expect(controls.first()).toBeFocused();
        await controls.first().focus(); await page.keyboard.press("Shift+Tab"); await expect(controls.last()).toBeFocused();
        const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(15); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 15);
        if (width === 320 || width === 1440) await page.screenshot({ path: info.outputPath(`${selector.includes("organization") ? "organization" : "title"}-${width}-${theme}.png`) });
        await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
});

test("transcription start and restart keep icon, toolbar and player through pending and real disabled copy", async ({ page }, info) => {
  test.setTimeout(90_000);
  await isolate(page);
  let release: (() => void) | undefined;
  await page.route("**/api/recordings/*/transcription*", async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 503, json: { error: disabledMessage } });
  });
  page.on("dialog", (dialog) => dialog.accept());
  for (const width of widths) {
    await page.setViewportSize({ width, height: 780 });
    for (const theme of ["dark", "light"]) for (const mode of ["transcription", "blocks"]) {
      release = undefined;
      await openDetail(page, mode); await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
      const button = page.locator(".transcription-actions button").first();
      await compactAction(page, ".transcription-actions button:first-child");
      await button.focus(); const before = await geometry(page); await button.click();
      await expect(button).toBeDisabled(); await expect(button).toHaveAccessibleName("Pracuji…");
      await expect(page.locator(".transcription-feedback [role='status']")).toContainText("Odesílám požadavek na přepis…");
      expect(await geometry(page)).toEqual(before);
      await expect.poll(() => Boolean(release)).toBe(true); release!();
      await expect(button).toBeEnabled(); await expect(page.locator(".transcription-feedback [role='status']")).toHaveText(disabledMessage);
      expect(await geometry(page)).toEqual(before);
      await expect(page.locator(".transcription-feedback")).toBeVisible();
      if (width === 320 || width === 1440) await page.screenshot({ path: info.outputPath(`transcription-${mode}-${width}-${theme}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
});

test("accepted transcription preserves geometry when checking action and running poll appear", async ({ page }) => {
  await isolate(page);
  let release: (() => void) | undefined;
  await page.route("**/api/recordings/*/transcription*", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json: { job: { status: "queued" } } });
    } else await route.fulfill({ json: { job: { status: "running" } } });
  });
  for (const width of widths) {
    release = undefined;
    await page.setViewportSize({ width, height: 780 });
    await openDetail(page, "transcription");
    const start = page.locator(".transcription-actions button").first(); await expect(start).toHaveAccessibleName("Spustit přepis"); await start.focus();
    const before = await geometry(page); await start.click(); await expect(start).toBeDisabled();
    await expect.poll(() => Boolean(release)).toBe(true); release!();
    await expect(page.getByRole("button", { name: "Zkontrolovat přepis" })).toBeVisible();
    await expect(page.locator(".transcription-feedback")).toContainText("Stav přepisu: běží.");
    expect(await geometry(page)).toEqual(before);
    await page.waitForLoadState("networkidle");
  }
});

test("blocked recovery uses one popup and preserves the real error on desktop and mobile", async ({ page }, info) => {
  await isolate(page);
  const recoveryError = "Stav přepisu se během obnovy změnil. Zkontrolujte aktuální stav a zkuste to znovu.";
  let recoveryCalls = 0;
  const recoveryBodies: unknown[] = [];
  let paidStarts = 0;
  await page.route("**/api/recordings/*/transcription**", async route => {
    if (route.request().url().endsWith("/recover")) {
      recoveryCalls++;
      recoveryBodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { error: recoveryError, code: "state_changed" } });
    }
    if (route.request().method() === "POST") {
      if (!route.request().url().endsWith("/reconcile")) paidStarts++;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { job: { status: "manual_required" }, operation: { operation_id: recordingId }, canRecover: true } });
  });
  for (const width of [320, 390, 1440]) for (const theme of ["light", "dark"]) {
    const initialRecoveryCalls = recoveryCalls;
    await page.setViewportSize({ width, height: 780 });
    await openDetail(page, "transcribing");
    await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
    const trigger = page.getByRole("button", { name: "Vyřešit přepis", exact: true });
    await expect(trigger).toBeVisible();
    // The identified operation is now resumed automatically once before explicit user recovery.
    await expect.poll(() => recoveryCalls).toBe(initialRecoveryCalls + 1);
    await expect(page.locator(".transcription-actions > button")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const before = await geometry(page);
    await compactAction(page, ".transcription-recovery-popover > summary");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Vyřešit přepis" });
    await expect(dialog).toBeVisible();
    expect(await geometry(page)).toEqual(before);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(15); expect(box!.x + box!.width).toBeLessThanOrEqual(width - 15);
    await compactAction(page, ".transcription-recovery-choice button");
    if (width === 320 || width === 1440) await page.screenshot({ path: info.outputPath(`recovery-${width}-${theme}.png`) });
    await page.getByRole("button", { name: "Dohledat původní přepis" }).click();
    await expect.poll(() => recoveryCalls).toBe(initialRecoveryCalls + 2);
    await expect(page.locator(".transcription-feedback [role='alert']")).toHaveText(recoveryError);
    await page.getByRole("button", { name: "Zkontrolovat stav" }).click();
    await expect(page.getByRole("button", { name: "Zkontrolovat stav" })).toBeEnabled();
    await expect(page.locator(".transcription-feedback [role='alert']")).toHaveText(recoveryError);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
    await expect(page.locator(".transcription-feedback [role='alert']")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  expect(recoveryCalls).toBe(12); expect(paidStarts).toBe(0);
  for (const body of recoveryBodies) expect(body).toMatchObject({ operationId: recordingId, action: "resume" });
});

test("audio empty, loading, success and error keep tabs and chat composer in place", async ({ page }, info) => {
  await isolate(page);
  const wav = Buffer.alloc(44 + 16_000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  let release!: () => void;
  let successful = true;
  let audioGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/recordings/*/audio", async (route) => {
    const succeed = successful;
    await audioGate;
    await route.fulfill(succeed ? { json: { expiresIn: 300, mimeType: "audio/wav", url: `${new URL(route.request().url()).origin}/inert.wav` } } : { status: 404, json: { error: "Inert audio error" } });
  });
  await page.route("**/inert.wav", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["dark", "light"]) {
      successful = true; audioGate = new Promise<void>((resolve) => { release = resolve; });
      await openDetail(page, "chat"); await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
      await expect(page.getByLabel("Dotaz k přepisu")).toBeEnabled();
      const status = page.locator(".recording-audio-player-status"); await expect(status).toHaveText("Načítám audio…");
      const before = await geometry(page); release();
      await expect(status).toBeEmpty(); expect(await geometry(page)).toEqual(before);
      successful = false; audioGate = new Promise<void>((resolve) => { release = resolve; });
      await page.locator("audio").evaluate((element) => element.dispatchEvent(new Event("error")));
      await expect(status).toHaveText("Načítám audio…"); expect(await geometry(page)).toEqual(before);
      release(); await expect(status).toHaveText("Audio se nepodařilo načíst."); expect(await geometry(page)).toEqual(before);
      await compactAction(page, ".recording-chat-composer button[type='submit']");
      if (width === 320 || width === 1440) await page.screenshot({ path: info.outputPath(`chat-audio-error-${width}-${theme}.png`) });
    }
  }
});

test("small semantic actions share geometry across new capture, settings, prompts and trash", async ({ page }, info) => {
  await isolate(page);
  for (const width of [320, 1440]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 850 });
    for (const [view, selector] of [["new", ".real-upload-actions button"], ["settings", ".settings-save-button"], ["trash", ".trash-bulk-toolbar button"], ["templates", ".prompt-editor-form button[type='submit']"]]) {
      const scope = randomBytes(6).toString("hex");
      await page.goto(view === "templates" ? `/login/prompts-ai-e2e?scope=${scope}&view=templates&template=00000000-0000-4000-8000-000000000951` : `/login/workspace-shell-e2e?scope=${scope}&view=${view}`);
      await page.locator("html").evaluate((element, value) => { element.dataset.theme = value; }, theme);
      await compactAction(page, selector);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath(`${view}-${width}-${theme}.png`) });
    }
  }
});
