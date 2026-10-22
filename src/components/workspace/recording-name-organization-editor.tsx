"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { RecordingTitleEditor } from "./recording-title-editor";
import { RecordingOrganizationEditor } from "./recording-organization-editor";
import { RecordingMenuOrganizationEditor } from "./recording-menu-organization-editor";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";

// RecordingNameOrganizationEditor keeps independent save results and drafts in one row action surface.
export function RecordingNameOrganizationEditor({ recordingId, title, editTitle, editOrganization, recording, options }: {
  recordingId: string;
  title: string;
  editTitle: boolean;
  editOrganization: boolean;
  recording?: RecordingRow;
  options: RecordingOrganizationOptions;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open && wasOpenRef.current) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);
  const [titlePending, setTitlePending] = useState(false);
  const [organizationPending, setOrganizationPending] = useState(false);
  const busy = titlePending || organizationPending;
  useEffect(() => {
    if (!busy) return;
    const menuTrigger = triggerRef.current?.closest(".recordings-actions-menu")?.querySelector(":scope > summary");
    // preventMenuDismiss keeps the native ellipsis menu from hiding an in-flight form.
    const preventMenuDismiss = (event: Event) => event.preventDefault();
    menuTrigger?.setAttribute("aria-disabled", "true");
    menuTrigger?.addEventListener("click", preventMenuDismiss);
    return () => {
      menuTrigger?.removeAttribute("aria-disabled");
      menuTrigger?.removeEventListener("click", preventMenuDismiss);
    };
  }, [busy]);
  return <CompactPopover open={open} onOpenChange={setOpen} triggerRef={triggerRef} busy={busy} className="recording-name-organization-popover" label="Název a zařazení"
    trigger={<><Pencil aria-hidden="true" size={15} />Název a zařazení</>}>
    <fieldset className="recording-name-organization-sections" disabled={busy}>
      {editTitle ? <RecordingTitleEditor embedded onPendingChange={setTitlePending} recordingId={recordingId} title={title} /> : null}
      {editOrganization ? recording ? <RecordingOrganizationEditor embedded onPendingChange={setOrganizationPending}
        options={options} organization={{
          client: options.clients.find((item) => item.id === recording.client_id) ?? null,
          project: options.projects.find((item) => item.id === recording.project_id) ?? null,
          folder: options.folders.find((item) => item.id === recording.folder_id) ?? null,
          tags: options.tags.filter((item) => recording.tag_ids?.includes(item.id))
        }} recording={recording} showSummary={false} />
        : <RecordingMenuOrganizationEditor embedded onPendingChange={setOrganizationPending} recordingId={recordingId} options={options} /> : null}
    </fieldset>
  </CompactPopover>;
}
