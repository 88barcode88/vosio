"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ManualAiJobStatus } from "@/lib/ai/manual-job-state";

export type AiProcessingType =
  | "summary"
  | "action_items"
  | "meeting_minutes"
  | "crm_note"
  | "follow_up_email"
  | "timeline_chapters";

export type AiProcessingRunInput = {
  model: string;
  processingType: AiProcessingType;
};

type ActiveAiRun = AiProcessingRunInput & { id: string };

type AiProcessingState = {
  activeRuns: ActiveAiRun[];
  message: string | null;
  transcriptId: string | null;
};

// getAiProcessingRunError returns only server-approved public copy or a fixed fallback.
export function getAiProcessingRunError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "Nepodařilo se spustit AI zpracování.";
  }

  const candidate = payload as { error?: unknown };
  return typeof candidate.error === "string" && candidate.error.length <= 180
    ? candidate.error
    : "Nepodařilo se spustit AI zpracování.";
}

// useAiProcessingRun owns parallel acceptance requests without cancelling potentially accepted jobs.
export function useAiProcessingRun(
  transcriptId: string | null,
  onAccepted?: (job: { id: string; status: ManualAiJobStatus }, processingType: AiProcessingType) => void
) {
  const [state, setState] = useState<AiProcessingState>({ activeRuns: [], message: null, transcriptId });
  const messageOwnerRef = useRef<string | null>(null);
  const scopeRef = useRef({ generation: 0, transcriptId: null as string | null });
  const currentState = state.transcriptId === transcriptId
    ? state
    : { activeRuns: [], message: null, transcriptId };

  useLayoutEffect(() => {
    const generation = scopeRef.current.generation + 1;
    scopeRef.current = { generation, transcriptId };
    messageOwnerRef.current = null;

    return () => {
      if (scopeRef.current.generation !== generation) {
        return;
      }
      scopeRef.current = { generation: generation + 1, transcriptId: null };
      messageOwnerRef.current = null;
    };
  }, [transcriptId]);

  // run posts one identity-tracked request while allowing parallel runs of any processing type.
  async function run(input: AiProcessingRunInput) {
    const scope = scopeRef.current;
    if (!transcriptId || scope.transcriptId !== transcriptId) {
      return false;
    }

    const runId = crypto.randomUUID();
    messageOwnerRef.current = runId;
    setState((current) => {
      const scoped = current.transcriptId === transcriptId
        ? current
        : { activeRuns: [], message: null, transcriptId };
      return {
        activeRuns: [...scoped.activeRuns, { ...input, id: runId }],
        message: "AI generuje výstup…",
        transcriptId
      };
    });

    // ownsCurrentScope prevents an old transcript request from mutating the newly mounted identity.
    const ownsCurrentScope = () => scopeRef.current.generation === scope.generation
      && scopeRef.current.transcriptId === transcriptId;

    // setOwnedMessage keeps shared copy bound to the most recently started run in this scope.
    const setOwnedMessage = (message: string) => {
      if (!ownsCurrentScope() || messageOwnerRef.current !== runId) {
        return;
      }
      setState((current) => current.transcriptId === transcriptId
        ? { ...current, message }
        : current);
    };

    try {
      const response = await postManualAiRequest(transcriptId, input, runId);
      const payload = await response.json().catch(() => null) as unknown;

      if (!ownsCurrentScope()) {
        return false;
      }

      if (!response.ok) {
        setOwnedMessage(getAiProcessingRunError(payload));
        return false;
      }

      const accepted = payload as { job?: { id?: unknown; status?: unknown } };
      if (
        typeof accepted.job?.id !== "string"
        || !["queued", "running", "done", "failed"].includes(String(accepted.job.status))
      ) {
        setOwnedMessage("Server nepotvrdil AI zpracování.");
        return false;
      }
      const acceptedJob = { id: accepted.job.id, status: accepted.job.status as ManualAiJobStatus };
      onAccepted?.(acceptedJob, input.processingType);
      setOwnedMessage("AI požadavek je přijatý a pokračuje na serveru.");
      return true;
    } catch {
      setOwnedMessage("Nepodařilo se spojit se serverem pro AI zpracování.");
      return false;
    } finally {
      if (ownsCurrentScope()) {
        setState((current) => current.transcriptId === transcriptId
          ? {
              ...current,
              activeRuns: current.activeRuns.filter((activeRun) => activeRun.id !== runId)
            }
          : current);
      }
    }
  }

  return {
    activeRuns: currentState.activeRuns,
    isRunning: (processingType: AiProcessingType) => currentState.activeRuns.some(
      (activeRun) => activeRun.processingType === processingType
    ),
    message: currentState.message,
    run
  };
}

// postManualAiRequest reuses one UUID for a single transport retry and keeps the request alive across navigation.
async function postManualAiRequest(transcriptId: string, input: AiProcessingRunInput, requestId: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(`/api/transcripts/${transcriptId}/process`, {
        body: JSON.stringify({ ...input, requestId }),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST"
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
