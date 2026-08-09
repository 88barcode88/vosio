"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useDialogFocusTrap } from "./modal";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
};

// Drawer renders a side-placed, focus-managed dialog for larger editing tasks.
export function Drawer({ open, onClose, label, children, className }: DrawerProps) {
  const { dialogRef, handleKeyDown } = useDialogFocusTrap(open, onClose);

  // handleBackdropPointerDown closes only the backdrop and prevents the completed click from stealing restored focus.
  function handleBackdropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="ui-drawer-backdrop" onPointerDown={handleBackdropPointerDown} onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        className={["ui-drawer", className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
