"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteRecordingAction } from "@/lib/recordings/actions";
import {
  markNearestOptimisticDeleteTarget,
  restoreOptimisticDeleteTarget
} from "@/components/optimistic-delete";

type DeleteRecordingFormProps = {
  deleteAction?: (formData: FormData) => Promise<void>;
  label?: string;
  next?: "/recordings";
  recordingId: string;
  variant?: "compact" | "danger" | "icon";
};

const recordingDeleteTargetSelector =
  ".recordings-row, .recording-object-header, [data-recording-delete-target]";

// isRedirectSignal preserves Next navigation control flow before local failure recovery.
function isRedirectSignal(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}

// DeleteRecordingForm soft-deletes a recording after user confirmation.
export function DeleteRecordingForm({
  deleteAction = deleteRecordingAction,
  label,
  next,
  recordingId,
  variant = "icon"
}: DeleteRecordingFormProps) {
  const effectiveLabel = label ?? (variant === "compact" ? "Koš" : "Smazat");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteErrorRef = useRef<HTMLParagraphElement | null>(null);
  const optimisticTargetRef = useRef<HTMLElement | null>(null);

  // Keep newly restored failure feedback inside the nearest visible viewport edge.
  useEffect(() => {
    if (deleteError) deleteErrorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [deleteError]);

  // handleSubmit prevents accidental moves to Trash and hides the row optimistically.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm("Přesunout nahrávku do Koše?");

    if (!confirmed) {
      event.preventDefault();
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);
    optimisticTargetRef.current = markNearestOptimisticDeleteTarget(
      event.currentTarget,
      recordingDeleteTargetSelector
    );
  }

  // runDelete restores the exact optimistic target when an unexpected action failure settles.
  async function runDelete(formData: FormData) {
    try {
      await deleteAction(formData);
    } catch (error) {
      if (isRedirectSignal(error)) throw error;
      restoreOptimisticDeleteTarget(optimisticTargetRef.current);
      optimisticTargetRef.current = null;
      setIsDeleting(false);
      setDeleteError("Nahrávku se nepodařilo přesunout do Koše.");
    }
  }

  return (
    <>
      <form
        action={runDelete}
        className={`delete-recording-form delete-recording-${variant}`}
        onSubmit={handleSubmit}
      >
        <input defaultValue={recordingId} name="recordingId" type="hidden" />
        {next ? <input defaultValue={next} name="next" type="hidden" /> : null}
        <button aria-label={effectiveLabel} disabled={isDeleting} title={effectiveLabel} type="submit">
          <Trash2 size={16} />
          {variant === "danger" ? <span>{isDeleting ? "Mažu..." : effectiveLabel}</span> : null}
          {variant === "compact" ? (
            <span className="recording-action-label">{isDeleting ? "Mažu..." : effectiveLabel}</span>
          ) : null}
          {variant === "icon" ? <span className="visually-hidden">{effectiveLabel}</span> : null}
        </button>
      </form>
      {deleteError ? (
        <p className="delete-recording-error" ref={deleteErrorRef} role="alert">
          {deleteError}
        </p>
      ) : null}
    </>
  );
}
