import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AI_FAILURE_CODES, type AiFailureCode } from "@/lib/ai/provider-errors";
import {
  MANUAL_AI_CLEANUP_BATCH_LIMIT,
  type ManualAiCleanupAction,
  type ManualAiCleanupChangedJob,
  type ManualAiCleanupClassification,
  type ManualAiCleanupItemResult,
  type ManualAiCleanupMutationResponse,
  type ManualAiCleanupPage,
  type ManualAiCleanupReason,
  type ManualAiCleanupResultStatus,
  type ManualAiCleanupState
} from "@/lib/ai/manual-job-cleanup-contract";

const cleanupActions = new Set<ManualAiCleanupAction>(["reconcile", "interrupt", "delete"]);
const cleanupReasons = new Set<ManualAiCleanupReason>([
  "eligible_terminal_no_output", "eligible_stale_unclaimed", "protected_output",
  "protected_projection", "active_or_slow", "ownership_mismatch", "unsupported_legacy"
]);
const cleanupResults = new Set<ManualAiCleanupResultStatus>([
  "deleted", "protected", "busy", "reconciled", "missing", "conflict"
]);
const cleanupStatuses = new Set(["queued", "running", "done", "failed", "cancelled"] as const);
const cursorSchema = z.object({
  c: z.iso.datetime({ offset: true }),
  i: z.uuid(),
  t: z.uuid(),
  u: z.string().min(1),
  v: z.literal(1)
}).strict();

type CleanupCursor = z.infer<typeof cursorSchema>;
type CleanupListRow = {
  actions: unknown;
  cleanup_reason: unknown;
  created_at: unknown;
  eligible_count: unknown;
  job_id: unknown;
  poll_eligible: unknown;
};
type CleanupClassificationRow = CleanupListRow & {
  attempt_count: unknown;
  completed_at: unknown;
  failure_code: unknown;
  lease_expires_at: unknown;
  max_attempts: unknown;
  model: unknown;
  processing_type: unknown;
  retry_after_at: unknown;
  started_at: unknown;
  status: unknown;
};

type ManualAiCleanupServerInput = {
  admin: SupabaseClient;
  transcriptId: string;
  userId: string;
};

// decodeCleanupCursor rejects malformed cursors and cursors copied across owners or transcripts.
function decodeCleanupCursor(cursor: string | null, userId: string, transcriptId: string): CleanupCursor | null {
  if (!cursor) return null;
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.u !== userId || parsed.t !== transcriptId) throw new Error("scope_mismatch");
    return parsed;
  } catch {
    throw new Error("manual_ai_cleanup_invalid_cursor");
  }
}

// encodeCleanupCursor keeps keyset internals opaque while binding them to the authenticated scope.
function encodeCleanupCursor(row: CleanupListRow, userId: string, transcriptId: string) {
  return Buffer.from(JSON.stringify({
    c: readDate(row.created_at), i: readUuid(row.job_id), t: transcriptId, u: userId, v: 1
  } satisfies CleanupCursor), "utf8").toString("base64url");
}

// readUuid accepts only canonical UUID strings returned by the privileged RPCs.
function readUuid(value: unknown) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new Error("manual_ai_cleanup_invalid_response");
  return parsed.data;
}

// readDate accepts only finite ISO timestamps from the database boundary.
function readDate(value: unknown) {
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  if (!parsed.success) throw new Error("manual_ai_cleanup_invalid_response");
  return parsed.data;
}

// readNullableDate validates timestamp fields without exposing arbitrary database values.
function readNullableDate(value: unknown) {
  return value === null ? null : readDate(value);
}

// readClassification validates the shared SQL classifier output before it reaches an API response.
function readClassification(row: CleanupListRow): ManualAiCleanupClassification {
  if (!cleanupReasons.has(row.cleanup_reason as ManualAiCleanupReason)
    || typeof row.poll_eligible !== "boolean"
    || !Array.isArray(row.actions)
    || !row.actions.every((action) => cleanupActions.has(action as ManualAiCleanupAction))) {
    throw new Error("manual_ai_cleanup_invalid_response");
  }
  return {
    actions: row.actions as ManualAiCleanupAction[],
    cleanup_reason: row.cleanup_reason as ManualAiCleanupReason,
    job_id: readUuid(row.job_id),
    poll_eligible: row.poll_eligible
  };
}

// readChangedJob validates a reconciled job summary returned after the locked mutation.
function readChangedJob(row: CleanupClassificationRow): ManualAiCleanupChangedJob {
  const classification = readClassification(row);
  const failureCode: AiFailureCode | null | undefined = row.failure_code === null
    ? null
    : (AI_FAILURE_CODES as readonly unknown[]).includes(row.failure_code)
      ? row.failure_code as AiFailureCode
      : undefined;
  if (!Number.isInteger(row.attempt_count) || !Number.isInteger(row.max_attempts)
    || typeof row.model !== "string" || typeof row.processing_type !== "string"
    || !cleanupStatuses.has(row.status as never) || failureCode === undefined) {
    throw new Error("manual_ai_cleanup_invalid_response");
  }
  return {
    ...classification,
    attempt_count: row.attempt_count as number,
    completed_at: readNullableDate(row.completed_at),
    created_at: readDate(row.created_at),
    failure_code: failureCode,
    lease_expires_at: readNullableDate(row.lease_expires_at),
    max_attempts: row.max_attempts as number,
    model: row.model,
    processing_type: row.processing_type,
    retry_after_at: readNullableDate(row.retry_after_at),
    started_at: readNullableDate(row.started_at),
    status: row.status as ManualAiCleanupChangedJob["status"]
  };
}

