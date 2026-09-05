"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  getEmptyLoadedManualAiState,
  mergeLoadedManualAiOutput,
  mergeManualAiState,
  type LoadedManualAiState,
  type ManualAiJobStatus,
  type ManualAiStateSnapshot
} from "@/lib/ai/manual-job-state";
import { getManualAiPollIntervalMs } from "@/lib/ai/manual-route-runtime";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";

export type AiStatePurpose = "ai" | "metadata" | "timeline";
type ExactOutputPayload = { output: AiOutputView; structuredItems: StructuredAiItems };
const OUTPUT_BODY_LOAD_CONCURRENCY = 8;

export type TranscriptAiStateContextValue = LoadedManualAiState & {
  acceptJob: (job: { id: string; status: ManualAiJobStatus }, processingType: string) => void;
  error: string | null;
  isLoaded: boolean;
  isLoading: boolean;
  loadAllOutputs: () => Promise<Pick<LoadedManualAiState, "loadedOutputs" | "structuredItems"> | null>;
  loadForPurpose: (purpose: AiStatePurpose) => Promise<void>;
  loadOutput: (outputId: string) => Promise<ExactOutputPayload | null>;
  setActivePurpose: (purpose: "ai" | "timeline" | null) => void;
  stateRevision: number;
};

const TranscriptAiStateContext = createContext<TranscriptAiStateContextValue | null>(null);
const EMPTY_AI_OUTPUTS: AiOutputView[] = [];

