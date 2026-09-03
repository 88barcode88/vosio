"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatDuration } from "@/components/workspace/utils";
import {
  resumeDurableSafetyPartsForOwner,
  type DurableSafetyManifest
} from "@/lib/live-recording/durable-audio";
import {
  getLiveRecordingStoragePrefix,
  uploadLiveRecordingPart
} from "@/lib/recordings/upload";
import { formatFileSize } from "@/lib/recordings/types";
import {
  TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE,
  addTranscriptSearchIndexWarningToPath,
  hasTranscriptSearchIndexWarning
} from "@/lib/transcripts/search-warning";

type RecoverableRecording = {
  created_at: string;
  duration_seconds: number | null;
  id: string;
  segment_count: number;
  storage_bytes: number;
  title: string;
  transcript_chars: number;
};

type RecoverableStatePayload = {
  error?: string;
  ownerId?: string;
  recordings?: RecoverableRecording[];
};

// getLocalRecoverableRecording keeps a durable browser manifest visible until remote recovery converges.
function getLocalRecoverableRecording(manifest: DurableSafetyManifest): RecoverableRecording {
  return {
    created_at: manifest.createdAt,
    duration_seconds: null,
    id: manifest.recordingId,
    segment_count: manifest.partCount,
    storage_bytes: manifest.totalBytes,
    title: "Lokálně uložená live nahrávka",
    transcript_chars: 0
  };
}

// mergeRecoverableRecordings prefers server metadata while retaining current local-only manifests.
function mergeRecoverableRecordings(
  serverRecordings: RecoverableRecording[],
  manifests: DurableSafetyManifest[]
) {
  const merged = new Map<string, RecoverableRecording>();

  for (const manifest of manifests) {
    if (!merged.has(manifest.recordingId)) {
      merged.set(manifest.recordingId, getLocalRecoverableRecording(manifest));
    }
  }

  for (const recording of serverRecordings) {
    const local = merged.get(recording.id);
    merged.set(recording.id, local ? {
      ...local,
      ...recording,
      segment_count: Math.max(local.segment_count, recording.segment_count),
      storage_bytes: Math.max(local.storage_bytes, recording.storage_bytes)
    } : recording);
  }

  return [...merged.values()].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

// fetchRecoverableState loads the current owner identity and compact server recovery rows.
async function fetchRecoverableState() {
  const response = await fetch("/api/recordings/recoverable", { cache: "no-store" });
  const payload = await response.json().catch(() => null) as RecoverableStatePayload | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Nepodařilo se načíst nedokončené nahrávky.");
  }

  return {
    ownerId: payload?.ownerId ?? null,
    recordings: Array.isArray(payload?.recordings) ? payload.recordings : []
  };
}

// LiveRecordingRecoveryPanel lists unfinished live recordings that can be completed from saved drafts.
export function LiveRecordingRecoveryPanel() {
  const router = useRouter();
  const [recordings, setRecordings] = useState<RecoverableRecording[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // loadRecoveryState promotes durable browser parts before reconciling them with fresh server state.
    async function loadRecoveryState() {
      try {
        const initial = await fetchRecoverableState();

        if (cancelled) return;
        setRecordings(initial.recordings);

        if (!initial.ownerId) return;

        const resumed = await resumeDurableSafetyPartsForOwner({
          maxConcurrent: 2,
          ownerId: initial.ownerId,
          uploadPart: async (part) => {
            await uploadLiveRecordingPart({
              blob: part.blob,
              contentType: part.mimeType,
              maxFileSizeBytes: part.size,
              partIndex: part.index,
              recording: {
                id: part.recordingId,
                storagePrefix: getLiveRecordingStoragePrefix(part.ownerId, part.recordingId),
                userId: part.ownerId
              }
            });
          }
        });

        if (cancelled) return;
        if (resumed.manifests.length === 0) return;
        setRecordings(mergeRecoverableRecordings(initial.recordings, resumed.manifests));

        if (resumed.failed.length > 0) {
          setMessage(
            "Některé části se nepodařilo nahrát; části zůstávají bezpečně uložené v tomto prohlížeči."
          );
        }

        const refreshed = await fetchRecoverableState();

        if (!cancelled) {
          setRecordings(mergeRecoverableRecordings(refreshed.recordings, resumed.manifests));
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Nepodařilo se načíst nedokončené nahrávky."
          );
        }
      }
    }

    void loadRecoveryState();

    return () => {
      cancelled = true;
    };
  }, []);

  // recoverRecording asks the server to finalize one unfinished live recording.
  async function recoverRecording(recordingId: string) {
    setRecoveringId(recordingId);
    setMessage("Obnovuji nahrávku...");

    try {
      const response = await fetch(`/api/recordings/${recordingId}/recover-live`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; warnings?: unknown }
        | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Obnova nahrávky selhala.");
        return;
      }

      const hasSearchWarning = hasTranscriptSearchIndexWarning(payload);
      const path = `/recordings/${recordingId}`;

      if (hasSearchWarning) {
        setMessage(TRANSCRIPT_SEARCH_INDEX_WARNING_MESSAGE);
      }

      router.push(hasSearchWarning ? addTranscriptSearchIndexWarningToPath(path) : path);
      router.refresh();
    } catch {
      setMessage("Obnova nahrávky selhala. Zkontrolujte připojení a zkuste to znovu.");
    } finally {
      setRecoveringId(null);
    }
  }

  if (recordings.length === 0 && !message) {
    return null;
  }

  return (
    <section className="live-recovery-panel" aria-label="Nedokončené live nahrávky">
      <div className="live-recovery-panel-header">
        <RotateCcw size={16} />
        <strong>Nedokončené live nahrávky</strong>
      </div>
      {message ? <p aria-live="polite" role="status">{message}</p> : null}
      {recordings.map((recording) => (
        <article key={recording.id}>
          <div>
            <span>{recording.title}</span>
            <small>
              {formatDuration(recording.duration_seconds)} |{" "}
              {recording.segment_count > 0
                ? `${recording.segment_count} částí | ${formatFileSize(recording.storage_bytes)} | `
                : "bez uloženého audia | "}
              {recording.transcript_chars} znaků přepisu
            </small>
          </div>
          <button
            disabled={recoveringId === recording.id}
            onClick={() => recoverRecording(recording.id)}
            type="button"
          >
            {recoveringId === recording.id ? "Obnovuji..." : "Obnovit"}
          </button>
        </article>
      ))}
    </section>
  );
}
