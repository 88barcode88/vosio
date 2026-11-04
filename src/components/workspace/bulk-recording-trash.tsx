"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { trashRecordingsBulkAction, type TrashBulkResult } from "@/lib/recordings/actions";

type BulkRecordingTrashProps = {
  // Selected rows the user may move to Trash; the server re-checks each one.
  ids: string[];
  // Rows selected in the list that are not allowed to go to Trash (shown as a count only).
  skippedCount: number;
  disabled?: boolean;
  // Keeps only the given ids selected after the action settles.
  onSettled: (remainingIds: string[]) => void;
  // Reports the outcome; the parent shows it outside the toolbar, which hides once nothing stays selected.
  onMessage: (message: { tone: "status" | "alert"; text: string } | null) => void;
  trashAction?: (formData: FormData) => Promise<TrashBulkResult>;
};

// formatRecordingCount writes "1 nahrávku / 2 nahrávky / 5 nahrávek" for Czech sentences.
function formatRecordingCount(count: number) {
  if (count === 1) return "1 nahrávku";
  if (count >= 2 && count <= 4) return `${count} nahrávky`;
  return `${count} nahrávek`;
}

// BulkRecordingTrash moves the selected recordings to Trash after confirmation and keeps failed ones selected.
export function BulkRecordingTrash({ ids, skippedCount, disabled = false, onSettled, onMessage: setMessage, trashAction = trashRecordingsBulkAction }: BulkRecordingTrashProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  // moveToTrash confirms, sends one bounded request and reports partial results without provider detail.
  async function moveToTrash() {
    if (ids.length === 0 || pending) return;
    const skippedNote = skippedCount > 0 ? ` ${formatRecordingCount(skippedCount)} z výběru smazat nemůžete, ty zůstanou.` : "";
    if (!window.confirm(`Přesunout ${formatRecordingCount(ids.length)} do Koše?${skippedNote}`)) return;
    setPending(true);
    setMessage(null);
    const formData = new FormData();
    for (const id of ids) formData.append("recordingId", id);
    try {
      const result = await trashAction(formData);
      const invalidBulk = result.failures.some((failure) => failure.id === "bulk");
      const failedIds = invalidBulk ? ids : ids.filter((id) => result.failures.some((failure) => failure.id === id));
      onSettled(failedIds);
      setMessage(failedIds.length === 0
        ? { tone: "status", text: `Do Koše jsme přesunuli ${formatRecordingCount(result.succeededIds.length)}.` }
        : { tone: "alert", text: `${formatRecordingCount(failedIds.length)} se nepodařilo přesunout do Koše. Zůstaly vybrané, zkuste to znovu.` });
      router.refresh();
    } catch {
      setMessage({ tone: "alert", text: "Vybrané nahrávky se nepodařilo přesunout do Koše. Zkuste to znovu." });
    } finally {
      setPending(false);
    }
  }

  return (
    <button className="recording-selection-trash" disabled={disabled || pending || ids.length === 0} onClick={() => void moveToTrash()} type="button"
      title={ids.length === 0 ? "Žádnou z vybraných nahrávek nemůžete přesunout do Koše." : undefined}>
      <Trash2 aria-hidden="true" size={15} />
      {pending ? "Přesouvám…" : `Do koše${ids.length > 0 ? ` (${ids.length})` : ""}`}
    </button>
  );
}
