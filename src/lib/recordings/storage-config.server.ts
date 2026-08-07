import "server-only";
import {
  createUnavailableRecordingStorageConfig,
  resolveRecordingStorageConfig,
  type RecordingStorageConfig
} from "@/lib/recordings/storage-config";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import type { SupabaseStoragePlan } from "@/lib/settings/types";
import { createAdminClient } from "@/lib/supabase/admin";

// getRecordingStorageConfig reads the bucket and applies a non-authoritative user plan ceiling.
export async function getRecordingStorageConfig(
  plan: SupabaseStoragePlan
): Promise<RecordingStorageConfig> {
  try {
    const { data: bucket, error } = await createAdminClient().storage.getBucket(RECORDINGS_BUCKET);

    if (error || !bucket) {
      return createUnavailableRecordingStorageConfig(plan);
    }

    return resolveRecordingStorageConfig(bucket.file_size_limit, plan);
  } catch {
    return createUnavailableRecordingStorageConfig(plan);
  }
}
