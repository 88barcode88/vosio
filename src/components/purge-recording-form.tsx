"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { purgeRecordingAction } from "@/lib/recordings/actions";
import { markNearestOptimisticDeleteTarget } from "@/components/optimistic-delete";

type PurgeRecordingFormProps = {
  next?: string;
  recordingId: string;
};

// PurgeRecordingForm permanently deletes a recording that is already in Trash.
export function PurgeRecordingForm({ next = "/trash", recordingId }: PurgeRecordingFormProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  // handleSubmit guards the destructive permanent delete step and hides the trash row immediately.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      "Trvale smazat nahrávku, soubor, přepis a AI výstupy? Tohle už nepůjde obnovit."
    );

    if (!confirmed) {
      event.preventDefault();
      return;
    }

    setIsDeleting(true);
    markNearestOptimisticDeleteTarget(event.currentTarget, ".utility-row");
  }

  return (
    <form action={purgeRecordingAction} className="purge-recording-form" onSubmit={handleSubmit}>
      <input defaultValue={recordingId} name="recordingId" type="hidden" />
      <input defaultValue={next} name="next" type="hidden" />
      <button disabled={isDeleting} type="submit">
        <Trash2 size={14} />
        <span>{isDeleting ? "Mažu..." : "Smazat trvale"}</span>
      </button>
    </form>
  );
}
