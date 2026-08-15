"use client";

import { useEffect, useRef, useState } from "react";
import { PurgeRecordingForm, type TrashRecordingAction } from "@/components/purge-recording-form";
import { RestoreRecordingForm } from "@/components/restore-recording-form";
import { Modal } from "@/components/ui/modal";
import {
  purgeRecordingMutationAction,
  restoreRecordingsBulkAction,
  type TrashBulkResult,
  type TrashItemResult,
  type TrashMutationCode
} from "@/lib/recordings/actions";
import {
  getRecordingAudioAvailabilityLabel,
  type RecordingClientView
} from "@/lib/recordings/client-view";
import { formatFileSize, formatRecordingDate } from "@/lib/recordings/types";

const BULK_SELECTION_LIMIT = 100;
const PURGE_CONCURRENCY = 2;
const PURGE_DELAY_MS = 86_400_000;

export type TrashRestoreBulkAction = (formData: FormData) => Promise<TrashBulkResult>;
export type TrashPurgeItemAction = (formData: FormData) => Promise<TrashItemResult>;

type PurgeQueueProgress = {
  completed: number;
  running: number;
  total: number;
};

// getRecordingRow finds a rendered row without interpolating untrusted ids into a selector.
function getRecordingRow(recordingId: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-recording-id]"))
    .find((row) => row.dataset.recordingId === recordingId);
}

// appendActionContext carries fixture metadata without allowing it to add mutation ids.
function appendActionContext(formData: FormData, actionContext?: Record<string, string>) {
  for (const [key, value] of Object.entries(actionContext ?? {})) {
    if (key !== "recordingId") formData.append(key, value);
  }
}

