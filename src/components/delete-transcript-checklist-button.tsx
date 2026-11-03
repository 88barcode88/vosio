"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useRecordingCapabilities } from "@/components/recording-capability-context";
import { checklistSnapshotSchema, formatChecklistCounts, snapshotRowCounts, type ChecklistReview } from "@/lib/ai/checklist-delete";

// DeleteTranscriptChecklistButton reviews the complete server snapshot before one atomic delete of tasks, decisions and risks.
export function DeleteTranscriptChecklistButton({ transcriptId, onDeleted, onPending }: {
  transcriptId: string;
  onDeleted?: (itemIds: string[], outputIds: string[]) => void;
  onPending?: (itemIds: string[] | null) => void;
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
      const parsedSnapshot = checklistSnapshotSchema.safeParse(review?.snapshot);
      const rows = parsedSnapshot.success ? snapshotRowCounts(parsedSnapshot.data) : null;
      if (!reviewResponse.ok || !review || !rows || review.snapshot.transcriptId !== scope
        || review.rowCount !== rows.tasks + rows.decisions + rows.risks
        || (["tasks", "decisions", "risks"] as const).some((kind) => !Number.isInteger(review.logicalCounts?.[kind])
          || review.logicalCounts[kind] < 0 || review.logicalCounts[kind] > rows[kind])) {
        throw new Error("Checklist se nepodařilo připravit ke smazání.");
      }
      if (scopeRef.current !== scope) return;
      if (review.rowCount === 0) { setMessage("Checklist je prázdný."); return; }
      if (!window.confirm(`Smazat celý checklist? Odstraní se ${formatChecklistCounts(review.logicalCounts)} tohoto přepisu. Původní AI výstupy, zápisy, shrnutí, nahrávka a přepis zůstanou.`)) return;
      const itemIds = [...review.snapshot.tasks, ...review.snapshot.decisions, ...review.snapshot.risks].map((row) => row.id);
      onPending?.(itemIds);
      const response = await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot: review.snapshot }) });
      const result = await response.json().catch(() => null) as { deletedIds?: string[]; suppressionIds?: string[]; transcriptId?: string; ok?: boolean } | null;
      if (response.status === 409) throw new Error("Checklist se změnil. Klikněte znovu pro obnovení rozsahu a nové potvrzení.");
      if (!response.ok || !result?.ok || result.transcriptId !== scope || !Array.isArray(result.deletedIds)
        || !Array.isArray(result.suppressionIds)) throw new Error("Smazání se nepodařilo potvrdit. Obnovte checklist a ověřte aktuální stav.");
      const outputIds = review.snapshot.outputs.map((output) => output.id);
      if (result.deletedIds.length !== itemIds.length || result.suppressionIds.length !== outputIds.length
        || new Set(result.deletedIds).size !== itemIds.length || new Set(result.suppressionIds).size !== outputIds.length
        || result.deletedIds.some((id) => !itemIds.includes(id)) || result.suppressionIds.some((id) => !outputIds.includes(id))) {
        throw new Error("Smazání se nepodařilo potvrdit. Obnovte checklist a ověřte aktuální stav.");
      }
      onDeleted?.(result.deletedIds, result.suppressionIds);
      if (scopeRef.current === scope) setMessage(`Checklist smazán (${formatChecklistCounts(review.logicalCounts)}). Původní AI výstupy zůstaly uložené.`);
    } catch (error) {
      if (scopeRef.current === scope) setMessage(error instanceof Error ? error.message : "Smazání se nepodařilo ověřit.");
    } finally {
      if (scopeRef.current === scope) { onPending?.(null); setPending(false); }
      inFlightRef.current = false;
    }
  }

  if (!capabilities.delete) return null;
  return <div className="checklist-delete-control">
    <button disabled={pending} onClick={() => void deleteChecklist()} type="button"><Trash2 size={15} />{pending ? "Připravuji smazání…" : "Smazat celý checklist"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
