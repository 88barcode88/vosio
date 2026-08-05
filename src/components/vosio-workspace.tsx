import { NewRecordingWorkspace } from "@/components/new-recording-workspace";
import { MobileNav } from "@/components/workspace-navigation";
import { RecordingWorkbench } from "@/components/workspace/recording-workbench";
import { RecordingsManager } from "@/components/workspace/recordings-manager";
import { WorkspaceSidebar } from "@/components/workspace/sidebar";
import { UtilityWorkspaceView } from "@/components/workspace/utility-workspace-view";
import { TranscriptSearchWarningNotice } from "@/components/transcript-search-warning-notice";
import { getEmptyStructuredAiItems } from "@/lib/ai/structured-queries";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import type { PromptTemplateRow } from "@/lib/prompt-templates/types";
import { toRecordingClientView } from "@/lib/recordings/client-view";
import {
  unavailableRecordingStorageConfig,
  type RecordingStorageConfig
} from "@/lib/recordings/storage-config";
import type { RecordingRow } from "@/lib/recordings/types";
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import type {
  RecordingOrganization,
  RecordingOrganizationOptions
} from "@/lib/recording-organization/types";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type { TranscriptTab } from "@/components/transcript-tabs/types";
import type { CurrentMonthUsageState } from "@/lib/usage/summary";
import type { WorkspaceView } from "@/lib/workspace-data";

type VosioWorkspaceProps = {
  activeRecordingId?: string;
  aiOutputs: AiOutputView[];
  deletedRecordings?: RecordingRow[];
  isCreatingRecording?: boolean;
  initialTranscriptTab?: TranscriptTab;
  initialTranscriptTabFromCookie?: boolean;
  promptTemplates?: PromptTemplateRow[];
  recordingStorageConfig?: RecordingStorageConfig;
  recordingMarkers?: RecordingMarkerRow[];
  recordingOrganization?: RecordingOrganization;
  recordingOrganizationFilters?: RecordingOrganizationFilters;
  recordingOrganizationOptions?: RecordingOrganizationOptions;
  recordings: RecordingRow[];
  recordingsError?: string | null;
  recordingsSearchQuery?: string;
  settingsStatus?: "error" | "saved" | null;
  structuredItems?: StructuredAiItems;
  templateStatus?: "created" | "duplicated" | "error" | "saved" | null;
  transcripts: TranscriptRow[];
  transcriptSearchWarning?: boolean;
  usageState?: CurrentMonthUsageState;
  userSettings?: UserSettings;
  userEmail: string;
  view?: WorkspaceView;
};

// VosioWorkspace composes the workspace shell and routes each view into its working area.
export function VosioWorkspace({
  activeRecordingId,
  aiOutputs,
  deletedRecordings = [],
  isCreatingRecording = false,
  initialTranscriptTab = "transcript",
  initialTranscriptTabFromCookie = false,
  promptTemplates = [],
  recordingStorageConfig = unavailableRecordingStorageConfig,
  recordingMarkers = [],
  recordingOrganization = { client: null, folder: null, project: null, tags: [] },
  recordingOrganizationFilters = { clientId: null, folderId: null, projectId: null, tagIds: [] },
  recordingOrganizationOptions = { clients: [], folders: [], projects: [], tags: [] },
  recordings,
  recordingsError = null,
  recordingsSearchQuery = "",
  settingsStatus = null,
  structuredItems = getEmptyStructuredAiItems(),
  templateStatus = null,
  transcripts,
  transcriptSearchWarning = false,
  usageState,
  userSettings = defaultUserSettings,
  userEmail,
  view = "recordings"
}: VosioWorkspaceProps) {
  const activeRecording = !isCreatingRecording && activeRecordingId
    ? recordings.find((recording) => recording.id === activeRecordingId) ?? null
    : null;
  const activeTranscript =
    transcripts.find((transcript) => transcript.recording_id === activeRecording?.id) ?? null;
  const activeRecordingMarkers = activeRecording
    ? recordingMarkers.filter((marker) => marker.recording_id === activeRecording.id)
    : [];
  const activeAiOutputs = activeTranscript
    ? aiOutputs.filter((output) => output.transcript_id === activeTranscript.id)
    : [];
  const activeStructuredItems = activeTranscript
    ? {
        chapters: structuredItems.chapters.filter((chapter) => chapter.transcript_id === activeTranscript.id),
        decisions: structuredItems.decisions.filter((decision) => decision.transcript_id === activeTranscript.id),
        risks: structuredItems.risks.filter((risk) => risk.transcript_id === activeTranscript.id),
        tasks: structuredItems.tasks.filter((task) => task.transcript_id === activeTranscript.id)
      }
    : getEmptyStructuredAiItems();
  const deletedRecordingViews = deletedRecordings.map(toRecordingClientView);

  return (
    <main className="workspace-shell">
      <WorkspaceSidebar activeView={view} userEmail={userEmail} />

      <section className="content-area">
        {transcriptSearchWarning ? <TranscriptSearchWarningNotice /> : null}
        <div className="workspace-grid workspace-grid-wide">
          {isCreatingRecording ? (
            <NewRecordingWorkspace
              recordingStorageConfig={recordingStorageConfig}
              userSettings={userSettings}
            />
          ) : view === "recordings" && !activeRecording ? (
            <RecordingsManager
              errorCode={recordingsError}
              filters={recordingOrganizationFilters}
              organizationOptions={recordingOrganizationOptions}
              recordings={recordings}
              searchQuery={recordingsSearchQuery}
            />
          ) : view === "ai" || view === "templates" || view === "documentation" || view === "trash" || view === "settings" ? (
            <UtilityWorkspaceView
              aiOutputs={aiOutputs}
              deletedRecordings={deletedRecordingViews}
              promptTemplates={promptTemplates}
              settings={userSettings}
              settingsStatus={settingsStatus}
              templateStatus={templateStatus}
              usageState={usageState}
              view={view}
            />
          ) : (
            <RecordingWorkbench
              activeAiOutputs={activeAiOutputs}
              activeRecording={activeRecording}
              activeRecordingMarkers={activeRecordingMarkers}
              activeRecordingOrganization={recordingOrganization}
              activeStructuredItems={activeStructuredItems}
              activeTranscript={activeTranscript}
              initialTab={initialTranscriptTab}
              initialTabFromCookie={initialTranscriptTabFromCookie}
              recordingOrganizationOptions={recordingOrganizationOptions}
              userSettings={userSettings}
            />
          )}
        </div>
      </section>

      <MobileNav activeView={view} />
    </main>
  );
}
