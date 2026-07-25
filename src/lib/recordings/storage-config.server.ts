import {
  normalizeRecordingStorageLimit,
  unavailableRecordingStorageConfig,
  type RecordingStorageConfig
} from "@/lib/recordings/storage-config";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import { createAdminClient } from "@/lib/supabase/admin";

// getRecordingStorageConfig reads the effective app limit from the recordings bucket metadata.
export async function getRecordingStorageConfig(): Promise<RecordingStorageConfig> {
  try {
    const { data: bucket, error } = await createAdminClient().storage.getBucket(RECORDINGS_BUCKET);

    if (error || !bucket) {
      return unavailableRecordingStorageConfig;
    }

    return {
      maxFileSizeBytes: normalizeRecordingStorageLimit(bucket.file_size_limit)
    };
  } catch {
    return unavailableRecordingStorageConfig;
  }
}
