"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, MessageCircle, RotateCw } from "lucide-react";
import { getAiMarkdownLines } from "@/components/transcript-tabs/markdown-utils";
import type { TranscriptTarget } from "@/components/transcript-tabs/types";
import type { SafeRecordingChatThread, SafeRecordingChatTurn } from "@/lib/ai/chat-types";
import { aiModelOptions, getAiModelOption } from "@/lib/model-options";

type ChatHistory = {
  thread: SafeRecordingChatThread | null;
  turns: SafeRecordingChatTurn[];
};

type ChatContentProps = {
  activeTranscriptId: string | null;
  defaultModel: string;
  onOpenEvidence: (target: TranscriptTarget) => void;
};

type PendingChatSubmission = {
  clientTurnId: string;
  model: string;
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
export function ChatContent({ activeTranscriptId, defaultModel, onOpenEvidence }: ChatContentProps) {
  const [history, setHistory] = useState<ChatHistory>(emptyHistory);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [message, setMessage] = useState<string | null>(null);
  const [transportUncertain, setTransportUncertain] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<PendingChatSubmission | null>(null);
  const activeTranscriptRef = useRef<string | null>(activeTranscriptId);
  const pendingTurnRef = useRef<PendingChatSubmission | null>(null);
  const submitInFlightRef = useRef(false);
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
    const pending = pendingTurnRef.current;
    if (pending?.transcriptId === transcriptId && nextHistory.turns.some(
      (turn) => turn.clientTurnId === pending.clientTurnId
    )) {
      updatePendingSubmission(null);
      setTransportUncertain(false);
      setDraft("");
    }
  }, [updatePendingSubmission]);

  // This hydration gate prevents pre-hydration form changes from being overwritten by the first controlled render.
  useEffect(() => {
    setIsHydrated(true);
    activeTranscriptRef.current = activeTranscriptId;
    setHistory(emptyHistory);
    setDraft("");
    setMessage(null);
    setTransportUncertain(false);
    updatePendingSubmission(null);
    submitInFlightRef.current = false;
    setModel(defaultModel);

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
  }, [activeTranscriptId, applyHistory, defaultModel, loadHistory, updatePendingSubmission]);

  const hasServerRunningTurn = history.turns.some((turn) => turn.status === "queued" || turn.status === "running");
  const hasPendingSubmission = pendingSubmission?.transcriptId === activeTranscriptId;
  const isComposerDisabled = !isHydrated || !activeTranscriptId || isLoading || isSubmitting || hasServerRunningTurn || transportUncertain || hasPendingSubmission;

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
    if (!pending || pending.transcriptId !== activeTranscriptId) {
      return;
    }

    setIsLoading(true);
    setMessage("Ověřuji stav posledního odeslání…");
    try {
      const nextHistory = await loadHistory(pending.transcriptId);
      if (activeTranscriptRef.current !== pending.transcriptId) return;
      setHistory(nextHistory);
      const recognized = nextHistory.turns.some((turn) => turn.clientTurnId === pending.clientTurnId);
      setTransportUncertain(false);
      setMessage(recognized ? "Odeslání bylo uloženo v historii." : "Odeslání nebylo potvrzeno. Můžete zopakovat původní odeslání.");
      if (recognized) {
        updatePendingSubmission(null);
        setDraft("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Stav posledního odeslání se nepodařilo ověřit.");
    } finally {
      if (activeTranscriptRef.current === pending.transcriptId) {
        setIsLoading(false);
      }
    }
  }

  // submitPendingTurn posts one immutable idempotency snapshot, including its original question and model.
  async function submitPendingTurn(pending: PendingChatSubmission) {
    if (activeTranscriptRef.current !== pending.transcriptId || submitInFlightRef.current) return;

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/transcripts/${pending.transcriptId}/chat`, {
        body: JSON.stringify({
          clientTurnId: pending.clientTurnId,
          model: pending.model,
          question: pending.question
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (activeTranscriptRef.current !== pending.transcriptId) return;

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
      setMessage(result.turn.status === "failed"
        ? result.turn.safeError ?? "Chat selhal."
        : "Odpověď je uložená.");
    } catch {
      if (activeTranscriptRef.current !== pending.transcriptId) return;
      setTransportUncertain(true);
      setMessage("Spojení bylo přerušeno. Nejdřív ověřte stav posledního odeslání.");
    } finally {
      if (activeTranscriptRef.current === pending.transcriptId) {
        setIsSubmitting(false);
      }
      submitInFlightRef.current = false;
    }
  }

  // submitQuestion snapshots a new draft only when no earlier idempotent submission remains unresolved.
  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!activeTranscriptId || !question || isComposerDisabled) return;
    const submittedModel = new FormData(event.currentTarget).get("model");

    const pending = {
      clientTurnId: crypto.randomUUID(),
      model: typeof submittedModel === "string" && getAiModelOption(submittedModel)
        ? submittedModel
        : model,
      question,
      transcriptId: activeTranscriptId
    };
    updatePendingSubmission(pending);
    await submitPendingTurn(pending);
  }

  // retryPendingSubmission repeats only the immutable unresolved request after reconciliation has checked it.
  async function retryPendingSubmission() {
    const pending = pendingTurnRef.current;
    if (!pending || pending.transcriptId !== activeTranscriptId || transportUncertain || isSubmitting) return;
    await submitPendingTurn(pending);
  }

  if (!activeTranscriptId) {
    return <div className="recording-chat-empty">Chat je dostupný po uložení přepisu.</div>;
  }

  return (
    <section aria-label="Chat nad přepisem" className="recording-chat-content">
      <div aria-live="polite" className="recording-chat-status">
        {isLoading ? "Načítám historii chatu…" : message}
      </div>
      {history.turns.length === 0 && !isLoading ? (
        <div className="recording-chat-empty">
          <MessageCircle aria-hidden="true" size={16} />
          <p>Zeptejte se na tento přepis.</p>
        </div>
      ) : null}
      <ol className="recording-chat-turns">
        {history.turns.map((turn) => <ChatTurn key={turn.id} onOpenEvidence={onOpenEvidence} transcriptId={activeTranscriptId} turn={turn} />)}
      </ol>
      {transportUncertain ? (
        <button className="recording-chat-reconcile" onClick={() => void reconcilePendingTurn()} type="button">
          <RotateCw aria-hidden="true" size={15} /> Ověřit poslední odeslání
        </button>
      ) : null}
      {hasPendingSubmission && !transportUncertain ? (
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
          placeholder="Na co se chcete ze záznamu zeptat?"
          value={draft}
        />
        <div className="recording-chat-composer-controls">
          <label>
            Model
            <select disabled={isComposerDisabled} name="model" onChange={(event) => setModel(event.currentTarget.value)} value={model}>
              {aiModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <button disabled={isComposerDisabled || !draft.trim()} type="submit">
            <ArrowUp aria-hidden="true" size={16} /> Odeslat
          </button>
        </div>
      </form>
    </section>
  );
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
        {turn.status === "queued" || turn.status === "running" ? <p>AI připravuje odpověď…</p> : null}
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
