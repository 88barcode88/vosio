"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRecordingCapabilities } from "@/components/recording-capability-context";
import { AiModelPicker, createAiModelSelection, getAiModelReasoningEffort } from "@/components/ai-model-picker";
import { ArrowUp, MessageCircle, RotateCw } from "lucide-react";
import { getAiMarkdownLines } from "@/components/transcript-tabs/markdown-utils";
import type { TranscriptTarget } from "@/components/transcript-tabs/types";
import type { SafeRecordingChatThread, SafeRecordingChatTurn } from "@/lib/ai/chat-types";
import { getActiveAiModelOption, getAiModelOption, type AiReasoningEffort } from "@/lib/model-options";

type ChatHistory = {
  thread: SafeRecordingChatThread | null;
  turns: SafeRecordingChatTurn[];
};

type ChatContentProps = {
  activeTranscriptId: string | null;
  defaultModel: string;
  defaultReasoningEffort?: AiReasoningEffort;
  onOpenEvidence: (target: TranscriptTarget) => void;
};

type PendingChatSubmission = {
  clientTurnId: string;
  model: string;
  reasoningEffort?: AiReasoningEffort;
  question: string;
  transcriptId: string;
};

const emptyHistory: ChatHistory = { thread: null, turns: [] };
const CHAT_RUNNING_POLL_INTERVAL_MS = 5_000;

// getChatError returns only the API's short public error message or a safe local fallback.
function getChatError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.length <= 180) {
      return error;
    }
  }

  return "Chat se nepodařilo zpracovat.";
}

// getModelLabel keeps persisted historical attribution readable if an old catalog model is absent.
function getModelLabel(model: string) {
  return getAiModelOption(model)?.label ?? model;
}

// formatEvidenceTime gives evidence controls a compact, screen-reader-friendly transcript time.
function formatEvidenceTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// mergeChatTurn replaces an idempotent turn while preserving all previously loaded history.
function mergeChatTurn(turns: SafeRecordingChatTurn[], nextTurn: SafeRecordingChatTurn) {
  const index = turns.findIndex((turn) => turn.clientTurnId === nextTurn.clientTurnId);

  if (index < 0) {
    return [...turns, nextTurn];
  }

  return turns.map((turn) => turn.clientTurnId === nextTurn.clientTurnId ? nextTurn : turn);
}

