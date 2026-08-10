"use client";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { markNearestOptimisticDeleteTarget, restoreOptimisticDeleteTarget } from "@/components/optimistic-delete";
import { Modal } from "@/components/ui/modal";
import { purgeRecordingAction } from "@/lib/recordings/actions";

export type TrashRecordingAction = (formData: FormData) => Promise<void>;

type PurgeRecordingFormProps = {
  actionContext?: Record<string, string>;
  next?: string;
  purgeAction?: TrashRecordingAction;
  recordingId: string;
};

// isRedirectSignal preserves Next navigation control flow before local failure recovery.
function isRedirectSignal(error: unknown) {
  if (!error || typeof error !== "object" || !("digest" in error)) return false;
  return typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT");
}

// PurgeRecordingForm permanently removes a Trash item behind an accessible confirmation modal.
export function PurgeRecordingForm({
  actionContext,
  next = "/trash",
  purgeAction = purgeRecordingAction,
  recordingId
}: PurgeRecordingFormProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const optimisticTargetRef = useRef<HTMLElement | null>(null);

  // handleSubmit hides only the confirmed row and locks the destructive controls while it settles.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    setDeleteError(null);
    setIsDeleting(true);
    optimisticTargetRef.current = markNearestOptimisticDeleteTarget(
      event.currentTarget,
      ".trash-recording-row, [data-trash-recording-target]"
    );
  }

  // runPurge restores the exact row after an unexpected action rejection.
  async function runPurge(formData: FormData) {
    try {
      await purgeAction(formData);
    } catch (error) {
      if (isRedirectSignal(error)) throw error;
      restoreOptimisticDeleteTarget(optimisticTargetRef.current);
      optimisticTargetRef.current = null;
      setIsDeleting(false);
      setIsConfirming(false);
      setDeleteError("Nahrávku se nepodařilo trvale smazat. Zkuste to znovu.");
    }
  }

  return (
    <>
      <button
        aria-label="Smazat trvale"
        className="trash-action trash-action-danger"
        disabled={isDeleting}
        onClick={() => {
          setDeleteError(null);
          setIsConfirming(true);
        }}
        title="Smazat trvale"
        type="button"
      >
        <Trash2 size={15} />
        <span>Smazat trvale</span>
      </button>
      <Modal
        className="trash-purge-modal"
        label="Trvale smazat nahrávku"
        onClose={() => {
          if (!isDeleting) setIsConfirming(false);
        }}
        open={isConfirming}
      >
        <div className="trash-purge-copy">
          <span>Trvalé smazání</span>
          <h2>Smazat nahrávku bez možnosti obnovení?</h2>
          <p>Odstraní se audio soubor, přepis i všechny AI výstupy.</p>
        </div>
        <form action={runPurge} className="trash-purge-form" onSubmit={handleSubmit}>
          <input defaultValue={recordingId} name="recordingId" type="hidden" />
          <input defaultValue={next} name="next" type="hidden" />
          {Object.entries(actionContext ?? {}).map(([name, value]) => (
            <input defaultValue={value} key={name} name={name} type="hidden" />
          ))}
          <button disabled={isDeleting} onClick={() => setIsConfirming(false)} type="button">Zrušit</button>
          <button className="trash-confirm-danger" disabled={isDeleting} type="submit">
            {isDeleting ? "Mažu..." : "Smazat trvale"}
          </button>
        </form>
      </Modal>
      {deleteError ? <p className="trash-action-error" role="alert">{deleteError}</p> : null}
    </>
  );
}
