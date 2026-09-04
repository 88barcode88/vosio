export const MANUAL_AI_MAX_DURATION_SECONDS = 300;
export const MANUAL_AI_LEASE_GRACE_SECONDS = 180;
export const MANUAL_AI_LEASE_SECONDS = MANUAL_AI_MAX_DURATION_SECONDS + MANUAL_AI_LEASE_GRACE_SECONDS;

// getManualAiPollIntervalMs derives polling cadence from the youngest persisted active job.
export function getManualAiPollIntervalMs(ageMs: number, transientError = false) {
  if (transientError) return 30_000;
  if (ageMs < 30_000) return 5_000;
  if (ageMs < 120_000) return 10_000;
  return 30_000;
}