// TrashRecordingsManager owns bounded selection, partial settlements and the two-request purge queue.
export function TrashRecordingsManager({
  recordings,
  nowMs,
  restoreBulkAction = restoreRecordingsBulkAction,
  purgeItemAction = purgeRecordingMutationAction,
  restoreAction,
  purgeAction,
  actionContext
}: {
  recordings: RecordingClientView[];
  nowMs: number;
  restoreBulkAction?: TrashRestoreBulkAction;
  purgeItemAction?: TrashPurgeItemAction;
  restoreAction?: TrashRecordingAction;
  purgeAction?: TrashRecordingAction;
  actionContext?: Record<string, string>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [restorePending, setRestorePending] = useState(false);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeProgress, setPurgeProgress] = useState<PurgeQueueProgress | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const cancelPurgeRef = useRef(false);
  const selectableIds = recordings.slice(0, BULK_SELECTION_LIMIT).map((recording) => recording.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const selectedRecordings = recordings.filter((recording) => selectedIds.has(recording.id));
  const hasRecentSelection = selectedRecordings.some((recording) => {
    const deletedAtMs = recording.deleted_at ? Date.parse(recording.deleted_at) : Number.NaN;
    return !Number.isFinite(deletedAtMs) || deletedAtMs > nowMs - PURGE_DELAY_MS;
  });

  // Keep the native select-all control truthful for partial selection.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedIds.size > 0 && !allSelected;
    }
  }, [allSelected, selectedIds]);

  // toggleRecording updates one immutable selection snapshot without exceeding the bulk contract.
  function toggleRecording(recordingId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(recordingId)) next.delete(recordingId);
      else if (next.size < BULK_SELECTION_LIMIT) next.add(recordingId);
      return next;
    });
  }

  // toggleAll selects at most the server's bounded restore limit.
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  }

  // runBulkRestore applies successful optimistic removals and retains only failed selection.
  async function runBulkRestore() {
    const recordingIds = recordings.map((recording) => recording.id).filter((id) => selectedIds.has(id));
    if (recordingIds.length === 0 || restorePending || purgeProgress) return;
    setRestorePending(true);
    setActionError(null);
    setActionNotice(null);
    const formData = new FormData();
    for (const id of recordingIds) formData.append("recordingId", id);
    appendActionContext(formData, actionContext);
    try {
      const result = await restoreBulkAction(formData);
      for (const id of result.succeededIds) {
        getRecordingRow(id)?.setAttribute("data-optimistic-deleted", "true");
      }
      const failedIds = new Set(result.failures.map((failure) => failure.id));
      const hasInvalidBulkFailure = result.failures.some(
        (failure) => failure.id === "bulk" && failure.code === "invalid_bulk"
      );
      setSelectedIds(new Set(recordingIds.filter((id) => hasInvalidBulkFailure || failedIds.has(id))));
      setActionError(result.failures.length > 0
        ? `${result.failures.length} ${result.failures.length === 1 ? "akce se nepodařila" : "akcí se nepodařilo"}. Zkuste to znovu.`
        : null);
    } catch {
      setActionError("Vybrané nahrávky se nepodařilo obnovit. Zkuste to znovu.");
    } finally {
      setRestorePending(false);
    }
  }

  // runPurgeQueue bounds Vercel work to one recording per request and two requests in flight.
  async function runPurgeQueue(recordingIds: string[]) {
    cancelPurgeRef.current = false;
    setPurgeModalOpen(false);
    setActionError(null);
    setActionNotice(null);
    setPurgeProgress({ completed: 0, running: 0, total: recordingIds.length });
    const startedIds = new Set<string>();
    const succeededIds: string[] = [];
    const failures: Array<{ id: string; code: TrashMutationCode }> = [];
    let cursor = 0;

    // worker owns sequential requests while sharing only the bounded queue cursor.
    async function worker() {
      while (!cancelPurgeRef.current) {
        const index = cursor;
        cursor += 1;
        if (index >= recordingIds.length) return;
        const recordingId = recordingIds[index]!;
        startedIds.add(recordingId);
        setPurgeProgress((current) => current
          ? { ...current, running: current.running + 1 }
          : current);
        const formData = new FormData();
        formData.append("recordingId", recordingId);
        appendActionContext(formData, actionContext);
        try {
          const result = await purgeItemAction(formData);
          if (result.ok) succeededIds.push(recordingId);
          else failures.push({ id: recordingId, code: result.code });
        } catch {
          failures.push({ id: recordingId, code: "purge_failed" });
        } finally {
          setPurgeProgress((current) => current
            ? { ...current, completed: current.completed + 1, running: current.running - 1 }
            : current);
        }
      }
    }

    const workerCount = Math.min(PURGE_CONCURRENCY, recordingIds.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const cancelledIds = recordingIds.filter((id) => !startedIds.has(id));
    for (const id of succeededIds) {
      getRecordingRow(id)?.setAttribute("data-optimistic-deleted", "true");
    }
    setSelectedIds(new Set([...failures.map((failure) => failure.id), ...cancelledIds]));
    setPurgeProgress(null);
    setActionNotice(cancelledIds.length > 0
      ? `Mazání zastaveno. ${cancelledIds.length} ${cancelledIds.length === 1 ? "záznam nebyl spuštěn" : "záznamy nebyly spuštěny"}.`
      : null);
    setActionError(failures.length > 0
      ? `${failures.length} ${failures.length === 1 ? "záznam se nepodařilo smazat" : "záznamy se nepodařilo smazat"}. Zkuste to znovu.`
      : null);
  }

  return (
    <>
      {recordings.length > 0 ? (
        <div className="trash-bulk-toolbar">
          <label className="trash-selection-control">
            <input
              ref={selectAllRef}
              aria-label="Vybrat všechny nahrávky v Koši"
              checked={allSelected}
              onChange={toggleAll}
              type="checkbox"
            />
          </label>
          <button disabled={selectedIds.size === 0 || restorePending || Boolean(purgeProgress)} onClick={runBulkRestore} type="button">
            {restorePending ? "Obnovuji…" : `Obnovit vybrané (${selectedIds.size})`}
          </button>
          <button
            disabled={selectedIds.size === 0 || hasRecentSelection || restorePending || Boolean(purgeProgress)}
            onClick={() => setPurgeModalOpen(true)}
            type="button"
          >
            Smazat vybrané trvale ({selectedIds.size})
          </button>
          {hasRecentSelection ? <span>Trvalé smazání je dostupné 24 hodin po přesunutí do Koše</span> : null}
        </div>
      ) : null}
      {actionError ? <p className="trash-route-alert" role="alert">{actionError}</p> : null}
      {actionNotice ? <p className="trash-route-notice" role="status">{actionNotice}</p> : null}
      {purgeProgress ? (
        <div className="trash-bulk-progress">
          <progress aria-label="Průběh trvalého mazání" max={purgeProgress.total} value={purgeProgress.completed} />
          <span>Hotovo {purgeProgress.completed} z {purgeProgress.total}</span>
          <button onClick={() => { cancelPurgeRef.current = true; }} type="button">Zastavit další mazání</button>
        </div>
      ) : null}
      <div className="utility-list trash-recording-list">
        {recordings.map((recording) => (
          <article className="trash-recording-row" data-recording-id={recording.id} key={recording.id}>
            <label className="trash-selection-control">
              <input
                aria-label={`Vybrat ${recording.title}`}
                checked={selectedIds.has(recording.id)}
                onChange={() => toggleRecording(recording.id)}
                type="checkbox"
              />
            </label>
            <div className="trash-recording-copy">
              <strong>{recording.title}</strong>
              <p>{formatFileSize(recording.file_size_bytes)} · {getRecordingAudioAvailabilityLabel(recording.audioAvailability)} · {recording.mime_type ?? "neznámý typ"}</p>
            </div>
            <time dateTime={recording.deleted_at ?? recording.updated_at}>
              {formatRecordingDate(recording.deleted_at ?? recording.updated_at)}
            </time>
            <div className="trash-recording-actions">
              <RestoreRecordingForm actionContext={actionContext} recordingId={recording.id} restoreAction={restoreAction} />
              <PurgeRecordingForm actionContext={actionContext} purgeAction={purgeAction} recordingId={recording.id} />
            </div>
          </article>
        ))}
      </div>
      <Modal label="Trvale smazat vybrané nahrávky" onClose={() => setPurgeModalOpen(false)} open={purgeModalOpen}>
        <h2>Trvale smazat {selectedIds.size} {selectedIds.size === 1 ? "nahrávku" : "nahrávky"}?</h2>
        <p>Audio, přepis a AI výstupy budou permanentně odstraněny.</p>
        <div className="trash-bulk-modal-actions">
          <button onClick={() => setPurgeModalOpen(false)} type="button">Zrušit</button>
          <button onClick={() => void runPurgeQueue(Array.from(selectedIds))} type="button">Smazat trvale</button>
        </div>
      </Modal>
    </>
  );
}
