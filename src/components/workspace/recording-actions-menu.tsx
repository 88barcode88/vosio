"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

// RecordingActionsMenu is the row "…" menu: one open at a time, closed by an outside click or Escape.
// A menu whose summary is aria-disabled (an in-flight save inside it) stays open.
export function RecordingActionsMenu({ title, children }: { title: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    // isLocked keeps the menu open while a nested form is saving.
    const isLocked = () => root?.querySelector(":scope > summary")?.getAttribute("aria-disabled") === "true";
    // closeMenu closes this native details menu without touching its mounted drafts.
    const closeMenu = () => { if (root && !isLocked()) root.open = false; };
    // dismissOutside closes the menu when the pointer goes down anywhere outside it, including another row's menu.
    // It waits one task so a nested popover can first decide to stay open (for example to ask about unsaved changes).
    let pendingDismiss: ReturnType<typeof setTimeout> | undefined;
    function dismissOutside(event: PointerEvent) {
      if (root?.contains(event.target as Node)) return;
      clearTimeout(pendingDismiss);
      pendingDismiss = setTimeout(() => {
        if (!root?.querySelector(".compact-popover[open]")) closeMenu();
      }, 0);
    }
    // closeOnEscape closes the menu when no nested popover handled Escape first.
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (root?.querySelector(".compact-popover[open]")) return;
      closeMenu();
      root?.querySelector<HTMLElement>(":scope > summary")?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      clearTimeout(pendingDismiss);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <details className="recordings-actions-menu" ref={rootRef} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={`Možnosti nahrávky ${title}`} title="Možnosti nahrávky">
        <MoreHorizontal aria-hidden="true" size={15} />
      </summary>
      <div className="recordings-actions-popover">{children}</div>
    </details>
  );
}
