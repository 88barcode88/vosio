import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const transcriptId = "00000000-0000-4000-8000-000000000301";

// createFixtureScope supplies the guarded local-only recording detail token.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

test("chat keeps its composer stable while history loads and the answer moves from POST to running", async ({ page }) => {
  let finishHistory!: () => void;
  let finishPost!: () => void;
  const historyGate = new Promise<void>((resolve) => { finishHistory = resolve; });
  const postGate = new Promise<void>((resolve) => { finishPost = resolve; });
  let firstHistory = true;
  let polls = 0;
  let turn: Record<string, unknown> | null = null;
  // This layout fixture has no real provider, audio, session or application API calls.
  await page.route("**/*", async (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.fallback() : route.abort());
  await page.route("**/api/**", async (route) => route.fulfill({ status: 404, json: { error: "Inert fixture" } }));
  await page.route("**/api/transcripts/*/chat", async (route) => {
    if (route.request().method() === "GET") {
      if (firstHistory) { firstHistory = false; await historyGate; }
      else if (turn) { polls += 1; turn = { ...turn, status: "completed", answerMarkdown: "Krátká dokončená odpověď." }; }
      await route.fulfill({ json: { thread: turn ? { id: "thread-1", transcriptId } : null, turns: turn ? [turn] : [] } });
      return;
    }
    const request = route.request().postDataJSON() as { clientTurnId: string; model: string; question: string };
    await postGate;
    turn = { answerMarkdown: null, clientTurnId: request.clientTurnId, evidence: [], id: "turn-1",
      model: request.model, provider: "openai", question: request.question, safeError: null,
      status: "running", usage: { inputTokens: null, outputTokens: null } };
    await route.fulfill({ json: { thread: { id: "thread-1", transcriptId }, turn } });
  });
  await page.goto(`/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=chat`);
  const composer = page.getByLabel("Dotaz k přepisu");
  const region = page.locator(".recording-chat-history");
  await expect(region).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => document.fonts.ready);
  // The independent player fixture must finish its stubbed load before isolating chat geometry.
  await expect(page.locator(".recording-audio-player-status")).toHaveText("Audio se nepodařilo načíst.");
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  // Measure actual compiled CSS rather than asserting the presence of a min-height rule.
  const measureLayout = () => page.evaluate(() => {
    const chat = document.querySelector(".recording-chat-content")!;
    const region = document.querySelector(".recording-chat-history")!;
    const status = document.querySelector(".recording-chat-status")!;
    const composer = document.querySelector(".recording-chat-composer")!;
    const question = document.querySelector("#recording-chat-question")!;
    const player = document.querySelector(".recording-audio-player")!;
    const tabbar = document.querySelector(".tabs-row")!;
    return { chatY: chat.getBoundingClientRect().y, regionHeight: region.getBoundingClientRect().height,
      statusHeight: status.getBoundingClientRect().height, composerY: composer.getBoundingClientRect().y,
      questionY: question.getBoundingClientRect().y, fontStatus: document.fonts.status, scrollY: window.scrollY,
      playerY: player.getBoundingClientRect().y, playerHeight: player.getBoundingClientRect().height,
      tabbarY: tabbar.getBoundingClientRect().y, tabbarHeight: tabbar.getBoundingClientRect().height };
  });
  const loadingLayout = await measureLayout();
  const loadingY = loadingLayout.questionY;
  finishHistory();
  await expect(composer).toBeEnabled();
  await expect(page.getByText("Zeptejte se na tento přepis.")).toBeVisible();
  const emptyLayout = await measureLayout();
  await test.info().attach("chat-loading-empty-geometry", {
    body: JSON.stringify({ loading: loadingLayout, empty: emptyLayout }), contentType: "application/json"
  });
  expect(emptyLayout.regionHeight).toBe(loadingLayout.regionHeight);
  expect(emptyLayout.playerHeight).toBe(loadingLayout.playerHeight);
  expect(Math.abs(emptyLayout.questionY - loadingY)).toBeLessThanOrEqual(1);
  await composer.fill("Krátká otázka?");
  await page.getByRole("button", { name: "Odeslat" }).click();
  await expect(page.locator(".recording-chat-answering-dot")).toHaveCount(3);
  await expect(page.locator(".recording-chat-turn-pending .recording-chat-question")).toContainText("Krátká otázka?");
  await expect(composer).toHaveValue("Krátká otázka?");
  await expect(composer).toBeDisabled();
  const pendingY = (await composer.boundingBox())!.y;
  finishPost();
  await expect(page.locator(".recording-chat-turn-running")).toBeVisible();
  await expect(page.locator(".recording-chat-answering-dot")).toHaveCount(3);
  expect(Math.abs((await composer.boundingBox())!.y - pendingY)).toBeLessThanOrEqual(1);
  await expect(page.getByText("Krátká dokončená odpověď.")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".recording-chat-answering-dot")).toHaveCount(0);
  await expect(composer).toBeEnabled();
  expect(polls).toBe(1);
});

