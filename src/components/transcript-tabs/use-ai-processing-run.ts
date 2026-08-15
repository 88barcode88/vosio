"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

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

// useAiProcessingRun owns parallel AI request indicators and refreshes persisted output after success.
export function useAiProcessingRun(transcriptId: string | null) {
  const router = useRouter();
  const [state, setState] = useState<AiProcessingState>({ activeRuns: [], message: null, transcriptId });
  const controllersRef = useRef(new Map<string, AbortController>());
  const messageOwnerRef = useRef<string | null>(null);
  const scopeRef = useRef({ generation: 0, transcriptId: null as string | null });
  const currentState = state.transcriptId === transcriptId
    ? state
    : { activeRuns: [], message: null, transcriptId };

  useLayoutEffect(() => {
    const generation = scopeRef.current.generation + 1;
    const controllers = controllersRef.current;
    scopeRef.current = { generation, transcriptId };
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    messageOwnerRef.current = null;

    return () => {
      if (scopeRef.current.generation !== generation) {
        return;
      }
      scopeRef.current = { generation: generation + 1, transcriptId: null };
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
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
    const controller = new AbortController();
    controllersRef.current.set(runId, controller);
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
      && scopeRef.current.transcriptId === transcriptId
      && !controller.signal.aborted;

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
      const response = await fetch(`/api/transcripts/${transcriptId}/process`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null) as unknown;

      if (!ownsCurrentScope()) {
        return false;
      }

      if (!response.ok) {
        setOwnedMessage(getAiProcessingRunError(payload));
        return false;
      }

      setOwnedMessage("AI výstup je uložený v Supabase.");
      router.refresh();
      return true;
    } catch {
      setOwnedMessage("Nepodařilo se spojit se serverem pro AI zpracování.");
      return false;
    } finally {
      if (controllersRef.current.get(runId) === controller) {
        controllersRef.current.delete(runId);
      }
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
