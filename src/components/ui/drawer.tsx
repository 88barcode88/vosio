"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useDialogFocusTrap } from "./modal";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  keepMounted?: boolean;
};

// Drawer renders a side-placed, focus-managed dialog for larger editing tasks.
export function Drawer({ open, onClose, label, children, className, keepMounted = false }: DrawerProps) {
  const { dialogRef, handleKeyDown } = useDialogFocusTrap(open, onClose);

  // handleBackdropPointerDown closes only the backdrop and prevents the completed click from stealing restored focus.
  function handleBackdropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onClose();
  }

  if (!open && !keepMounted) return null;

  return (
    <div
      aria-hidden={!open || undefined}
      aria-label={label}
      className="ui-drawer-backdrop"
      hidden={!open}
      onKeyDown={open ? handleKeyDown : undefined}
      onPointerDown={open ? handleBackdropPointerDown : undefined}
    >
      <div
        ref={dialogRef}
        aria-label={label}
        aria-modal={open ? "true" : undefined}
        className={["ui-drawer", className].filter(Boolean).join(" ")}
        role={open ? "dialog" : undefined}
        tabIndex={open ? -1 : undefined}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