test("chat persists the selected model and opens its verified evidence through the shared transcript path", async ({ page }) => {
  let turns: unknown[] = [];
  let postedBody: unknown = null;
  await page.route("**/*", async (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.fallback() : route.abort());
  await page.route("**/api/**", async (route) => route.fulfill({ status: 404, json: { error: "Inert fixture" } }));
  await page.addInitScript(() => {
    const fixtureWindow = window as typeof window & { __chatSeekSeconds?: number; __chatPlayCalls?: number };
    fixtureWindow.__chatSeekSeconds = 0;
    fixtureWindow.__chatPlayCalls = 0;
    Object.defineProperty(HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 60 });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => fixtureWindow.__chatSeekSeconds ?? 0,
      set: (value: number) => { fixtureWindow.__chatSeekSeconds = value; }
    });
    HTMLMediaElement.prototype.play = async function play() {
      fixtureWindow.__chatPlayCalls = (fixtureWindow.__chatPlayCalls ?? 0) + 1;
    };
  });
  await page.route("**/api/recordings/*/audio", async (route) => route.fulfill({
    contentType: "application/json",
    json: { expiresIn: 300, mimeType: "audio/wav", url: "https://media.vosio.test/chat.wav" }
  }));
  await page.route("https://media.vosio.test/chat.wav", async (route) => route.fulfill({
    body: Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", "base64"),
    contentType: "audio/wav"
  }));
  await page.route("**/api/transcripts/*/chat", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { thread: turns.length ? { id: "thread-1", transcriptId } : null, turns } });
      return;
    }

    postedBody = route.request().postDataJSON();
    const request = postedBody as { clientTurnId: string; model: string; question: string };
    const turn = {
      answerMarkdown: "## E2E CHAT SENTINEL\nOvěřený další krok.",
      clientTurnId: request.clientTurnId,
      evidence: [{ endMs: 8_900, quote: "Testovací věta 1.", startMs: 8_000 }],
      id: "turn-1",
      model: request.model,
      provider: "openai",
      question: request.question,
      safeError: null,
      status: "completed",
      usage: { inputTokens: 1, outputTokens: 1 }
    };
    turns = [turn];
    await route.fulfill({ json: { thread: { id: "thread-1", transcriptId }, turn } });
  });

  await page.goto(`/login/recording-layout-e2e?scope=${createFixtureScope()}&mode=chat`);
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  const modelPicker = page.locator(".recording-chat-content").getByRole("combobox");
  await expect(modelPicker).toHaveValue("gpt-6.1-sol");
  await modelPicker.selectOption("gpt-6-astra");
  await page.locator(".recording-chat-content").getByRole("slider").focus();
  await page.locator(".recording-chat-content").getByRole("slider").press("Home");
  await page.getByLabel("Dotaz k přepisu").fill("Jaký je další krok?");
  await page.getByRole("button", { name: "Odeslat" }).click();
  await expect(page.getByText("E2E CHAT SENTINEL")).toBeVisible();
  expect(postedBody).toMatchObject({ model: "gpt-6-astra", question: "Jaký je další krok?", reasoningEffort: "low" });

  await page.reload();
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("E2E CHAT SENTINEL")).toBeVisible();
  await expect(page.locator(".recording-chat-answer header small")).toHaveText("GPT-6 Astra");
  await expect(page.locator(".recording-audio-element")).toHaveAttribute("src", /chat\.wav/u);
  await page.getByRole("button", { name: /Otevřít ověřený důkaz v 00:08/u }).click();
  await expect(page.getByRole("tab", { name: "Přepis" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __chatSeekSeconds?: number }
  ).__chatSeekSeconds ?? 0)).toBe(8);
});
