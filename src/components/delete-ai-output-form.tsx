"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteAiOutputAction } from "@/lib/ai/actions";
import { markNearestOptimisticDeleteTarget } from "@/components/optimistic-delete";

type DeleteAiOutputFormProps = {
  confirmationMessage?: string;
  label?: string;
  next: string;
  outputId?: string;
  outputIds?: string[];
  targetSelector?: string;
};

// DeleteAiOutputForm removes one or more saved AI generations after explicit confirmation.
export function DeleteAiOutputForm({
  confirmationMessage,
  label = "Smazat",
  next,
  outputId,
  outputIds,
  targetSelector = ".ai-output-detail"
}: DeleteAiOutputFormProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const ids = getDeleteOutputIds(outputId, outputIds);

  // handleSubmit prevents accidental deletion and hides the output card optimistically.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      confirmationMessage ?? "Smazat tento AI výstup? Přepis a nahrávka zůstanou uložené."
    );

    if (!confirmed) {
      event.preventDefault();
      return;
    }

    setIsDeleting(true);
    markNearestOptimisticDeleteTarget(event.currentTarget, targetSelector);
  }

  return (
    <form action={deleteAiOutputAction} className="ai-output-delete-form" onSubmit={handleSubmit}>
      {ids.map((id) => (
        <input defaultValue={id} key={id} name="outputIds" type="hidden" />
      ))}
      <input defaultValue={next} name="next" type="hidden" />
      <button aria-label={label} disabled={isDeleting || ids.length === 0} title={label} type="submit">
        <Trash2 size={14} />
        <span>{isDeleting ? "Mažu..." : label}</span>
      </button>
    </form>
  );
}

// getDeleteOutputIds deduplicates hidden form ids for single and grouped AI output deletes.
function getDeleteOutputIds(outputId?: string, outputIds?: string[]) {
  return Array.from(new Set([...(outputIds ?? []), outputId].filter((id): id is string => Boolean(id))));
}
