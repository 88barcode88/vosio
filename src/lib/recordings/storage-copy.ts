import { getLiveAudioMaxFileSizeBytes } from "@/lib/recordings/live-audio-limit";
import { formatFileSize } from "@/lib/recordings/types";
import type { RecordingStorageConfig } from "@/lib/recordings/storage-config";
import type { SupabaseStoragePlan } from "@/lib/settings/types";

type RecordingStorageLimitSummary = {
  bucketLimit: string;
  globalLimit: string;
  liveAudioLimit: string;
  manualUploadLimit: string;
  planLabel: "Auto" | "Free" | "Paid";
  warning: string | null;
};

// formatKnownLimit preserves the distinction between an unknown limit and a known byte size.
function formatKnownLimit(limit: number | null, unknownLabel: string) {
  return limit === null ? unknownLabel : formatFileSize(limit);
}

// getRecordingStorageLimitSummary creates transparent UI copy without claiming an undetectable global limit.
export function getRecordingStorageLimitSummary(
  config: RecordingStorageConfig,
  plan: SupabaseStoragePlan
): RecordingStorageLimitSummary {
  const liveAudioMaxFileSizeBytes = getLiveAudioMaxFileSizeBytes(config.maxFileSizeBytes);
  const planLabel = ({ auto: "Auto", free: "Free", paid: "Paid" } as const)[plan];
  let warning: string | null = null;

  if (config.maxFileSizeBytes === null) {
    warning = "Limit bucketu recordings se nepodařilo ověřit. Audio se proto neukládá; live přepis a vložení hotového přepisu fungují dál.";
  } else if (
    plan === "free" &&
    config.bucketMaxFileSizeBytes !== null &&
    config.maxFileSizeBytes < config.bucketMaxFileSizeBytes
  ) {
    warning = "Globální limit projektu nelze bezpečně zjistit. Preference Free proto upload zpřísňuje na 50 MB; Supabase konfiguraci nemění.";
  } else if (
    plan === "paid" &&
    config.bucketMaxFileSizeBytes !== null &&
    config.planMaxFileSizeBytes !== null &&
    config.bucketMaxFileSizeBytes < config.planMaxFileSizeBytes
  ) {
    warning = `Je vybraný placený tarif, ale bucket recordings je omezený na ${formatFileSize(config.bucketMaxFileSizeBytes)}. Preference Supabase konfiguraci nezvyšuje.`;
  }

  return {
    bucketLimit: formatKnownLimit(config.bucketMaxFileSizeBytes, "Nezjištěn"),
    globalLimit: formatKnownLimit(config.detectedGlobalMaxFileSizeBytes, "Nezjištěn"),
    liveAudioLimit: formatKnownLimit(liveAudioMaxFileSizeBytes, "Nedostupný"),
    manualUploadLimit: formatKnownLimit(config.maxFileSizeBytes, "Nedostupný"),
    planLabel,
    warning
  };
}