// listCleanupRows reads at most one lookahead row from the owner-scoped keyset RPC.
async function listCleanupRows(input: ManualAiCleanupServerInput & { cursor: string | null }) {
  const cursor = decodeCleanupCursor(input.cursor, input.userId, input.transcriptId);
  const { data, error } = await input.admin.rpc("list_manual_ai_job_cleanup_v1", {
    p_before_created_at: cursor?.c ?? null,
    p_before_job_id: cursor?.i ?? null,
    p_limit: MANUAL_AI_CLEANUP_BATCH_LIMIT + 1,
    p_now: new Date().toISOString(),
    p_transcript_id: input.transcriptId,
    p_user_id: input.userId
  });
  if (error || !Array.isArray(data)) throw new Error("manual_ai_cleanup_list_failed");
  const rows = data as CleanupListRow[];
  rows.forEach(readClassification);
  return rows;
}

// classifyManualAiJobs reads authoritative cleanup and polling decisions for exact visible jobs.
async function classifyManualAiJobs(input: ManualAiCleanupServerInput & { jobIds: string[] }) {
  if (input.jobIds.length === 0) return [];
  const { data, error } = await input.admin.rpc("classify_manual_ai_jobs_v1", {
    p_job_ids: input.jobIds,
    p_now: new Date().toISOString(),
    p_transcript_id: input.transcriptId,
    p_user_id: input.userId
  });
  if (error || !Array.isArray(data)) throw new Error("manual_ai_cleanup_classify_failed");
  return (data as CleanupClassificationRow[]).map(readChangedJob);
}

// listManualAiCleanupCandidates returns one bounded historical page without leaking cursor internals.
export async function listManualAiCleanupCandidates(
  input: ManualAiCleanupServerInput & { cursor: string | null }
): Promise<ManualAiCleanupPage> {
  const rows = await listCleanupRows(input);
  const pageRows = rows.slice(0, MANUAL_AI_CLEANUP_BATCH_LIMIT);
  return {
    candidates: pageRows.map((row) => {
      const classification = readClassification(row);
      return { cleanup_reason: classification.cleanup_reason, job_id: classification.job_id };
    }),
    next_cursor: rows.length > MANUAL_AI_CLEANUP_BATCH_LIMIT
      ? encodeCleanupCursor(pageRows.at(-1)!, input.userId, input.transcriptId)
      : null
  };
}

// getManualAiCleanupState supplies ai-state with exact job decorations and global cleanup metadata.
export async function getManualAiCleanupState(
  input: ManualAiCleanupServerInput & { jobIds: string[] }
): Promise<ManualAiCleanupState> {
  const [classifications, rows] = await Promise.all([
    classifyManualAiJobs(input),
    listCleanupRows({ ...input, cursor: null })
  ]);
  const pageRows = rows.slice(0, MANUAL_AI_CLEANUP_BATCH_LIMIT);
  const count = rows[0]?.eligible_count ?? 0;
  if ((typeof count !== "number" && typeof count !== "string") || !/^\d+$/.test(String(count))) {
    throw new Error("manual_ai_cleanup_invalid_response");
  }
  return {
    classifications,
    cleanup: {
      eligible_count: Number(count),
      next_cursor: rows.length > MANUAL_AI_CLEANUP_BATCH_LIMIT
        ? encodeCleanupCursor(pageRows.at(-1)!, input.userId, input.transcriptId)
        : null
    }
  };
}

// cleanupManualAiJobs applies one atomic mixed batch and reports deletion only for explicit deleted results.
export async function cleanupManualAiJobs(
  input: ManualAiCleanupServerInput & { jobIds: string[] }
): Promise<ManualAiCleanupMutationResponse> {
  if (input.jobIds.length < 1 || input.jobIds.length > MANUAL_AI_CLEANUP_BATCH_LIMIT
    || new Set(input.jobIds).size !== input.jobIds.length
    || input.jobIds.some((id) => !z.uuid().safeParse(id).success)) {
    throw new Error("manual_ai_cleanup_invalid_ids");
  }
  const { data, error } = await input.admin.rpc("cleanup_manual_ai_jobs_v1", {
    p_job_ids: input.jobIds,
    p_now: new Date().toISOString(),
    p_transcript_id: input.transcriptId,
    p_user_id: input.userId
  });
  if (error || !Array.isArray(data)) throw new Error("manual_ai_cleanup_failed");
  const results = (data as Array<{ job_id?: unknown; result?: unknown }>).map((row): ManualAiCleanupItemResult => {
    if (!cleanupResults.has(row.result as ManualAiCleanupResultStatus)) {
      throw new Error("manual_ai_cleanup_invalid_response");
    }
    return { job_id: readUuid(row.job_id), result: row.result as ManualAiCleanupResultStatus };
  });
  if (results.length !== input.jobIds.length
    || new Set(results.map((row) => row.job_id)).size !== input.jobIds.length
    || results.some((row) => !input.jobIds.includes(row.job_id))) {
    throw new Error("manual_ai_cleanup_invalid_response");
  }
  const changedIds = results.filter((row) => row.result === "reconciled").map((row) => row.job_id);
  const changedJobs = await classifyManualAiJobs({ ...input, jobIds: changedIds });
  if (changedJobs.length !== changedIds.length
    || changedJobs.some((job) => !changedIds.includes(job.job_id))) {
    throw new Error("manual_ai_cleanup_invalid_response");
  }
  return {
    changed_jobs: changedJobs,
    removed_job_ids: results.filter((row) => row.result === "deleted").map((row) => row.job_id),
    results
  };
}
