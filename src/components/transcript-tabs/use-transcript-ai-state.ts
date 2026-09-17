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
  applyManualAiCleanupMutation,
  mergeLoadedManualAiOutput,
  mergeManualAiState,
  removeManualAiOutputs,
  type LoadedManualAiState,
  type ManualAiJobStatus,
  type ManualAiStateSnapshot
} from "@/lib/ai/manual-job-state";
import type { ManualAiCleanupMutationResponse } from "@/lib/ai/manual-job-cleanup-contract";
import { dedupeStructuredAiItems, getTaskDedupeKey } from "@/lib/ai/structured-dedupe";
import { getManualAiPollIntervalMs } from "@/lib/ai/manual-route-runtime";
import type { StructuredAiItems, StructuredTaskRow } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";

export type AiStatePurpose = "ai" | "metadata" | "timeline";
type ExactOutputPayload = { output: AiOutputView; structuredItems: StructuredAiItems };
const OUTPUT_BODY_LOAD_CONCURRENCY = 8;

export type TranscriptAiStateContextValue = LoadedManualAiState & {
  acceptJob: (job: { id: string; status: ManualAiJobStatus }, processingType: string) => void;
  applyCleanupMutation: (mutation: ManualAiCleanupMutationResponse) => void;
  confirmTaskDeletion: (task: StructuredTaskRow) => void;
  confirmTaskStatus: (task: StructuredTaskRow, status: StructuredTaskRow["status"]) => void;
  error: string | null;
  isLoaded: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  loadAllOutputs: () => Promise<Pick<LoadedManualAiState, "loadedOutputs" | "structuredItems"> | null>;
  loadForPurpose: (purpose: AiStatePurpose) => Promise<void>;
  loadOutput: (outputId: string) => Promise<ExactOutputPayload | null>;
  removeOutputs: (outputIds: string[]) => void;
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const scopeRef = useRef({ generation: 0, transcriptId: null as string | null });
  const stateRequestRef = useRef<Promise<ManualAiStateSnapshot | null> | null>(null);
  const outputRequestsRef = useRef(new Map<string, Promise<ExactOutputPayload | null>>());
  const outputTombstonesRef = useRef(new Set<string>());
  const jobTombstonesRef = useRef(new Set<string>());
  const taskDeletionTombstonesRef = useRef(new Set<string>());
  const taskStatusOverridesRef = useRef(new Map<string, StructuredTaskRow["status"]>());
  const isLoadedRef = useRef(initialAiOutputs.length > 0);
  const lastCompletedCheckRef = useRef(0);
  const serverPropsRef = useRef({ initialAiOutputs, initialStructuredItems });
  const [activePurpose, setActivePurpose] = useState<"ai" | "timeline" | null>(null);
  const [stateRevision, setStateRevision] = useState(0);

  // replaceState keeps the synchronous ref and React snapshot consistent for chained lazy loads.
  const replaceState = useCallback((next: LoadedManualAiState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // resetTranscriptScope fences old responses only when the durable transcript identity changes.
  useLayoutEffect(() => {
    const generation = scopeRef.current.generation + 1;
    scopeRef.current = { generation, transcriptId };
    stateRequestRef.current = null;
    outputRequestsRef.current.clear();
    outputTombstonesRef.current.clear();
    jobTombstonesRef.current.clear();
    taskDeletionTombstonesRef.current.clear();
    taskStatusOverridesRef.current.clear();
    setActivePurpose(null);
    const next = createInitialState(initialAiOutputs, initialStructuredItems);
    stateRef.current = next;
    setState(next);
    isLoadedRef.current = initialAiOutputs.length > 0;
    setIsLoaded(isLoadedRef.current);
    setIsLoading(false);
    setIsRefreshing(false);
    setError(null);
    lastCompletedCheckRef.current = 0;
    setStateRevision((revision) => revision + 1);

    return () => {
      if (scopeRef.current.generation === generation) {
        scopeRef.current = { generation: scopeRef.current.generation + 1, transcriptId: null };
      }
    };
    // Server props intentionally do not invalidate a same-transcript client cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptId]);

  // reconcileServerProps merges same-transcript RSC props without clearing mounted output or task UI.
  useEffect(() => {
    const previous = serverPropsRef.current;
    serverPropsRef.current = { initialAiOutputs, initialStructuredItems };
    if (previous.initialAiOutputs === initialAiOutputs && previous.initialStructuredItems === initialStructuredItems) return;
    if (scopeRef.current.transcriptId !== transcriptId) return;
    replaceState(applyClientGuards(
      mergeInitialManualAiState(stateRef.current, createInitialState(initialAiOutputs, initialStructuredItems)),
      outputTombstonesRef.current,
      jobTombstonesRef.current,
      taskDeletionTombstonesRef.current,
      taskStatusOverridesRef.current
    ));
    setStateRevision((revision) => revision + 1);
  }, [initialAiOutputs, initialStructuredItems, replaceState, transcriptId]);

  // loadOutput fetches one exact artifact body and only its normalized rows.
  const loadOutput = useCallback(async (outputId: string) => {
    const scope = scopeRef.current;
    const completionGeneration = stateRef.current.automaticGenerationKey;
    if (!transcriptId || scope.transcriptId !== transcriptId) return null;
    if (outputTombstonesRef.current.has(outputId)) return null;
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
        if (stateRef.current.automaticGenerationKey !== completionGeneration) return null;
        if (scopeRef.current.generation !== scope.generation || scopeRef.current.transcriptId !== transcriptId) return null;
        if (outputTombstonesRef.current.has(outputId)) return null;
        replaceState(applyClientGuards(
          mergeLoadedManualAiOutput(stateRef.current, payload.output, payload.structuredItems),
          outputTombstonesRef.current,
          jobTombstonesRef.current,
          taskDeletionTombstonesRef.current,
          taskStatusOverridesRef.current
        ));
        return payload;
      } finally {
        if (scopeRef.current.generation === scope.generation) outputRequestsRef.current.delete(outputId);
      }
    })();
    outputRequestsRef.current.set(outputId, request);
    return request;
  }, [replaceState, transcriptId]);

  // mergeMetadata clears hydrated bodies and projections whenever accepted metadata changes generation.
  const mergeMetadata = useCallback((payload: ManualAiStateSnapshot) => {
    const generationChanged = payload.automaticGenerationKey !== undefined && stateRef.current.automaticGenerationKey !== undefined
      && payload.automaticGenerationKey !== stateRef.current.automaticGenerationKey;
    const metadata = applyClientGuards({
      ...mergeManualAiState(stateRef.current, {
        ...payload,
        classifications: payload.classifications ?? [],
        cleanup: payload.cleanup ?? { eligible_count: 0, next_cursor: null }
      }),
      loadedOutputs: generationChanged ? [] : stateRef.current.loadedOutputs,
      structuredItems: generationChanged ? { tasks: [], chapters: [], decisions: [], risks: [] } : stateRef.current.structuredItems,
      nextOutputOffset: payload.nextOutputOffset ?? null
    } as LoadedManualAiState,
    outputTombstonesRef.current,
    jobTombstonesRef.current,
    taskDeletionTombstonesRef.current,
    taskStatusOverridesRef.current);
    replaceState(metadata);
    return metadata;
  }, [replaceState]);

  // refreshMetadata deduplicates one owner-scoped state request and merges it into current hydration.
  const refreshMetadata = useCallback(async () => {
    const scope = scopeRef.current;
    if (!transcriptId || scope.transcriptId !== transcriptId) return null;
    if (stateRequestRef.current) return stateRequestRef.current;
    const completionGeneration = stateRef.current.automaticGenerationKey;
    const initialLoad = !isLoadedRef.current;
    if (initialLoad) setIsLoading(true);
    else setIsRefreshing(true);
    const request = (async () => {
      try {
        const response = await fetch(`/api/transcripts/${transcriptId}/ai-state`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as ManualAiStateSnapshot | null;
        if (!response.ok || !payload || !Array.isArray(payload.jobs) || !Array.isArray(payload.outputs)) {
          throw new Error("invalid_state");
        }
        if (scopeRef.current.generation !== scope.generation || scopeRef.current.transcriptId !== transcriptId
          || stateRef.current.automaticGenerationKey !== completionGeneration) return null;
        const eligible = new Set((payload.classifications ?? []).filter((item) => item.poll_eligible).map((item) => item.job_id));
        if (payload.jobs.some((job) => job.execution_mode === "automatic" && eligible.has(job.id)
          && (job.status === "queued" || job.status === "failed"
            || (job.status === "running" && Date.parse(job.lease_expires_at ?? "") <= Date.now())))) {
          // Recovery POST can restore/claim persisted intents; the metadata GET never calls a provider.
          await fetch(`/api/transcripts/${transcriptId}/automatic-timeline`, { method: "POST" }).catch(() => null);
          if (scopeRef.current.generation !== scope.generation || scopeRef.current.transcriptId !== transcriptId
            || stateRef.current.automaticGenerationKey !== completionGeneration) return null;
        }
        const metadata = mergeMetadata(payload);
        isLoadedRef.current = true;
        setIsLoaded(true);
        setError(null);
        return metadata;
      } catch {
        if (scopeRef.current.generation === scope.generation) setError("AI stav se nepodařilo načíst.");
        return null;
      } finally {
        if (scopeRef.current.generation === scope.generation) {
          setIsLoading(false);
          setIsRefreshing(false);
          stateRequestRef.current = null;
          lastCompletedCheckRef.current = Date.now();
        }
      }
    })();
    stateRequestRef.current = request;
    return request;
  }, [mergeMetadata, transcriptId]);

  // hydratePurpose loads only the newest body needed by the visible AI or timeline surface.
  const hydratePurpose = useCallback(async (purpose: AiStatePurpose, metadata?: ManualAiStateSnapshot | null) => {
    if (purpose === "metadata") return;
    const outputs = metadata?.outputs ?? stateRef.current.outputs;
    const target = purpose === "timeline"
      ? outputs.find((output) => output.processing_type === "timeline_chapters")
      : outputs[0];
    if (target) await loadOutput(target.id);
    const automaticDone = new Set((metadata?.jobs ?? stateRef.current.jobs)
      .filter((job) => job.execution_mode === "automatic" && job.status === "done").map((job) => job.id));
    await Promise.all(outputs.filter((output) => automaticDone.has(output.processing_job_id)
      && (purpose === "ai" || output.processing_type === "timeline_chapters"))
      .slice(0, 6).map((output) => loadOutput(output.id)));
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
    const completionGeneration = metadata.automaticGenerationKey;
    // exportIsCurrent prevents deferred pages or hydration from crossing this export's generation.
    const exportIsCurrent = () => {
      if (scopeRef.current.generation !== scope.generation || scopeRef.current.transcriptId !== transcriptId) return false;
      if (stateRef.current.automaticGenerationKey === completionGeneration) return true;
      setError("Přepis se změnil. Export spusťte znovu.");
      return false;
    };
    if (!exportIsCurrent()) return null;
    let nextOutputOffset = metadata.nextOutputOffset ?? null;

    while (nextOutputOffset !== null) {
      const response = await fetch(
        `/api/transcripts/${transcriptId}/ai-state?outputOffset=${nextOutputOffset}`,
        { cache: "no-store" }
      );
      const payload = await response.json().catch(() => null) as ManualAiStateSnapshot | null;
      if (!response.ok || !payload || !Array.isArray(payload.jobs) || !Array.isArray(payload.outputs)) return null;
      if (!exportIsCurrent()) return null;
      mergeMetadata(payload);
      if (!exportIsCurrent()) return null;
      const followingOffset = payload.nextOutputOffset ?? null;
      if (followingOffset !== null && followingOffset <= nextOutputOffset) return null;
      nextOutputOffset = followingOffset;
    }

    const outputs = stateRef.current.outputs;
    for (let index = 0; index < outputs.length; index += OUTPUT_BODY_LOAD_CONCURRENCY) {
      const loaded = await Promise.all(
        outputs.slice(index, index + OUTPUT_BODY_LOAD_CONCURRENCY).map((output) => loadOutput(output.id))
      );
      if (!exportIsCurrent()) return null;
      if (loaded.some((payload) => !payload)) return null;
    }
    if (!exportIsCurrent()) return null;
    return { loadedOutputs: stateRef.current.loadedOutputs, structuredItems: stateRef.current.structuredItems };
  }, [loadOutput, mergeMetadata, refreshMetadata, transcriptId]);

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
    isLoadedRef.current = true;
    setIsLoaded(true);
    const requestWasAlreadyInFlight = stateRequestRef.current !== null;
    void refreshMetadata().then(() => {
      if (requestWasAlreadyInFlight && scopeRef.current.transcriptId === transcriptId) void refreshMetadata();
    });
  }, [refreshMetadata, replaceState, transcriptId]);

  // applyCleanupMutation records server-confirmed removals before any later bounded snapshot can race them.
  const applyCleanupMutation = useCallback((mutation: ManualAiCleanupMutationResponse) => {
    mutation.removed_job_ids.forEach((jobId) => jobTombstonesRef.current.add(jobId));
    replaceState(applyClientGuards(
      applyManualAiCleanupMutation(stateRef.current, mutation),
      outputTombstonesRef.current,
      jobTombstonesRef.current,
      taskDeletionTombstonesRef.current,
      taskStatusOverridesRef.current
    ));
  }, [replaceState]);

  // removeOutputs makes an explicit successful deletion authoritative across stale metadata and body requests.
  const removeOutputs = useCallback((outputIds: string[]) => {
    outputIds.forEach((outputId) => outputTombstonesRef.current.add(outputId));
    replaceState(removeManualAiOutputs(stateRef.current, outputIds));
  }, [replaceState]);

  // confirmTaskStatus overlays a successful checklist mutation across older hydrated output bodies.
  const confirmTaskStatus = useCallback((task: StructuredTaskRow, status: StructuredTaskRow["status"]) => {
    const key = getTaskDedupeKey(task);
    taskStatusOverridesRef.current.set(key, status);
    replaceState(applyClientGuards(
      stateRef.current,
      outputTombstonesRef.current,
      jobTombstonesRef.current,
      taskDeletionTombstonesRef.current,
      taskStatusOverridesRef.current
    ));
  }, [replaceState]);

  // confirmTaskDeletion keeps a logical task absent after the owner-scoped delete endpoint confirms success.
  const confirmTaskDeletion = useCallback((task: StructuredTaskRow) => {
    taskDeletionTombstonesRef.current.add(getTaskDedupeKey(task));
    replaceState(applyClientGuards(
      stateRef.current,
      outputTombstonesRef.current,
      jobTombstonesRef.current,
      taskDeletionTombstonesRef.current,
      taskStatusOverridesRef.current
    ));
  }, [replaceState]);

  const hasPollEligibleJobs = state.classifications.some((classification) => classification.poll_eligible);

  useEffect(() => {
    if (!transcriptId || !isLoaded || !activePurpose || !hasPollEligibleJobs) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cycleInFlight = false;
    let catchupScheduled = false;
    let transientBackoffUntil = 0;
    let disposed = false;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const isEligible = () => document.visibilityState !== "hidden" && navigator.onLine;
    const currentActiveJobs = () => {
      const eligibleIds = new Set(stateRef.current.classifications
        .filter((classification) => classification.poll_eligible)
        .map((classification) => classification.job_id));
      return stateRef.current.jobs.filter((job) => eligibleIds.has(job.id));
    };

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

    // runCycle is the sole continuation owner for one metadata request and the next cadence timer.
    const runCycle = async () => {
      if (disposed || !isEligible()) return;
      if (cycleInFlight) return;
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
        transientBackoffUntil = Date.now() + 30_000;
        schedulePoll(true);
        return;
      }
      transientBackoffUntil = 0;
      schedulePoll();
    };

    // catchUpOnce coalesces lifecycle bursts and catches up only after thirty quiet seconds.
    const catchUpOnce = () => {
      if (disposed || !isEligible()) return;
      if (Date.now() < transientBackoffUntil) {
        if (timer === null) schedulePoll(true);
        return;
      }
      if (cycleInFlight || catchupScheduled) return;
      if (Date.now() - lastCompletedCheckRef.current <= 30_000) {
        if (timer === null) schedulePoll();
        return;
      }
      clearTimer();
      catchupScheduled = true;
      queueMicrotask(async () => {
        if (disposed) return;
        catchupScheduled = false;
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
  }, [activePurpose, hasPollEligibleJobs, hydratePurpose, isLoaded, refreshMetadata, transcriptId]);

  const value = useMemo<TranscriptAiStateContextValue>(() => ({
    ...state,
    acceptJob,
    applyCleanupMutation,
    confirmTaskDeletion,
    confirmTaskStatus,
    error,
    isLoaded,
    isLoading,
    isRefreshing,
    loadAllOutputs,
    loadForPurpose,
    loadOutput,
    removeOutputs,
    setActivePurpose,
    stateRevision
  }), [acceptJob, applyCleanupMutation, confirmTaskDeletion, confirmTaskStatus, error, isLoaded, isLoading, isRefreshing, loadAllOutputs, loadForPurpose, loadOutput, removeOutputs, state, stateRevision]);

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

// mergeInitialManualAiState treats same-transcript server props as additive cache hints, never deletions.
function mergeInitialManualAiState(current: LoadedManualAiState, incoming: LoadedManualAiState): LoadedManualAiState {
  const loadedOutputs = new Map(current.loadedOutputs.map((output) => [output.id, output]));
  incoming.loadedOutputs.forEach((output) => {
    if (!loadedOutputs.has(output.id)) loadedOutputs.set(output.id, output);
  });
  return {
    ...current,
    ...mergeManualAiState(current, incoming),
    loadedOutputs: Array.from(loadedOutputs.values()),
    structuredItems: dedupeStructuredAiItems({
      chapters: [...current.structuredItems.chapters, ...incoming.structuredItems.chapters],
      decisions: [...current.structuredItems.decisions, ...incoming.structuredItems.decisions],
      risks: [...current.structuredItems.risks, ...incoming.structuredItems.risks],
      tasks: [...current.structuredItems.tasks, ...incoming.structuredItems.tasks]
    })
  };
}

// applyClientGuards reapplies confirmed client mutations after any older server response settles.
function applyClientGuards(
  state: LoadedManualAiState,
  outputTombstones: Set<string>,
  jobTombstones: Set<string>,
  taskDeletionTombstones: Set<string>,
  taskStatusOverrides: Map<string, StructuredTaskRow["status"]>
): LoadedManualAiState {
  const withoutOutputs = removeManualAiOutputs(state, Array.from(outputTombstones));
  return {
    ...withoutOutputs,
    classifications: withoutOutputs.classifications.filter((item) => !jobTombstones.has(item.job_id)),
    jobs: withoutOutputs.jobs.filter((job) => !jobTombstones.has(job.id)),
    structuredItems: {
      ...withoutOutputs.structuredItems,
      tasks: withoutOutputs.structuredItems.tasks
        .filter((task) => !taskDeletionTombstones.has(getTaskDedupeKey(task)))
        .map((task) => {
          const status = taskStatusOverrides.get(getTaskDedupeKey(task));
          return status ? { ...task, status } : task;
        })
    }
  };
}
