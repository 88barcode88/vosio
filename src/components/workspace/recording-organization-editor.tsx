"use client";

import { type CSSProperties, type ReactNode, useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Pencil, Save, X } from "lucide-react";
import { CompactPopover } from "@/components/ui/compact-popover";
import { useCloseOnSuccessfulSave } from "@/components/use-close-on-successful-save";
import { createInitialSaveActionState, type SaveAction } from "@/lib/forms/save-action-state";
import { runSaveActionSafely } from "@/lib/forms/run-save-action-safely";
import { assignRecordingOrganizationAction } from "@/lib/recording-organization/actions";
import type {
  RecordingOrganization,
  RecordingOrganizationOptions
} from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";

type RecordingOrganizationEditorProps = {
  embedded?: boolean;
  onPendingChange?: (pending: boolean) => void;
  options: RecordingOrganizationOptions;
  organization: RecordingOrganization;
  recording: Pick<RecordingRow, "id" | "client_id" | "project_id" | "folder_id">;
  showSummary?: boolean;
  initiallyOpen?: boolean;
  saveAction?: SaveAction;
};

type DismissedSaveError = {
  revision: number;
  scopeKey: string;
};

type RecordingOrganizationDraft = {
  clientId: string;
  folderId: string;
  projectId: string;
  tagIds: Set<string>;
};

// createPersistedSignature tracks meaningful persisted assignment changes without array identity.
function createPersistedSignature(organization: RecordingOrganization, recording: RecordingOrganizationEditorProps["recording"]) {
  return JSON.stringify([
    recording.id,
    recording.client_id,
    recording.project_id,
    recording.folder_id,
    organization.tags.map((tag) => tag.id).sort()
  ]);
}

// createSubmittedDraft captures the exact assignment expected after a successful action.
function createSubmittedDraft(formData: FormData): RecordingOrganizationDraft {
  return {
    clientId: String(formData.get("clientId") ?? ""),
    folderId: String(formData.get("folderId") ?? ""),
    projectId: String(formData.get("projectId") ?? ""),
    tagIds: new Set(formData.getAll("tagIds").map(String))
  };
}

