"use client";

import { type CSSProperties, useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useCloseOnSuccessfulSave } from "@/components/use-close-on-successful-save";
import {
  createRecordingClientAction,
  createRecordingFolderAction,
  createRecordingProjectAction,
  createRecordingTagAction,
  deleteRecordingClientAction,
  deleteRecordingFolderAction,
  deleteRecordingProjectAction,
  deleteRecordingTagAction,
  renameRecordingClientAction,
  renameRecordingFolderAction,
  renameRecordingProjectAction,
  renameRecordingTagAction
} from "@/lib/recording-organization/actions";
import type {
  RecordingClientRow,
  RecordingFolderRow,
  RecordingOrganizationEntityKind,
  RecordingOrganizationOptions,
  RecordingProjectRow,
  RecordingTagRow
} from "@/lib/recording-organization/types";
import {
  createInitialSaveActionState,
  type SaveAction,
  type SaveActionState
} from "@/lib/forms/save-action-state";
import { runSaveActionSafely } from "@/lib/forms/run-save-action-safely";
import { OrganizationColorPicker } from "@/components/workspace/organization-color-picker";

export type OrganizationManagerActions = {
  createClient: SaveAction;
  createFolder: SaveAction;
  createProject: SaveAction;
  createTag: SaveAction;
  deleteClient: SaveAction;
  deleteFolder: SaveAction;
  deleteProject: SaveAction;
  deleteTag: SaveAction;
  renameClient: SaveAction;
  renameFolder: SaveAction;
  renameProject: SaveAction;
  renameTag: SaveAction;
};

type OrganizationRow = RecordingClientRow | RecordingProjectRow | RecordingFolderRow | RecordingTagRow;

type ManagerGroup = {
  createAction: SaveAction;
  createLabel: string;
  deleteAction: SaveAction;
  emptyLabel: string;
  kind: RecordingOrganizationEntityKind;
  label: string;
  renameAction: SaveAction;
  rows: OrganizationRow[];
};

type OrganizationSaveEditorProps = {
  action: SaveAction;
  clients: RecordingClientRow[];
  initialColor?: string | null;
  initialName?: string;
  kind: RecordingOrganizationEntityKind;
  label: string;
  mode: "create" | "rename";
  rowId?: string;
};

type DismissedSaveError = {
  revision: number;
  scopeKey: string;
};

const defaultActions: OrganizationManagerActions = {
  createClient: createRecordingClientAction,
  createFolder: createRecordingFolderAction,
  createProject: createRecordingProjectAction,
  createTag: createRecordingTagAction,
  deleteClient: deleteRecordingClientAction,
  deleteFolder: deleteRecordingFolderAction,
  deleteProject: deleteRecordingProjectAction,
  deleteTag: deleteRecordingTagAction,
  renameClient: renameRecordingClientAction,
  renameFolder: renameRecordingFolderAction,
  renameProject: renameRecordingProjectAction,
  renameTag: renameRecordingTagAction
};