// ChatContent loads and submits the single persisted transcript chat without sending transcript audio or context.
export function ChatContent({ activeTranscriptId, defaultModel, defaultReasoningEffort, onOpenEvidence }: ChatContentProps) {
  const { capabilities } = useRecordingCapabilities();
  const [history, setHistory] = useState<ChatHistory>(emptyHistory);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedTranscriptId, setLoadedTranscriptId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draft, setDraft] = useState("");
  const activeDefaultSelection = createAiModelSelection(defaultModel, defaultReasoningEffort);
  const activeDefaultModel = activeDefaultSelection.model;
  const activeDefaultReasoningEffort = activeDefaultSelection.reasoningEffort;
  const [selection, setSelection] = useState(activeDefaultSelection);
  const { model } = selection;
  const [message, setMessage] = useState<string | null>(null);
  const [transportUncertain, setTransportUncertain] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<PendingChatSubmission | null>(null);
  const activeTranscriptRef = useRef<string | null>(activeTranscriptId);
  const pendingTurnRef = useRef<PendingChatSubmission | null>(null);
  const submitInFlightRef = useRef<PendingChatSubmission | null>(null);
  const reconcileInFlightRef = useRef<PendingChatSubmission | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const pollInFlightRef = useRef(false);

  // updatePendingSubmission keeps the synchronous idempotency guard and rendered composer state in lockstep.
  const updatePendingSubmission = useCallback((pending: PendingChatSubmission | null) => {
    pendingTurnRef.current = pending;
    setPendingSubmission(pending);
  }, []);

  const loadHistory = useCallback(async (transcriptId: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/transcripts/${transcriptId}/chat`, {
      cache: "no-store",
      method: "GET",
      signal
    });
    const payload = await response.json().catch(() => null) as unknown;

    if (!response.ok) {
      throw new Error(getChatError(payload));
    }

    return payload as ChatHistory;
  }, []);

  // applyHistory keeps received data scoped to the transcript still mounted in the chat tab.
  const applyHistory = useCallback((transcriptId: string, nextHistory: ChatHistory) => {
    if (activeTranscriptRef.current !== transcriptId) {
      return;
    }
    setHistory(nextHistory);
    setLoadedTranscriptId(transcriptId);
    setMessage(null);
    const pending = pendingTurnRef.current;
    if (pending?.transcriptId === transcriptId && nextHistory.turns.some(
      (turn) => turn.clientTurnId === pending.clientTurnId
    )) {
      updatePendingSubmission(null);
      setTransportUncertain(false);
      setDraft("");
    }
  }, [updatePendingSubmission]);

  // Account defaults affect only the next model choice, not transcript history or an immutable pending request.
  useEffect(() => {
    setSelection({ model: activeDefaultModel, reasoningEffort: activeDefaultReasoningEffort });
  }, [activeTranscriptId, activeDefaultModel, activeDefaultReasoningEffort]);

  // This hydration gate prevents pre-hydration form changes from being overwritten by the first controlled render.
  useEffect(() => {
    setIsHydrated(true);
    activeTranscriptRef.current = activeTranscriptId;
    setHistory(emptyHistory);
    setDraft("");
    setMessage(null);
    setTransportUncertain(false);
    updatePendingSubmission(null);
    submitInFlightRef.current = null;
    reconcileInFlightRef.current = null;
    setIsSubmitting(false);

    if (!activeTranscriptId) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    void loadHistory(activeTranscriptId, controller.signal)
      .then((nextHistory) => {
        if (!controller.signal.aborted) {
          applyHistory(activeTranscriptId, nextHistory);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && activeTranscriptRef.current === activeTranscriptId) {
          setMessage(error instanceof Error ? error.message : "Historii chatu se nepodařilo načíst.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && activeTranscriptRef.current === activeTranscriptId) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeTranscriptId, applyHistory, loadHistory, updatePendingSubmission]);

  const visibleTurns = loadedTranscriptId === activeTranscriptId ? history.turns : [];
  const hasServerRunningTurn = visibleTurns.some((turn) => turn.status === "queued" || turn.status === "running");
  const hasPendingSubmission = pendingSubmission?.transcriptId === activeTranscriptId;
  const visiblePending = hasPendingSubmission && pendingSubmission
    && !visibleTurns.some((turn) => turn.clientTurnId === pendingSubmission.clientTurnId) ? pendingSubmission : null;
  const isComposerDisabled = !isHydrated || !capabilities.usePrivateChat || !capabilities.runPersonalAi || !activeTranscriptId || loadedTranscriptId !== activeTranscriptId || isLoading || isSubmitting || hasServerRunningTurn || transportUncertain || hasPendingSubmission;

  useEffect(() => {
    if (!activeTranscriptId || !hasServerRunningTurn) {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    // stopPolling aborts the active background request before releasing its timer and ownership lock.
    const stopPolling = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      pollControllerRef.current?.abort();
      pollControllerRef.current = null;
      pollInFlightRef.current = false;
    };

    // pollRunningTurn refreshes only one visible running chat and never drops the previous safe history on error.
    const pollRunningTurn = async () => {
      if (
        disposed
        || document.visibilityState === "hidden"
        || pollInFlightRef.current
        || activeTranscriptRef.current !== activeTranscriptId
      ) {
        return;
      }

      const controller = new AbortController();
      pollControllerRef.current = controller;
      pollInFlightRef.current = true;

      try {
        const nextHistory = await loadHistory(activeTranscriptId, controller.signal);
        if (!disposed && !controller.signal.aborted) {
          applyHistory(activeTranscriptId, nextHistory);
        }
      } catch {
        if (!disposed && !controller.signal.aborted && activeTranscriptRef.current === activeTranscriptId) {
          setMessage("Stav chatu se nepodařilo obnovit. Zkusíme to znovu.");
        }
      } finally {
        if (pollControllerRef.current === controller) {
          pollControllerRef.current = null;
          pollInFlightRef.current = false;
        }
      }
    };

    // startPolling resumes the bounded timer only while the tab is visible and this server turn remains active.
    const startPolling = () => {
      if (document.visibilityState === "hidden" || intervalId !== null) {
        return;
      }
      intervalId = setInterval(() => { void pollRunningTurn(); }, CHAT_RUNNING_POLL_INTERVAL_MS);
    };

    // refreshVisibleChat resumes delayed reconciliation as soon as the browser returns to this tab.
    const refreshVisibleChat = () => {
      if (document.visibilityState === "hidden") {
        stopPolling();
        return;
      }
      void pollRunningTurn();
      startPolling();
    };

    document.addEventListener("visibilitychange", refreshVisibleChat);
    window.addEventListener("focus", refreshVisibleChat);
    startPolling();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", refreshVisibleChat);
      window.removeEventListener("focus", refreshVisibleChat);
      stopPolling();
    };
  }, [activeTranscriptId, applyHistory, hasServerRunningTurn, loadHistory]);

  // reconcilePendingTurn checks a transport-uncertain UUID before the user can submit another request.
  async function reconcilePendingTurn() {
    const pending = pendingTurnRef.current;
    if (!pending || pending.transcriptId !== activeTranscriptId || reconcileInFlightRef.current) {
      return;
    }

    reconcileInFlightRef.current = pending;
    setIsLoading(true);
    setMessage("Ověřuji stav posledního odeslání…");
    try {
      const nextHistory = await loadHistory(pending.transcriptId);
      if (activeTranscriptRef.current !== pending.transcriptId || pendingTurnRef.current !== pending
        || reconcileInFlightRef.current !== pending) return;
      setHistory(nextHistory);
      const recognized = nextHistory.turns.find((turn) => turn.clientTurnId === pending.clientTurnId);
      setTransportUncertain(false);
      setMessage(recognized?.status === "failed" || recognized?.status === "interrupted"
        ? recognized.safeError ?? "Chat nedokončil odpověď."
        : recognized ? null : "Odeslání nebylo potvrzeno. Můžete zopakovat původní odeslání.");
      if (recognized) {
        updatePendingSubmission(null);
        setDraft("");
      }
    } catch (error) {
      if (activeTranscriptRef.current !== pending.transcriptId || pendingTurnRef.current !== pending
        || reconcileInFlightRef.current !== pending) return;
      setTransportUncertain(true);
      setMessage(error instanceof Error ? error.message : "Stav posledního odeslání se nepodařilo ověřit.");
    } finally {
      if (activeTranscriptRef.current === pending.transcriptId && reconcileInFlightRef.current === pending) {
        setIsLoading(false);
        reconcileInFlightRef.current = null;
      }
    }
  }

  // submitPendingTurn posts one immutable idempotency snapshot, including its original question and model.
  async function submitPendingTurn(pending: PendingChatSubmission) {
    if (!capabilities.usePrivateChat || !capabilities.runPersonalAi || activeTranscriptRef.current !== pending.transcriptId || submitInFlightRef.current) return;

    submitInFlightRef.current = pending;
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/transcripts/${pending.transcriptId}/chat`, {
        body: JSON.stringify({
          clientTurnId: pending.clientTurnId,
          model: pending.model,
          question: pending.question,
          ...(pending.reasoningEffort ? { reasoningEffort: pending.reasoningEffort } : {})
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (activeTranscriptRef.current !== pending.transcriptId || submitInFlightRef.current !== pending) return;

      if (!response.ok) {
        setMessage(getChatError(payload));
        await reconcilePendingTurn();
        return;
      }

      const result = payload as { thread: SafeRecordingChatThread; turn: SafeRecordingChatTurn };
      if (!result.turn || result.turn.clientTurnId !== pending.clientTurnId) {
        throw new Error("Odpověď chatu neobsahuje potvrzení odeslání.");
      }
      setHistory((current) => ({
        thread: result.thread,
        turns: mergeChatTurn(current.turns, result.turn)
      }));
      updatePendingSubmission(null);
      setDraft("");
      setTransportUncertain(false);
      setMessage(result.turn.status === "failed" || result.turn.status === "interrupted"
        ? result.turn.safeError ?? "Chat selhal."
        : result.turn.status === "completed" ? "Odpověď je uložená." : null);
    } catch {
      if (activeTranscriptRef.current !== pending.transcriptId || submitInFlightRef.current !== pending) return;
      setTransportUncertain(true);
      setMessage("Spojení bylo přerušeno. Nejdřív ověřte stav posledního odeslání.");
    } finally {
      if (submitInFlightRef.current === pending) {
        if (activeTranscriptRef.current === pending.transcriptId) setIsSubmitting(false);
        submitInFlightRef.current = null;
      }
    }
  }

  // submitQuestion snapshots a new draft only when no earlier idempotent submission remains unresolved.
  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!activeTranscriptId || !question || isComposerDisabled || submitInFlightRef.current || pendingTurnRef.current) return;
    const formData = new FormData(event.currentTarget);
    const submittedModel = formData.get("model");
    const selectedModel = typeof submittedModel === "string" && getActiveAiModelOption(submittedModel) ? submittedModel : model;
    const submittedEffort = formData.get("reasoningEffort");
    const reasoningEffort = getAiModelReasoningEffort({
      model: selectedModel,
      reasoningEffort: typeof submittedEffort === "string" ? submittedEffort as AiReasoningEffort : selection.reasoningEffort
    });

    const pending = {
      clientTurnId: crypto.randomUUID(),
      model: selectedModel,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      question,
      transcriptId: activeTranscriptId
    };
    updatePendingSubmission(pending);
    await submitPendingTurn(pending);
  }

  // handleComposerKeyDown shares the button submission path while preserving multiline input and IME confirmation.
  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (event.repeat || isComposerDisabled || !draft.trim()) return;
    event.currentTarget.form?.requestSubmit();
  }

  // retryPendingSubmission repeats only the immutable unresolved request after reconciliation has checked it.
  async function retryPendingSubmission() {
    const pending = pendingTurnRef.current;
    if (!pending || pending.transcriptId !== activeTranscriptId || transportUncertain || isSubmitting) return;
    await submitPendingTurn(pending);
  }

  // retryHistory repeats the read only and preserves the mounted composer after an initial load failure.
  async function retryHistory() {
    if (!activeTranscriptId || isLoading) return;
    const transcriptId = activeTranscriptId;
    setIsLoading(true);
    setMessage(null);
    try { applyHistory(transcriptId, await loadHistory(transcriptId)); }
    catch { if (activeTranscriptRef.current === transcriptId) setMessage("Historii chatu se nepodařilo načíst."); }
    finally { if (activeTranscriptRef.current === transcriptId) setIsLoading(false); }
  }

  if (!activeTranscriptId) {
    return <div className="recording-chat-empty">Chat je dostupný po uložení přepisu.</div>;
  }

  return (
    <section aria-label="Chat nad přepisem" className="recording-chat-content">
      <div aria-live="polite" className="recording-chat-status">
        {(isLoading || loadedTranscriptId !== activeTranscriptId) && !message ? "Načítám historii chatu…" : message}
      </div>
      {message && !isLoading && loadedTranscriptId !== activeTranscriptId ? <button className="recording-chat-reconcile" onClick={() => void retryHistory()} type="button">Zkusit znovu</button> : null}
      <div className="recording-chat-history" aria-busy={isLoading || loadedTranscriptId !== activeTranscriptId}>
      {visibleTurns.length === 0 && !visiblePending && !isLoading && loadedTranscriptId === activeTranscriptId ? (
        <div className="recording-chat-empty">
          <MessageCircle aria-hidden="true" size={16} />
          <p>Zeptejte se na tento přepis.</p>
        </div>
      ) : null}
      <ol className="recording-chat-turns" aria-busy={loadedTranscriptId !== activeTranscriptId}>
        {visibleTurns.map((turn) => <ChatTurn key={turn.id} onOpenEvidence={onOpenEvidence} transcriptId={activeTranscriptId} turn={turn} />)}
        {visiblePending ? <li className="recording-chat-turn recording-chat-turn-pending">
          <div className="recording-chat-question"><strong>Vy</strong><p>{visiblePending.question}</p></div>
          <div className="recording-chat-answer">
            <header><strong>Vosio AI</strong><small>{getModelLabel(visiblePending.model)}</small></header>
            {isSubmitting ? <ChatAnswering /> : <p>Odeslání zatím není potvrzené. Ověřte stav nebo zopakujte původní odeslání.</p>}
          </div>
        </li> : null}
      </ol>
      </div>
      {transportUncertain ? (
        <button className="recording-chat-reconcile" onClick={() => void reconcilePendingTurn()} type="button">
          <RotateCw aria-hidden="true" size={15} /> Ověřit poslední odeslání
        </button>
      ) : null}
      {hasPendingSubmission && !transportUncertain && !isSubmitting && !isLoading ? (
        <button className="recording-chat-reconcile recording-chat-retry" onClick={() => void retryPendingSubmission()} type="button">
          <RotateCw aria-hidden="true" size={15} /> Zopakovat původní odeslání
        </button>
      ) : null}
      <form className="recording-chat-composer" onSubmit={(event) => void submitQuestion(event)}>
        <label htmlFor="recording-chat-question">Dotaz k přepisu</label>
        <textarea
          disabled={isComposerDisabled}
          id="recording-chat-question"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleComposerKeyDown}
          aria-describedby="recording-chat-keyboard-hint"
          placeholder="Na co se chcete ze záznamu zeptat?"
          value={draft}
        />
        <small id="recording-chat-keyboard-hint">Enter odešle zprávu · Shift+Enter vloží nový řádek</small>
        <div className="recording-chat-composer-controls">
          <AiModelPicker
            disabled={isComposerDisabled}
            modelLabel="Model"
            onChange={setSelection}
            scope="Pro následující otázku v chatu."
            value={selection}
          />
          <button disabled={isComposerDisabled || !draft.trim()} type="submit">
            <ArrowUp aria-hidden="true" size={16} /> Odeslat
          </button>
        </div>
      </form>
    </section>
  );
}