// TranscriptAiStateProvider keeps lazy manual job and output state shared by detail tabs and export.
export function TranscriptAiStateProvider({
  children,
  initialAiOutputs = EMPTY_AI_OUTPUTS,
  initialStructuredItems,
  transcriptId
}: {
  children?: ReactNode;
  initialAiOutputs?: AiOutputView[];
  initialStructuredItems?: StructuredAiItems;
  transcriptId: string | null;
}) {
  const initialState = useMemo(() => createInitialState(initialAiOutputs, initialStructuredItems), [initialAiOutputs, initialStructuredItems]);
  const [state, setState] = useState<LoadedManualAiState>(initialState);
  const [isLoaded, setIsLoaded] = useState(initialAiOutputs.length > 0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const scopeRef = useRef({ generation: 0, transcriptId: null as string | null });
  const stateRequestRef = useRef<Promise<ManualAiStateSnapshot | null> | null>(null);
  const outputRequestsRef = useRef(new Map<string, Promise<ExactOutputPayload | null>>());
  const [activePurpose, setActivePurpose] = useState<"ai" | "timeline" | null>(null);
  const [stateRevision, setStateRevision] = useState(0);

  // replaceState keeps the synchronous ref and React snapshot consistent for chained lazy loads.
  const replaceState = useCallback((next: LoadedManualAiState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // invalidateState fences old responses and notifies active tabs when server props replace their cache.
  useLayoutEffect(() => {
    scopeRef.current = { generation: scopeRef.current.generation + 1, transcriptId };
    stateRequestRef.current = null;
    outputRequestsRef.current.clear();
    setActivePurpose(null);
    const next = createInitialState(initialAiOutputs, initialStructuredItems);
    stateRef.current = next;
    setState(next);
    setIsLoaded(initialAiOutputs.length > 0);
    setIsLoading(false);
    setError(null);
    setStateRevision((revision) => revision + 1);

    return () => {
      if (scopeRef.current.transcriptId === transcriptId) {
        scopeRef.current = { generation: scopeRef.current.generation + 1, transcriptId: null };
      }
    };
  }, [initialAiOutputs, initialStructuredItems, transcriptId]);

  // loadOutput fetches one exact artifact body and only its normalized rows.
  const loadOutput = useCallback(async (outputId: string) => {
    const scope = scopeRef.current;
    if (!transcriptId || scope.transcriptId !== transcriptId) return null;
    const existing = stateRef.current.loadedOutputs.find((output) => output.id === outputId);
    if (existing) return { output: existing, structuredItems: stateRef.current.structuredItems };
    const pending = outputRequestsRef.current.get(outputId);
    if (pending) return pending;

    const request = (async () => {
      try {
        const response = await fetch(`/api/ai-outputs/${outputId}?transcriptId=${encodeURIComponent(transcriptId)}`, {
          cache: "no-store"
        });
        const payload = await response.json().catch(() => null) as ExactOutputPayload | null;
        if (!response.ok || !payload?.output || !payload.structuredItems) return null;
        if (scopeRef.current.generation !== scope.generation || scopeRef.current.transcriptId !== transcriptId) return null;
        replaceState(mergeLoadedManualAiOutput(stateRef.current, payload.output, payload.structuredItems));
        return payload;
      } finally {
        if (scopeRef.current.generation === scope.generation) outputRequestsRef.current.delete(outputId);
      }
    })();
    outputRequestsRef.current.set(outputId, request);
    return request;
  }, [replaceState, transcriptId]);

  // refreshMetadata deduplicates one owner-scoped state request and merges it into current hydration.
  const refreshMetadata = useCallback(async () => {
    const scope = scopeRef.current;
    if (!transcriptId || scope.transcriptId !== transcriptId) return null;
    if (stateRequestRef.current) return stateRequestRef.current;
    setIsLoading(true);
    const request = (async () => {
      try {
        const response = await fetch(`/api/transcripts/${transcriptId}/ai-state`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as ManualAiStateSnapshot | null;
        if (!response.ok || !payload || !Array.isArray(payload.jobs) || !Array.isArray(payload.outputs)) {
          throw new Error("invalid_state");
        }
        if (scopeRef.current.generation !== scope.generation || scopeRef.current.transcriptId !== transcriptId) return null;
        const metadata = {
          ...mergeManualAiState(stateRef.current, payload),
          nextOutputOffset: payload.nextOutputOffset ?? null
        };
        replaceState({ ...stateRef.current, ...metadata });
        setIsLoaded(true);
        setError(null);
        return metadata;
      } catch {
        if (scopeRef.current.generation === scope.generation) setError("AI stav se nepodařilo načíst.");
        return null;
      } finally {
        if (scopeRef.current.generation === scope.generation) {
          setIsLoading(false);
          stateRequestRef.current = null;
        }
      }
    })();
    stateRequestRef.current = request;
    return request;
  }, [replaceState, transcriptId]);

  // hydratePurpose loads only the newest body needed by the visible AI or timeline surface.
  const hydratePurpose = useCallback(async (purpose: AiStatePurpose, metadata?: ManualAiStateSnapshot | null) => {
    if (purpose === "metadata") return;
    const outputs = metadata?.outputs ?? stateRef.current.outputs;
    const target = purpose === "timeline"
      ? outputs.find((output) => output.processing_type === "timeline_chapters")
      : outputs[0];
    if (target) await loadOutput(target.id);
  }, [loadOutput]);

  // loadForPurpose marks a lazy consumer and hydrates only its default-open body.
  const loadForPurpose = useCallback(async (purpose: AiStatePurpose) => {
    const scope = scopeRef.current;
    const metadata = await refreshMetadata();
    if (scopeRef.current.generation !== scope.generation) return;
    await hydratePurpose(purpose, metadata);
  }, [hydratePurpose, refreshMetadata]);

  // loadAllOutputs hydrates every artifact only for an explicitly AI-inclusive export.
  const loadAllOutputs = useCallback(async () => {
    const metadata = await refreshMetadata();
    if (!metadata) return null;
    const scope = scopeRef.current;
    let nextOutputOffset = metadata.nextOutputOffset ?? null;

    while (nextOutputOffset !== null) {
      const response = await fetch(
        `/api/transcripts/${transcriptId}/ai-state?outputOffset=${nextOutputOffset}`,
        { cache: "no-store" }
      );
      const payload = await response.json().catch(() => null) as ManualAiStateSnapshot | null;
      if (!response.ok || !payload || !Array.isArray(payload.jobs) || !Array.isArray(payload.outputs)) return null;
      if (scopeRef.current.generation !== scope.generation || scopeRef.current.transcriptId !== transcriptId) return null;
      const merged = mergeManualAiState(stateRef.current, payload);
      replaceState({ ...stateRef.current, ...merged });
      const followingOffset = payload.nextOutputOffset ?? null;
      if (followingOffset !== null && followingOffset <= nextOutputOffset) return null;
      nextOutputOffset = followingOffset;
    }

    const outputs = stateRef.current.outputs;
    for (let index = 0; index < outputs.length; index += OUTPUT_BODY_LOAD_CONCURRENCY) {
      const loaded = await Promise.all(
        outputs.slice(index, index + OUTPUT_BODY_LOAD_CONCURRENCY).map((output) => loadOutput(output.id))
      );
      if (loaded.some((payload) => !payload)) return null;
    }
    return { loadedOutputs: stateRef.current.loadedOutputs, structuredItems: stateRef.current.structuredItems };
  }, [loadOutput, refreshMetadata, replaceState, transcriptId]);

  // acceptJob merges the server-accepted durable identity without inventing success output.
  const acceptJob = useCallback((job: { id: string; status: ManualAiJobStatus }, processingType: string) => {
    if (!transcriptId) return;
    const now = new Date().toISOString();
    const metadata = mergeManualAiState(stateRef.current, {
      jobs: [{
        attempt_count: 0,
        completed_at: null,
        created_at: now,
        failure_code: null,
        id: job.id,
        lease_expires_at: null,
        max_attempts: 1,
        model: "",
        processing_type: processingType,
        retry_after_at: null,
        started_at: null,
        status: job.status
      }],
      outputs: []
    });
    replaceState({ ...stateRef.current, ...metadata });
    setIsLoaded(true);
  }, [replaceState, transcriptId]);

  const hasActiveJobs = state.jobs.some((job) => job.status === "queued" || job.status === "running");

  useEffect(() => {
    if (!transcriptId || !isLoaded || !activePurpose || !hasActiveJobs) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cycleInFlight = false;
    let catchupPending = false;
    let transientBackoffUntil = 0;
    let disposed = false;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const isEligible = () => document.visibilityState !== "hidden" && navigator.onLine;
    const currentActiveJobs = () => stateRef.current.jobs.filter((job) => job.status === "queued" || job.status === "running");

    // schedulePoll derives cadence from persisted age and pauses while hidden, offline or inactive.
    const schedulePoll = (transientError = false) => {
      if (disposed || !isEligible()) return;
      const activeJobs = currentActiveJobs();
      if (activeJobs.length === 0) return;
      clearTimer();
      const youngestStartedAt = Math.max(...activeJobs.map((job) => Date.parse(job.started_at ?? job.created_at)));
      const ageMs = Math.max(0, Date.now() - youngestStartedAt);
      timer = setTimeout(async () => {
        timer = null;
        await runCycle();
      }, getManualAiPollIntervalMs(ageMs, transientError));
    };

    // runCycle is the sole continuation owner for an immediate catch-up or the next cadence timer.
    const runCycle = async () => {
      if (disposed || !isEligible()) return;
      if (cycleInFlight) {
        catchupPending = true;
        return;
      }
      cycleInFlight = true;
      let metadata: ManualAiStateSnapshot | null = null;
      try {
        metadata = await refreshMetadata();
        await hydratePurpose(activePurpose, metadata);
      } catch {
        metadata = null;
      } finally {
        cycleInFlight = false;
      }
      if (disposed || !isEligible() || currentActiveJobs().length === 0) return;
      if (metadata === null) {
        catchupPending = false;
        transientBackoffUntil = Date.now() + 30_000;
        schedulePoll(true);
        return;
      }
      transientBackoffUntil = 0;
      if (catchupPending) {
        catchupPending = false;
        queueMicrotask(async () => runCycle());
        return;
      }
      schedulePoll();
    };

    // catchUpOnce coalesces focus, visibility and online bursts, including while one poll is in flight.
    const catchUpOnce = () => {
      if (disposed || !isEligible()) return;
      if (Date.now() < transientBackoffUntil) {
        schedulePoll(true);
        return;
      }
      clearTimer();
      if (cycleInFlight) {
        catchupPending = true;
        return;
      }
      if (catchupPending) return;
      catchupPending = true;
      queueMicrotask(async () => {
        if (disposed) return;
        catchupPending = false;
        await runCycle();
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
      } else {
        catchUpOnce();
      }
    };
    const handleOnline = () => catchUpOnce();
    const handleOffline = () => {
      clearTimer();
    };
    window.addEventListener("focus", catchUpOnce);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    schedulePoll();
    return () => {
      disposed = true;
      clearTimer();
      window.removeEventListener("focus", catchUpOnce);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activePurpose, hasActiveJobs, hydratePurpose, isLoaded, refreshMetadata, transcriptId]);

  const value = useMemo<TranscriptAiStateContextValue>(() => ({
    ...state,
    acceptJob,
    error,
    isLoaded,
    isLoading,
    loadAllOutputs,
    loadForPurpose,
    loadOutput,
    setActivePurpose,
    stateRevision
  }), [acceptJob, error, isLoaded, isLoading, loadAllOutputs, loadForPurpose, loadOutput, state, stateRevision]);

  // The callbacks read refs only after user/effect invocation; createElement does not execute them during render.
  // eslint-disable-next-line react-hooks/refs
  return createElement(TranscriptAiStateContext.Provider, { value }, children);
}

// useTranscriptAiState reads the recording-detail provider and fails fast outside its owner boundary.
export function useTranscriptAiState() {
  const value = useContext(TranscriptAiStateContext);
  if (!value) throw new Error("useTranscriptAiState must be used inside TranscriptAiStateProvider");
  return value;
}

// useOptionalTranscriptAiState lets isolated development fixtures keep their explicit static AI props.
export function useOptionalTranscriptAiState() {
  return useContext(TranscriptAiStateContext);
}

// createInitialState adapts optional fixture/server data while production detail starts empty.
function createInitialState(aiOutputs: AiOutputView[], structuredItems?: StructuredAiItems): LoadedManualAiState {
  const state = getEmptyLoadedManualAiState();
  return {
    ...state,
    loadedOutputs: [...aiOutputs],
    outputs: aiOutputs.map((output) => ({
      body_loaded: true,
      created_at: output.created_at,
      id: output.id,
      processing_job_id: output.processing_job_id,
      processing_type: output.processing_type,
      transcript_id: output.transcript_id
    })),
    structuredItems: structuredItems ?? state.structuredItems
  };
}
