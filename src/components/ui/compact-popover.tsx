"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";
import { useDialogFocusTrap } from "./modal";

type Props = {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  busy?: boolean;
  keepMounted?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: RefObject<HTMLElement | null>;
};

// CompactPopover reuses the dialog focus contract for a kept-mounted, viewport-bounded action popup.
export function CompactPopover({ label, trigger, children, busy = false, keepMounted = false, className = "", open: controlledOpen, onOpenChange, triggerRef }: Props) {
  const [localOpen, setLocalOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16, maxHeight: 400 });
  const rootRef = useRef<HTMLDetailsElement>(null);
  const open = controlledOpen ?? localOpen;
  const id = useId();
  // changeOpen keeps all dismissal paths blocked while the current mutation is pending.
  const changeOpen = useCallback((next: boolean) => {
    if (busy) return;
    if (next) setHasOpened(true);
    if (onOpenChange) onOpenChange(next); else setLocalOpen(next);
  }, [busy, onOpenChange]);
  const close = useCallback(() => changeOpen(false), [changeOpen]);
  const { dialogRef, handleKeyDown } = useDialogFocusTrap(open, close);

  useLayoutEffect(() => {
    if (!open) return;
    // placePopup anchors below its stable trigger, using the viewport on small or short screens.
    function placePopup() {
      const anchor = rootRef.current?.querySelector("summary")?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(360, window.innerWidth - 32);
      const height = Math.min(dialogRef.current?.scrollHeight ?? 400, window.innerHeight - 32);
      const top = Math.max(16, Math.min(anchor.bottom + 4, window.innerHeight - height - 16));
      setPosition({ left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)), top, maxHeight: window.innerHeight - top - 16 });
    }
    placePopup();
    window.addEventListener("resize", placePopup);
    window.addEventListener("scroll", placePopup, true);
    return () => { window.removeEventListener("resize", placePopup); window.removeEventListener("scroll", placePopup, true); };
  }, [dialogRef, open]);

  useEffect(() => {
    if (!open) return;
    // dismissOutside closes an idle popup without discarding its mounted draft.
    function dismissOutside(event: PointerEvent) {
      if (!busy && !rootRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [busy, close, open]);

  return <details className={`compact-popover ${className}`} open={open} ref={rootRef}>
    <summary role="button" aria-controls={id} aria-expanded={open} aria-disabled={busy} aria-haspopup="dialog" ref={triggerRef}
      onClick={(event) => { event.preventDefault(); changeOpen(!open); }}>{trigger}</summary>
    {keepMounted || hasOpened || open ? <div className="compact-popover-surface" id={id} ref={dialogRef} role={open ? "dialog" : undefined}
      aria-modal={open ? "true" : undefined} aria-label={label} aria-busy={busy} tabIndex={-1}
      hidden={!open}
      onKeyDown={handleKeyDown} style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}>
      <header className="compact-popover-header"><strong>{label}</strong><button aria-label={`Zavřít ${label}`} disabled={busy} onClick={close} type="button"><X aria-hidden="true" size={15} /></button></header>
      {children}
    </div> : null}
  </details>;
}
