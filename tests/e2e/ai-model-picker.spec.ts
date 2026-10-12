import { randomBytes } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ trace: "on" });

// fixturePath restricts picker proof to existing inert development surfaces.
function fixturePath(path: string, query: Record<string, string> = {}) {
  return `/login/${path}?${new URLSearchParams({ scope: randomBytes(6).toString("hex"), ...query })}`;
}

// assertPickerGeometry checks the actual controls and containment in the chosen Appica surface.
async function assertPickerGeometry(page: Page, picker: Locator) {
  await expect(picker).toBeVisible();
  const result = await picker.evaluate((element) => ({
    shortControls: Array.from(element.querySelectorAll<HTMLElement>("select, input[type=range], button"))
      .filter((control) => control.getBoundingClientRect().height < 43.5).map((control) => control.tagName),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    focusableRange: element.querySelector<HTMLInputElement>('input[type="range"]')?.tabIndex
  }));
  expect(result.shortControls).toEqual([]);
  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.focusableRange).toBeGreaterThanOrEqual(0);
  const ids = await picker.locator("select option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(ids.filter((id) => id.startsWith("gpt-"))).toEqual(["gpt-6.1-sol", "gpt-6-astra"]);
  expect(ids).toContain("gemini-3.8-flash");
  expect(ids).toContain("mistral-small-2603");
  await expect(page.locator('input[name="aiTemperature"][type="range"]')).toHaveCount(0);
}

// chooseEffort uses native keyboard semantics rather than assigning a range value behind React.
async function chooseEffort(slider: Locator, effort: "low" | "medium" | "xhigh" | "max") {
  await slider.focus();
  await slider.press(effort === "low" || effort === "medium" ? "Home" : "End");
  if (effort === "medium") await slider.press("ArrowRight");
  if (effort === "xhigh") await slider.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuetext", new RegExp(`\\(${effort}\\)`));
}

