"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatDuration } from "@/components/workspace/utils";
import { formatFileSize } from "@/lib/recordings/types";

type RecoverableRecording = {
  created_at: string;
  duration_seconds: number | null;
  id: string;
  segment_count: number;
  storage_bytes: number;
  title: string;
  transcript_chars: number;
};

// LiveRecordingRecoveryPanel lists unfinished live recordings that can be completed from saved drafts.
export function LiveRecordingRecoveryPanel() {
  const router = useRouter();
  const [recordings, setRecordings] = useState<RecoverableRecording[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/recordings/recoverable", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled) {
          setRecordings(Array.isArray(payload.recordings) ? payload.recordings : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessage("Nepodařilo se načíst nedokončené nahrávky.");
        }
      });

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
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Obnova nahrávky selhala.");
        return;
      }

      router.push(`/recordings/${recordingId}`);
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
      {message ? <p>{message}</p> : null}
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
