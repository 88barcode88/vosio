"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteRecordingAction } from "@/lib/recordings/actions";
import { markNearestOptimisticDeleteTarget } from "@/components/optimistic-delete";

type DeleteRecordingFormProps = {
  label?: string;
  next?: "/recordings";
  recordingId: string;
  variant?: "danger" | "icon";
};

// DeleteRecordingForm soft-deletes a recording after user confirmation.
export function DeleteRecordingForm({
  label = "Smazat",
  next,
  recordingId,
  variant = "icon"
}: DeleteRecordingFormProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  // handleSubmit prevents accidental moves to Trash and hides the row optimistically.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm("Přesunout nahrávku do Koše?");

    if (!confirmed) {
      event.preventDefault();
      return;
    }

    setIsDeleting(true);
    markNearestOptimisticDeleteTarget(event.currentTarget, ".recordings-row, .recording-object-header");
  }

  return (
    <form
      action={deleteRecordingAction}
      className={`delete-recording-form delete-recording-${variant}`}
      onSubmit={handleSubmit}
    >
      <input defaultValue={recordingId} name="recordingId" type="hidden" />
      {next ? <input defaultValue={next} name="next" type="hidden" /> : null}
      <button aria-label={label} disabled={isDeleting} title={label} type="submit">
        <Trash2 size={16} />
        {variant === "danger" ? <span>{isDeleting ? "Mažu..." : label}</span> : <span className="visually-hidden">{label}</span>}
      </button>
    </form>
  );
}
