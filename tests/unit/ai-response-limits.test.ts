import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAiResponse, AI_RESPONSE_MAX_BYTES } from "@/lib/ai/response.server";
import { runOpenAIChat, runOpenAIProcessing } from "@/lib/ai/openai";
import { runGeminiChat, runGeminiProcessing } from "@/lib/ai/gemini";
import { runMistralChat, runMistralProcessing } from "@/lib/ai/mistral";

vi.mock("@/lib/env.server", () => ({
  getOpenAIEnv: () => ({ openaiApiKey: "test" }),
  getGeminiEnv: () => ({ geminiApiKey: "test" }),
  getMistralEnv: () => ({ mistralApiKey: "test" })
}));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const processing = { model: "test", outputSchema: null, prompt: "test", temperature: 0.2 };
const chat = { model: "test", outputSchema: null, messages: [], systemInstruction: "test" };
const calls = [
  ["OpenAI processing", () => runOpenAIProcessing(processing)],
  ["OpenAI chat", () => runOpenAIChat(chat)],
  ["Gemini processing", () => runGeminiProcessing(processing)],
  ["Gemini chat", () => runGeminiChat(chat)],
  ["Mistral processing", () => runMistralProcessing(processing)],
  ["Mistral chat", () => runMistralChat(chat)]
] as const;

describe.each(calls)("%s response boundaries", (_name, run) => {
  it("cancels an oversized body without trusting Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Length": "1" } })));
    await expect(run()).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("aborts a provider that never returns headers", async () => {
    vi.useFakeTimers();
    let observed: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      observed = init.signal;
      init.signal?.addEventListener("abort", () => reject(new Error("secret transport detail")), { once: true });
    })));
    const result = run();
    const assertion = expect(result).rejects.not.toThrow("secret transport detail");
    await vi.advanceTimersByTimeAsync(240_000);
    expect(observed?.aborted).toBe(true);
    await assertion;
  });

  it("keeps the deadline active while waiting for the body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const assertion = expect(run()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(240_000);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
});

it("honors an earlier processing cancellation", async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
  const assertion = expect(runOpenAIProcessing({ ...processing, signal: controller.signal })).rejects.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
});

// responseChunks simulates decoded HTTP body chunks without requiring a provider or network.
function responseChunks(chunks: Uint8Array[], cancel = () => {}) {
  return new Response(new ReadableStream({
    start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); },
    cancel
  }));
}

it("counts cumulative bytes across chunks, including multibyte text", async () => {
  const cancel = vi.fn();
  const first = new TextEncoder().encode("ě".repeat(AI_RESPONSE_MAX_BYTES / 2));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseChunks([first, new Uint8Array([32])], cancel)));
  await expect(fetchAiResponse("https://example.invalid", {})).rejects.toThrow("allowed size");
  expect(cancel).toHaveBeenCalledOnce();
});

it("accepts exactly the limit and preserves HTTP errors for safe classification", async () => {
  vi.useFakeTimers();
  const json = JSON.stringify({ error: "x".repeat(AI_RESPONSE_MAX_BYTES - 12) });
  expect(Buffer.byteLength(json)).toBe(AI_RESPONSE_MAX_BYTES);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(json, { status: 429, headers: { "Retry-After": "3" } })));
  const result = await fetchAiResponse("https://example.invalid", {});
  expect(result.status).toBe(429);
  expect(result.headers.get("Retry-After")).toBe("3");
  expect((await result.json()).error.length).toBe(AI_RESPONSE_MAX_BYTES - 12);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not send a request when its caller has already cancelled", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchAiResponse("https://example.invalid", { signal: AbortSignal.abort() })).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
