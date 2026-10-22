"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Link2, RotateCcw, Sparkles, Square } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { createClient } from "@/lib/supabase/browser";
import { getCaptureState } from "@/lib/recordings/capture";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE,
  hasTranscriptSearchIndexWarning
} from "@/lib/transcripts/search-warning";

type TranscriptionControlsProps = {
  storedAudioMode?: "none" | "segments" | "single";
  hasTranscript?: boolean;
  recordingId: string | null;
  recordingStatus: string | null;
};
type TranscriptionEndpointPayload = {
  error?: string;
  job?: {
    provider_job_id?: string | null;
    status?: string | null;
    failureCode?: string | null;
  };
  reused?: boolean;
  transcript?: {
    id?: string;
    text?: string;
  };
  warnings?: unknown;
  operation?: { operation_id?: string; operationId?: string } | null;
  canRecover?: boolean;
};
type TranscriptionCallOptions = {
  automatic?: boolean;
  restart?: boolean;
};

const AUTO_TRANSCRIPTION_POLL_MS = 15000;
const RUNNING_JOB_STATUSES = ["queued", "running"] as const;

// formatCheckTime renders the last polling time for the transcription controls.
function formatCheckTime(date: Date) {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

// getJobStatusLabel maps provider job states into compact Czech labels.
function getJobStatusLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    done: "hotovo",
    failed: "chyba",
    queued: "ve frontě",
    running: "běží",
    manual_required: "zablokovaný"
  };

  return status ? labels[status] ?? status : "neznámý";
}

// isRunningJobStatus checks if the latest provider state still needs polling.
function isRunningJobStatus(status: string | null) {
  return RUNNING_JOB_STATUSES.some((runningStatus) => runningStatus === status);
}

// getTranscriptionMessage converts API payloads into status copy for the user.
function getTranscriptionMessage(
  method: "GET" | "POST",
  payload: TranscriptionEndpointPayload | null
) {
  if (method === "POST") {
    return payload?.reused
      ? "Požadavek na přepis už existuje. Stav se bude kontrolovat automaticky."
      : "Požadavek na přepis je přijatý. Stav se bude kontrolovat automaticky.";
  }

  const status = payload?.job?.status;

  if (status === "done" || payload?.transcript) {
    return "Přepis je hotový. Načítám uložený transcript.";
  }

  if (status === "failed") {
    if (payload?.job?.failureCode === "provider_authentication") return "Soniox odmítl přístup. Zkontrolujte API klíč a region v nastavení instalace, potom spusťte nový přepis.";
    if (payload?.job?.failureCode === "audio_unavailable") return "Audio se nepodařilo připravit pro přepis. Zůstává uložené; můžete zkusit nový přepis.";
    if (payload?.job?.failureCode === "user_stopped") return "Původní pokus je zastavený. Audio zůstalo uložené; můžete spustit nový přepis.";
    return "Soniox přepis selhal. Zkuste přepis spustit znovu.";
  }

  if (status === "manual_required") return "Přepis je zablokovaný. V nabídce Vyřešit přepis nejdřív dohledáte původní pokus.";

  if (status === "queued") {
    return "Soniox job čeká ve frontě. Stav kontroluji automaticky.";
  }

  if (status === "running") {
    return "Soniox přepis běží. Stav kontroluji automaticky.";
  }

  return "Stav přepisu je aktualizovaný.";
}

