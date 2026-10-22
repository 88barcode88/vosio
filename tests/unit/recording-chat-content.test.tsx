// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatContent } from "@/components/transcript-tabs/chat-content";
import { RecordingCapabilityProvider } from "@/components/recording-capability-context";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";
import type { AiReasoningEffort } from "@/lib/model-options";

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
async function renderChat(id: string | null = transcriptId, onOpenEvidence = vi.fn(), defaultModel = "gpt-5.6-terra", defaultReasoningEffort?: AiReasoningEffort, isActive = true) {
  await act(async () => root?.render(<RecordingCapabilityProvider
    capabilities={{ ...NO_RECORDING_CAPABILITIES, read: true, usePrivateChat: true, runPersonalAi: true }} canReadPrivateChat>
    <ChatContent isActive={isActive} activeTranscriptId={id} defaultModel={defaultModel} defaultReasoningEffort={defaultReasoningEffort} onOpenEvidence={onOpenEvidence} />
  </RecordingCapabilityProvider>));
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
  // Use a completed historical row distinct from the new immutable client UUID.
  const oldTurn = { answerMarkdown: "Původní odpověď", clientTurnId: "00000000-0000-4000-8000-000000000004",
    evidence: [], id: "turn-old", model: "gpt-6.1-sol", provider: "openai", question: "Původní otázka",
    safeError: null, status: "completed", usage: { inputTokens: null, outputTokens: null } };

  // Edit the controlled input through real DOM events before using its ordinary submit path.
  async function writeQuestion(question = "Nová otázka") {
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, question);
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    return textarea;
  }
  it("keeps the model, reasoning and draft when model controls collapse", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ thread: null, turns: [] }) as never);
    await renderChat();
    const textarea = await writeQuestion("Rozepsaná otázka");
    const details = container!.querySelector<HTMLDetailsElement>(".recording-chat-model-settings")!;
    details.open = true;
    const select = details.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = "gpt-6-astra"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const max = details.querySelector<HTMLButtonElement>('button[aria-label="Maximum (max)"]')!;
    await act(async () => max.click());
    await act(async () => select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector("summary"));
    expect(details.querySelector("summary")?.textContent).toContain("GPT-6 Astra · max");
    expect(new FormData(container!.querySelector("form")!).get("reasoningEffort")).toBe("max");
    expect(textarea.value).toBe("Rozepsaná otázka");
    expect(details.textContent).toContain("zvýšit cenu");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("pauses server turn polling on an inactive surface and resumes without reloading history or losing model choice", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.mocked(fetch).mockImplementation(async () => response({ thread: null, turns: [{ ...oldTurn, status: "running" }] }) as never);
    await renderChat();
    const select = container!.querySelector<HTMLSelectElement>("select")!;
    const textarea = container!.querySelector("textarea");
    await renderChat(transcriptId, vi.fn(), "gpt-5.6-terra", undefined, false);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container!.querySelector("select")).toBe(select);
    expect(container!.querySelector("textarea")).toBe(textarea);
    await renderChat();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.every(([, request]) => request?.method === "GET")).toBe(true);
  });

  it("preserves history and draft without a GET when account defaults change on the same transcript", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ thread: { id: "thread-1", transcriptId }, turns: [oldTurn] }) as never);
    await renderChat();
    const textarea = await writeQuestion();
    const historyList = container!.querySelector(".recording-chat-turns");
    await renderChat(transcriptId, vi.fn(), "gpt-6-astra", "high");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain("Původní odpověď");
    expect(container!.querySelector(".recording-chat-turns")).toBe(historyList);
    expect(container!.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("Nová otázka");
    expect(textarea.disabled).toBe(false);
  });
  it("shows the optimistic question and three answering dots throughout a held POST without replacing history or composer", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [oldTurn] }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    await renderChat();
    const textarea = await writeQuestion();
    const historyList = container!.querySelector(".recording-chat-turns");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(container!.querySelector(".recording-chat-turn-pending .recording-chat-question")?.textContent).toContain("Nová otázka");
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    expect(container!.textContent).toContain("Původní odpověď");
    expect(container!.querySelector(".recording-chat-turns")).toBe(historyList);
    expect(container!.querySelector("textarea")).toBe(textarea);
    expect(container!.querySelector(".recording-chat-retry")).toBeNull();
    await renderChat(transcriptId, vi.fn(), "gpt-6-astra", "high");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(textarea.value).toBe("Nová otázka");
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    await act(async () => finish(response({ thread: { id: "thread-1", transcriptId }, turn: {
      ...oldTurn, id: "turn-new", clientTurnId: "00000000-0000-4000-8000-000000000003", question: "Nová otázka", answerMarkdown: "Nová odpověď"
    } })));
    expect(container!.querySelector(".recording-chat-turn-pending")).toBeNull();
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(0);
    expect(container!.querySelectorAll(".recording-chat-question")).toHaveLength(2);
    expect(textarea.value).toBe("");
  });
  it("keeps the same history region while initial loading becomes the empty chat", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    await renderChat();
    const region = container!.querySelector(".recording-chat-history");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-busy")).toBe("true");
    await act(async () => finish(response({ thread: null, turns: [] })));
    expect(container!.querySelector(".recording-chat-history")).toBe(region);
    expect(region?.getAttribute("aria-busy")).toBe("false");
    expect(region?.textContent).toContain("Zeptejte se na tento přepis");
  });
  it("keeps dots and history through queued and running polling, then removes them on a terminal safe failure", async () => {
    vi.useFakeTimers();
    const pendingTurn = { ...oldTurn, id: "turn-new", clientTurnId: "00000000-0000-4000-8000-000000000003",
      question: "Nová otázka", answerMarkdown: null, status: "queued" };
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [oldTurn] }) as never)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turn: pendingTurn }) as never)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [oldTurn, { ...pendingTurn, status: "running" }] }) as never)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [oldTurn, { ...pendingTurn, status: "failed", safeError: "Odpověď se nepodařilo dokončit." }] }) as never);
    await renderChat();
    const textarea = await writeQuestion();
    const region = container!.querySelector(".recording-chat-history");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    expect(container!.textContent).not.toContain("Odpověď je uložená");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    expect(container!.textContent).toContain("Původní odpověď");
    expect(container!.querySelector(".recording-chat-history")).toBe(region);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(0);
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe("Odpověď se nepodařilo dokončit.");
    expect(container!.querySelector("textarea")).toBe(textarea);
    expect(textarea.disabled).toBe(false);
  });
  it("retains the optimistic question on uncertain transport, then resumes dots for the reconciled original UUID", async () => {
    const clientTurnId = "00000000-0000-4000-8000-000000000003";
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [oldTurn] }) as never)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turns: [oldTurn,
        { ...oldTurn, id: "turn-new", clientTurnId, question: "Nová otázka", answerMarkdown: null, status: "running" }] }) as never);
    await renderChat();
    await writeQuestion();
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(container!.querySelector(".recording-chat-turn-pending")?.textContent).toContain("Nová otázka");
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(0);
    expect(container!.textContent).toContain("Spojení bylo přerušeno");
    await renderChat(transcriptId, vi.fn(), "gpt-6-astra", "high");
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => container!.querySelector<HTMLButtonElement>(".recording-chat-reconcile")!.click());
    expect(container!.querySelector(".recording-chat-turn-pending")).toBeNull();
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    expect(container!.textContent).not.toContain("Odpověď je uložená");
    expect(vi.mocked(fetch).mock.calls.filter(([, request]) => request?.method === "POST")).toHaveLength(1);
    expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
  });
  it("ignores a held POST receipt after switching transcripts and never carries its optimistic question", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never);
    await renderChat();
    await writeQuestion();
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    await renderChat(otherTranscriptId);
    expect(container!.textContent).not.toContain("Nová otázka");
    await act(async () => finish(response({ thread: { id: "thread-1", transcriptId }, turn: {
      ...oldTurn, clientTurnId: "00000000-0000-4000-8000-000000000003", answerMarkdown: "Starý POST výsledek"
    } })));
    expect(container!.textContent).not.toContain("Starý POST výsledek");
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(0);
    expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
  });
  it("requires reconciliation when an error response cannot be checked, without retrying a new UUID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockResolvedValueOnce(response({ error: "Chat nedokončil odpověď." }, false) as never)
      .mockRejectedValueOnce(new Error("Stav odeslání se nepodařilo ověřit."));
    await renderChat();
    await writeQuestion();
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(container!.textContent).toContain("Stav odeslání se nepodařilo ověřit.");
    expect(container!.querySelector(".recording-chat-retry")).toBeNull();
    expect(container!.querySelector(".recording-chat-reconcile")?.textContent).toContain("Ověřit poslední odeslání");
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(0);
    expect(container!.querySelector(".recording-chat-turn-pending")?.textContent).toContain("Nová otázka");
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });
  it("keeps a newer held POST busy when the previous transcript's POST finally settles", async () => {
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    const firstId = "00000000-0000-4000-8000-000000000003";
    const secondId = "00000000-0000-4000-8000-000000000005";
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId) });
    vi.mocked(fetch).mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }) as never);
    await renderChat();
    await writeQuestion("První přepis");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await renderChat(otherTranscriptId);
    const textarea = await writeQuestion("Druhý přepis");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await act(async () => finishOld(response({ thread: { id: "thread-old", transcriptId }, turn: {
      ...oldTurn, clientTurnId: firstId, answerMarkdown: "Stará odpověď"
    } })));
    expect(container!.textContent).not.toContain("Stará odpověď");
    expect(textarea.disabled).toBe(true);
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    await act(async () => {
      container!.querySelector<HTMLFormElement>("form")!.requestSubmit();
      container!.querySelector<HTMLFormElement>("form")!.requestSubmit();
    });
    expect(vi.mocked(fetch).mock.calls.filter(([, request]) => request?.method === "POST")).toHaveLength(2);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(2);
    await act(async () => finishNew(response({ thread: { id: "thread-new", transcriptId: otherTranscriptId }, turn: {
      ...oldTurn, clientTurnId: secondId, question: "Druhý přepis", answerMarkdown: "Nová odpověď"
    } })));
    expect(container!.textContent).toContain("Nová odpověď");
    expect(textarea.disabled).toBe(false);
  });
  it("rejects an old POST receipt after returning to the same transcript with a new pending UUID", async () => {
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    const firstId = "00000000-0000-4000-8000-000000000003";
    const secondId = "00000000-0000-4000-8000-000000000005";
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId) });
    vi.mocked(fetch).mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }) as never);
    await renderChat();
    await writeQuestion("Starý dotaz");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await renderChat(otherTranscriptId);
    await renderChat(transcriptId);
    const textarea = await writeQuestion("Nový dotaz po návratu");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await act(async () => finishOld(response({ thread: { id: "thread-1", transcriptId }, turn: {
      ...oldTurn, clientTurnId: firstId, answerMarkdown: "Stará pozdní odpověď"
    } })));
    expect(container!.textContent).not.toContain("Stará pozdní odpověď");
    expect(textarea.value).toBe("Nový dotaz po návratu");
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    await act(async () => finishNew(response({ thread: { id: "thread-1", transcriptId }, turn: {
      ...oldTurn, clientTurnId: secondId, question: "Nový dotaz po návratu", answerMarkdown: "Nová potvrzená odpověď"
    } })));
    expect(container!.textContent).toContain("Nová potvrzená odpověď");
    expect(textarea.disabled).toBe(false);
  });
  it("rejects old reconciliation after returning to the same transcript with a new held POST", async () => {
    let finishCheck!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    const firstId = "00000000-0000-4000-8000-000000000003";
    const secondId = "00000000-0000-4000-8000-000000000005";
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId) });
    vi.mocked(fetch).mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise((resolve) => { finishCheck = resolve; }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }) as never);
    await renderChat();
    await writeQuestion("Nejistý starý dotaz");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await act(async () => container!.querySelector<HTMLButtonElement>(".recording-chat-reconcile")!.click());
    await renderChat(otherTranscriptId);
    await renderChat(transcriptId);
    const textarea = await writeQuestion("Nový dotaz");
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await act(async () => finishCheck(response({ thread: { id: "thread-1", transcriptId }, turns: [
      { ...oldTurn, clientTurnId: firstId, answerMarkdown: "Staré ověření" }
    ] })));
    expect(container!.textContent).not.toContain("Staré ověření");
    expect(textarea.value).toBe("Nový dotaz");
    expect(container!.querySelectorAll(".recording-chat-answering-dot")).toHaveLength(3);
    expect(textarea.disabled).toBe(true);
    await act(async () => finishNew(response({ thread: { id: "thread-1", transcriptId }, turn: {
      ...oldTurn, clientTurnId: secondId, question: "Nový dotaz", answerMarkdown: "Nová odpověď"
    } })));
    expect(container!.textContent).toContain("Nová odpověď");
    expect(textarea.disabled).toBe(false);
  });
  it("shows unknown history until success and retries an initial error without sending a question", async () => {
    let resolveHistory!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveHistory = resolve; }) as never)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never);
    await renderChat();
    const composer = container?.querySelector("textarea");
    expect(container?.textContent).toContain("Načítám historii");
    expect(container?.textContent).not.toContain("Zeptejte se na tento přepis");
    await act(async () => resolveHistory(response({ error: "Historie není dostupná." }, false)));
    expect(container?.textContent).toContain("Historie není dostupná.");
    expect(container?.textContent).not.toContain("Zeptejte se na tento přepis");
    const retry = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Zkusit znovu");
    await act(async () => retry!.click());
    expect(container?.querySelector("textarea")).toBe(composer);
    expect(container?.textContent).toContain("Zeptejte se na tento přepis");
    expect(vi.mocked(fetch).mock.calls.every(([, request]) => (request as RequestInit).method === "GET")).toBe(true);
  });
  it("sends with Enter once, but preserves Shift+Enter and composition", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockImplementationOnce(() => new Promise(() => undefined));
    await renderChat();
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Dotaz\ns dalším řádkem");
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    for (const modifiers of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...modifiers });
      await act(async () => textarea.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    const heldEnter = new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true });
    await act(async () => textarea.dispatchEvent(heldEnter));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      method: "POST", body: expect.stringContaining("Dotaz\\ns dalším řádkem")
    }));
    expect(textarea.disabled).toBe(true);
  });

  it("does not send an empty draft with Enter", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ thread: null, turns: [] }) as never);
    await renderChat();
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the server-rendered composer disabled until React owns its controls", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(createElement(ChatContent, {
      activeTranscriptId: transcriptId,
      defaultModel: "gpt-5.6-terra",
      onOpenEvidence: vi.fn()
    }));

    expect(host.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
  });

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
    expect(container?.querySelector<HTMLSelectElement>("select")?.value).toBe("gpt-6.1-sol");
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
        model: "gpt-6.1-sol",
        question: "Jaký je další krok?",
        reasoningEffort: "medium"
      }),
      method: "POST"
    }));
  });

  it("submits the model selected immediately before the form submit", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockResolvedValueOnce(response({
        thread: { id: "thread-1", transcriptId },
        turn: {
          answerMarkdown: "Ano",
          clientTurnId: "00000000-0000-4000-8000-000000000003",
          evidence: [], id: "turn-1", model: "gpt-6-astra", provider: "openai",
          question: "Jaký je další krok?", safeError: null, status: "completed", usage: { inputTokens: null, outputTokens: null }
        }
      }) as never);
    await renderChat();
    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    const modelPicker = container?.querySelector<HTMLSelectElement>("select");
    const form = container?.querySelector<HTMLFormElement>("form");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Jaký je další krok?");
    await act(async () => textarea?.dispatchEvent(new Event("input", { bubbles: true })));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(modelPicker, "gpt-6-astra");
    await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(fetch).toHaveBeenLastCalledWith(`/api/transcripts/${transcriptId}/chat`, expect.objectContaining({
      body: JSON.stringify({
        clientTurnId: "00000000-0000-4000-8000-000000000003",
        model: "gpt-6-astra",
        question: "Jaký je další krok?",
        reasoningEffort: "medium"
      }),
      method: "POST"
    }));
  });

  it.each([
    ["gpt-6.1-sol", "xhigh"], ["gpt-6-astra", "max"], ["gemini-3.8-flash", undefined], ["mistral-small-2603", undefined]
  ] as const)("snapshots the current picker choice %s / %s into a new question", async (selectedModel, expectedEffort) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ thread: null, turns: [] }) as never)
      .mockResolvedValueOnce(response({ thread: { id: "thread-1", transcriptId }, turn: {
        answerMarkdown: "Potvrzeno", clientTurnId: "00000000-0000-4000-8000-000000000003", evidence: [], id: "turn-1",
        model: selectedModel, provider: "openai", question: "Nový dotaz", safeError: null, status: "completed",
        usage: { inputTokens: null, outputTokens: null }
      } }) as never);
    await renderChat();
    const model = container!.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      model.value = selectedModel;
      model.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (expectedEffort) {
      const slider = container!.querySelector('input[type="range"]')!;
      await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
      if (expectedEffort === "xhigh") {
        await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
      }
    } else {
      expect(container!.querySelector('input[type="range"]')).toBeNull();
    }
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Nový dotaz");
    await act(async () => textarea.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => container!.querySelector<HTMLFormElement>("form")!.requestSubmit());
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.find(([, request]) => request?.method === "POST")![1]!.body));
    expect(body.model).toBe(selectedModel);
    expect(body.question).toBe("Nový dotaz");
    if (expectedEffort) expect(body.reasoningEffort).toBe(expectedEffort);
    else expect(body).not.toHaveProperty("reasoningEffort");
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
        id: "turn-1", model: "gpt-6.1-sol", provider: "openai", question: "Čeká odpověď?",
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
      id: "turn-1", model: "gpt-6.1-sol", provider: "openai", question: "Čeká odpověď?",
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
      id: "turn-1", model: "gpt-6.1-sol", provider: "openai", question: "Čeká odpověď?",
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
      id: "turn-1", model: "gpt-6.1-sol", provider: "openai", question: "Čeká odpověď?",
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
          model: "gpt-6.1-sol", provider: "openai", question: "Je to uloženo?",
          safeError: null, status: "completed", usage: { inputTokens: null, outputTokens: null }
        }
      }) as never);
    await renderChat();
    await act(async () => container!.querySelector('input[type="range"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true })));
    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    const form = container?.querySelector<HTMLFormElement>("form");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Je to uloženo?");
    await act(async () => textarea?.dispatchEvent(new Event("input", { bubbles: true })));
    await act(async () => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container?.textContent).toContain("Spojení bylo přerušeno");
    expect(container?.querySelector(".recording-chat-reconcile")).not.toBeNull();
    expect(container?.querySelector(".recording-chat-retry")).toBeNull();

    await act(async () => container?.querySelector<HTMLButtonElement>(".recording-chat-reconcile")?.click());
    const modelPicker = container?.querySelector<HTMLSelectElement>("select");
    expect(container?.querySelector(".recording-chat-reconcile:not(.recording-chat-retry)")).toBeNull();
    expect(container?.querySelector(".recording-chat-retry")).not.toBeNull();
    expect(textarea?.disabled).toBe(true);
    expect(modelPicker?.disabled).toBe(true);
    expect(container!.querySelector<HTMLInputElement>('input[type="range"]')?.disabled).toBe(true);
    if (textarea) textarea.disabled = false;
    if (modelPicker) modelPicker.disabled = false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Jiný dotaz");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(modelPicker, "gpt-6-astra");
    await act(async () => {
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
      modelPicker?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    container!.querySelector<HTMLInputElement>('input[name="reasoningEffort"]')!.value = "low";
    await act(async () => container?.querySelector<HTMLButtonElement>(".recording-chat-retry")?.click());

    const postBodies = vi.mocked(fetch).mock.calls
      .filter(([, request]) => (request as RequestInit | undefined)?.method === "POST")
      .map(([, request]) => JSON.parse((request as RequestInit).body as string));
    expect(postBodies).toEqual([
      { clientTurnId: firstId, model: "gpt-6.1-sol", question: "Je to uloženo?", reasoningEffort: "max" },
      { clientTurnId: firstId, model: "gpt-6.1-sol", question: "Je to uloženo?", reasoningEffort: "max" }
    ]);
  });
});
