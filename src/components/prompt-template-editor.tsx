"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { PencilLine, RotateCcw } from "lucide-react";
import {
  resetPromptOverrideAction,
  savePromptOverrideAction,
} from "@/lib/prompt-templates/actions";
import {
  createInitialPromptTemplateActionState,
  type PromptTemplateActionState,
} from "@/lib/prompt-templates/action-state";
import type { QuickPromptProcessingType } from "@/lib/prompt-templates/effective";
import {
  buildPromptTemplateHref,
  type PromptTemplateNavigationState,
} from "@/lib/prompt-templates/navigation";
import type { EffectivePromptTemplate } from "@/lib/prompt-templates/types";

const processingTypeLabels: Record<QuickPromptProcessingType, string> = {
  summary: "Shrnutí",
  action_items: "Úkoly",
  timeline_chapters: "Časová osa",
  meeting_minutes: "Zápis ze schůzky",
  crm_note: "CRM poznámka",
  follow_up_email: "E-mail po hovoru",
};

const resetConfirmation = "Obnovit tento AI prompt na systémové nastavení? Vaše úprava zůstane pouze v historii již vytvořených AI výstupů.";

export type PromptTemplateAction = (
  state: PromptTemplateActionState,
  formData: FormData,
) => Promise<PromptTemplateActionState>;

export type PromptTemplateActions = {
  saveOverride: PromptTemplateAction;
  resetOverride: PromptTemplateAction;
};

const defaultActions: PromptTemplateActions = {
  saveOverride: savePromptOverrideAction,
  resetOverride: resetPromptOverrideAction,
};

