import type { AiOutputView } from "@/lib/ai/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import { dedupeStructuredAiItems } from "@/lib/ai/structured-dedupe";
import { MANUAL_AI_LEASE_GRACE_SECONDS, MANUAL_AI_MAX_DURATION_SECONDS } from "@/lib/ai/manual-route-runtime";
import type { AiFailureCode } from "@/lib/ai/provider-errors";
import type {
  ManualAiCleanupClassification,
  ManualAiCleanupMetadata,
  ManualAiCleanupMutationResponse
} from "@/lib/ai/manual-job-cleanup-contract";

export const MANUAL_AI_RUNTIME_MS = MANUAL_AI_MAX_DURATION_SECONDS * 1_000;
export const MANUAL_AI_STALL_GRACE_MS = MANUAL_AI_LEASE_GRACE_SECONDS * 1_000;

export type ManualAiJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type ManualAiJobDisplayStatus = ManualAiJobStatus | "stalled";

export type ManualAiJobSummary = {
  attempt_count: number;
  completed_at: string | null;
  created_at: string;
  failure_code: AiFailureCode | null;
  id: string;
  lease_expires_at: string | null;
  max_attempts: number;
  model: string;
  processing_type: string;
  retry_after_at: string | null;
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
  classifications?: ManualAiCleanupClassification[];
  cleanup?: ManualAiCleanupMetadata;
  jobs: ManualAiJobSummary[];
  nextOutputOffset?: number | null;
  outputs: ManualAiOutputMetadata[];
};

export type LoadedManualAiState = ManualAiStateSnapshot & {
  classifications: ManualAiCleanupClassification[];
  cleanup: ManualAiCleanupMetadata;
  loadedOutputs: AiOutputView[];
  structuredItems: StructuredAiItems;
};

// getEmptyLoadedManualAiState creates a fresh unloaded client state without shared mutable arrays.
export function getEmptyLoadedManualAiState(): LoadedManualAiState {
  return {
    classifications: [],
    cleanup: { eligible_count: 0, next_cursor: null },
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
  const classifications = new Map((current?.classifications ?? []).map((item) => [item.job_id, item]));

  incoming.jobs.forEach((job) => jobs.set(job.id, { ...jobs.get(job.id), ...job }));
  incoming.outputs.forEach((output) => outputs.set(output.id, {
    ...outputs.get(output.id),
    ...output,
    body_loaded: output.body_loaded || outputs.get(output.id)?.body_loaded === true
  }));
  incoming.classifications?.forEach((item) => classifications.set(item.job_id, item));

  return {
    classifications: Array.from(classifications.values()),
    cleanup: incoming.cleanup ?? current?.cleanup ?? { eligible_count: 0, next_cursor: null },
    jobs: Array.from(jobs.values()).sort(compareCreatedRows),
    outputs: Array.from(outputs.values()).sort(compareCreatedRows)
  };
}

// applyManualAiCleanupMutation applies only explicit removals and merges server-returned changed rows.
export function applyManualAiCleanupMutation(
  current: LoadedManualAiState,
  mutation: ManualAiCleanupMutationResponse
): LoadedManualAiState {
  const removedIds = new Set(mutation.removed_job_ids);
  const changedSnapshot: ManualAiStateSnapshot = {
    classifications: mutation.changed_jobs.map(({ actions, cleanup_reason, job_id, poll_eligible }) => ({
      actions, cleanup_reason, job_id, poll_eligible
    })),
    jobs: mutation.changed_jobs.map(({ job_id, actions: _actions, cleanup_reason: _reason, poll_eligible: _poll, ...job }) => ({
      ...job,
      id: job_id
    })),
    outputs: []
  };
  const merged = mergeManualAiState(current, changedSnapshot);

  return {
    ...current,
    ...merged,
    classifications: (merged.classifications ?? []).filter((item) => !removedIds.has(item.job_id)),
    jobs: merged.jobs.filter((job) => !removedIds.has(job.id))
  };
}

// removeManualAiOutputs removes only confirmed artifacts and their normalized projections.
export function removeManualAiOutputs(current: LoadedManualAiState, outputIds: string[]): LoadedManualAiState {
  const removedIds = new Set(outputIds);
  return {
    ...current,
    loadedOutputs: current.loadedOutputs.filter((output) => !removedIds.has(output.id)),
    outputs: current.outputs.filter((output) => !removedIds.has(output.id)),
    structuredItems: {
      chapters: current.structuredItems.chapters.filter((row) => !removedIds.has(row.ai_output_id)),
      decisions: current.structuredItems.decisions.filter((row) => !removedIds.has(row.ai_output_id)),
      risks: current.structuredItems.risks.filter((row) => !removedIds.has(row.ai_output_id)),
      tasks: current.structuredItems.tasks.filter((row) => !removedIds.has(row.ai_output_id))
    }
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
