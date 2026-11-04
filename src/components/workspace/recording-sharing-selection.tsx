"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RecordingRow } from "@/lib/recordings/types";

type SelectionContext = {
  ids: string[]; setIds: (ids: string[]) => void; busy: boolean; setBusy: (busy: boolean) => void;
  // eligible = every selectable row; shareable and trashable are the subsets each bulk action may use.
  eligible: string[]; shareable: string[]; trashable: string[];
};
const SharingSelectionContext = createContext<SelectionContext | null>(null);

// RecordingSharingSelectionProvider shares the row selection with the bounded bulk sharing and bulk Trash actions.
export function RecordingSharingSelectionProvider({ recordings, children }: { recordings: RecordingRow[]; children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const shareable = useMemo(() => recordings.filter((row) => row.visibility === "private" && row.capabilities?.manageAccess).map((row) => row.id), [recordings]);
  const trashable = useMemo(() => recordings.filter((row) => row.capabilities?.delete).map((row) => row.id), [recordings]);
  const eligible = useMemo(() => Array.from(new Set([...shareable, ...trashable])), [shareable, trashable]);
  // Prune only idle selection; a busy or uncertain operation retains its own immutable payload.
  useEffect(() => { if (!busy) setIds((current) => current.some((id) => !eligible.includes(id)) ? current.filter((id) => eligible.includes(id)) : current); }, [busy, eligible]);
  return <SharingSelectionContext.Provider value={{ ids: ids.filter((id) => eligible.includes(id)), setIds, busy, setBusy, eligible, shareable, trashable }}>{children}</SharingSelectionContext.Provider>;
}

// useRecordingSharingSelection returns only the current list's client selection, never authorization.
export function useRecordingSharingSelection() { return useContext(SharingSelectionContext); }

// RecordingSharingCheckbox selects a visible row the user may share or move to Trash, with a full touch label.
export function RecordingSharingCheckbox({ recordingId, title }: { recordingId: string; title: string }) {
  const selection = useRecordingSharingSelection();
  if (!selection?.eligible.includes(recordingId)) return <span className="recording-sharing-checkbox-placeholder" />;
  const checked = selection.ids.includes(recordingId);
  return <label className="recording-sharing-checkbox"><input aria-label={`Vybrat nahrávku: ${title}`} type="checkbox" checked={checked}
    disabled={selection.busy || (!checked && selection.ids.length >= 100)}
    onChange={(event) => selection.setIds(event.target.checked ? [...selection.ids, recordingId] : selection.ids.filter((id) => id !== recordingId))} /></label>;
}