// TranscriptionControls starts and polls Soniox transcription for one recording.
export function TranscriptionControls({
  storedAudioMode = "none",
  hasTranscript = false,
  recordingId,
  recordingStatus
}: TranscriptionControlsProps) {
  const router = useRouter();
  const controlsRef = useRef<HTMLDivElement>(null);
  const autoPollInFlightRef = useRef(false);
  const scopeGenerationRef = useRef(0);
  const manualRequestInFlightRef = useRef(false);
  const manualRecoveryInFlightRef = useRef(false);
  const autoRecoveryRef = useRef<{ operationId: string; requestId: string; attempts: number; nextAt: number } | null>(null);
  const requestRef = useRef<{ recordingId: string; requestId: string; captureRevision: number; purpose: "capture" | "retry" | "retranscribe" } | null>(null);
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastJobStatus, setLastJobStatus] = useState<string | null>(null);
  const lastJobStatusRef = useRef<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [canRecover, setCanRecover] = useState(false);
  const recoveryRequestRef = useRef<{ operationId: string; action: "resume" | "stop"; requestId: string } | null>(null);
  const canUseRecording = Boolean(recordingId);
  const hasTranscribableAudio = storedAudioMode !== "none";
  const isTranscribing = recordingStatus === "transcribing";
  const isBlocked = lastJobStatus === "manual_required";
  const shouldPollTranscription = lastJobStatus === null ? isTranscribing
    : isRunningJobStatus(lastJobStatus) || (isBlocked && canRecover && Boolean(operationId));
  const canStart =
    canUseRecording &&
    hasTranscribableAudio &&
    !hasTranscript &&
    (recordingStatus === "uploaded" || recordingStatus === "failed" || recordingStatus === "completed" || lastJobStatus === "failed");
  const canRestart = canUseRecording && hasTranscript && hasTranscribableAudio;
  const canCheck = canUseRecording && (shouldPollTranscription || isBlocked);
  const showRecovery = Boolean(canRecover && operationId && (isBlocked || shouldPollTranscription));

  // Fence responses and retry identities when the same mounted controls switch recording or unmount.
  useEffect(() => {
    scopeGenerationRef.current += 1;
    autoRecoveryRef.current = null;
    requestRef.current = null;
    recoveryRequestRef.current = null;
    autoPollInFlightRef.current = false;
    manualRequestInFlightRef.current = false;
    manualRecoveryInFlightRef.current = false;
    lastJobStatusRef.current = null;
    setLastJobStatus(null);
    setOperationId(null);
    setCanRecover(false);
    setMessage(null);
    setLastCheckedAt(null);
    setRecoveryError(null);
    setIsWorking(false);
    setIsAutoChecking(false);
    return () => { scopeGenerationRef.current += 1; };
  }, [recordingId]);

  // callTranscriptionEndpoint invokes the recording transcription route and refreshes data.
  const callTranscriptionEndpoint = useCallback(async (
    method: "GET" | "POST",
    options: TranscriptionCallOptions = {}
  ) => {
    if (!recordingId) {
      return;
    }

    const requestScope = scopeGenerationRef.current;
    const isCurrent = () => requestScope === scopeGenerationRef.current;
    if (autoPollInFlightRef.current || manualRequestInFlightRef.current
      || (options.automatic && (manualRecoveryInFlightRef.current || document.visibilityState === "hidden" || !navigator.onLine))) {
      return;
    }
    if (options.automatic && lastJobStatusRef.current === "manual_required" && autoRecoveryRef.current
      && (autoRecoveryRef.current.attempts >= 3 || Date.now() < autoRecoveryRef.current.nextAt)) return;
    if (method === "POST") setRecoveryError(null);

    if (options.automatic) {
      autoPollInFlightRef.current = true;
      setIsAutoChecking(true);
    } else {
      manualRequestInFlightRef.current = true;
      setIsWorking(true);
      setMessage(options.restart
        ? "Odesílám požadavek na přepis… Původní přepis zůstává uložený."
        : method === "POST"
          ? "Odesílám požadavek na přepis…"
          : "Kontroluji stav přepisu...");
    }

    try {
      if (method === "GET" && lastJobStatusRef.current !== "manual_required") {
        await fetch(`/api/recordings/${recordingId}/transcription/reconcile`, { method: "POST", cache: "no-store" }).catch(() => undefined);
        if (!isCurrent()) return;
      }
      if (method === "POST" && requestRef.current?.recordingId !== recordingId) {
        const state = await getCaptureState(createClient(), recordingId);
        if (!isCurrent()) return;
        requestRef.current = { recordingId, requestId: crypto.randomUUID(), captureRevision: state.captureRevision,
          purpose: options.restart ? "retranscribe" : state.status === "failed" ? "retry" : "capture" };
      }
      const url = options.restart
        ? `/api/recordings/${recordingId}/transcription?restart=1`
        : `/api/recordings/${recordingId}/transcription`;
      const response = await fetch(url, {
        cache: "no-store",
        ...(method === "POST" && requestRef.current ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: requestRef.current.requestId, captureRevision: requestRef.current.captureRevision, purpose: requestRef.current.purpose }) } : {}),
        method
      });
      const payload = (await response.json().catch(() => null)) as TranscriptionEndpointPayload | null;
      if (!isCurrent()) return;

      if (!response.ok) {
        setMessage(payload?.error ?? "Přepis se nepovedlo zpracovat.");
        return;
      }

      setLastCheckedAt(formatCheckTime(new Date()));
      setLastJobStatus(payload?.job?.status ?? null);
      lastJobStatusRef.current = payload?.job?.status ?? null;
      const currentOperation = payload?.operation?.operation_id ?? payload?.operation?.operationId;
      if (payload?.job?.status === "done" || payload?.job?.status === "failed"
        || (currentOperation && recoveryRequestRef.current && currentOperation !== recoveryRequestRef.current.operationId)) {
        setRecoveryError(null);
      }
      if (currentOperation) setOperationId(currentOperation);
      if (typeof payload?.canRecover === "boolean") setCanRecover(payload.canRecover);
      if (options.automatic && payload?.job?.status === "manual_required" && payload.canRecover && currentOperation) {
        const previous = autoRecoveryRef.current;
        const recovery = previous?.operationId === currentOperation ? previous
          : { operationId: currentOperation, requestId: crypto.randomUUID(), attempts: 0, nextAt: 0 };
        autoRecoveryRef.current = recovery;
        if (recovery.attempts < 3 && Date.now() >= recovery.nextAt) {
          autoRecoveryRef.current = { ...recovery, attempts: recovery.attempts + 1,
            nextAt: Date.now() + [30_000, 60_000, 120_000][recovery.attempts] };
          setMessage(getTranscriptionMessage("GET", payload));
          const resumed = await fetch(`/api/recordings/${recordingId}/transcription/recover`, {
            method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operationId: currentOperation, requestId: recovery.requestId, action: "resume" })
          });
          const result = await resumed.json().catch(() => null) as TranscriptionEndpointPayload | null;
          if (!isCurrent()) return;
          if (resumed.ok && (result?.job?.status === "queued" || result?.job?.status === "running")) {
            lastJobStatusRef.current = result.job.status;
            setLastJobStatus(result.job.status);
            setRecoveryError(null);
            setMessage("Navazuji na původní přepis. Nová placená úloha se nevytvořila.");
            router.refresh();
          } else {
            setRecoveryError(result?.error ?? "Původní pokus zatím nelze bezpečně převzít. Nový přepis se nespustil.");
          }
          return;
        }
      }
      if (payload?.job?.status === "done" || payload?.job?.status === "failed") requestRef.current = null;
      setMessage(hasTranscriptSearchIndexWarning(payload)
        ? TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
        : options.restart
          ? "Požadavek na nový přepis je přijatý. Původní přepis zůstává uložený."
          : getTranscriptionMessage(method, payload));

      if (
        method === "POST" ||
        payload?.job?.status === "done" ||
        payload?.job?.status === "failed" ||
        payload?.transcript
      ) {
        router.refresh();
      }
    } catch {
      if (!isCurrent()) return;
      setMessage("Nepodařilo se spojit se serverem pro přepis.");
    } finally {
      if (isCurrent()) {
        if (options.automatic) {
          autoPollInFlightRef.current = false;
          setIsAutoChecking(false);
        } else {
          manualRequestInFlightRef.current = false;
          setIsWorking(false);
        }
      }
    }
  }, [recordingId, router]);

  // Recover the original operation before allowing an explicitly confirmed new paid attempt.
  async function recoverTranscription(action: "resume" | "stop", startNew = false) {
    if (!recordingId || !operationId || isWorking || autoPollInFlightRef.current || manualRequestInFlightRef.current || manualRecoveryInFlightRef.current) return;
    const requestScope = scopeGenerationRef.current;
    if (action === "stop" && !window.confirm(startNew
      ? "Nejprve ověřit a zastavit původní pokus, potom spustit nový placený přepis? Audio a uložené přepisy zůstanou zachované. Běžící úlohu Soniox nelze zastavit."
      : "Zastavit původní pokus o přepis? Audio a uložené přepisy zůstanou zachované.")) return;
    const previous = recoveryRequestRef.current;
    manualRecoveryInFlightRef.current = true;
    const request = previous?.operationId === operationId && previous.action === action ? previous
      : { operationId, action, requestId: crypto.randomUUID() };
    recoveryRequestRef.current = request;
    setIsWorking(true);
    setRecoveryError(null);
    setMessage(action === "resume" ? "Dohledávám původní přepis v Sonioxu…" : "Ověřuji a zastavuji původní pokus…");
    try {
      const response = await fetch(`/api/recordings/${recordingId}/transcription/recover`, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request)
      });
      const payload = await response.json().catch(() => null) as { error?: string; message?: string; job?: { status?: string } } | null;
      if (requestScope !== scopeGenerationRef.current) return;
      if (!response.ok) { setRecoveryError(payload?.error ?? "Obnovu se nepodařilo ověřit. Nový přepis se nespustil."); return; }
      if (!payload?.job?.status || !["queued", "running", "failed"].includes(payload.job.status)) throw new Error("Unconfirmed recovery");
      recoveryRequestRef.current = null;
      setLastJobStatus(payload?.job?.status ?? "manual_required");
      lastJobStatusRef.current = payload?.job?.status ?? "manual_required";
      setMessage(payload?.message ?? "Stav původního přepisu je ověřený.");
      if (payload?.job?.status === "failed") {
        requestRef.current = null;
        if (startNew) { await callTranscriptionEndpoint("POST"); return; }
      }
      router.refresh();
    } catch { if (requestScope === scopeGenerationRef.current) setRecoveryError("Nepodařilo se potvrdit obnovu. Zkontrolujte stav před dalším pokusem; nový přepis se nespustil."); }
    finally { if (requestScope === scopeGenerationRef.current) { manualRecoveryInFlightRef.current = false; setIsWorking(false); } }
  }

  // Confirm a new paid transcription while retaining its saved transcript and historical outputs.
  function restartTranscription() {
    const confirmed = window.confirm(
      "Přepsat znovu? Vytvoří se nový Soniox job ze stejného audio souboru. Aktuální přepis zůstane uložený, dokud nový přepis úspěšně nedoběhne."
    );

    if (!confirmed) {
      return;
    }

    void callTranscriptionEndpoint("POST", { restart: true });
  }

  useEffect(() => {
    // Return keyboard focus to the open popup after its focused action was temporarily disabled.
    if (!isWorking && document.activeElement === document.body) {
      controlsRef.current?.querySelector<HTMLElement>("[role='dialog']")?.focus();
    }
  }, [isWorking]);

  useEffect(() => {
    if (!recordingId || !shouldPollTranscription) {
      return;
    }

    let isActive = true;

    // pollTranscription checks Soniox until the server stores the completed transcript.
    function pollTranscription() {
      if (isActive) {
        void callTranscriptionEndpoint("GET", { automatic: true });
      }
    }

    pollTranscription();
    const intervalId = window.setInterval(pollTranscription, AUTO_TRANSCRIPTION_POLL_MS);

    // pollWhenVisible catches up immediately after background tab throttling or window focus.
    function pollWhenVisible() {
      if (document.visibilityState === "visible") {
        pollTranscription();
      }
    }

    document.addEventListener("visibilitychange", pollWhenVisible);
    window.addEventListener("focus", pollWhenVisible);
    window.addEventListener("online", pollWhenVisible);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", pollWhenVisible);
      window.removeEventListener("focus", pollWhenVisible);
      window.removeEventListener("online", pollWhenVisible);
    };
  }, [callTranscriptionEndpoint, recordingId, shouldPollTranscription]);

  return (
    <div className={`transcription-controls${showRecovery || recoveryError ? " transcription-controls-recovery" : ""}`} aria-busy={isWorking} ref={controlsRef}>
      <div className="transcription-actions">
      {showRecovery ? <CompactPopover label={isBlocked ? "Vyřešit přepis" : "Možnosti přepisu"}
        className="transcription-recovery-popover" busy={isWorking}
        trigger={<><Sparkles aria-hidden="true" size={15} />{isBlocked ? "Vyřešit přepis" : "Možnosti přepisu"}<ChevronDown aria-hidden="true" size={15} /></>}>
        {isBlocked ? <>
          <section className="transcription-recovery-choice">
            <strong>1. Nejdřív dohledat původní pokus</strong>
            <p>Zjistíme, jestli Soniox přepis přijal. Pokud běží, navážeme na něj. Hotový výsledek načteme bez nového placeného pokusu.</p>
            <button className="command-button command-primary" disabled={isWorking} onClick={() => recoverTranscription("resume")} type="button"><Link2 aria-hidden="true" size={15} />Dohledat původní přepis</button>
          </section>
          <section className="transcription-recovery-choice">
            <strong>2. Když se původní přepis nenajde</strong>
            <p>Ověříme a uzavřeme starý pokus, potom spustíme nový placený přepis. Běžící nebo hotový přepis nejdřív dohledáme.</p>
            <button className="command-button" disabled={isWorking} onClick={() => recoverTranscription("stop", true)} type="button"><RotateCcw aria-hidden="true" size={15} />Spustit nový přepis</button>
          </section>
        </> : <p>Přepis čeká nebo běží. Stav kontrolujeme automaticky; kontrolu můžete spustit i ručně.</p>}
        <div className="transcription-recovery-secondary">
          <button className="command-button" disabled={isWorking} onClick={() => callTranscriptionEndpoint("GET")} type="button"><Link2 aria-hidden="true" size={15} />Zkontrolovat stav</button>
          <button className="command-button" disabled={isWorking} onClick={() => recoverTranscription("stop")} type="button"><Square aria-hidden="true" size={15} />Zastavit pokus</button>
        </div>
        <p>Zastavení pouze uzavře neúspěšný pokus, pokud se dá ověřit. Audio a uložený přepis zůstanou zachované.</p>
        {isWorking ? <p role="status">{message}</p> : recoveryError ? <p className="transcription-recovery-error">{recoveryError}</p> : null}
      </CompactPopover> : null}
      {!hasTranscript && !showRecovery && !isBlocked ? (
        <button
          className="command-button command-primary"
          disabled={!canStart || isWorking}
          onClick={() => callTranscriptionEndpoint("POST")}
          type="button"
        >
          <Sparkles aria-hidden="true" size={15} />
          <span className="transcription-action-label">
            <span aria-hidden={isWorking}>Spustit přepis</span>
            <span aria-hidden={!isWorking}>Pracuji…</span>
          </span>
        </button>
      ) : null}
      {hasTranscript && !showRecovery ? (
        <button
          className="command-button command-warning"
          disabled={!canRestart || isWorking}
          onClick={restartTranscription}
          title={hasTranscribableAudio
            ? "Vytvořit nový Soniox job a původní přepis nahradit až po úspěšném doběhnutí."
            : "Tento přepis nemá uložené audio, takže ho nejde dopočítat znovu."}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} />
          <span className="transcription-action-label">
            <span aria-hidden={isWorking}>Přepsat znovu</span>
            <span aria-hidden={!isWorking}>Pracuji…</span>
          </span>
        </button>
      ) : null}
        {!showRecovery ? <button
          aria-hidden={!canCheck}
          className="command-button transcription-check-action"
          disabled={!canCheck || isWorking}
          inert={!canCheck}
          onClick={() => callTranscriptionEndpoint("GET")}
          type="button"
        >
          <Link2 aria-hidden="true" size={15} />
          Zkontrolovat přepis
        </button> : null}
      </div>
      <div className="transcription-feedback">
      {shouldPollTranscription && !isBlocked ? (
        <p className="command-state command-state-live">
          {lastJobStatus === "queued" ? "Přepis čeká na zpracování." : "Přepis se zpracovává na pozadí."}{" "}
          {isAutoChecking
            ? "Právě kontroluji stav..."
            : lastCheckedAt
              ? `Poslední kontrola ${lastCheckedAt}.`
              : "Kontrola se spustí automaticky."}
        </p>
      ) : null}
      {lastJobStatus && !isBlocked ? (
        <p className="command-state">Stav přepisu: {getJobStatusLabel(lastJobStatus)}.</p>
      ) : null}
      {isBlocked ? <p className="command-state" role="status">Přepis je zablokovaný. Původní pokus zatím není potvrzený; nový placený přepis se nespustil.</p> : null}
      {recoveryError ? <p className="command-state transcription-recovery-error" role="alert">{recoveryError}</p>
        : message && !isBlocked ? <p aria-live="polite" className="command-state" role="status">{message}</p> : null}
      {storedAudioMode === "segments" && !shouldPollTranscription ? (
        <p className="command-state">
          Tahle live nahrávka je uložená po částech. Přepis z audia se spouští jako dávka segmentů.
        </p>
      ) : null}
      </div>
    </div>
  );
}
