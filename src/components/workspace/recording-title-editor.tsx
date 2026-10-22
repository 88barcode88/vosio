"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Save, X } from "lucide-react";
import { useCloseOnSuccessfulSave } from "@/components/use-close-on-successful-save";
import { createInitialSaveActionState, type SaveAction } from "@/lib/forms/save-action-state";
import { runSaveActionSafely } from "@/lib/forms/run-save-action-safely";
import { updateRecordingTitleStateAction } from "@/lib/recordings/actions";

type RecordingTitleEditorProps = {
  embedded?: boolean;
  onPendingChange?: (pending: boolean) => void;
  recordingId: string;
  saveAction?: SaveAction;
  title: string;
};

type DismissedSaveError = {
  revision: number;
  scopeKey: string;
};

// RecordingTitleSaveButton reflects the pending state of its nearest title form.
function RecordingTitleSaveButton({ embedded = false }: { embedded?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button disabled={pending} type="submit">
      <Save aria-hidden="true" size={15} />
      {pending ? "Ukládám…" : embedded ? "Uložit název" : "Uložit"}
    </button>
  );
}

// RecordingTitleEditor saves an inbox-row title before closing its anchored popover.
export function RecordingTitleEditor({
  embedded = false,
  onPendingChange,
  recordingId,
  saveAction = updateRecordingTitleStateAction,
  title
}: RecordingTitleEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [dismissedError, setDismissedError] = useState<DismissedSaveError | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const scopedSaveAction = useCallback(
    (previousState: ReturnType<typeof createInitialSaveActionState>, formData: FormData) =>
      runSaveActionSafely(
        saveAction,
        previousState,
        formData,
        recordingId
      ),
    [recordingId, saveAction]
  );
  const [actionState, formAction, isPending] = useActionState(
    scopedSaveAction,
    createInitialSaveActionState()
  );
  useEffect(() => { onPendingChange?.(isPending); }, [isPending, onPendingChange]);
  const closeAfterSuccess = useCallback(() => { if (!embedded) setIsOpen(false); }, [embedded]);
  // dismissEditor resets the draft and hides only the current settled error revision.
  const dismissEditor = useCallback(() => {
    if (actionState.status === "error" && actionState.scopeKey === recordingId) {
      setDismissedError({
        revision: actionState.revision,
        scopeKey: recordingId
      });
    }

    setDraftTitle(title);
    setIsOpen(false);
  }, [actionState.revision, actionState.scopeKey, actionState.status, recordingId, title]);
  const isCurrentSettlement = actionState.scopeKey === recordingId;
  const isCurrentErrorDismissed =
    dismissedError?.scopeKey === recordingId
    && actionState.revision <= dismissedError.revision;

  useCloseOnSuccessfulSave({
    actionState,
    close: closeAfterSuccess,
    currentScopeKey: recordingId,
    triggerRef
  });

  useEffect(() => {
    if (!embedded) {
      setDraftTitle(title);
      setIsOpen(false);
    }
  }, [embedded, recordingId, title]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();

    // closeOnDocumentPointer closes an idle popover clicked from outside.
    function closeOnDocumentPointer(event: PointerEvent) {
      if (!isPending && !containerRef.current?.contains(event.target as Node)) {
        dismissEditor();
      }
    }

    // closeOnEscape closes an idle popover for keyboard users.
    function closeOnEscape(event: KeyboardEvent) {
      if (!isPending && event.key === "Escape") {
        dismissEditor();
      }
    }

    document.addEventListener("pointerdown", closeOnDocumentPointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnDocumentPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dismissEditor, isOpen, isPending]);

  return (
    <div className="recording-title-edit" ref={containerRef}>
      {embedded ? <h3>Název</h3> : <button
        aria-expanded={isOpen}
        className="recording-title-edit-button"
        disabled={isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isPending) {
            return;
          }

          if (isOpen) {
            dismissEditor();
          } else {
            setIsOpen(true);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="recording-action-label">Upravit</span>
        <span aria-hidden="true">{isOpen ? "-" : "+"}</span>
      </button>}
      <span aria-atomic="true" aria-live="polite" className="visually-hidden recording-title-save-status">
        {isCurrentSettlement && actionState.status === "success" && !isPending
          ? actionState.message
          : ""}
      </span>
      {embedded || isOpen ? (
        <form
          action={formAction}
          aria-busy={isPending}
          aria-label="Název"
          className={`recording-title-form${embedded ? "" : " recording-title-popover"}`}
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            if (isPending) {
              event.preventDefault();
            }
          }}
        >
          <input value={recordingId} name="recordingId" readOnly type="hidden" />
          <label>
            <span>Název</span>
            <input
              aria-label={`Název nahrávky ${title}`}
              maxLength={160}
              name="title"
              onChange={(event) => setDraftTitle(event.target.value)}
              ref={inputRef}
              required
              value={draftTitle}
            />
          </label>
          <div className="recording-title-feedback">
            {isCurrentSettlement
              && actionState.status === "error"
              && !isPending
              && !isCurrentErrorDismissed ? (
                <p className="recording-title-save-error" role="alert">
                  {actionState.message}
                </p>
              ) : null}
          </div>
          <div className="recording-title-popover-actions">
            <RecordingTitleSaveButton embedded={embedded} />
            {embedded ? null : <button disabled={isPending} onClick={dismissEditor} type="button">
              <X aria-hidden="true" size={15} />
              Zrušit
            </button>}
          </div>
        </form>
      ) : null}
    </div>
  );
}
