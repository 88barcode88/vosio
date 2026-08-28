import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const transcriptId = "00000000-0000-4000-8000-000000000301";

// createFixtureScope supplies the guarded local-only recording detail token.
function createFixtureScope() {
  return randomBytes(6).toString("hex");
}

test("chat persists the selected model and opens its verified evidence through the shared transcript path", async ({ page }) => {
  let turns: unknown[] = [];
  let postedBody: unknown = null;
  await page.addInitScript(() => {
    const fixtureWindow = window as typeof window & { __chatSeekSeconds?: number; __chatPlayCalls?: number };
    fixtureWindow.__chatSeekSeconds = 0;
    fixtureWindow.__chatPlayCalls = 0;
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
  await expect(page.getByRole("combobox")).toHaveValue("gpt-5.6-terra");
  await page.getByRole("combobox").selectOption("gpt-5.6-sol");
  await page.getByLabel("Dotaz k přepisu").fill("Jaký je další krok?");
  await page.getByRole("button", { name: "Odeslat" }).click();
  await expect(page.getByText("E2E CHAT SENTINEL")).toBeVisible();
  expect(postedBody).toMatchObject({ model: "gpt-5.6-sol", question: "Jaký je další krok?" });

  await page.reload();
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("E2E CHAT SENTINEL")).toBeVisible();
  await expect(page.getByText("GPT-5.6 Sol · XHigh")).toBeVisible();
  await page.getByRole("button", { name: /Otevřít ověřený důkaz v 00:08/u }).click();
  await expect(page.getByRole("tab", { name: "Přepis" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __chatSeekSeconds?: number }
  ).__chatSeekSeconds ?? 0)).toBe(8);
});