// RecordingOrganizationEditor atomically edits one recording's client, project, folder and tags.
export function RecordingOrganizationEditor({
  embedded = false,
  onPendingChange,
  options,
  organization,
  recording,
  showSummary = true,
  initiallyOpen = false,
  saveAction = assignRecordingOrganizationAction
}: RecordingOrganizationEditorProps) {
  const persistedTagIdsSignature = organization.tags.map((tag) => tag.id).sort().join("\u001f");
  const persistedDraft = useMemo<RecordingOrganizationDraft>(() => ({
    clientId: recording.client_id ?? "",
    folderId: recording.folder_id ?? "",
    projectId: recording.project_id ?? "",
    tagIds: new Set(persistedTagIdsSignature ? persistedTagIdsSignature.split("\u001f") : [])
  }), [persistedTagIdsSignature, recording.client_id, recording.folder_id, recording.project_id]);
  const persistedSignature = createPersistedSignature(organization, recording);
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [clientId, setClientId] = useState(persistedDraft.clientId);
  const [projectId, setProjectId] = useState(persistedDraft.projectId);
  const [folderId, setFolderId] = useState(persistedDraft.folderId);
  const [tagIds, setTagIds] = useState(persistedDraft.tagIds);
  const [dismissedError, setDismissedError] = useState<DismissedSaveError | null>(null);
  const firstControlRef = useRef<HTMLSelectElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const persistedDraftRef = useRef(persistedDraft);
  const persistedSignatureRef = useRef(persistedSignature);
  const lastSyncedPersistedSignatureRef = useRef(persistedSignature);
  const previousRecordingIdRef = useRef(recording.id);
  const submittedDraftRef = useRef<RecordingOrganizationDraft | null>(null);
  const submittedPersistedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    persistedDraftRef.current = persistedDraft;
    persistedSignatureRef.current = persistedSignature;
  }, [persistedDraft, persistedSignature]);

  // applyDraft replaces every controlled assignment field as one logical snapshot.
  const applyDraft = useCallback((draft: RecordingOrganizationDraft) => {
    setClientId(draft.clientId);
    setProjectId(draft.projectId);
    setFolderId(draft.folderId);
    setTagIds(new Set(draft.tagIds));
  }, []);

  const scopedSaveAction = useCallback(
    (previousState: ReturnType<typeof createInitialSaveActionState>, formData: FormData) => {
      submittedDraftRef.current = createSubmittedDraft(formData);
      submittedPersistedSignatureRef.current = persistedSignatureRef.current;
      return runSaveActionSafely(saveAction, previousState, formData, recording.id);
    },
    [recording.id, saveAction]
  );
  const [actionState, formAction, isPending] = useActionState(
    scopedSaveAction,
    createInitialSaveActionState()
  );
  useEffect(() => { onPendingChange?.(isPending); }, [isPending, onPendingChange]);
  const matchingProjects = useMemo(
    () => options.projects.filter((project) => (project.client_id ?? "") === clientId),
    [clientId, options.projects]
  );
  const closeAfterSuccess = useCallback(() => {
    const submittedDraft = submittedDraftRef.current;
    const serverPropsChanged = submittedPersistedSignatureRef.current !== persistedSignatureRef.current;
    applyDraft(submittedDraft && !serverPropsChanged ? submittedDraft : persistedDraftRef.current);
    lastSyncedPersistedSignatureRef.current = persistedSignatureRef.current;
    submittedDraftRef.current = null;
    submittedPersistedSignatureRef.current = null;
    if (!embedded) setIsOpen(false);
  }, [applyDraft, embedded]);
  const isCurrentSettlement = actionState.scopeKey === recording.id;
  const isCurrentErrorDismissed = dismissedError?.scopeKey === recording.id
    && actionState.revision <= dismissedError.revision;

  // resetDraft restores the persisted organization values for the current recording.
  const resetDraft = useCallback(() => {
    applyDraft(persistedDraftRef.current);
    lastSyncedPersistedSignatureRef.current = persistedSignatureRef.current;
  }, [applyDraft]);

  // dismissEditor closes only an idle editor and suppresses its currently visible error revision.
  const dismissEditor = useCallback(() => {
    if (isPending) {
      return;
    }
    if (actionState.status === "error" && actionState.scopeKey === recording.id) {
      setDismissedError({ revision: actionState.revision, scopeKey: recording.id });
    }
    resetDraft();
    setIsOpen(false);
  }, [actionState.revision, actionState.scopeKey, actionState.status, isPending, recording.id, resetDraft]);

  useCloseOnSuccessfulSave({
    actionState,
    close: closeAfterSuccess,
    currentScopeKey: recording.id,
    triggerRef
  });

  useEffect(() => {
    if (previousRecordingIdRef.current === recording.id) return;
    previousRecordingIdRef.current = recording.id;
    submittedDraftRef.current = null;
    submittedPersistedSignatureRef.current = null;
    lastSyncedPersistedSignatureRef.current = persistedSignatureRef.current;
    applyDraft(persistedDraftRef.current);
    setDismissedError(null);
    setIsOpen(false);
  }, [applyDraft, recording.id]);

  useEffect(() => {
    if (embedded || isOpen || isPending || previousRecordingIdRef.current !== recording.id) return;
    if (lastSyncedPersistedSignatureRef.current === persistedSignature) return;
    applyDraft(persistedDraftRef.current);
    lastSyncedPersistedSignatureRef.current = persistedSignature;
  }, [applyDraft, embedded, isOpen, isPending, persistedSignature, recording.id]);

  useEffect(() => {
    if (actionState.status === "error" && actionState.scopeKey === recording.id) {
      setTagIds((current) => new Set(current));
    }
  }, [actionState.revision, actionState.scopeKey, actionState.status, recording.id]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    firstControlRef.current?.focus();
  }, [isOpen]);

  // toggleTag updates the controlled many-to-many selection without mutating prior state.
  function toggleTag(tagId: string) {
    setTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const chips = [
    organization.client ? { color: organization.client.color, id: `client-${organization.client.id}`, label: organization.client.name } : null,
    organization.project ? { color: organization.project.color, id: `project-${organization.project.id}`, label: organization.project.name } : null,
    organization.folder ? { color: organization.folder.color, id: `folder-${organization.folder.id}`, label: organization.folder.name } : null,
    ...organization.tags.map((tag) => ({ color: tag.color, id: `tag-${tag.id}`, label: tag.name }))
  ].filter((chip): chip is { color: string | null; id: string; label: string } => chip !== null);

  // renderEditor shares the form while leaving dismissal to the combined surface when embedded.
  const renderEditor = (children: ReactNode) => embedded ? <section aria-label="Zařazení"><h3>Zařazení</h3>{children}</section> : (
    <CompactPopover busy={isPending} className="recording-organization-popover" label="Zařazení nahrávky"
      onOpenChange={(next) => { if (next) setIsOpen(true); else dismissEditor(); }} open={isOpen}
      trigger={<><Pencil aria-hidden="true" size={15} />Upravit zařazení</>} triggerRef={triggerRef}>{children}</CompactPopover>
  );

  return (
    <div className="recording-organization-editor">
      <div className="recording-organization-summary" aria-label="Zařazení nahrávky">
        {showSummary ? chips.length > 0
          ? chips.map((chip) => (
            <span
              className={`organization-chip${chip.color ? " organization-chip-colored" : ""}`}
              key={chip.id}
              style={chip.color
                ? ({ "--organization-color": chip.color } as CSSProperties)
                : undefined}
            >
              {chip.label}
            </span>
          ))
          : <span className="organization-chip organization-chip-muted">Bez zařazení</span> : null}
        {renderEditor(
          <form
            action={formAction}
            aria-busy={isPending}
            aria-label="Zařazení"
            className="recording-organization-form"
            onSubmit={(event) => {
              if (isPending) event.preventDefault();
            }}
          >
            <input name="recordingId" readOnly type="hidden" value={recording.id} />
            <input name="scopeKey" readOnly type="hidden" value={recording.id} />
            <div className="recording-organization-fields">
              <label>
                <span>Klient</span>
                <select
                  name="clientId"
                  onChange={(event) => {
                    const nextClientId = event.target.value;
                    setClientId(nextClientId);
                    if (!options.projects.some((project) =>
                      project.id === projectId && project.client_id === nextClientId
                    )) {
                      setProjectId("");
                    }
                  }}
                  ref={firstControlRef}
                  value={clientId}
                >
                  <option value="">Bez klienta</option>
                  {options.clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Projekt</span>
                <select
                  name="projectId"
                  onChange={(event) => setProjectId(event.target.value)}
                  value={projectId}
                >
                  <option value="">Bez projektu</option>
                  {matchingProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Složka</span>
                <select name="folderId" onChange={(event) => setFolderId(event.target.value)} value={folderId}>
                  <option value="">Bez složky</option>
                  {options.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="recording-organization-tags">
              <legend>Štítky</legend>
              {options.tags.length > 0 ? options.tags.map((tag) => (
                <label key={tag.id}>
                  <input
                    checked={tagIds.has(tag.id)}
                    name="tagIds"
                    onChange={() => toggleTag(tag.id)}
                    type="checkbox"
                    value={tag.id}
                  />
                  <span>{tag.name}</span>
                </label>
              )) : <span>Žádné štítky</span>}
            </fieldset>
            <div className="recording-organization-feedback">
              {isCurrentSettlement && actionState.status === "error" && !isPending && !isCurrentErrorDismissed ? (
                <p role="alert">{actionState.message}</p>
              ) : null}
            </div>
            <div className="recording-organization-actions">
              <button
                className="recording-organization-primary-action"
                disabled={isPending}
                type="submit"
              >
                <Save aria-hidden="true" size={15} />
                {isPending ? "Ukládám…" : embedded ? "Uložit zařazení" : "Uložit"}
              </button>
              <button
                disabled={isPending}
                onClick={() => {
                  setClientId("");
                  setProjectId("");
                  setFolderId("");
                  setTagIds(new Set());
                }}
                type="button"
              >
                <Eraser aria-hidden="true" size={15} />
                Vyčistit zařazení
              </button>
              {embedded ? null : <button disabled={isPending} onClick={dismissEditor} type="button"><X aria-hidden="true" size={15} />Zrušit</button>}
            </div>
          </form>
        )}
      </div>
      <span aria-atomic="true" aria-live="polite" className="visually-hidden">
        {isCurrentSettlement && actionState.status === "success" && !isPending
          ? actionState.message
          : ""}
      </span>
    </div>
  );
}