// OrganizationSaveEditor provides the shared scoped create and rename lifecycle.
function OrganizationSaveEditor({
  action,
  clients,
  initialColor = null,
  initialName = "",
  kind,
  label,
  mode,
  rowId
}: OrganizationSaveEditorProps) {
  const instanceId = useId();
  const scopeKey = mode === "create" ? `create:${kind}:${instanceId}` : rowId ?? "";
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor ?? "");
  const [clientId, setClientId] = useState("");
  const [, forceDraftRender] = useState(0);
  const [dismissedError, setDismissedError] = useState<DismissedSaveError | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientSelectRef = useRef<HTMLSelectElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const scopedAction = useCallback(
    (previousState: SaveActionState, formData: FormData) =>
      runSaveActionSafely(action, previousState, formData, scopeKey),
    [action, scopeKey]
  );
  const [actionState, formAction, isPending] = useActionState(
    scopedAction,
    createInitialSaveActionState()
  );
  const closeAfterSuccess = useCallback(() => setIsOpen(false), []);
  const isCurrentSettlement = actionState.scopeKey === scopeKey;
  const isDismissedError = dismissedError?.scopeKey === scopeKey
    && actionState.revision <= dismissedError.revision;

  // resetDraft restores the current persisted row or an empty create form.
  const resetDraft = useCallback(() => {
    setName(initialName);
    setColor(initialColor ?? "");
    setClientId("");
  }, [initialColor, initialName]);

  // dismissEditor closes only while idle and remembers the dismissed error revision.
  const dismissEditor = useCallback(() => {
    if (isPending) return;
    if (actionState.status === "error" && actionState.scopeKey === scopeKey) {
      setDismissedError({ revision: actionState.revision, scopeKey });
    }
    resetDraft();
    setIsOpen(false);
  }, [actionState.revision, actionState.scopeKey, actionState.status, isPending, resetDraft, scopeKey]);

  useCloseOnSuccessfulSave({
    actionState,
    close: closeAfterSuccess,
    currentScopeKey: scopeKey,
    triggerRef
  });

  useEffect(() => {
    if (actionState.status === "success" && actionState.scopeKey === scopeKey) resetDraft();
  }, [actionState.revision, actionState.scopeKey, actionState.status, resetDraft, scopeKey]);

  useEffect(() => {
    if (actionState.status === "error" && actionState.scopeKey === scopeKey) {
      forceDraftRender((revision) => revision + 1);
    }
  }, [actionState.revision, actionState.scopeKey, actionState.status, scopeKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === "create" && kind === "project") clientSelectRef.current?.focus();
    else inputRef.current?.focus();
    if (mode === "rename") inputRef.current?.select();

    // closeOnPointer dismisses an idle manager editor clicked from outside.
    function closeOnPointer(event: PointerEvent) {
      if (!isPending && !containerRef.current?.contains(event.target as Node)) dismissEditor();
    }

    // closeOnEscape dismisses an idle manager editor for keyboard users.
    function closeOnEscape(event: KeyboardEvent) {
      if (!isPending && event.key === "Escape") dismissEditor();
    }

    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dismissEditor, isOpen, isPending, kind, mode]);

  const formClassName = mode === "create" ? "organization-create-form" : "organization-rename-form";

  return (
    <div className="organization-save-editor" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        disabled={isPending || (mode === "create" && kind === "project" && clients.length === 0)}
        onClick={() => isOpen ? dismissEditor() : setIsOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {label}
      </button>
      {isOpen ? (
        <form
          action={formAction}
          aria-busy={isPending}
          className={formClassName}
          onSubmit={(event) => {
            if (isPending) event.preventDefault();
          }}
        >
          <input name="scopeKey" readOnly type="hidden" value={scopeKey} />
          {rowId ? <input name="entityId" readOnly type="hidden" value={rowId} /> : null}
          {mode === "create" && kind === "project" ? (
            <label>
              <span>Klient</span>
              <select
                name="clientId"
                onChange={(event) => setClientId(event.target.value)}
                ref={clientSelectRef}
                required
                value={clientId}
              >
                <option value="">Vyberte klienta</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            <span>Název</span>
            <input
              maxLength={kind === "tag" ? 60 : 100}
              name="name"
              onChange={(event) => setName(event.target.value)}
              ref={inputRef}
              required
              value={name}
            />
          </label>
          <div className="organization-color-field">
            <span>Barva</span>
            <OrganizationColorPicker label={label} onChange={setColor} value={color} />
            <input name="color" readOnly type="hidden" value={color} />
          </div>
          <div className="organization-save-feedback">
            {isCurrentSettlement && actionState.status === "error" && !isPending && !isDismissedError
              ? <p role="alert">{actionState.message}</p>
              : null}
          </div>
          <div className="organization-save-actions">
            <button disabled={isPending} type="submit">{isPending ? "Ukládám…" : "Uložit"}</button>
            <button disabled={isPending} onClick={dismissEditor} type="button">Zrušit</button>
          </div>
        </form>
      ) : null}
      <span aria-atomic="true" aria-live="polite" className="visually-hidden">
        {isCurrentSettlement && actionState.status === "success" && !isPending
          ? actionState.message
          : ""}
      </span>
    </div>
  );
}

// OrganizationDeleteButton confirms destructive semantics and never auto-collapses an editor.
function OrganizationDeleteButton({
  action,
  kind,
  name,
  rowId
}: {
  action: SaveAction;
  kind: RecordingOrganizationEntityKind;
  name: string;
  rowId: string;
}) {
  const [state, setState] = useState(createInitialSaveActionState);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const confirmCopy = kind === "client"
    ? "Smazání klienta je možné jen bez přiřazených projektů nebo nahrávek. Pokračovat?"
    : kind === "project"
      ? `Smazat projekt ${name}? Přiřazené nahrávky zůstanou bez projektu.`
      : kind === "folder"
        ? "Smazat složku? Přiřazené nahrávky zůstanou bez složky."
        : "Smazat štítek? Jeho vazby na nahrávky se odstraní.";

  // deleteRow runs only after explicit confirmation and guards duplicate clicks.
  async function deleteRow() {
    if (pendingRef.current || !window.confirm(confirmCopy)) return;
    const formData = new FormData();
    formData.set("entityId", rowId);
    formData.set("scopeKey", rowId);
    pendingRef.current = true;
    setIsPending(true);
    try {
      const nextState = await runSaveActionSafely(action, state, formData, rowId);
      setState(nextState);
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }

  return (
    <div className="organization-delete-action">
      <button disabled={isPending} onClick={deleteRow} type="button">
        {isPending ? "Mažu…" : `Smazat ${name}`}
      </button>
      {state.status === "error" && state.scopeKey === rowId ? <p role="alert">{state.message}</p> : null}
      <span aria-atomic="true" aria-live="polite" className="visually-hidden">
        {state.status === "success" && state.scopeKey === rowId ? state.message : ""}
      </span>
    </div>
  );
}

// OrganizationManager manages clients, projects, flat folders and reusable tags.
export function OrganizationManager({
  actions,
  options
}: {
  actions?: OrganizationManagerActions;
  options: RecordingOrganizationOptions;
}) {
  const resolvedActions = actions ?? defaultActions;
  const groups: ManagerGroup[] = [
    {
      createAction: resolvedActions.createClient,
      createLabel: "Přidat klienta",
      deleteAction: resolvedActions.deleteClient,
      emptyLabel: "Zatím bez položek",
      kind: "client",
      label: "Klienti",
      renameAction: resolvedActions.renameClient,
      rows: options.clients
    },
    {
      createAction: resolvedActions.createProject,
      createLabel: "Přidat projekt",
      deleteAction: resolvedActions.deleteProject,
      emptyLabel: options.clients.length === 0 ? "Nejdřív vytvořte klienta" : "Zatím bez položek",
      kind: "project",
      label: "Projekty",
      renameAction: resolvedActions.renameProject,
      rows: options.projects
    },
    {
      createAction: resolvedActions.createFolder,
      createLabel: "Přidat složku",
      deleteAction: resolvedActions.deleteFolder,
      emptyLabel: "Zatím bez položek",
      kind: "folder",
      label: "Složky",
      renameAction: resolvedActions.renameFolder,
      rows: options.folders
    },
    {
      createAction: resolvedActions.createTag,
      createLabel: "Přidat štítek",
      deleteAction: resolvedActions.deleteTag,
      emptyLabel: "Zatím bez položek",
      kind: "tag",
      label: "Štítky",
      renameAction: resolvedActions.renameTag,
      rows: options.tags
    }
  ];

  return (
    <section className="organization-manager" aria-label="Klienti, projekty, složky a štítky">
      <div className="organization-manager-header">
        <div>
          <span>Organizace</span>
          <h2>Zařazení nahrávek</h2>
        </div>
        <p>Spravujte firmy, projekty, ploché složky a štítky.</p>
      </div>
      <div className="organization-manager-grid">
        {groups.map((group) => (
          <section className="organization-manager-group" key={group.kind}>
            <header>
              <h3>{group.label}</h3>
              <OrganizationSaveEditor
                action={group.createAction}
                clients={options.clients}
                kind={group.kind}
                label={group.createLabel}
                mode="create"
              />
            </header>
            {group.rows.length > 0 ? (
              <ul>
                {group.rows.map((row) => {
                  const clientName = group.kind === "project"
                    ? options.clients.find((client) => client.id === (row as RecordingProjectRow).client_id)?.name
                      ?? "Neznámý klient"
                    : null;
                  const contextualName = group.kind === "project" ? `${row.name} · ${clientName}` : row.name;
                  return (
                    <li key={row.id}>
                      <div className="organization-manager-row-label">
                        <strong
                          className={`organization-manager-badge${row.color ? " organization-manager-badge-colored" : ""}`}
                          style={row.color
                            ? ({ "--organization-color": row.color } as CSSProperties)
                            : undefined}
                        >
                          {contextualName}
                        </strong>
                      </div>
                      <div className="organization-manager-row-actions">
                        <OrganizationSaveEditor
                          action={group.renameAction}
                          clients={options.clients}
                          initialColor={row.color}
                          initialName={row.name}
                          kind={group.kind}
                          label={`Přejmenovat ${contextualName}`}
                          mode="rename"
                          rowId={row.id}
                        />
                        <OrganizationDeleteButton
                          action={group.deleteAction}
                          kind={group.kind}
                          name={contextualName}
                          rowId={row.id}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="organization-manager-empty">{group.emptyLabel}</p>}
          </section>
        ))}
      </div>
    </section>
  );
}
