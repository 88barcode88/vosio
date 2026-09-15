import type { ManualAiJobSummary } from "@/lib/ai/manual-job-state";
import type { ManualAiCleanupClassification } from "@/lib/ai/manual-job-cleanup-contract";

// classifyAutomaticJob exposes status-only polling; automatic work never receives manual mutation actions.
export function classifyAutomaticJob(job: ManualAiJobSummary, now = Date.now()): ManualAiCleanupClassification {
  const bounded = Number.isInteger(job.attempt_count) && job.attempt_count >= 0
    && Number.isInteger(job.max_attempts) && job.max_attempts >= 1 && job.max_attempts <= 5;
  const lease = job.lease_expires_at ? Date.parse(job.lease_expires_at) : Number.NaN;
  const active = job.status === "running" && Number.isFinite(lease) && lease > now;
  const recoverable = bounded && job.attempt_count < job.max_attempts
    && (job.status === "queued" || job.status === "failed" || (job.status === "running" && Number.isFinite(lease) && lease <= now));
  return { actions: [], cleanup_reason: "automatic_status", job_id: job.id, poll_eligible: bounded && (active || recoverable) };
}
