"use client";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { markNearestOptimisticDeleteTarget, restoreOptimisticDeleteTarget } from "@/components/optimistic-delete";
import type { TrashRecordingAction } from "@/components/purge-recording-form";
import { restoreRecordingAction } from "@/lib/recordings/actions";

type RestoreRecordingFormProps = {
  actionContext?: Record<string, string>;
  next?: string;
  recordingId: string;
  restoreAction?: TrashRecordingAction;
};

// isRedirectSignal preserves Next navigation control flow before local failure recovery.
function isRedirectSignal(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}

// RestoreRecordingForm returns one trashed recording to its exact captured status.
export function RestoreRecordingForm({
  actionContext,
  next = "/trash",
  recordingId,
  restoreAction = restoreRecordingAction
}: RestoreRecordingFormProps) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const optimisticTargetRef = useRef<HTMLElement | null>(null);

  // handleSubmit hides and locks only the row currently being restored.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    setRestoreError(null);
    setIsRestoring(true);
    optimisticTargetRef.current = markNearestOptimisticDeleteTarget(
      event.currentTarget,
      ".trash-recording-row, [data-trash-recording-target]"
    );
  }

  // runRestore restores the exact row after an unexpected action rejection.
  async function runRestore(formData: FormData) {
    try {
      await restoreAction(formData);
    } catch (error) {
      if (isRedirectSignal(error)) throw error;
      restoreOptimisticDeleteTarget(optimisticTargetRef.current);
      optimisticTargetRef.current = null;
      setIsRestoring(false);
      setRestoreError("Nahrávku se nepodařilo obnovit. Zkuste to znovu.");
    }
  }

  return (
    <>
      <form action={runRestore} className="trash-restore-form" onSubmit={handleSubmit}>
        <input defaultValue={recordingId} name="recordingId" type="hidden" />
        <input defaultValue={next} name="next" type="hidden" />
        {Object.entries(actionContext ?? {}).map(([name, value]) => (
          <input defaultValue={value} key={name} name={name} type="hidden" />
        ))}
        <button className="trash-action" disabled={isRestoring} type="submit">
          <RotateCcw size={15} />
          <span>{isRestoring ? "Obnovuji..." : "Obnovit"}</span>
        </button>
      </form>
      {restoreError ? <p className="trash-action-error" role="alert">{restoreError}</p> : null}
    </>
  );
}
