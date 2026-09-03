import type { AiOutputView } from "@/lib/ai/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import { dedupeStructuredAiItems } from "@/lib/ai/structured-dedupe";

export const MANUAL_AI_RUNTIME_MS = 5 * 60_000;
export const MANUAL_AI_STALL_GRACE_MS = 3 * 60_000;
export const MANUAL_AI_WATCHER_MAX_MS = 10 * 60_000;

export type ManualAiJobStatus = "queued" | "running" | "done" | "failed";
export type ManualAiJobDisplayStatus = ManualAiJobStatus | "stalled";

export type ManualAiJobSummary = {
  completed_at: string | null;
  created_at: string;
  error_message: string | null;
  id: string;
  processing_type: string;
  started_at: string | null;
  status: ManualAiJobStatus;
};

export type ManualAiOutputMetadata = {
  body_loaded: boolean;
  created_at: string;
  id: string;
  processing_job_id: string;
  processing_type: string | null;
  transcript_id: string;
};

export type ManualAiStateSnapshot = {
  jobs: ManualAiJobSummary[];
  outputs: ManualAiOutputMetadata[];
};

export type LoadedManualAiState = ManualAiStateSnapshot & {
  loadedOutputs: AiOutputView[];
  structuredItems: StructuredAiItems;
};

// getEmptyLoadedManualAiState creates a fresh unloaded client state without shared mutable arrays.
export function getEmptyLoadedManualAiState(): LoadedManualAiState {
  return {
    jobs: [],
    loadedOutputs: [],
    outputs: [],
    structuredItems: { chapters: [], decisions: [], risks: [], tasks: [] }
  };
}

// getManualAiJobDisplayStatus derives a stalled warning from persisted timestamps without changing the row.
export function getManualAiJobDisplayStatus(
  job: ManualAiJobSummary,
  nowMs = Date.now(),
  runtimeMs = MANUAL_AI_RUNTIME_MS,
  graceMs = MANUAL_AI_STALL_GRACE_MS
): ManualAiJobDisplayStatus {
  if (job.status !== "queued" && job.status !== "running") {
    return job.status;
  }

  const boundary = job.status === "running" ? job.started_at : job.created_at;
  const boundaryMs = boundary ? Date.parse(boundary) : Number.NaN;

  return Number.isFinite(boundaryMs) && nowMs - boundaryMs > runtimeMs + graceMs
    ? "stalled"
    : job.status;
}

// mergeManualAiState merges bounded server snapshots by durable ids while preserving local body hydration.
export function mergeManualAiState(
  current: ManualAiStateSnapshot | undefined,
  incoming: ManualAiStateSnapshot
): ManualAiStateSnapshot {
  const jobs = new Map((current?.jobs ?? []).map((job) => [job.id, job]));
  const outputs = new Map((current?.outputs ?? []).map((output) => [output.id, output]));

  incoming.jobs.forEach((job) => jobs.set(job.id, { ...jobs.get(job.id), ...job }));
  incoming.outputs.forEach((output) => outputs.set(output.id, {
    ...outputs.get(output.id),
    ...output,
    body_loaded: output.body_loaded || outputs.get(output.id)?.body_loaded === true
  }));

  return {
    jobs: Array.from(jobs.values()).sort(compareCreatedRows),
    outputs: Array.from(outputs.values()).sort(compareCreatedRows)
  };
}

// mergeLoadedManualAiOutput adds one exact body and its rows without duplicating prior generations.
export function mergeLoadedManualAiOutput(
  current: LoadedManualAiState,
  output: AiOutputView,
  structuredItems: StructuredAiItems
): LoadedManualAiState {
  const loadedOutputs = new Map(current.loadedOutputs.map((item) => [item.id, item]));
  loadedOutputs.set(output.id, output);

  return {
    ...current,
    loadedOutputs: Array.from(loadedOutputs.values()).sort(compareCreatedRows),
    outputs: current.outputs.map((metadata) => metadata.id === output.id
      ? { ...metadata, body_loaded: true }
      : metadata),
    structuredItems: dedupeStructuredAiItems({
      chapters: [...current.structuredItems.chapters, ...structuredItems.chapters],
      decisions: [...current.structuredItems.decisions, ...structuredItems.decisions],
      risks: [...current.structuredItems.risks, ...structuredItems.risks],
      tasks: [...current.structuredItems.tasks, ...structuredItems.tasks]
    })
  };
}

// compareCreatedRows keeps server order deterministic when timestamps collide.
function compareCreatedRows(left: { created_at: string; id: string }, right: { created_at: string; id: string }) {
  return Date.parse(right.created_at) - Date.parse(left.created_at) || right.id.localeCompare(left.id);
}
