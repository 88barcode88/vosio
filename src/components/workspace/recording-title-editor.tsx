"use client";

import { useEffect, useRef, useState } from "react";
import { updateRecordingTitleAction } from "@/lib/recordings/actions";

type RecordingTitleEditorProps = {
  recordingId: string;
  title: string;
};

// RecordingTitleEditor opens a compact anchored title form without expanding the recordings row.
export function RecordingTitleEditor({ recordingId, title }: RecordingTitleEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();

    // closeOnDocumentPointer closes the popover when the user clicks outside the editor.
    function closeOnDocumentPointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    // closeOnEscape lets keyboard users leave the compact title editor.
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnDocumentPointer);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnDocumentPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="recording-title-edit" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        className="recording-title-edit-button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        Upravit <span aria-hidden="true">{isOpen ? "-" : "+"}</span>
      </button>
      {isOpen ? (
        <form
          action={updateRecordingTitleAction}
          className="recording-title-form recording-title-popover"
          onClick={(event) => event.stopPropagation()}
          onSubmit={() => setIsOpen(false)}
        >
          <input defaultValue={recordingId} name="recordingId" type="hidden" />
          <label>
            <span>Název</span>
            <input
              aria-label={`Název nahrávky ${title}`}
              defaultValue={title}
              maxLength={160}
              name="title"
              ref={inputRef}
              required
            />
          </label>
          <div className="recording-title-popover-actions">
            <button type="submit">Uložit</button>
            <button onClick={() => setIsOpen(false)} type="button">
              Zrušit
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
