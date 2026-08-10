"use client";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteAiOutputAction } from "@/lib/ai/actions";
import {
  markNearestOptimisticDeleteTarget,
  restoreOptimisticDeleteTarget
} from "@/components/optimistic-delete";

type DeleteAiOutputFormProps = {
  confirmationMessage?: string;
  deleteAction?: (formData: FormData) => Promise<void>;
  label?: string;
  next: string;
  outputId?: string;
  outputIds?: string[];
  targetSelector?: string;
};

// DeleteAiOutputForm removes one or more saved AI generations after explicit confirmation.
export function DeleteAiOutputForm({
  confirmationMessage,
  deleteAction = deleteAiOutputAction,
  label = "Smazat",
  next,
  outputId,
  outputIds,
  targetSelector = "[data-ai-output-delete-target], .ai-output-detail"
}: DeleteAiOutputFormProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const optimisticTargetRef = useRef<HTMLElement | null>(null);
  const ids = getDeleteOutputIds(outputId, outputIds);

  // handleSubmit prevents accidental deletion and hides only the nearest output card optimistically.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      confirmationMessage ?? "Smazat tento AI výstup? Přepis a nahrávka zůstanou uložené."
    );

    if (!confirmed) {
      event.preventDefault();
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);
    optimisticTargetRef.current = markNearestOptimisticDeleteTarget(
      event.currentTarget,
      targetSelector
    );
  }

  // runDelete restores the exact target when an unexpected action rejection settles.
  async function runDelete(formData: FormData) {
    try {
      await deleteAction(formData);
    } catch (error) {
      if (isRedirectSignal(error)) throw error;
      restoreOptimisticDeleteTarget(optimisticTargetRef.current);
      optimisticTargetRef.current = null;
      setIsDeleting(false);
      setDeleteError("AI výstup se nepodařilo smazat. Zkuste to znovu.");
    }
  }

  return (
    <>
      <form action={runDelete} className="ai-output-delete-form" onSubmit={handleSubmit}>
        {ids.map((id) => (
          <input defaultValue={id} key={id} name="outputIds" type="hidden" />
        ))}
        <input defaultValue={next} name="next" type="hidden" />
        <button aria-label={label} disabled={isDeleting || ids.length === 0} title={label} type="submit">
          <Trash2 size={14} />
          <span>{isDeleting ? "Mažu..." : label}</span>
        </button>
      </form>
      {deleteError ? <p className="ai-output-delete-error" role="alert">{deleteError}</p> : null}
    </>
  );
}

// getDeleteOutputIds deduplicates hidden form ids for single and grouped AI output deletes.
function getDeleteOutputIds(outputId?: string, outputIds?: string[]) {
  return Array.from(new Set([...(outputIds ?? []), outputId].filter((id): id is string => Boolean(id))));
}

// isRedirectSignal preserves Next navigation control flow before local failure recovery.
function isRedirectSignal(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}
