import { validateSafetyPartListing } from "@/lib/live-recording/safety-parts";

export const LIVE_RECORDING_AUTOSAVE_INTERVAL_MS = 15 * 1000;

type AutosaveInput = {
  elapsedSeconds: number;
  rawText: string;
  segments: unknown[];
};

type RecoverableLiveRecordingInput = {
  source_type: string;
  status: string;
};

type SafetyPartStorageObject = {
  created_at?: string | null;
  metadata?: unknown;
  name: string;
  updated_at?: string | null;
};

type StorageListError = {
  message: string;
};

type StorageListOptions = {
  limit: number;
  offset: number;
  sortBy: {
    column: "name";
    order: "asc";
  };
};

// getStorageObjectSize reads a finite non-negative byte count from Storage metadata.
function getStorageObjectSize(item: SafetyPartStorageObject) {
  if (typeof item.metadata !== "object" || item.metadata === null || !("size" in item.metadata)) {
    return 0;
  }

  const size = (item.metadata as { size?: unknown }).size;

  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;
}

// listStorageObjectsToExhaustion collects every stable page before callers validate the sequence.
export async function listStorageObjectsToExhaustion<T extends { name: string }>(input: {
  folder: string;
  listPage: (
    folder: string,
    options: StorageListOptions
  ) => PromiseLike<{ data: T[] | null; error: StorageListError | null }>;
  pageSize?: number;
}) {
  const pageSize = Math.max(1, Math.min(1_000, Math.floor(input.pageSize ?? 100)));
  const items: T[] = [];

  while (true) {
    const { data, error } = await input.listPage(input.folder, {
      limit: pageSize,
      offset: items.length,
      sortBy: { column: "name", order: "asc" }
    });

    if (error) {
      throw new Error(`Unable to list live recording parts: ${error.message}`);
    }

    const page = data ?? [];
    items.push(...page);

    if (page.length < pageSize) {
      return items;
    }
  }
}

// summarizeSafetyPartStorageObjects validates canonical parts before exposing recovery metadata.
export function summarizeSafetyPartStorageObjects(items: readonly SafetyPartStorageObject[]) {
  return validateSafetyPartListing(items).reduce(
    (summary, part) => {
      const updatedAt = part.item.updated_at ?? part.item.created_at ?? null;

      return {
        count: summary.count + 1,
        newestUpdatedAt:
          updatedAt && (!summary.newestUpdatedAt || updatedAt > summary.newestUpdatedAt)
            ? updatedAt
            : summary.newestUpdatedAt,
        totalBytes: summary.totalBytes + getStorageObjectSize(part.item)
      };
    },
    { count: 0, newestUpdatedAt: null as string | null, totalBytes: 0 }
  );
}

// getLiveDraftAutosavePayload normalizes partial live transcript data before persistence.
export function getLiveDraftAutosavePayload(input: AutosaveInput) {
  return {
    duration_seconds: Math.max(0, Math.ceil(input.elapsedSeconds)),
    raw_text: input.rawText.trim(),
    segments: input.segments
  };
}

// isRecoverableLiveRecording returns true for unfinished in-app live captures.
export function isRecoverableLiveRecording(recording: RecoverableLiveRecordingInput) {
  return (
    ["in_app_recording", "realtime"].includes(recording.source_type) &&
    ["uploading", "failed", "transcribing"].includes(recording.status)
  );
}

// getRecoveredLiveRecordingUpdate keeps transcript-only recovery from advertising missing audio.
export function getRecoveredLiveRecordingUpdate(input: {
  hasTranscript: boolean;
  segmentCount: number;
  storagePrefix: string | null;
  totalBytes: number;
}) {
  const hasAudio = input.segmentCount > 0 && Boolean(input.storagePrefix);

  return {
    error_message: null,
    file_size_bytes: hasAudio ? input.totalBytes : 0,
    status: input.hasTranscript ? "completed" : "uploaded",
    ...(hasAudio
      ? { storage_path: input.storagePrefix }
      : { source_type: "realtime", storage_path: null })
  };
}

// getRecoverableLiveStoragePrefix derives the Storage folder for a live recording draft.
export function getRecoverableLiveStoragePrefix(userId: string, recordingId: string) {
  return `${userId}/${recordingId}/live/`;
}

// getLiveStorageListPrefix converts a stored live prefix into the folder accepted by Supabase list().
export function getLiveStorageListPrefix(storagePrefix: string) {
  return storagePrefix.replace(/\/$/, "");
}