// The same accessible three-dot state spans an optimistic POST and a persisted queued/running turn.
function ChatAnswering() {
  return <p className="recording-chat-answering" role="status">
    <span className="visually-hidden">AI připravuje odpověď…</span>
    <span aria-hidden="true" className="recording-chat-answering-dots">
      {[0, 1, 2].map((index) => <span className="recording-chat-answering-dot" key={index}>·</span>)}
    </span>
  </p>;
}

// ChatTurn renders one server-authoritative turn without interpreting raw HTML or inventing evidence.
function ChatTurn({
  onOpenEvidence,
  transcriptId,
  turn
}: {
  onOpenEvidence: (target: TranscriptTarget) => void;
  transcriptId: string;
  turn: SafeRecordingChatTurn;
}) {
  const markdown = turn.answerMarkdown ? getAiMarkdownLines(turn.answerMarkdown) : [];

  return (
    <li className={`recording-chat-turn recording-chat-turn-${turn.status}`}>
      <div className="recording-chat-question"><strong>Vy</strong><p>{turn.question}</p></div>
      <div className="recording-chat-answer">
        <header><strong>Vosio AI</strong><small>{getModelLabel(turn.model)}</small></header>
        {turn.status === "queued" || turn.status === "running" ? <ChatAnswering /> : null}
        {turn.status === "failed" || turn.status === "interrupted" ? <p role="alert">{turn.safeError ?? "Chat nedokončil odpověď."}</p> : null}
        {markdown.length > 0 ? <div className="ai-markdown-preview recording-chat-markdown">
          {markdown.map((line, index) => line.kind === "heading"
            ? <strong className="ai-markdown-heading" key={`${line.text}-${index}`}>{line.text}</strong>
            : line.kind === "bullet"
              ? <p className="ai-markdown-bullet" key={`${line.text}-${index}`}>{line.text}</p>
              : line.kind === "table"
                ? <div className="recording-chat-table" key={`table-${index}`}>{line.rows.map((row, rowIndex) => <p key={rowIndex}>{row.join(" · ")}</p>)}</div>
                : <p key={`${line.text}-${index}`}>{line.text}</p>
          )}
        </div> : null}
        {turn.evidence.map((evidence, index) => (
          <button
            aria-label={`Otevřít ověřený důkaz v ${formatEvidenceTime(evidence.startMs)}: ${evidence.quote}`}
            className="structured-evidence-action"
            data-chat-evidence="true"
            key={`${evidence.startMs}-${evidence.endMs}-${index}`}
            onClick={() => onOpenEvidence({
              endMs: evidence.endMs,
              highlightText: evidence.quote,
              playback: "play",
              startMs: evidence.startMs,
              transcriptId
            })}
            type="button"
          >
            <time dateTime={`PT${Math.floor(evidence.startMs / 1_000)}S`}>{formatEvidenceTime(evidence.startMs)}</time> „{evidence.quote}“
          </button>
        ))}
      </div>
    </li>
  );
}
