"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { copyTextToClipboard } from "@/components/transcript-tabs/export-utils";
import { formatTokenTimestamp } from "@/components/transcript-tabs/speaker-blocks";
import type { TranscriptEvidenceReference, TranscriptTarget } from "@/components/transcript-tabs/types";

const COPY_FEEDBACK_MS = 1600;

type CopyState = "idle" | "copied" | "failed";

export type EvidenceSpeakerResolver = (target: TranscriptTarget) => string | null;

// useCopyFeedback copies text to the clipboard and exposes a short-lived copied/failed state for one control.
function useCopyFeedback() {
  const [state, setState] = useState<CopyState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // copy writes the text and schedules the feedback reset.
  async function copy(text: string) {
    try {
      await copyTextToClipboard(text);
      setState("copied");
    } catch {
      setState("failed");
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
  }

  return { copy, state };
}

// InlineCopyButton is the light text-only copy action placed right after an item title.
export function InlineCopyButton({ label, text }: { label: string; text: string }) {
  const { copy, state } = useCopyFeedback();

  return (
    <button
      aria-label={`Kopírovat text: ${label}`}
      className="structured-inline-copy"
      data-copy-state={state}
      onClick={() => void copy(text)}
      title="Kopírovat jen text"
      type="button"
    >
      {state === "copied" ? "Zkopírováno" : state === "failed" ? "Nelze kopírovat" : "kopírovat"}
    </button>
  );
}

// StructuredItemActions renders the full-item copy action followed by the delete action for one structured row.
export function StructuredItemActions({
  canDelete,
  copyText,
  deleteLabel,
  isDeleting,
  onDelete
}: {
  canDelete: boolean;
  copyText: () => string;
  deleteLabel: string;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const { copy, state } = useCopyFeedback();
  const copyLabel = state === "copied" ? "Zkopírováno" : state === "failed" ? "Kopírování selhalo" : "Kopírovat celou položku";

  return (
    <div className="structured-item-actions">
      <button
        aria-label={copyLabel}
        className="structured-item-copy"
        data-copy-state={state}
        onClick={() => void copy(copyText())}
        title={copyLabel}
        type="button"
      >
        {state === "copied" ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
      </button>
      <button
        aria-label={deleteLabel}
        className="structured-task-delete"
        disabled={!canDelete || isDeleting}
        onClick={onDelete}
        title={deleteLabel}
        type="button"
      >
        <Trash2 aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

// getEvidenceLocation describes where a quote sits in the transcript (time and speaker) for clipboard output.
export function getEvidenceLocation(
  reference: TranscriptEvidenceReference,
  resolveTarget: (reference: TranscriptEvidenceReference) => TranscriptTarget | null,
  resolveSpeaker?: EvidenceSpeakerResolver
) {
  const target = resolveTarget(reference);

  if (!target) {
    return [];
  }

  return [
    target.startMs === null ? null : formatTokenTimestamp(target.startMs, 0),
    resolveSpeaker?.(target) ?? null
  ];
}

// useStructuredItemGroupDelete confirms, optimistically hides and deletes one logical decision/risk group.
export function useStructuredItemGroupDelete({
  confirmText,
  endpoint,
  failureText,
  onDeleted
}: {
  confirmText: string;
  endpoint: string | null;
  failureText: string;
  onDeleted?: (ids: string[]) => void;
}) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // remove asks for confirmation, calls the delete route and restores the row on failure.
  async function remove() {
    if (!endpoint || isDeleting || !window.confirm(confirmText)) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);
    setIsDeleted(true);

    try {
      const response = await fetch(endpoint, { credentials: "same-origin", method: "DELETE" });
      const payload = await response.json().catch(() => null) as { ids?: unknown; ok?: unknown } | null;

      if (!response.ok || payload?.ok !== true) {
        throw new Error("Structured item delete failed.");
      }

      const ids = Array.isArray(payload.ids)
        ? payload.ids.filter((id): id is string => typeof id === "string")
        : [];
      onDeleted?.(ids);
    } catch {
      setIsDeleted(false);
      setDeleteError(failureText);
    } finally {
      setIsDeleting(false);
    }
  }

  return { deleteError, isDeleted, isDeleting, remove };
}
