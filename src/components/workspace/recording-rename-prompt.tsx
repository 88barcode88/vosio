"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { RecordingTitleEditor } from "./recording-title-editor";

export const RECORDING_RENAME_PARAM = "rename";

// withRenamePrompt marks a detail path so the detail asks for a name once (used right after a live recording is saved).
export function withRenamePrompt(path: string) {
  const url = new URL(path, "https://vosio.local");
  url.searchParams.set(RECORDING_RENAME_PARAM, "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

// RecordingRenamePrompt opens a small "name this recording" dialog when the detail URL carries ?rename=1,
// then drops the parameter so a reload or Back does not ask again.
export function RecordingRenamePrompt({ recordingId, title, canEditTitle }: { recordingId: string; title: string; canEditTitle: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get(RECORDING_RENAME_PARAM) === "1";
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // clearRequest removes only the rename parameter and keeps tab, deep link and warning parameters.
  const clearRequest = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(RECORDING_RENAME_PARAM);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  // handledRef makes the request one-shot for this mounted recording, even before the URL update lands.
  const handledRef = useRef(false);
  useEffect(() => {
    if (!requested || handledRef.current) return;
    handledRef.current = true;
    if (canEditTitle) setOpen(true);
    else clearRequest();
  }, [canEditTitle, clearRequest, requested]);

  // Preselect the generated name so typing replaces it right away.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const input = bodyRef.current?.querySelector<HTMLInputElement>("input[name='title']");
      input?.focus();
      input?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // close hides the dialog and forgets the one-time request, unless a save is still running.
  const close = useCallback(() => {
    if (pending) return;
    setOpen(false);
    clearRequest();
  }, [clearRequest, pending]);

  return (
    <Modal className="recording-rename-prompt" label="Pojmenovat nahrávku" onClose={close} open={open}>
      <div className="recording-rename-prompt-body" ref={bodyRef}>
        <h2>Pojmenujte nahrávku</h2>
        <p>Nahrávka je uložená. Dejte jí název, podle kterého ji v seznamu snadno najdete.</p>
        <RecordingTitleEditor embedded onPendingChange={setPending} onSaved={close} recordingId={recordingId} title={title} />
        <div className="recording-rename-prompt-actions">
          <button className="ui-button" disabled={pending} onClick={close} type="button">Později</button>
        </div>
      </div>
    </Modal>
  );
}
