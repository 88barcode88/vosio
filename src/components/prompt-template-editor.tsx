"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Copy, FilePlus2, LockKeyhole, PencilLine } from "lucide-react";
import {
  createPromptTemplateAction,
  duplicatePromptTemplateAction,
  updatePromptTemplateAction
} from "@/lib/prompt-templates/actions";
import {
  createInitialPromptTemplateActionState,
  type PromptTemplateActionState
} from "@/lib/prompt-templates/action-state";
import {
  buildPromptTemplateHref,
  type PromptTemplateNavigationState
} from "@/lib/prompt-templates/navigation";
import type { PromptTemplateRow } from "@/lib/prompt-templates/types";

const processingTypeOptions = [
  { label: "Shrnutí", value: "summary" },
  { label: "Úkoly", value: "action_items" },
  { label: "Zápis ze schůzky", value: "meeting_minutes" },
  { label: "Časová osa", value: "timeline_chapters" },
  { label: "Strukturovaná extrakce", value: "structured_extraction" },
  { label: "CRM poznámka", value: "crm_note" },
  { label: "E-mail po hovoru", value: "follow_up_email" },
  { label: "Vlastní prompt", value: "custom_prompt" }
] as const;

export type PromptTemplateAction = (
  state: PromptTemplateActionState,
  formData: FormData
) => Promise<PromptTemplateActionState>;

export type PromptTemplateActions = {
  create: PromptTemplateAction;
  duplicate: PromptTemplateAction;
  update: PromptTemplateAction;
};

const defaultActions: PromptTemplateActions = {
  create: createPromptTemplateAction,
  duplicate: duplicatePromptTemplateAction,
  update: updatePromptTemplateAction
};

// formatOutputSchema renders JSONB schema values for textarea editing.
function formatOutputSchema(schema: unknown) {
  if (schema === null || typeof schema === "undefined") return "";
  return JSON.stringify(schema, null, 2);
}

// getProcessingTypeLabel maps prompt identifiers to compact Czech labels.
function getProcessingTypeLabel(processingType: string) {
  return processingTypeOptions.find((option) => option.value === processingType)?.label
    ?? processingType;
}

