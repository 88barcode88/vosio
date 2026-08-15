"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import {
  OrganizationManager,
  type OrganizationManagerActions
} from "@/components/workspace/organization-manager";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";

// OrganizationManagerDrawer preserves editor drafts while presenting management outside the inbox flow.
export function OrganizationManagerDrawer({ actions, options }: {
  actions?: OrganizationManagerActions;
  options: RecordingOrganizationOptions;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // close restores the operation owner after the focus trap releases.
  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button ref={triggerRef} aria-expanded={open} onClick={() => setOpen(true)} type="button">
        Spravovat
      </button>
      <Drawer className="organization-manager-drawer" keepMounted label="Správa organizace" onClose={close} open={open}>
        <header>
          <div><span>Organizace</span><h2>Zařazení nahrávek</h2></div>
          <button aria-label="Zavřít správu organizace" onClick={close} type="button"><X size={16} /></button>
        </header>
        <OrganizationManager actions={actions} options={options} />
      </Drawer>
    </>
  );
}
