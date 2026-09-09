import type { AiFailureCode } from "@/lib/ai/provider-errors";

export const MANUAL_AI_CLEANUP_BATCH_LIMIT = 50;

export type ManualAiCleanupAction = "reconcile" | "interrupt" | "delete";

export type ManualAiCleanupReason =
  | "eligible_terminal_no_output"
  | "eligible_stale_unclaimed"
  | "protected_output"
  | "protected_projection"
  | "active_or_slow"
  | "ownership_mismatch"
  | "unsupported_legacy";

export type ManualAiCleanupResultStatus =
  | "deleted"
  | "protected"
  | "busy"
  | "reconciled"
  | "missing"
  | "conflict";

export type ManualAiCleanupClassification = {
  actions: ManualAiCleanupAction[];
  cleanup_reason: ManualAiCleanupReason;
  job_id: string;
  poll_eligible: boolean;
};

export type ManualAiCleanupCandidate = Pick<
  ManualAiCleanupClassification,
  "cleanup_reason" | "job_id"
>;

export type ManualAiCleanupPage = {
  candidates: ManualAiCleanupCandidate[];
  next_cursor: string | null;
};

export type ManualAiCleanupRequest = {
  job_ids: string[];
};

export type ManualAiCleanupError = {
  error: string;
};

export type ManualAiCleanupChangedJob = ManualAiCleanupClassification & {
  attempt_count: number;
  completed_at: string | null;
  created_at: string;
  failure_code: AiFailureCode | null;
  lease_expires_at: string | null;
  max_attempts: number;
  model: string;
  processing_type: string;
  retry_after_at: string | null;
  started_at: string | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
};

export type ManualAiCleanupItemResult = {
  job_id: string;
  result: ManualAiCleanupResultStatus;
};

export type ManualAiCleanupMutationResponse = {
  changed_jobs: ManualAiCleanupChangedJob[];
  removed_job_ids: string[];
  results: ManualAiCleanupItemResult[];
};

export type ManualAiCleanupMetadata = {
  eligible_count: number;
  next_cursor: string | null;
};

export type ManualAiCleanupState = {
  classifications: ManualAiCleanupClassification[];
  cleanup: ManualAiCleanupMetadata;
};
