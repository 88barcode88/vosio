"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useRecordingCapabilities } from "@/components/recording-capability-context";
import { checklistSnapshotSchema, type ChecklistReview } from "@/lib/ai/checklist-delete";

// DeleteTranscriptChecklistButton reviews the complete server snapshot before one atomic task-only delete.
export function DeleteTranscriptChecklistButton({ transcriptId, onDeleted, onPending }: {
  transcriptId: string;
  onDeleted?: (taskIds: string[], outputIds: string[]) => void;
  onPending?: (taskIds: string[] | null) => void;
}) {
  const { capabilities } = useRecordingCapabilities();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const scopeRef = useRef<string | null>(transcriptId);
  const inFlightRef = useRef(false);
  useLayoutEffect(() => {
    scopeRef.current = transcriptId;
    return () => { scopeRef.current = null; };
  }, [transcriptId]);

  // deleteChecklist keeps the displayed confirmation bound to exact IDs and restores rows on failure.
  async function deleteChecklist() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(true);
    setMessage(null);
    const scope = transcriptId;
    try {
      const url = `/api/transcripts/${scope}/checklist`;
      const reviewResponse = await fetch(url, { cache: "no-store" });
      const review = await reviewResponse.json().catch(() => null) as ChecklistReview | null;
      if (!reviewResponse.ok || !review || !checklistSnapshotSchema.safeParse(review.snapshot).success
        || review.snapshot.transcriptId !== scope || review.rowCount !== review.snapshot.tasks.length
        || !Number.isInteger(review.logicalCount) || review.logicalCount < 0 || review.logicalCount > review.rowCount) {
        throw new Error("Checklist se nepodařilo připravit ke smazání.");
      }
      if (scopeRef.current !== scope) return;
      if (review.rowCount === 0) { setMessage("Checklist je prázdný."); return; }
      if (!window.confirm(`Smazat celý checklist (${review.logicalCount} položek)? Odstraní se všechny úkoly tohoto přepisu ze všech zdrojových výstupů. Zápisy, shrnutí, původní AI výstupy, nahrávka a přepis zůstanou.`)) return;
      onPending?.(review.snapshot.tasks.map((task) => task.id));
      const response = await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot: review.snapshot }) });
      const result = await response.json().catch(() => null) as { deletedIds?: string[]; suppressionIds?: string[]; transcriptId?: string; ok?: boolean } | null;
      if (response.status === 409) throw new Error("Checklist se změnil. Klikněte znovu pro obnovení rozsahu a nové potvrzení.");
      if (!response.ok || !result?.ok || result.transcriptId !== scope || !Array.isArray(result.deletedIds)
        || !Array.isArray(result.suppressionIds)) throw new Error("Smazání se nepodařilo potvrdit. Obnovte checklist a ověřte aktuální stav.");
      const taskIds = review.snapshot.tasks.map((task) => task.id);
      const outputIds = review.snapshot.outputs.map((output) => output.id);
      if (result.deletedIds.length !== taskIds.length || result.suppressionIds.length !== outputIds.length
        || new Set(result.deletedIds).size !== taskIds.length || new Set(result.suppressionIds).size !== outputIds.length
        || result.deletedIds.some((id) => !taskIds.includes(id)) || result.suppressionIds.some((id) => !outputIds.includes(id))) {
        throw new Error("Smazání se nepodařilo potvrdit. Obnovte checklist a ověřte aktuální stav.");
      }
      onDeleted?.(result.deletedIds, result.suppressionIds);
      if (scopeRef.current === scope) setMessage("Checklist smazán. Původní AI výstupy zůstaly uložené.");
    } catch (error) {
      if (scopeRef.current === scope) setMessage(error instanceof Error ? error.message : "Smazání se nepodařilo ověřit.");
    } finally {
      if (scopeRef.current === scope) { onPending?.(null); setPending(false); }
      inFlightRef.current = false;
    }
  }

  if (!capabilities.delete) return null;
  return <div className="checklist-delete-control">
    <button disabled={pending} onClick={() => void deleteChecklist()} type="button"><Trash2 size={14} />{pending ? "Připravuji smazání…" : "Smazat celý checklist"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
