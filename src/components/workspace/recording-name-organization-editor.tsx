"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Save, TriangleAlert } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { RecordingTitleEditor } from "./recording-title-editor";
import { RecordingOrganizationEditor } from "./recording-organization-editor";
import { RecordingMenuOrganizationEditor } from "./recording-menu-organization-editor";
import type { RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";

// RecordingNameOrganizationEditor keeps independent save results and drafts in one row action surface and
// asks before closing with unsaved changes: save them, discard them, or keep editing.
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
  const sectionsRef = useRef<HTMLFieldSetElement | null>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open && wasOpenRef.current) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);
  const [titlePending, setTitlePending] = useState(false);
  const [organizationPending, setOrganizationPending] = useState(false);
  const [titleDirty, setTitleDirty] = useState(false);
  const [organizationDirty, setOrganizationDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeAfterSave, setCloseAfterSave] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const busy = titlePending || organizationPending;
  const dirty = titleDirty || organizationDirty;
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

  // Close once a "save and close" request has settled and nothing is left unsaved; a failed save stays open with its error.
  useEffect(() => {
    if (closeAfterSave && !busy && !dirty) {
      setCloseAfterSave(false);
      setOpen(false);
    }
  }, [busy, closeAfterSave, dirty]);

  // changeOpen opens directly but turns every close path (X, Escape, outside click) into a question when a draft is unsaved.
  const changeOpen = useCallback((next: boolean) => {
    if (next) {
      setConfirmClose(false);
      setOpen(true);
      return;
    }
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    setConfirmClose(false);
    setOpen(false);
  }, [dirty]);

  // markTitleSaved clears the title draft flag as soon as the save is confirmed, before the list refresh brings the new title.
  const markTitleSaved = useCallback(() => setTitleDirty(false), []);

  // saveAndClose submits each unsaved section through its own form and closes after all of them succeed.
  function saveAndClose() {
    const forms = Array.from(sectionsRef.current?.querySelectorAll("form") ?? []);
    const titleForm = forms.find((form) => form.classList.contains("recording-title-form"));
    const organizationForm = forms.find((form) => form.classList.contains("recording-organization-form"));
    if (titleDirty) titleForm?.requestSubmit();
    if (organizationDirty) organizationForm?.requestSubmit();
    setConfirmClose(false);
    setCloseAfterSave(true);
  }

  // discardAndClose drops both drafts by remounting the sections, then closes.
  function discardAndClose() {
    setConfirmClose(false);
    setTitleDirty(false);
    setOrganizationDirty(false);
    setDraftKey((key) => key + 1);
    setOpen(false);
  }

  return <CompactPopover open={open} onOpenChange={changeOpen} triggerRef={triggerRef} busy={busy} className="recording-name-organization-popover" label="Název a zařazení"
    trigger={<><Pencil aria-hidden="true" size={15} />Název a zařazení</>}>
    {confirmClose ? <div className="unsaved-changes-prompt" role="alert">
      <p><TriangleAlert aria-hidden="true" size={15} />Máte neuložené změny{titleDirty && organizationDirty ? " v názvu i zařazení" : titleDirty ? " v názvu" : " v zařazení"}. Chcete je uložit?</p>
      <div className="unsaved-changes-actions">
        <button className="ui-button ui-button--primary" type="button" onClick={saveAndClose}><Save aria-hidden="true" size={15} />Uložit a zavřít</button>
        <button className="ui-button" type="button" onClick={discardAndClose}>Zahodit změny</button>
        <button className="ui-button" type="button" onClick={() => setConfirmClose(false)}>Pokračovat v úpravách</button>
      </div>
    </div> : null}
    <fieldset className="recording-name-organization-sections" disabled={busy} key={draftKey} ref={sectionsRef}>
      {editTitle ? <RecordingTitleEditor embedded onDirtyChange={setTitleDirty} onPendingChange={setTitlePending} onSaved={markTitleSaved} recordingId={recordingId} title={title} /> : null}
      {editOrganization ? recording && recording.visibility === "private" ? <RecordingOrganizationEditor embedded onDirtyChange={setOrganizationDirty} onPendingChange={setOrganizationPending}
        options={options} organization={{
          client: options.clients.find((item) => item.id === recording.client_id) ?? null,
          project: options.projects.find((item) => item.id === recording.project_id) ?? null,
          folder: options.folders.find((item) => item.id === recording.folder_id) ?? null,
          tags: options.tags.filter((item) => recording.tag_ids?.includes(item.id))
        }} recording={recording} showSummary={false} />
        : <RecordingMenuOrganizationEditor embedded onDirtyChange={setOrganizationDirty} onPendingChange={setOrganizationPending} recordingId={recordingId} options={options} /> : null}
    </fieldset>
  </CompactPopover>;
}
