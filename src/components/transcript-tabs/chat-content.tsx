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

const emptyHistory: ChatHistory = { thread: null, turns: [] };

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
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [message, setMessage] = useState<string | null>(null);
  const [transportUncertain, setTransportUncertain] = useState(false);
  const activeTranscriptRef = useRef<string | null>(activeTranscriptId);
  const pendingTurnRef = useRef<{ clientTurnId: string; question: string; transcriptId: string } | null>(null);
  const submitInFlightRef = useRef(false);

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

  useEffect(() => {
    activeTranscriptRef.current = activeTranscriptId;
    setHistory(emptyHistory);
    setDraft("");
    setMessage(null);
    setTransportUncertain(false);
    pendingTurnRef.current = null;
    submitInFlightRef.current = false;
    setModel(defaultModel);

    if (!activeTranscriptId) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    // applyHistory ignores a fetch that belongs to a transcript which is no longer rendered.
    const applyHistory = (nextHistory: ChatHistory) => {
      if (controller.signal.aborted || activeTranscriptRef.current !== activeTranscriptId) {
        return;
      }
      setHistory(nextHistory);
      const pending = pendingTurnRef.current;
      if (pending?.transcriptId === activeTranscriptId && nextHistory.turns.some(
        (turn) => turn.clientTurnId === pending.clientTurnId
      )) {
        pendingTurnRef.current = null;
        setTransportUncertain(false);
        setDraft("");
      }
    };

    void loadHistory(activeTranscriptId, controller.signal)
      .then(applyHistory)
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
  }, [activeTranscriptId, defaultModel, loadHistory]);

  const hasServerRunningTurn = history.turns.some((turn) => turn.status === "queued" || turn.status === "running");
  const isComposerDisabled = !activeTranscriptId || isLoading || isSubmitting || hasServerRunningTurn || transportUncertain;

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
      setMessage(recognized ? "Odeslání bylo uloženo v historii." : "Odeslání nebylo potvrzeno. Můžete jej odeslat znovu.");
      if (recognized) {
        pendingTurnRef.current = null;
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

  // submitQuestion posts the narrow browser contract once and retains its UUID through reconciliation.
  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!activeTranscriptId || !question || isComposerDisabled || submitInFlightRef.current) return;

    const pending = pendingTurnRef.current;
    const clientTurnId = pending?.transcriptId === activeTranscriptId
      ? pending.clientTurnId
      : crypto.randomUUID();
    pendingTurnRef.current = { clientTurnId, question, transcriptId: activeTranscriptId };
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/transcripts/${activeTranscriptId}/chat`, {
        body: JSON.stringify({ clientTurnId, model, question }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (activeTranscriptRef.current !== activeTranscriptId) return;

      if (!response.ok) {
        setMessage(getChatError(payload));
        await reconcilePendingTurn();
        return;
      }

      const result = payload as { thread: SafeRecordingChatThread; turn: SafeRecordingChatTurn };
      if (!result.turn || result.turn.clientTurnId !== clientTurnId) {
        throw new Error("Odpověď chatu neobsahuje potvrzení odeslání.");
      }
      setHistory((current) => ({
        thread: result.thread,
        turns: mergeChatTurn(current.turns, result.turn)
      }));
      pendingTurnRef.current = null;
      setDraft("");
      setTransportUncertain(false);
      setMessage(result.turn.status === "failed"
        ? result.turn.safeError ?? "Chat selhal."
        : "Odpověď je uložená.");
    } catch {
      if (activeTranscriptRef.current !== activeTranscriptId) return;
      setTransportUncertain(true);
      setMessage("Spojení bylo přerušeno. Nejdřív ověřte stav posledního odeslání.");
    } finally {
      if (activeTranscriptRef.current === activeTranscriptId) {
        setIsSubmitting(false);
      }
      submitInFlightRef.current = false;
    }
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
            <select disabled={isComposerDisabled} onChange={(event) => setModel(event.currentTarget.value)} value={model}>
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
