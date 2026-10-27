"use client";

import { type CSSProperties, type ReactNode, useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Pencil, Save, X } from "lucide-react";
import Link from "next/link";
import { CompactPopover } from "@/components/ui/compact-popover";
import { useCloseOnSuccessfulSave } from "@/components/use-close-on-successful-save";
import { createInitialSaveActionState, createSaveError, type SaveAction } from "@/lib/forms/save-action-state";
import { runSaveActionSafely } from "@/lib/forms/run-save-action-safely";
import { assignRecordingOrganizationAction, previewRecordingOrganizationAction } from "@/lib/recording-organization/actions";
import type {
  RecordingOrganization,
  RecordingOrganizationOptions,
  RecordingOrganizationPolicy,
  RecordingOrganizationPreview
} from "@/lib/recording-organization/types";
import type { RecordingRow } from "@/lib/recordings/types";

type RecordingOrganizationEditorProps = {
  embedded?: boolean;
  onPendingChange?: (pending: boolean) => void;
  options: RecordingOrganizationOptions;
  organization: RecordingOrganization;
  recording: Pick<RecordingRow, "id" | "client_id" | "project_id" | "folder_id"> & { visibility?: string; organization_policy?: RecordingOrganizationPolicy };
  showSummary?: boolean;
  initiallyOpen?: boolean;
  saveAction?: SaveAction;
  previewAction?: typeof previewRecordingOrganizationAction;
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

const organizationScopeLabels = { client: "klient", folder: "složka", project: "projekt" };

// RecordingOrganizationSummary renders only the safe metadata already supplied to the current viewer.
export function RecordingOrganizationSummary({ organization }: { organization: RecordingOrganization }) {
  const chips = [
    organization.client ? { color: organization.client.color, id: `client-${organization.client.id}`, label: organization.client.name } : null,
    organization.project ? { color: organization.project.color, id: `project-${organization.project.id}`, label: organization.project.name } : null,
    organization.folder ? { color: organization.folder.color, id: `folder-${organization.folder.id}`, label: organization.folder.name } : null,
    ...organization.tags.map(tag => ({ color: tag.color, id: `tag-${tag.id}`, label: tag.name }))
  ].filter((chip): chip is { color: string | null; id: string; label: string } => chip !== null);
  return <span className="recording-organization-badges" aria-label="Zařazení nahrávky">{chips.length ? chips.map(chip => <span className={`organization-chip${chip.color ? " organization-chip-colored" : ""}`} key={chip.id}
    style={chip.color ? { "--organization-color": chip.color } as CSSProperties : undefined}>{chip.label}</span>) : <span className="organization-chip organization-chip-muted">Bez zařazení</span>}</span>;
}

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
  options: allOptions,
  organization,
  recording,
  showSummary = true,
  initiallyOpen = false,
  saveAction = assignRecordingOrganizationAction,
  previewAction = previewRecordingOrganizationAction
}: RecordingOrganizationEditorProps) {
  const policy = recording.organization_policy;
  const options = useMemo(() => policy ? {
    clients: policy.personalEditable ? allOptions.clients : [],
    folders: policy.personalEditable ? allOptions.folders : [],
    tags: policy.personalEditable ? allOptions.tags : [],
    projects: allOptions.projects.filter((project) => policy.projectIds.includes(project.id))
  } : allOptions, [allOptions, policy]);
  const [impact, setImpact] = useState<{ signature: string; preview: RecordingOrganizationPreview } | null>(null);
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

  // React resets forms during commit, when synthetic onReset is suppressed; preserve the controlled draft natively.
  const preserveDraftOnReset = useCallback((form: HTMLFormElement | null) => {
    if (!form) return;
    const preventReset = (event: Event) => event.preventDefault();
    form.addEventListener("reset", preventReset);
    return () => form.removeEventListener("reset", preventReset);
  }, []);

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
    async (previousState: ReturnType<typeof createInitialSaveActionState>, formData: FormData) => {
      if (policy) {
        const signature = JSON.stringify([recording.id, String(formData.get("clientId") ?? ""), String(formData.get("projectId") ?? ""), String(formData.get("folderId") ?? ""), formData.getAll("tagIds").sort()]);
        if (!formData.get("organizationFingerprint")) {
          let result: Awaited<ReturnType<typeof previewRecordingOrganizationAction>>;
          try { result = await previewAction(formData); }
          catch { return createSaveError(previousState.revision, recording.id, "Náhled zařazení se nepodařilo načíst. Zkuste to znovu."); }
          if (result.error || !result.preview) return createSaveError(previousState.revision, recording.id, result.error ?? "Náhled se nepodařilo načíst.");
          if (recording.visibility !== "private" || result.preview.addedPaths.length || result.preview.removedPaths.length) {
            setImpact({ signature, preview: result.preview });
            return previousState;
          }
          formData.set("organizationFingerprint", result.preview.fingerprint);
        }
      }
      submittedDraftRef.current = createSubmittedDraft(formData);
      submittedPersistedSignatureRef.current = persistedSignatureRef.current;
      const result = await runSaveActionSafely(saveAction, previousState, formData, recording.id);
      setImpact(null);
      return result;
    },
    [policy, previewAction, recording.id, recording.visibility, saveAction]
  );
  const [actionState, formAction, isPending] = useActionState(
    scopedSaveAction,
    createInitialSaveActionState()
  );
  useEffect(() => { onPendingChange?.(isPending); }, [isPending, onPendingChange]);
  const matchingProjects = useMemo(
    () => options.projects.filter((project) => policy?.personalEditable === false || (project.client_id ?? "") === clientId),
    [clientId, options.projects, policy]
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
    setImpact(null);
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
    setImpact(null);
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

  const currentDraftSignature = JSON.stringify([recording.id, clientId, projectId, folderId, [...tagIds].sort()]);
  const currentImpact = impact?.signature === currentDraftSignature ? impact.preview : null;

  // renderEditor shares the form while leaving dismissal to the combined surface when embedded.
  const renderEditor = (children: ReactNode) => embedded ? <section aria-label="Zařazení"><h3>Zařazení</h3>{children}</section> : (
    <CompactPopover busy={isPending} className="recording-organization-popover" label="Zařazení nahrávky"
      onOpenChange={(next) => { if (next) setIsOpen(true); else dismissEditor(); }} open={isOpen}
      trigger={<><Pencil aria-hidden="true" size={15} />Upravit zařazení</>} triggerRef={triggerRef}>{children}</CompactPopover>
  );

  return (
    <div className="recording-organization-editor">
      <div className="recording-organization-summary" aria-label="Zařazení nahrávky">
        {showSummary ? <RecordingOrganizationSummary organization={organization} /> : null}
        {renderEditor(
          <form
            action={formAction}
            aria-busy={isPending}
            aria-label="Zařazení"
            className="recording-organization-form"
            ref={preserveDraftOnReset}
            onSubmit={(event) => {
              if (isPending) event.preventDefault();
            }}
          >
            <input name="recordingId" readOnly type="hidden" value={recording.id} />
            <input name="scopeKey" readOnly type="hidden" value={recording.id} />
            {currentImpact ? <input name="organizationFingerprint" readOnly type="hidden" value={currentImpact.fingerprint} /> : null}
            <div className="recording-organization-fields">
              <label>
                <span>Klient</span>
                <select
                  disabled={isPending || policy?.personalEditable === false}
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
                  disabled={isPending}
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
                <select disabled={isPending || policy?.personalEditable === false} name="folderId" onChange={(event) => setFolderId(event.target.value)} value={folderId}>
                  <option value="">Bez složky</option>
                  {options.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {policy?.personalEditable === false ? <p>Osobní klient, složka a štítky autora zůstávají beze změny.</p> : options.folders.length === 0 ? <p>Nemáte žádnou vlastní složku. <Link href="/recordings">Otevřít seznam nahrávek a Spravovat</Link>.</p> : null}
            <fieldset className="recording-organization-tags" disabled={isPending}>
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
              {currentImpact ? <section aria-label="Dopad zařazení">
                <p>Vybrané zařazení: {options.clients.find((item) => item.id === clientId)?.name ?? "Bez klienta"}, {options.projects.find((item) => item.id === projectId)?.name ?? "Bez projektu"}, {options.folders.find((item) => item.id === folderId)?.name ?? "Bez složky"}.</p>
                <p>Zachovaní konkrétní příjemci: {currentImpact.exactRecipients.map((item) => `${item.label} (${item.role === "editor" ? "editor" : "čtenář"})`).join(", ") || "žádní"}.</p>
                <p>Přidané přístupové cesty: {currentImpact.addedPaths.map((item) => `${item.label} (${item.kind ? organizationScopeLabels[item.kind] : "přístup"}, ${item.role === "editor" ? "editor" : "čtenář"})`).join(", ") || "žádné"}.</p>
                <p>Odebrané přístupové cesty: {currentImpact.removedPaths.map((item) => `${item.label} (${item.kind ? organizationScopeLabels[item.kind] : "přístup"}, ${item.role === "editor" ? "editor" : "čtenář"})`).join(", ") || "žádné"}. Další platné cesty zůstávají zachovány.</p>
                {currentImpact.pendingInvitations?.length ? <p>Čekající pozvánky v cílovém rozsahu: {currentImpact.pendingInvitations.map((item) => `${item.label} (${item.role === "editor" ? "editor" : "čtenář"})`).join(", ")}. Přístup vznikne až po přijetí.</p> : null}
              </section> : null}
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
                {isPending ? "Ukládám…" : currentImpact ? "Potvrdit zařazení" : embedded ? "Uložit zařazení" : "Uložit"}
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
