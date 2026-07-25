import {
  createPromptTemplateAction,
  duplicatePromptTemplateAction,
  updatePromptTemplateAction
} from "@/lib/prompt-templates/actions";
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

type TemplateStatus = "created" | "duplicated" | "error" | "saved" | null;

type PromptTemplateFormMode = "create" | "system-copy" | "user-edit";

// formatOutputSchema renders JSONB schema values for textarea editing.
function formatOutputSchema(schema: unknown) {
  if (schema === null || typeof schema === "undefined") {
    return "";
  }

  return JSON.stringify(schema, null, 2);
}

// getTemplateStatusMessage maps template action outcomes to compact UI feedback.
function getTemplateStatusMessage(status: TemplateStatus) {
  const messages: Record<Exclude<TemplateStatus, null>, string> = {
    created: "Prompt je vytvořený.",
    duplicated: "Vlastní kopie systémového promptu je vytvořená.",
    error: "Prompt se nepodařilo uložit. Zkontrolujte JSON schéma a povinná pole.",
    saved: "Prompt je uložený."
  };

  return status ? messages[status] : null;
}

// getProcessingTypeLabel maps prompt processing identifiers into short visible labels.
function getProcessingTypeLabel(processingType: string) {
  return (
    processingTypeOptions.find((option) => option.value === processingType)?.label ??
    processingType
  );
}

// splitPromptTemplates separates global defaults from user-owned templates without mutating input.
function splitPromptTemplates(promptTemplates: PromptTemplateRow[]) {
  return {
    systemTemplates: promptTemplates.filter((template) => template.is_system),
    userTemplates: promptTemplates.filter((template) => !template.is_system)
  };
}

// PromptTemplateEditor renders editable prompt template forms for system and user prompts.
export function PromptTemplateEditor({
  promptTemplates,
  status
}: {
  promptTemplates: PromptTemplateRow[];
  status: TemplateStatus;
}) {
  const statusMessage = getTemplateStatusMessage(status);
  const { systemTemplates, userTemplates } = splitPromptTemplates(promptTemplates);

  return (
    <div className="prompt-template-editor prompt-template-editor-compact">
      {statusMessage ? (
        <p
          aria-live="polite"
          className={status === "error" ? "template-status template-status-error" : "template-status"}
          role={status === "error" ? "alert" : "status"}
        >
          {statusMessage}
        </p>
      ) : null}

      <section className="prompt-template-overview" aria-label="Stav promptů">
        <div>
          <strong>{userTemplates.length}</strong>
          <span>vlastní</span>
        </div>
        <div>
          <strong>{systemTemplates.length}</strong>
          <span>systémové read-only</span>
        </div>
      </section>

      <section className="prompt-template-section" aria-labelledby="custom-template-heading">
        <div className="prompt-template-section-header">
          <div>
            <h2 id="custom-template-heading">Vlastní prompty</h2>
            <p>Upravitelné prompty uložené pod vaším účtem.</p>
          </div>
          <details className="prompt-template-card prompt-template-new">
            <summary>
              <strong>Nový prompt</strong>
              <span>Vlastní prompt</span>
            </summary>
            <PromptTemplateForm
              action={createPromptTemplateAction}
              buttonLabel="Vytvořit"
              mode="create"
              template={null}
            />
          </details>
        </div>

        {userTemplates.length > 0 ? (
          <div className="prompt-template-list prompt-template-list-custom">
            {userTemplates.map((template) => (
              <PromptTemplateCard
                action={updatePromptTemplateAction}
                buttonLabel="Uložit změny"
                key={template.id}
                mode="user-edit"
                template={template}
              />
            ))}
          </div>
        ) : (
          <article className="utility-empty prompt-template-empty">
            <strong>Zatím žádné vlastní prompty</strong>
            <p>Vytvořte nový prompt, nebo si založte kopii ze systémové knihovny níže.</p>
          </article>
        )}
      </section>

      <section className="prompt-template-section" aria-labelledby="system-template-heading">
        <div className="prompt-template-section-header">
          <div>
            <h2 id="system-template-heading">Systémová knihovna</h2>
            <p>Globální výchozí prompty jsou read-only. Uložit lze jen vlastní kopii.</p>
          </div>
        </div>

        {systemTemplates.length > 0 ? (
          <div className="prompt-template-list prompt-template-list-system">
            {systemTemplates.map((template) => (
              <PromptTemplateCard
                action={duplicatePromptTemplateAction}
                buttonLabel="Založit kopii"
                key={template.id}
                mode="system-copy"
                template={template}
              />
            ))}
          </div>
        ) : (
          <article className="utility-empty prompt-template-empty">
            <strong>Systémové prompty nejsou dostupné</strong>
            <p>Aktuální RLS kontext nevrátil globální prompty.</p>
          </article>
        )}
      </section>
    </div>
  );
}

