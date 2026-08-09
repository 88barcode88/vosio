"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, RotateCcw, Sparkles } from "lucide-react";
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
  };
  reused?: boolean;
  transcript?: {
    id?: string;
    text?: string;
  };
  warnings?: unknown;
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
    running: "běží"
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
      ? "Soniox job už existuje. Stav se bude kontrolovat automaticky."
      : "Soniox job je založený a běží na pozadí.";
  }

  const status = payload?.job?.status;

  if (status === "done" || payload?.transcript) {
    return "Přepis je hotový. Načítám uložený transcript.";
  }

  if (status === "failed") {
    return "Soniox přepis selhal. Zkuste přepis spustit znovu.";
  }

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
  const autoPollInFlightRef = useRef(false);
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastJobStatus, setLastJobStatus] = useState<string | null>(null);
  const canUseRecording = Boolean(recordingId);
  const hasTranscribableAudio = storedAudioMode !== "none";
  const isTranscribing = recordingStatus === "transcribing";
  const shouldPollTranscription = isTranscribing || isRunningJobStatus(lastJobStatus);
  const canStart =
    canUseRecording &&
    hasTranscribableAudio &&
    !hasTranscript &&
    (recordingStatus === "uploaded" || recordingStatus === "failed" || recordingStatus === "completed");
  const canRestart = canUseRecording && hasTranscript && hasTranscribableAudio;
  const canCheck = canUseRecording && shouldPollTranscription;

  // callTranscriptionEndpoint invokes the recording transcription route and refreshes data.
  const callTranscriptionEndpoint = useCallback(async (
    method: "GET" | "POST",
    options: TranscriptionCallOptions = {}
  ) => {
    if (!recordingId) {
      return;
    }

    if (options.automatic && autoPollInFlightRef.current) {
      return;
    }

    if (options.automatic) {
      autoPollInFlightRef.current = true;
      setIsAutoChecking(true);
    } else {
      setIsWorking(true);
      setMessage(options.restart
        ? "Zakládám nový Soniox job. Původní přepis zůstane uložený, dokud nový nedoběhne."
        : method === "POST"
          ? "Zakládám Soniox job..."
          : "Kontroluji stav přepisu...");
    }

    try {
      const url = options.restart
        ? `/api/recordings/${recordingId}/transcription?restart=1`
        : `/api/recordings/${recordingId}/transcription`;
      const response = await fetch(url, {
        cache: "no-store",
        method
      });
      const payload = (await response.json().catch(() => null)) as TranscriptionEndpointPayload | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Přepis se nepovedlo zpracovat.");
        return;
      }

      setLastCheckedAt(formatCheckTime(new Date()));
      setLastJobStatus(payload?.job?.status ?? null);
      setMessage(hasTranscriptSearchIndexWarning(payload)
        ? TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE
        : options.restart
          ? "Nový Soniox job běží na pozadí. Původní přepis se nahradí až po úspěšném doběhnutí."
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
      setMessage("Nepodařilo se spojit se serverem pro přepis.");
    } finally {
      if (options.automatic) {
        autoPollInFlightRef.current = false;
        setIsAutoChecking(false);
      } else {
        setIsWorking(false);
      }
    }
  }, [recordingId, router]);

  // restartTranscription confirms replacement before deleting the saved transcript and AI outputs.
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

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [callTranscriptionEndpoint, recordingId, shouldPollTranscription]);

  return (
    <>
      {!hasTranscript ? (
        <button
          className="command-button command-primary"
          disabled={!canStart || isWorking}
          onClick={() => callTranscriptionEndpoint("POST")}
          type="button"
        >
          <Sparkles size={18} />
          {isWorking ? "Pracuji..." : "Spustit přepis"}
        </button>
      ) : null}
      {hasTranscript ? (
        <button
          className="command-button command-warning"
          disabled={!canRestart || isWorking}
          onClick={restartTranscription}
          title={hasTranscribableAudio
            ? "Vytvořit nový Soniox job a původní přepis nahradit až po úspěšném doběhnutí."
            : "Tento přepis nemá uložené audio, takže ho nejde dopočítat znovu."}
          type="button"
        >
          <RotateCcw size={18} />
          Přepsat znovu
        </button>
      ) : null}
      {shouldPollTranscription ? (
        <button
          className="command-button"
          disabled={!canCheck || isWorking}
          onClick={() => callTranscriptionEndpoint("GET")}
          type="button"
        >
          <Link2 size={18} />
          Zkontrolovat přepis
        </button>
      ) : null}
      {shouldPollTranscription ? (
        <p className="command-state command-state-live">
          Soniox zpracovává přepis na pozadí.{" "}
          {isAutoChecking
            ? "Právě kontroluji stav..."
            : lastCheckedAt
              ? `Poslední kontrola ${lastCheckedAt}.`
              : "Kontrola se spustí automaticky."}
        </p>
      ) : null}
      {lastJobStatus ? (
        <p className="command-state">Stav Soniox jobu: {getJobStatusLabel(lastJobStatus)}.</p>
      ) : null}
      {message ? <p aria-live="polite" className="command-state" role="status">{message}</p> : null}
      {storedAudioMode === "segments" && !shouldPollTranscription ? (
        <p className="command-state">
          Tahle live nahrávka je uložená po částech. Přepis z audia se spouští jako dávka segmentů.
        </p>
      ) : null}
    </>
  );
}
