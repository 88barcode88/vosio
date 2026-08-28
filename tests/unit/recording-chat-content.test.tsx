// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatContent } from "@/components/transcript-tabs/chat-content";

const transcriptId = "00000000-0000-4000-8000-000000000001";
const otherTranscriptId = "00000000-0000-4000-8000-000000000002";

let container: HTMLDivElement | null;
let root: Root | null;

// response returns the minimum browser fetch shape used by the chat component.
function response(payload: unknown, ok = true) {
  return {
    json: vi.fn().mockResolvedValue(payload),
    ok
  };
}

// renderChat mounts the standalone lazy tab content with one controlled transcript identity.
async function renderChat(id: string | null = transcriptId, onOpenEvidence = vi.fn()) {
  await act(async () => root?.render(createElement(ChatContent, {
    activeTranscriptId: id,
    defaultModel: "gpt-5.6-terra",
    onOpenEvidence
  })));
  return onOpenEvidence;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000003") });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("recording chat content", () => {
  it("shows a no-transcript state without loading history", async () => {
    await renderChat(null);

    expect(container?.textContent).toContain("Chat je dostupný po uložení přepisu.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads empty history and preselects the account model", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ thread: null, turns: [] }) as never);
    await renderChat();

    expect(fetch).toHaveBeenCalledWith(`/api/transcripts/${transcriptId}/chat`, expect.objectContaining({ method: "GET" }));
    expect(container?.textContent).toContain("Zeptejte se na tento přepis.");
    expect(container?.querySelector<HTMLSelectElement>("select")?.value).toBe("gpt-5.6-terra");
  });

  it("renders stored model, safe markdown and only API-provided evidence", async () => {
    const onOpenEvidence = vi.fn();
    vi.mocked(fetch).mockResolvedValue(response({
      thread: { id: "thread-1", transcriptId },
      turns: [{
        answerMarkdown: "## Výsledek\n- Bezpečný text <img src=x>",
        clientTurnId: "00000000-0000-4000-8000-000000000004",
        evidence: [{ endMs: 1_500, quote: "Ověřená citace", startMs: 1_000 }],
        id: "turn-1",
        model: "gpt-5.6-sol",
        provider: "openai",
        question: "Co bylo domluveno?",
        safeError: null,
        status: "completed",
        usage: { inputTokens: 1, outputTokens: 1 }
      }]
    }) as never);
    await renderChat(transcriptId, onOpenEvidence);

    expect(container?.textContent).toContain("GPT-5.6 Sol · XHigh");
    expect(container?.querySelector("img")).toBeNull();
    await act(async () => container?.querySelector<HTMLButtonElement>("[data-chat-evidence]")?.click());
    expect(onOpenEvidence).toHaveBeenCalledWith({
      endMs: 1_500,
      highlightText: "Ověřená citace",
      playback: "play",
      startMs: 1_000,
      transcriptId
    });
  });

  it("posts one stable client UUID and blocks a rapid duplicate submit", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockResolvedValueOnce(response({
        thread: { id: "thread-1", transcriptId },
        turn: {
          answerMarkdown: "Ano",
          clientTurnId: "00000000-0000-4000-8000-000000000003",
          evidence: [], id: "turn-1", model: "gpt-5.6-luna", provider: "openai",
          question: "Jaký je další krok?", safeError: null, status: "completed", usage: { inputTokens: null, outputTokens: null }
        }
      }) as never);
    await renderChat();
    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    const form = container?.querySelector<HTMLFormElement>("form");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Jaký je další krok?");
    await act(async () => textarea?.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(`/api/transcripts/${transcriptId}/chat`, expect.objectContaining({
      body: JSON.stringify({
        clientTurnId: "00000000-0000-4000-8000-000000000003",
        model: "gpt-5.6-terra",
        question: "Jaký je další krok?"
      }),
      method: "POST"
    }));
  });

  it("ignores a stale history response after switching transcript identity", async () => {
    let resolveOldHistory: (value: unknown) => void = () => undefined;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldHistory = resolve; }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never);
    await renderChat(transcriptId);
    await renderChat(otherTranscriptId);
    await act(async () => resolveOldHistory(response({
      thread: { id: "old", transcriptId }, turns: [{ question: "Starý chat" }]
    })));

    expect(container?.textContent).not.toContain("Starý chat");
    expect(fetch).toHaveBeenCalledWith(`/api/transcripts/${otherTranscriptId}/chat`, expect.anything());
  });

  it("keeps a server-running turn visible and locks the composer until reconciliation", async () => {
    vi.mocked(fetch).mockResolvedValue(response({
      thread: { id: "thread-1", transcriptId },
      turns: [{
        answerMarkdown: null, clientTurnId: "00000000-0000-4000-8000-000000000004", evidence: [],
        id: "turn-1", model: "gpt-5.6-terra", provider: "openai", question: "Čeká odpověď?",
        safeError: null, status: "running", usage: { inputTokens: null, outputTokens: null }
      }]
    }) as never);
    await renderChat();

    expect(container?.textContent).toContain("AI připravuje odpověď…");
    expect(container?.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  });

  it("polls a stored running turn to completion and unlocks the composer", async () => {
    vi.useFakeTimers();
    const runningTurn = {
      answerMarkdown: null, clientTurnId: "00000000-0000-4000-8000-000000000004", evidence: [],
      id: "turn-1", model: "gpt-5.6-terra", provider: "openai", question: "Čeká odpověď?",
      safeError: null, status: "running", usage: { inputTokens: null, outputTokens: null }
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [runningTurn] }) as never)
      .mockResolvedValueOnce(response({
        thread: { id: "thread-1", transcriptId },
        turns: [{ ...runningTurn, answerMarkdown: "Hotovo", status: "completed" }]
      }) as never);
    await renderChat();
    expect(container?.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container?.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
    expect(container?.textContent).toContain("Hotovo");
  });

  it("pauses a running-turn poll while hidden and refreshes immediately when visible", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const runningTurn = {
      answerMarkdown: null, clientTurnId: "00000000-0000-4000-8000-000000000004", evidence: [],
      id: "turn-1", model: "gpt-5.6-terra", provider: "openai", question: "Čeká odpověď?",
      safeError: null, status: "running", usage: { inputTokens: null, outputTokens: null }
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [runningTurn] }) as never)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [runningTurn] }) as never);
    await renderChat();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight poll when the transcript identity switches", async () => {
    vi.useFakeTimers();
    const runningTurn = {
      answerMarkdown: null, clientTurnId: "00000000-0000-4000-8000-000000000004", evidence: [],
      id: "turn-1", model: "gpt-5.6-terra", provider: "openai", question: "Čeká odpověď?",
      safeError: null, status: "running", usage: { inputTokens: null, outputTokens: null }
    };
    let pollSignal: AbortSignal | undefined;
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [runningTurn] }) as never)
      .mockImplementationOnce((_url, request) => {
        pollSignal = (request as RequestInit).signal as AbortSignal;
        return new Promise(() => undefined) as never;
      })
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never);
    await renderChat();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await renderChat(otherTranscriptId);

    expect(pollSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`/api/transcripts/${otherTranscriptId}/chat`, expect.anything());
  });

  it("reconciles an uncertain transport with the original UUID before another send", async () => {
    const firstId = "00000000-0000-4000-8000-000000000003";
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => firstId) });
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockResolvedValueOnce(response({
        thread: { id: "thread-1", transcriptId },
        turn: {
          answerMarkdown: "Potvrzeno", clientTurnId: firstId, evidence: [], id: "turn-1",
          model: "gpt-5.6-terra", provider: "openai", question: "Je to uloženo?",
          safeError: null, status: "completed", usage: { inputTokens: null, outputTokens: null }
        }
      }) as never);
    await renderChat();
    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    const form = container?.querySelector<HTMLFormElement>("form");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Je to uloženo?");
    await act(async () => textarea?.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container?.textContent).toContain("Spojení bylo přerušeno");

    await act(async () => container?.querySelector<HTMLButtonElement>(".recording-chat-reconcile")?.click());
    const modelPicker = container?.querySelector<HTMLSelectElement>("select");
    expect(textarea?.disabled).toBe(true);
    expect(modelPicker?.disabled).toBe(true);
    if (textarea) textarea.disabled = false;
    if (modelPicker) modelPicker.disabled = false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Jiný dotaz");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(modelPicker, "gpt-5.6-sol");
    await act(async () => {
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      modelPicker?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container?.querySelector<HTMLButtonElement>(".recording-chat-retry")?.click());

    const postBodies = vi.mocked(fetch).mock.calls
      .filter(([, request]) => (request as RequestInit | undefined)?.method === "POST")
      .map(([, request]) => JSON.parse((request as RequestInit).body as string));
    expect(postBodies).toEqual([
      { clientTurnId: firstId, model: "gpt-5.6-terra", question: "Je to uloženo?" },
      { clientTurnId: firstId, model: "gpt-5.6-terra", question: "Je to uloženo?" }
    ]);
  });
});
