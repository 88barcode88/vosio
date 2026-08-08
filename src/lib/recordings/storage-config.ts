import type { SupabaseStoragePlan } from "@/lib/settings/types";

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

export type RecordingStorageConfig = {
  bucketMaxFileSizeBytes: number | null;
  detectedGlobalMaxFileSizeBytes: number | null;
  maxFileSizeBytes: number | null;
  planMaxFileSizeBytes: number | null;
};

// getSupabasePlanMaxFileSizeBytes maps a user-selected plan to a conservative local ceiling.
export function getSupabasePlanMaxFileSizeBytes(plan: SupabaseStoragePlan) {
  switch (plan) {
    case "free":
      return 50 * MEBIBYTE;
    case "paid":
      return 500 * GIBIBYTE;
    case "auto":
      return null;
  }
}

// createUnavailableRecordingStorageConfig fails closed while preserving the non-authoritative plan hint.
export function createUnavailableRecordingStorageConfig(
  plan: SupabaseStoragePlan
): RecordingStorageConfig {
  return {
    bucketMaxFileSizeBytes: null,
    detectedGlobalMaxFileSizeBytes: null,
    maxFileSizeBytes: null,
    planMaxFileSizeBytes: getSupabasePlanMaxFileSizeBytes(plan)
  };
}

export const unavailableRecordingStorageConfig = createUnavailableRecordingStorageConfig("auto");

// normalizeRecordingStorageLimit accepts only bucket limits that are safe to use in browser validation.
export function normalizeRecordingStorageLimit(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

// resolveRecordingStorageConfig keeps the configured bucket authoritative and only lets a plan tighten it.
export function resolveRecordingStorageConfig(
  bucketLimit: unknown,
  plan: SupabaseStoragePlan
): RecordingStorageConfig {
  const bucketMaxFileSizeBytes = normalizeRecordingStorageLimit(bucketLimit);

  if (bucketMaxFileSizeBytes === null) {
    return createUnavailableRecordingStorageConfig(plan);
  }

  const planMaxFileSizeBytes = getSupabasePlanMaxFileSizeBytes(plan);

  return {
    bucketMaxFileSizeBytes,
    detectedGlobalMaxFileSizeBytes: null,
    maxFileSizeBytes: planMaxFileSizeBytes === null
      ? bucketMaxFileSizeBytes
      : Math.min(bucketMaxFileSizeBytes, planMaxFileSizeBytes),
    planMaxFileSizeBytes
  };
}
