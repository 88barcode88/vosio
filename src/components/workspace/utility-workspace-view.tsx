import { FileText, Sparkles, Trash2 } from "lucide-react";
import { DocumentationPanel } from "@/components/documentation-panel";
import { PromptTemplateEditor } from "@/components/prompt-template-editor";
import { PurgeRecordingForm } from "@/components/purge-recording-form";
import { SettingsPanel } from "@/components/settings-panel";
import type { AiOutputView } from "@/lib/ai/types";
import type { PromptTemplateRow } from "@/lib/prompt-templates/types";
import {
  formatFileSize,
  formatRecordingDate,
  type RecordingRow
} from "@/lib/recordings/types";
import type { UserSettings } from "@/lib/settings/types";
import type { CurrentMonthUsageState } from "@/lib/usage/summary";
import { getAiOutputPreview, getAiOutputTitle } from "@/components/workspace/utils";

const unavailableUsageState: CurrentMonthUsageState = {
  error: "Usage se teď nepodařilo načíst.",
  summary: null
};

// UtilityWorkspaceView renders secondary data-driven app sections outside the recording detail workspace.
export function UtilityWorkspaceView({
  aiOutputs,
  deletedRecordings,
  promptTemplates,
  settings,
  settingsStatus,
  templateStatus,
  usageState,
  view
}: {
  aiOutputs: AiOutputView[];
  deletedRecordings: RecordingRow[];
  promptTemplates: PromptTemplateRow[];
  settings: UserSettings;
  settingsStatus: "error" | "saved" | null;
  templateStatus: "created" | "duplicated" | "error" | "saved" | null;
  usageState?: CurrentMonthUsageState;
  view: "ai" | "templates" | "documentation" | "trash" | "settings";
}) {
  if (view === "settings") {
    return <SettingsPanel settings={settings} status={settingsStatus} usageState={usageState ?? unavailableUsageState} />;
  }

  if (view === "documentation") {
    return <DocumentationPanel />;
  }

  if (view === "ai") {
    return (
      <section className="utility-panel" aria-label="AI zpracování">
        <div className="utility-header">
          <Sparkles size={18} />
          <div>
            <h1>AI zpracování</h1>
            <p>Uložené výstupy z reálných transcriptů: shrnutí, úkoly, zápisy a follow-upy.</p>
          </div>
        </div>
        <div className="utility-list">
          {aiOutputs.length > 0 ? (
            aiOutputs.map((output) => (
              <article className="utility-row" key={output.id}>
                <div>
                  <strong>{getAiOutputTitle(output.processing_type)}</strong>
                  <span>{formatRecordingDate(output.created_at)}</span>
                </div>
                <p>{getAiOutputPreview(output)}</p>
              </article>
            ))
          ) : (
            <EmptyUtilityState text="Zatím tu není žádný AI výstup. Vytvoří se po spuštění AI akce nad hotovým přepisem." />
          )}
        </div>
      </section>
    );
  }

  if (view === "templates") {
    return (
      <section className="utility-panel" aria-label="Prompty">
        <div className="utility-header">
          <FileText size={18} />
          <div>
            <h1>Prompty</h1>
            <p>Systémové a uživatelské prompty uložené v Supabase pro AI zpracování přepisů.</p>
          </div>
        </div>
        <PromptTemplateEditor promptTemplates={promptTemplates} status={templateStatus} />
      </section>
    );
  }

  return (
    <section className="utility-panel" aria-label="Koš">
      <div className="utility-header">
        <Trash2 size={18} />
        <div>
          <h1>Koš</h1>
          <p>Smazané nahrávky. Tady už jde položku trvale odstranit včetně souboru, přepisu a AI výstupů.</p>
        </div>
      </div>
      <div className="utility-list">
        {deletedRecordings.length > 0 ? (
          deletedRecordings.map((recording) => (
            <article className="utility-row" key={recording.id}>
              <div>
                <strong>{recording.title}</strong>
                <span>{formatRecordingDate(recording.updated_at)}</span>
              </div>
              <p>
                {formatFileSize(recording.file_size_bytes)} · {recording.storage_path ?? "bez souboru"}
              </p>
              <PurgeRecordingForm recordingId={recording.id} />
            </article>
          ))
        ) : (
          <EmptyUtilityState text="Koš je prázdný. Aktivní nahrávky zůstávají v hlavní pracovní ploše." />
        )}
      </div>
    </section>
  );
}

// EmptyUtilityState renders a compact empty state for secondary workspace pages.
function EmptyUtilityState({ text }: { text: string }) {
  return (
    <article className="utility-empty">
      <strong>Bez dat</strong>
      <p>{text}</p>
    </article>
  );
}
