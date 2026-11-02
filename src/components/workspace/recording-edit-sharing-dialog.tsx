"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDialogFocusTrap } from "@/components/ui/modal";
import { RecordingTitleEditor } from "./recording-title-editor";
import { RecordingOrganizationEditor } from "./recording-organization-editor";
import { RecordingMenuOrganizationEditor } from "./recording-menu-organization-editor";
import { BulkRecordingSharing } from "./bulk-recording-sharing";
import { AccessManager, type ConfirmedAccessRevocation, type RevokedRecordingGrant } from "./project-access-manager";
import type { RecordingAssignment, RecordingOrganization, RecordingOrganizationOptions } from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";
import type { RecordingVisibility } from "@/lib/recording-sharing/types";
import styles from "./recording-edit-sharing-dialog.module.css";

// RecordingEditSharingDialog coordinates independent saves without remounting an uncertain sharing attempt.
export function RecordingEditSharingDialog({ recording, organization, options }: {
  recording: RecordingRow;
  organization: RecordingOrganization;
  options: RecordingOrganizationOptions;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [current, setCurrent] = useState(recording);
  const [titleBusy, setTitleBusy] = useState(false);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const [organizationDirty, setOrganizationDirty] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [sharingUnsettled, setSharingUnsettled] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [projectAccessBusy, setProjectAccessBusy] = useState(false);
  const [projectInvitationOpen, setProjectInvitationOpen] = useState(false);
  const [revokedGrant, setRevokedGrant] = useState<RevokedRecordingGrant | null>(null);
  const [accessRevision, setAccessRevision] = useState(0);
  const busy = titleBusy || organizationBusy || sharingBusy || accessBusy || projectAccessBusy;
  const sharingBlocked = organizationDirty || organizationBusy || titleBusy || accessBusy || projectAccessBusy;
  const assignmentBlocked = titleBusy || sharingUnsettled || accessBusy || projectAccessBusy;
  const invitationsBlocked = sharingBlocked || sharingUnsettled;
  const close = useCallback(() => { if (!busy) setOpen(false); }, [busy]);
  const { dialogRef, handleKeyDown } = useDialogFocusTrap(open, close);
  const rows = useMemo(() => [current], [current]);
  const project = options.projects.find((item) => item.id === current.project_id);
  const projectFounder = project?.can_manage_access === true;
  const canManage = recording.capabilities?.manageAccess === true;
  const canInviteRecording = (!current.project_id && current.visibility === "private") || current.visibility === "selected";

  useEffect(() => { setCurrent(recording); }, [recording]);
  // restoreSettledFocus recovers focus dropped to body when a pending action disabled its focused control.
  useEffect(() => {
    const surface = dialogRef.current;
    if (open && !busy && surface && !surface.contains(document.activeElement)) surface.focus();
  }, [busy, dialogRef, open]);

  // organizationSaved publishes only a confirmed assignment to dependent sharing and invitation controls.
  const organizationSaved = useCallback((assignment: RecordingAssignment) => {
    setCurrent((value) => ({ ...value, client_id: assignment.clientId, project_id: assignment.projectId, folder_id: assignment.folderId, tag_ids: assignment.tagIds }));
    setOrganizationDirty(false);
    setProjectInvitationOpen(false);
    router.refresh();
  }, [router]);

  // sharingSaved updates the confirmed local visibility while the server refreshes the surrounding header.
  const sharingSaved = useCallback((visibility: RecordingVisibility) => {
    setCurrent((value) => ({ ...value, visibility }));
    setAccessRevision((value) => value + 1);
  }, []);

  // recordingAccessRevoked maps a matching project's member revocation to its removed exact recording grant.
  const recordingAccessRevoked = useCallback((revocation: ConfirmedAccessRevocation) => {
    if (revocation.kind === "grant" && revocation.recordingId === recording.id) setRevokedGrant(revocation);
    else if (revocation.kind === "member" && revocation.projectId === current.project_id) setRevokedGrant({ recordingId: recording.id, userId: revocation.userId });
  }, [current.project_id, recording.id]);

  if (!canManage && !recording.capabilities?.editTitle && !sharingUnsettled) return null;

  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onClick={() => { setMounted(true); setOpen(true); }}>
      <Pencil aria-hidden="true" size={15} />Upravit a sdílení
    </button>
    {mounted ? <div className={`ui-modal-backdrop ${styles.backdrop}`} hidden={!open}
      onPointerDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); close(); } }} onKeyDown={handleKeyDown}>
      <div className={`ui-modal ${styles.dialog}`} id={id} ref={dialogRef} role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined} aria-label="Upravit a sdílení" aria-busy={busy} tabIndex={-1}>
        <header className={styles.header}><div><h2>Upravit a sdílení</h2><p>Název, zařazení a sdílení se ukládají samostatně.</p></div>
          <button type="button" aria-label="Zavřít Upravit a sdílení" disabled={busy} onClick={close}><X aria-hidden="true" size={15} /></button>
        </header>
        <div className={styles.content}>
          {recording.capabilities?.editTitle ? <fieldset className={styles.section} disabled={organizationBusy || sharingUnsettled || accessBusy || projectAccessBusy}>
            <RecordingTitleEditor embedded recordingId={recording.id} title={recording.title} onPendingChange={setTitleBusy} />
          </fieldset> : null}
          {canManage || sharingUnsettled ? <>
            {canManage ? <fieldset className={styles.section} disabled={assignmentBlocked}>
              {recording.visibility === "private" ? <RecordingOrganizationEditor embedded hashtagLabels showSummary={false}
                recording={current} organization={organization} options={options} onPendingChange={setOrganizationBusy}
                onDirtyChange={setOrganizationDirty} onSaved={organizationSaved} /> : <RecordingMenuOrganizationEditor
                embedded hashtagLabels recordingId={recording.id} options={options} visibility={current.visibility}
                onPendingChange={setOrganizationBusy} onDirtyChange={setOrganizationDirty} onSaved={organizationSaved} />}
            </fieldset> : null}
            {organizationDirty ? <p className={styles.guard} role="status">Nejprve potvrďte změnu zařazení. Sdílení navazuje na uložený stav.</p> : null}
            <div className={styles.sharing}>
              <BulkRecordingSharing detail embedded recordings={rows} disabled={!canManage || sharingBlocked} canSelectRecipients={!current.project_id || projectFounder}
                onBusyChange={setSharingBusy} onUnsettledChange={setSharingUnsettled} onSaved={sharingSaved} revokedGrant={revokedGrant} />
            </div>
            {canManage ? <fieldset className={`${styles.section} ${styles.access}`} disabled={invitationsBlocked}>
              {canInviteRecording ? <AccessManager key={`recording-${current.project_id ?? "standalone"}`} recordingId={current.id}
                scope={current.project_id ? { scope: "project-selected", projectId: current.project_id, recordingIds: [current.id] } : { scope: "standalone", recordingIds: [current.id] }}
                heading="Pozvat k nahrávce" inviteLabel="Pozvat k nahrávce" disabled={invitationsBlocked} onBusyChange={setAccessBusy} onAccessRevoked={recordingAccessRevoked} refreshKey={accessRevision} />
                : <p>Pro pozvání ke konkrétní projektové nahrávce nejprve uložte sdílení s vybranými lidmi.</p>}
              {projectFounder && current.project_id ? <div className={styles.projectInvitation}>
                <button type="button" aria-expanded={projectInvitationOpen} disabled={invitationsBlocked} onClick={() => setProjectInvitationOpen((value) => !value)}>Pozvat do projektu</button>
                <p>Přístup k současným i budoucím nahrávkám sdíleným s projektem {project.name}.</p>
                {projectInvitationOpen ? <AccessManager key={current.project_id} scope={{ scope: "project", projectId: current.project_id }}
                  heading={`Pozvánka do projektu ${project.name}`} inviteLabel="Odeslat pozvánku do projektu" disabled={invitationsBlocked || accessBusy} onBusyChange={setProjectAccessBusy} onAccessRevoked={recordingAccessRevoked} refreshKey={accessRevision} /> : null}
              </div> : null}
            </fieldset> : null}
          </> : null}
        </div>
        <footer className={styles.footer}><button type="button" disabled={busy} onClick={close}>Zavřít</button></footer>
      </div>
    </div> : null}
  </>;
}