for (const theme of ["light", "dark"] as const) {
  test(`variant A ${theme} sends the chosen manual effort and preserves the Settings preference`, async ({ page, context, baseURL }, testInfo) => {
    if (testInfo.project.name === "mobile-chrome") await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "vosio-theme", value: theme, url: baseURL! }]);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/transcripts/*/automatic-timeline", (route) => route.fulfill({ json: { status: "not_scheduled" } }));
    await page.route("**/api/transcripts/*/ai-state", (route) => route.fulfill({ json: { jobs: [], outputs: [] } }));
    await page.route("**/api/transcripts/*/process", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ json: { job: { id: `00000000-0000-4000-8000-${String(bodies.length).padStart(12, "0")}`, status: "queued" } }, status: 202 });
    });
    await page.goto(fixturePath("manual-ai-refresh-e2e"));
    await page.locator(".ai-settings-details > summary").click();
    const picker = page.locator(".ai-model-picker");
    await assertPickerGeometry(page, picker);
    await picker.screenshot({ path: testInfo.outputPath(`manual-A-${theme}.png`) });
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`manual-surface-A-${theme}.png`) });
    const model = picker.getByRole("combobox");
    const slider = picker.getByRole("slider");
    for (const effort of ["medium", "xhigh", "max", "low"] as const) {
      await model.selectOption(effort === "low" ? "gpt-6-astra" : "gpt-6.1-sol");
      await chooseEffort(slider, effort);
      const before = bodies.length;
      await page.locator(".quick-grid").getByRole("button", { name: /^Shrnutí/ }).click();
      await expect.poll(() => bodies.length).toBe(before + 1);
      expect(bodies.at(-1)).toMatchObject({ model: effort === "low" ? "gpt-6-astra" : "gpt-6.1-sol", reasoningEffort: effort, processingType: "summary" });
    }
    await model.selectOption("gemini-3.8-flash");
    await expect(picker.getByRole("slider")).toHaveCount(0);
    await expect(picker).toContainText("U tohoto modelu nelze uvažování nastavit.");
    await page.locator(".quick-grid").getByRole("button", { name: /^Shrnutí/ }).click();
    await expect.poll(() => bodies.length).toBe(5);
    expect(bodies.at(-1)).toMatchObject({ model: "gemini-3.8-flash" });
    expect(bodies.at(-1)).not.toHaveProperty("reasoningEffort");

    await page.goto(fixturePath("soniox-installation-e2e", { installation: "ready", surface: "settings", save: "error" }));
    const settingsPicker = page.locator(".ai-model-picker");
    await assertPickerGeometry(page, settingsPicker);
    await settingsPicker.screenshot({ path: testInfo.outputPath(`settings-A-${theme}.png`) });
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`settings-surface-A-${theme}.png`) });
    await settingsPicker.getByRole("combobox").selectOption("gpt-6-astra");
    await chooseEffort(settingsPicker.getByRole("slider"), "xhigh");
    await settingsPicker.getByRole("combobox").selectOption("mistral-small-2603");
    await expect(settingsPicker.getByRole("slider")).toHaveCount(0);
    const formData = await settingsPicker.evaluate((element) => {
      const data = new FormData(element.closest("form")!);
      return { model: data.get("defaultOpenaiModel"), effort: data.get("defaultReasoningEffort") };
    });
    expect(formData).toEqual({ model: "mistral-small-2603", effort: "xhigh" });
    await settingsPicker.getByRole("combobox").selectOption("gpt-6.1-sol");
    await expect(settingsPicker.getByRole("slider")).toHaveAttribute("aria-valuetext", /\(xhigh\)/);
    await page.getByRole("button", { name: "Uložit nastavení" }).click();
    await expect(page.locator("fieldset[data-settings-fields]")).toHaveAttribute("disabled", "");
    await expect(page.locator(".settings-alert-error")).toBeVisible();
    await expect(settingsPicker.getByRole("slider")).toHaveAttribute("aria-valuetext", /\(xhigh\)/);
  });

  test(`variant A ${theme} captures the next chat model and effort with keyboard or touch`, async ({ page, context, baseURL }, testInfo) => {
    if (testInfo.project.name === "mobile-chrome") await page.setViewportSize({ width: 375, height: 800 });
    await context.addCookies([{ name: "vosio-theme", value: theme, url: baseURL! }]);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/transcripts/*/automatic-timeline", (route) => route.fulfill({ json: { status: "not_scheduled" } }));
    await page.route("**/api/transcripts/*/ai-state", (route) => route.fulfill({ json: { jobs: [], outputs: [] } }));
    await page.route("**/api/recordings/*/audio", (route) => route.fulfill({ json: { error: "fixture_audio_unavailable" }, status: 404 }));
    await page.route("**/api/transcripts/*/chat", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { thread: null, turns: [] } });
      const body = route.request().postDataJSON() as Record<string, unknown>;
      bodies.push(body);
      return route.fulfill({ json: { thread: { id: "thread" }, turn: {
        id: `turn-${bodies.length}`, clientTurnId: body.clientTurnId, model: body.model, provider: body.model === "gemini-3.8-flash" ? "gemini" : "openai",
        question: body.question, status: "completed", answerMarkdown: "Synthetic picker answer", evidence: [], safeError: null, usage: null
      } } });
    });
    await page.goto(fixturePath("recording-layout-e2e", { mode: "chat" }));
    const picker = page.locator(".recording-chat-content .ai-model-picker");
    await expect(picker.getByRole("combobox")).toBeEnabled();
    await assertPickerGeometry(page, picker);
    await picker.screenshot({ path: testInfo.outputPath(`chat-A-${theme}.png`) });
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`chat-surface-A-${theme}.png`) });
    await picker.getByRole("combobox").selectOption("gpt-6.1-sol");
    if (testInfo.project.name === "mobile-chrome") {
      const slider = picker.getByRole("slider");
      const box = (await slider.boundingBox())!;
      await slider.tap({ position: { x: box.width - 8, y: box.height / 2 } });
      await expect(slider).toHaveAttribute("aria-valuetext", /\(max\)/);
    } else {
      await chooseEffort(picker.getByRole("slider"), "max");
    }
    await page.getByLabel("Dotaz k přepisu").fill("Co je další krok?");
    await page.getByRole("button", { name: "Odeslat", exact: true }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ model: "gpt-6.1-sol", reasoningEffort: "max", question: "Co je další krok?" });
    await expect(picker.getByRole("combobox")).toBeEnabled();
    await picker.getByRole("combobox").selectOption("gemini-3.8-flash");
    await expect(picker.getByRole("slider")).toHaveCount(0);
    await page.getByLabel("Dotaz k přepisu").fill("Jaké jsou termíny?");
    await page.getByRole("button", { name: "Odeslat", exact: true }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toMatchObject({ model: "gemini-3.8-flash" });
    expect(bodies[1]).not.toHaveProperty("reasoningEffort");
  });
}