// PromptTemplateEditor renders the real desktop master-detail and mobile list/editor workspace.
export function PromptTemplateEditor({
  actions = defaultActions,
  baseHref = "/templates",
  navigationState,
  promptTemplates
}: {
  actions?: PromptTemplateActions;
  baseHref?: string;
  navigationState: PromptTemplateNavigationState;
  promptTemplates: PromptTemplateRow[];
}) {
  const [isEditorPending, setIsEditorPending] = useState(false);
  const userTemplates = promptTemplates.filter((template) => !template.is_system);
  const systemTemplates = promptTemplates.filter((template) => template.is_system);
  const selectedTemplate = navigationState.kind === "selected"
    ? promptTemplates.find((template) => template.id === navigationState.templateId) ?? null
    : null;

  return (
    <div
      className={`prompt-workspace ${navigationState.kind === "list" ? "prompt-workspace-list" : "prompt-workspace-editor"}`}
      aria-busy={isEditorPending ? "true" : undefined}
      data-prompt-surface={navigationState.kind}
    >
      <aside className="prompt-master" aria-label="Seznam promptů">
        <div className="prompt-master-toolbar">
          <div>
            <strong>Šablony</strong>
            <span>{userTemplates.length} vlastních · {systemTemplates.length} systémových</span>
          </div>
          <Link
            aria-disabled={isEditorPending ? "true" : undefined}
            className="prompt-new-link"
            href={buildPromptTemplateHref(baseHref, { kind: "create" })}
            onClick={(event) => blockPendingNavigation(event, isEditorPending)}
            tabIndex={isEditorPending ? -1 : undefined}
          >
            <FilePlus2 aria-hidden="true" size={16} />
            Nový
          </Link>
        </div>
        <PromptTemplateList
          baseHref={baseHref}
          heading="Vlastní prompty"
          selectedId={selectedTemplate?.id ?? null}
          templates={userTemplates}
          navigationLocked={isEditorPending}
        />
        <PromptTemplateList
          baseHref={baseHref}
          heading="Systémová knihovna"
          selectedId={selectedTemplate?.id ?? null}
          templates={systemTemplates}
          navigationLocked={isEditorPending}
        />
      </aside>

      <section className="prompt-editor-surface" aria-label="Editor promptu">
        {navigationState.kind !== "list" ? (
          <Link
            aria-disabled={isEditorPending ? "true" : undefined}
            className="prompt-mobile-back"
            href={stripEditorState(baseHref)}
            onClick={(event) => blockPendingNavigation(event, isEditorPending)}
            tabIndex={isEditorPending ? -1 : undefined}
          >← Zpět na prompty</Link>
        ) : null}
        {navigationState.kind === "create" ? (
          <PromptTemplateForm
            action={actions.create}
            baseHref={baseHref}
            heading="Nový vlastní prompt"
            key="create"
            mode="create"
            onPendingChange={setIsEditorPending}
            template={null}
          />
        ) : selectedTemplate?.is_system ? (
          <SystemPromptView
            action={actions.duplicate}
            baseHref={baseHref}
            onPendingChange={setIsEditorPending}
            template={selectedTemplate}
          />
        ) : selectedTemplate ? (
          <PromptTemplateForm
            action={actions.update}
            baseHref={baseHref}
            heading={selectedTemplate.name}
            key={selectedTemplate.id}
            mode="edit"
            onPendingChange={setIsEditorPending}
            template={selectedTemplate}
          />
        ) : (
          <div className="prompt-editor-empty">
            <PencilLine aria-hidden="true" size={20} />
            <strong>Vyberte prompt</strong>
            <p>Otevřete vlastní prompt pro úpravu nebo systémový prompt pro vytvoření kopie.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// PromptTemplateList renders one semantic group in the master column.
function PromptTemplateList({
  baseHref,
  heading,
  navigationLocked,
  selectedId,
  templates
}: {
  baseHref: string;
  heading: string;
  navigationLocked: boolean;
  selectedId: string | null;
  templates: PromptTemplateRow[];
}) {
  return (
    <section className="prompt-master-group">
      <h2>{heading}</h2>
      {templates.length ? templates.map((template) => (
        <Link
          aria-current={selectedId === template.id ? "page" : undefined}
          className={selectedId === template.id ? "prompt-master-row prompt-master-row-active" : "prompt-master-row"}
          href={buildPromptTemplateHref(baseHref, { kind: "selected", templateId: template.id })}
          key={template.id}
          onClick={(event) => blockPendingNavigation(event, navigationLocked)}
          tabIndex={navigationLocked ? -1 : undefined}
          aria-disabled={navigationLocked ? "true" : undefined}
        >
          <strong>{template.name}</strong>
          <span>{getProcessingTypeLabel(template.processing_type)}</span>
        </Link>
      )) : <p className="prompt-master-empty">Zatím bez položek.</p>}
    </section>
  );
}

// PromptTemplateForm keeps the native form draft mounted across pending and validation errors.
function PromptTemplateForm({
  action,
  baseHref,
  heading,
  mode,
  onPendingChange,
  template
}: {
  action: PromptTemplateAction;
  baseHref: string;
  heading: string;
  mode: "create" | "edit";
  onPendingChange: (pending: boolean) => void;
  template: PromptTemplateRow | null;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, createInitialPromptTemplateActionState());
  const [draft, setDraft] = useState(() => ({
    name: template?.name ?? "",
    outputSchema: formatOutputSchema(template?.output_schema),
    processingType: template?.processing_type ?? "custom_prompt",
    promptText: template?.prompt_text ?? ""
  }));

  useEffect(() => {
    if (state.status !== "success" || !state.templateId) return;
    router.replace(buildPromptTemplateHref(baseHref, {
      kind: "selected",
      templateId: state.templateId
    }));
    router.refresh();
  }, [baseHref, router, state.status, state.templateId]);

  useEffect(() => {
    onPendingChange(isPending);
    return () => { if (isPending) onPendingChange(false); };
  }, [isPending, onPendingChange]);

  return (
    <form
      action={formAction}
      className="prompt-template-form prompt-editor-form"
      onSubmit={() => onPendingChange(true)}
    >
      <fieldset aria-busy={isPending ? "true" : undefined} data-prompt-editor-fields disabled={isPending}>
        <div className="prompt-editor-heading">
        <div>
          <span>{mode === "create" ? "Vlastní prompt" : "Upravitelný prompt"}</span>
          <h2>{heading}</h2>
        </div>
        <SubmitPromptButton label={mode === "create" ? "Vytvořit prompt" : "Uložit změny"} />
        </div>
        {template ? <input name="templateId" type="hidden" value={template.id} /> : null}
        {state.message ? (
        <p className={`prompt-action-state prompt-action-state-${state.status}`} role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
        ) : null}
        <label>
        Název
        <input
          maxLength={120}
          minLength={2}
          name="name"
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          required
          value={draft.name}
        />
        </label>
        <label>
        Prompt
        <textarea
          minLength={20}
          name="promptText"
          onChange={(event) => setDraft((current) => ({ ...current, promptText: event.target.value }))}
          placeholder="Instrukce pro AI zpracování přepisu…"
          required
          rows={14}
          value={draft.promptText}
        />
        </label>
        <details className="prompt-advanced-fields">
        <summary>Pokročilé parametry</summary>
        <div>
          <label>
            Typ výstupu
            <select
              name="processingType"
              onChange={(event) => setDraft((current) => ({ ...current, processingType: event.target.value }))}
              value={draft.processingType}
            >
              {processingTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            JSON schéma výstupu
            <textarea
              name="outputSchema"
              onChange={(event) => setDraft((current) => ({ ...current, outputSchema: event.target.value }))}
              placeholder={'{"type":"object"}'}
              rows={8}
              value={draft.outputSchema}
            />
          </label>
        </div>
        </details>
      </fieldset>
    </form>
  );
}

// SystemPromptView keeps system content read-only and submits only its authoritative id for copying.
function SystemPromptView({
  action,
  baseHref,
  onPendingChange,
  template
}: {
  action: PromptTemplateAction;
  baseHref: string;
  onPendingChange: (pending: boolean) => void;
  template: PromptTemplateRow;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(action, createInitialPromptTemplateActionState());

  useEffect(() => {
    if (state.status !== "success" || !state.templateId) return;
    router.replace(buildPromptTemplateHref(baseHref, {
      kind: "selected",
      templateId: state.templateId
    }));
    router.refresh();
  }, [baseHref, router, state.status, state.templateId]);

  useEffect(() => {
    onPendingChange(isPending);
    return () => { if (isPending) onPendingChange(false); };
  }, [isPending, onPendingChange]);

  return (
    <div className="prompt-template-form prompt-template-form-readonly prompt-editor-form">
      <div className="prompt-editor-heading">
        <div>
          <span><LockKeyhole aria-hidden="true" size={14} /> Systémový prompt · pouze pro čtení</span>
          <h2>{template.name}</h2>
        </div>
        <form
          action={formAction}
          aria-busy={isPending ? "true" : undefined}
          onSubmit={() => onPendingChange(true)}
        >
          <fieldset disabled={isPending}>
            <input name="templateId" type="hidden" value={template.id} />
            <SubmitPromptButton icon={<Copy aria-hidden="true" size={15} />} label="Vytvořit vlastní kopii" />
          </fieldset>
        </form>
      </div>
      {state.message ? (
        <p className={`prompt-action-state prompt-action-state-${state.status}`} role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
      <label>Název<input readOnly value={template.name} /></label>
      <label>Prompt<textarea readOnly rows={14} value={template.prompt_text} /></label>
      <details className="prompt-advanced-fields">
        <summary>Pokročilé parametry</summary>
        <div>
          <label>Typ výstupu<input readOnly value={getProcessingTypeLabel(template.processing_type)} /></label>
          <label>JSON schéma výstupu<textarea readOnly rows={8} value={formatOutputSchema(template.output_schema)} /></label>
        </div>
      </details>
    </div>
  );
}

// SubmitPromptButton exposes the pending state inside the exact active form.
function SubmitPromptButton({ icon, label }: { icon?: React.ReactNode; label: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} type="submit">{icon}{pending ? "Ukládám…" : label}</button>;
}

// stripEditorState returns the mobile master-list URL without discarding fixture guards.
function stripEditorState(baseHref: string) {
  const url = new URL(baseHref, "https://vosio.local");
  url.searchParams.delete("template");
  url.searchParams.delete("mode");
  return `${url.pathname}${url.search}`;
}

// blockPendingNavigation keeps the mounted submitted snapshot stable until its action settles.
function blockPendingNavigation(event: React.MouseEvent<HTMLAnchorElement>, locked: boolean) {
  if (!locked) return;
  event.preventDefault();
  event.stopPropagation();
}