// PromptTemplateCard renders a compact collapsible row for one prompt template.
function PromptTemplateCard({
  action,
  buttonLabel,
  mode,
  template
}: {
  action: (formData: FormData) => void | Promise<void>;
  buttonLabel: string;
  mode: Exclude<PromptTemplateFormMode, "create">;
  template: PromptTemplateRow;
}) {
  const isSystem = mode === "system-copy";

  return (
    <details
      className={
        isSystem
          ? "prompt-template-card prompt-template-card-system"
          : "prompt-template-card prompt-template-card-user"
      }
    >
      <summary>
        <strong>{template.name}</strong>
        <span>
          {getProcessingTypeLabel(template.processing_type)} -{" "}
          {isSystem ? "read-only, kopie povolena" : "vlastní editace"}
        </span>
      </summary>
      <PromptTemplateForm
        action={action}
        buttonLabel={buttonLabel}
        mode={mode}
        template={template}
      />
    </details>
  );
}

// PromptTemplateForm renders the shared create, update and duplicate prompt form.
function PromptTemplateForm({
  action,
  buttonLabel,
  mode,
  template
}: {
  action: (formData: FormData) => void | Promise<void>;
  buttonLabel: string;
  mode: PromptTemplateFormMode;
  template: PromptTemplateRow | null;
}) {
  const isSystemCopy = mode === "system-copy";
  const processingType = template?.processing_type ?? "custom_prompt";
  const outputSchema = formatOutputSchema(template?.output_schema);

  return (
    <form
      action={action}
      aria-label={isSystemCopy ? "Vytvořit vlastní kopii systémového promptu" : undefined}
      className={
        isSystemCopy
          ? "prompt-template-form prompt-template-form-readonly"
          : "prompt-template-form"
      }
    >
      {template ? <input name="templateId" type="hidden" value={template.id} /> : null}
      {isSystemCopy ? <input name="processingType" type="hidden" value={processingType} /> : null}
      <div className="prompt-template-fields-row">
        <label>
          Název
          <input
            defaultValue={template?.name ?? ""}
            maxLength={120}
            minLength={2}
            name="name"
            placeholder="Např. e-mail po hovoru pro klienta"
            readOnly={isSystemCopy}
            required
            type="text"
          />
        </label>
        <label>
          Typ výstupu
          <select
            defaultValue={processingType}
            disabled={isSystemCopy}
            name={isSystemCopy ? undefined : "processingType"}
          >
            {processingTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Prompt
        <textarea
          defaultValue={template?.prompt_text ?? ""}
          minLength={20}
          name="promptText"
          placeholder="Instrukce pro AI zpracování přepisu..."
          readOnly={isSystemCopy}
          required
          rows={isSystemCopy ? 7 : 9}
        />
      </label>
      <label>
        JSON schéma výstupu
        <textarea
          defaultValue={outputSchema}
          name="outputSchema"
          placeholder='{"type":"object"}'
          readOnly={isSystemCopy}
          rows={isSystemCopy ? 5 : 6}
        />
      </label>
      {isSystemCopy ? (
        <p className="prompt-template-readonly-note">
          Systémovou šablonu nelze upravit přímo. Tlačítko vytvoří vlastní kopii se stejným obsahem.
        </p>
      ) : null}
      <button type="submit">{buttonLabel}</button>
    </form>
  );
}