// PromptTemplateEditor renders one effective editor for each authoritative quick-action prompt.
export function PromptTemplateEditor({
  actions = defaultActions,
  baseHref = "/templates",
  navigationState,
  promptTemplates,
}: {
  actions?: PromptTemplateActions;
  baseHref?: string;
  navigationState: PromptTemplateNavigationState;
  promptTemplates: EffectivePromptTemplate[];
}) {
  const [isEditorPending, setIsEditorPending] = useState(false);
  const selectedTemplate = navigationState.kind === "selected"
    ? promptTemplates.find((template) => template.systemPromptId === navigationState.templateId) ?? null
    : null;

  return (
    <div
      aria-busy={isEditorPending ? "true" : undefined}
      className={`prompt-workspace ${navigationState.kind === "list" ? "prompt-workspace-list" : "prompt-workspace-editor"}`}
      data-prompt-surface={navigationState.kind}
      data-utility-surface="prompt-templates"
    >
      <aside className="prompt-master" aria-label="Seznam AI promptů">
        <div className="prompt-master-toolbar">
          <div>
            <strong>AI prompty</strong>
            <span>{promptTemplates.length} rychlých akcí</span>
          </div>
        </div>
        <section className="prompt-master-group">
          <h2>Existující AI tlačítka</h2>
          {promptTemplates.map((template) => (
            <Link
              aria-current={selectedTemplate?.systemPromptId === template.systemPromptId ? "page" : undefined}
              aria-disabled={isEditorPending ? "true" : undefined}
              className={selectedTemplate?.systemPromptId === template.systemPromptId
                ? "prompt-master-row prompt-master-row-active"
                : "prompt-master-row"}
              href={buildPromptTemplateHref(baseHref, {
                kind: "selected",
                templateId: template.systemPromptId,
              })}
              key={template.systemPromptId}
              onClick={(event) => blockPendingNavigation(event, isEditorPending)}
              tabIndex={isEditorPending ? -1 : undefined}
            >
              <strong>{getProcessingTypeLabel(template.processingType)}</strong>
              <span>{template.isModified ? "Upravený" : "Výchozí"}</span>
            </Link>
          ))}
        </section>
      </aside>

      <section className="prompt-editor-surface" aria-label="Editor AI promptu">
        {selectedTemplate ? (
          <Link
            aria-disabled={isEditorPending ? "true" : undefined}
            className="prompt-mobile-back"
            href={stripEditorState(baseHref)}
            onClick={(event) => blockPendingNavigation(event, isEditorPending)}
            tabIndex={isEditorPending ? -1 : undefined}
          >← Zpět na AI prompty</Link>
        ) : null}
        {selectedTemplate ? (
          <EffectivePromptForm
            key={`${selectedTemplate.systemPromptId}:${selectedTemplate.source}:${selectedTemplate.revision}`}
            onPendingChange={setIsEditorPending}
            resetAction={actions.resetOverride}
            saveAction={actions.saveOverride}
            template={selectedTemplate}
          />
        ) : (
          <div className="prompt-editor-empty">
            <PencilLine aria-hidden="true" size={20} />
            <strong>Vyberte AI prompt</strong>
            <p>Upravte instrukce, které používá jedno z existujících AI tlačítek.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// EffectivePromptForm submits only prompt text and revision while displaying system-owned metadata read-only.
function EffectivePromptForm({
  onPendingChange,
  resetAction,
  saveAction,
  template,
}: {
  onPendingChange: (pending: boolean) => void;
  resetAction: PromptTemplateAction;
  saveAction: PromptTemplateAction;
  template: EffectivePromptTemplate;
}) {
  const { refresh } = useRouter();
  const [isHydrated, setIsHydrated] = useState(false);
  const [saveState, saveFormAction, isSavePending] = useActionState(
    saveAction,
    createInitialPromptTemplateActionState(),
  );
  const [resetState, resetFormAction, isResetPending] = useActionState(
    resetAction,
    createInitialPromptTemplateActionState(),
  );
  const [draft, setDraft] = useState(() => ({ promptText: template.promptText }));
  const isPending = isSavePending || isResetPending;
  const visibleState = resetState.status !== "idle" ? resetState : saveState;

  // Keep the controlled prompt inert until React can preserve the first browser edit.
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (saveState.status === "success" || resetState.status === "success") {
      refresh();
    }
  }, [refresh, resetState.status, saveState.status]);

  useEffect(() => {
    onPendingChange(isPending);
    return () => {
      if (isPending) onPendingChange(false);
    };
  }, [isPending, onPendingChange]);

  return (
    <div className="prompt-template-form prompt-editor-form-shell">
      <form
        action={saveFormAction}
        className="prompt-editor-form"
        onSubmit={() => onPendingChange(true)}
      >
        <fieldset aria-busy={isPending ? "true" : undefined} data-prompt-editor-fields disabled={!isHydrated || isPending}>
          <div className="prompt-editor-heading">
            <div>
              <span>{template.isModified ? "Upravený" : "Výchozí"}</span>
              <h2>{getProcessingTypeLabel(template.processingType)}</h2>
            </div>
            <SubmitPromptButton label="Uložit změny" />
          </div>

          <input name="systemPromptId" type="hidden" value={template.systemPromptId} />
          <input name="revision" type="hidden" value={template.revision} />
          {visibleState.message ? (
            <p
              className={`prompt-action-state prompt-action-state-${visibleState.status}`}
              role={visibleState.status === "error" || visibleState.status === "conflict" ? "alert" : "status"}
            >
              {visibleState.message}
            </p>
          ) : null}
          <label>
            Prompt
            <textarea
              maxLength={20000}
              minLength={20}
              name="promptText"
              onChange={(event) => setDraft({ promptText: event.target.value })}
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
                <input readOnly value={getProcessingTypeLabel(template.processingType)} />
              </label>
              <label>
                JSON schéma výstupu · systémové
                <textarea
                  aria-label="JSON schéma výstupu"
                  readOnly
                  rows={8}
                  value={formatOutputSchema(template.outputSchema)}
                />
              </label>
              <p>Schéma je pevnou součástí výstupu a nelze je upravit.</p>
            </div>
          </details>
        </fieldset>
      </form>

      {template.isModified ? (
        <form
          action={resetFormAction}
          className="prompt-reset-form"
          onSubmit={(event) => {
            if (!window.confirm(resetConfirmation)) {
              event.preventDefault();
              return;
            }
            onPendingChange(true);
          }}
        >
          <fieldset disabled={!isHydrated || isPending}>
            <input name="systemPromptId" type="hidden" value={template.systemPromptId} />
            <input name="revision" type="hidden" value={template.revision} />
            <ResetPromptButton />
          </fieldset>
        </form>
      ) : null}
    </div>
  );
}

// SubmitPromptButton exposes the pending state inside the save form.
function SubmitPromptButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} type="submit">{pending ? "Ukládám…" : label}</button>;
}

// ResetPromptButton exposes the pending state inside the destructive reset boundary.
function ResetPromptButton() {
  const { pending } = useFormStatus();
  return (
    <button name="resetOverride" type="submit">
      <RotateCcw aria-hidden="true" size={15} />
      {pending ? "Obnovuji…" : "Obnovit výchozí"}
    </button>
  );
}

// getProcessingTypeLabel maps the shared six-type contract to compact Czech labels.
function getProcessingTypeLabel(processingType: QuickPromptProcessingType) {
  return processingTypeLabels[processingType];
}

// formatOutputSchema renders system JSONB schema values without making them form fields.
function formatOutputSchema(schema: unknown) {
  if (schema === null || typeof schema === "undefined") return "";
  return JSON.stringify(schema, null, 2);
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
