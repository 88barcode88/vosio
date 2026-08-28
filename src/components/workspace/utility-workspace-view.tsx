import Link from "next/link";
import { FileText, Sparkles, Trash2 } from "lucide-react";
import { AiArchive } from "@/components/ai-archive";
import { DocumentationPanel } from "@/components/documentation-panel";
import { PromptTemplateEditor, type PromptTemplateActions } from "@/components/prompt-template-editor";
import type { TrashRecordingAction } from "@/components/purge-recording-form";
import { SettingsPanel } from "@/components/settings-panel";
import {
  TrashRecordingsManager,
  type TrashPurgeItemAction,
  type TrashRestoreBulkAction
} from "@/components/workspace/trash-recordings-manager";
import type { AiArchiveFilters } from "@/lib/ai/archive";
import type { AiArchiveItem, AiOutputView } from "@/lib/ai/types";
import type { InstallationStatus } from "@/lib/installation-status.server";
import type { PromptTemplateNavigationState } from "@/lib/prompt-templates/navigation";
import type { EffectivePromptTemplate } from "@/lib/prompt-templates/types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import {
  unavailableRecordingStorageConfig,
  type RecordingStorageConfig
} from "@/lib/recordings/storage-config";
import type { UserSettings } from "@/lib/settings/types";
import type { CurrentMonthUsageState } from "@/lib/usage/summary";

const unavailableUsageState: CurrentMonthUsageState = {
  error: "Usage se teď nepodařilo načíst.",
  summary: null
};

type UtilityWorkspaceViewProps = {
  aiArchiveActionAlert?: string | null;
  aiArchiveBaseHref?: string;
  aiArchiveDeleteAction?: (formData: FormData) => Promise<void>;
  aiArchiveFilters?: AiArchiveFilters;
  aiArchiveItems?: AiArchiveItem[];
  aiOutputs: AiOutputView[];
  deletedRecordings: RecordingClientView[];
  disableAccountSecurity?: boolean;
  installationStatus?: InstallationStatus;
  promptTemplateActions?: PromptTemplateActions;
  promptTemplateBaseHref?: string;
  promptTemplateNavigationState?: PromptTemplateNavigationState;
  promptTemplates: EffectivePromptTemplate[];
  recordingStorageConfig?: RecordingStorageConfig;
  settingsFormDisabled?: boolean;
  settings: UserSettings;
  settingsStatus: "error" | "saved" | null;
  templateStatus: "created" | "duplicated" | "error" | "saved" | null;
  trashActionAlert?: string | null;
  trashActionContext?: Record<string, string>;
  trashNowMs?: number;
  trashPurgeItemAction?: TrashPurgeItemAction;
  trashPurgeAction?: TrashRecordingAction;
  trashRestoreBulkAction?: TrashRestoreBulkAction;
  trashRestoreAction?: TrashRecordingAction;
  usageState?: CurrentMonthUsageState;
  userEmail?: string;
  view: "ai" | "templates" | "documentation" | "trash" | "settings";
};

// UtilityWorkspaceView renders secondary data-driven app sections outside recording detail.
export function UtilityWorkspaceView({
  aiArchiveActionAlert,
  aiArchiveBaseHref,
  aiArchiveDeleteAction,
  aiArchiveFilters = { processingType: null, recordingId: null },
  aiArchiveItems = [],
  deletedRecordings,
  disableAccountSecurity = false,
  installationStatus,
  promptTemplateActions,
  promptTemplateBaseHref,
  promptTemplateNavigationState = { kind: "list" },
  promptTemplates,
  recordingStorageConfig,
  settingsFormDisabled = false,
  settings,
  settingsStatus,
  trashActionAlert,
  trashActionContext,
  trashNowMs = 0,
  trashPurgeItemAction,
  trashPurgeAction,
  trashRestoreBulkAction,
  trashRestoreAction,
  usageState,
  userEmail = "",
  view
}: UtilityWorkspaceViewProps) {
  if (view === "settings") {
    return (
      <SettingsPanel
        accountEmail={userEmail}
        disableAccountSecurity={disableAccountSecurity}
        disableSave={settingsFormDisabled}
        installationStatus={installationStatus ?? {
          environment: "unknown",
          geminiConfigured: false,
          missingRequiredNames: [],
          ready: false
        }}
        recordingStorageConfig={recordingStorageConfig ?? unavailableRecordingStorageConfig}
        settings={settings}
        status={settingsStatus}
        usageState={usageState ?? unavailableUsageState}
      />
    );
  }

  if (view === "documentation") return <DocumentationPanel />;

  if (view === "ai") {
    return (
      <section className="utility-panel utility-panel-document" aria-label="AI archiv">
        <div className="utility-header utility-header-actions">
          <Sparkles size={18} />
          <div>
            <h1>AI archiv</h1>
            <p>Celé uložené generace napříč nahrávkami. Nové výstupy spouštíte v detailu nahrávky.</p>
          </div>
          <Link href="/templates">Spravovat AI prompty</Link>
        </div>
        <AiArchive
          actionAlert={aiArchiveActionAlert}
          baseHref={aiArchiveBaseHref}
          deleteAction={aiArchiveDeleteAction}
          filters={aiArchiveFilters}
          items={aiArchiveItems}
        />
      </section>
    );
  }

  if (view === "templates") {
    return (
      <section className="utility-panel utility-panel-document" aria-label="AI prompty">
        <div className="utility-header utility-header-actions">
          <FileText size={18} />
          <div>
            <h1>AI prompty</h1>
            <p>Upravte instrukce, které používají existující AI tlačítka. Upravený prompt lze kdykoli obnovit na systémový výchozí stav.</p>
          </div>
          <Link href="/ai">Otevřít AI archiv</Link>
        </div>
        <PromptTemplateEditor
          actions={promptTemplateActions}
          baseHref={promptTemplateBaseHref}
          navigationState={promptTemplateNavigationState}
          promptTemplates={promptTemplates}
        />
      </section>
    );
  }

  return (
    <section className="utility-panel utility-panel-trash" aria-label="Koš">
      <div className="utility-header">
        <Trash2 size={18} />
        <div>
          <h1>Koš</h1>
          <p>Smazané nahrávky. Tady lze položku trvale odstranit včetně souboru, přepisu a AI výstupů.</p>
        </div>
      </div>
      {trashActionAlert ? <p className="trash-route-alert" role="alert">{trashActionAlert}</p> : null}
      {deletedRecordings.length > 0 ? (
        <TrashRecordingsManager
          actionContext={trashActionContext}
          nowMs={trashNowMs}
          purgeAction={trashPurgeAction}
          purgeItemAction={trashPurgeItemAction}
          recordings={deletedRecordings}
          restoreAction={trashRestoreAction}
          restoreBulkAction={trashRestoreBulkAction}
        />
      ) : (
        <div className="utility-list trash-recording-list">
          <article className="utility-empty trash-empty-state">
            <strong>Koš je prázdný</strong>
            <p>Aktivní nahrávky zůstávají v hlavní pracovní ploše.</p>
            <div>
              <Link href="/recordings">Nahrávky</Link>
              <Link href="/recordings/new">Nová nahrávka</Link>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
