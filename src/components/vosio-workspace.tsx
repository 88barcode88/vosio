import {
  NewRecordingWorkspace,
  type NewRecordingCaptureSlots
} from "@/components/new-recording-workspace";
import type { RecordingUploadTransport } from "@/components/recording-upload-form";
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
import type { RecordingRow, RecordingSearchPage } from "@/lib/recordings/types";
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import type {
  RecordingOrganization,
  RecordingOrganizationOptions
} from "@/lib/recording-organization/types";
import type { RecordingOrganizationFilters } from "@/lib/recording-organization/filters";
import { defaultUserSettings, type UserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type { TranscriptTab } from "@/components/transcript-tabs/types";
import type { ResolvedTranscriptDeepLink } from "@/lib/transcripts/deep-link";
import type { CurrentMonthUsageState } from "@/lib/usage/summary";
import type { NavigationHrefOverrides, WorkspaceView } from "@/lib/workspace-data";

type VosioWorkspaceProps = {
  activeRecordingId?: string;
  aiOutputs: AiOutputView[];
  deletedRecordings?: RecordingRow[];
  isCreatingRecording?: boolean;
  initialTranscriptDeepLink?: ResolvedTranscriptDeepLink | null;
  initialTranscriptTab?: TranscriptTab;
  initialTranscriptTabFromCookie?: boolean;
  initialTranscriptTabFromUrl?: boolean;
  navigationHrefOverrides?: NavigationHrefOverrides;
  newRecordingCaptureSlots?: NewRecordingCaptureSlots;
  newRecordingUploadRedirectAfterSuccess?: "detail" | "list" | "stay";
  newRecordingUploadTransport?: RecordingUploadTransport;
  promptTemplates?: PromptTemplateRow[];
  recordingStorageConfig?: RecordingStorageConfig;
  recordingMarkers?: RecordingMarkerRow[];
  recordingOrganization?: RecordingOrganization;
  recordingOrganizationFilters?: RecordingOrganizationFilters;
  recordingOrganizationOptions?: RecordingOrganizationOptions;
  recordings: RecordingRow[];
  recordingsError?: string | null;
  recordingsSearchQuery?: string;
  recordingSearchError?: string | null;
  recordingSearchNextHref?: string | null;
  recordingSearchPage?: RecordingSearchPage | null;
  recordingSearchPreviousHref?: string | null;
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

// getContentAreaClassName keeps the recordings list scrollable without changing the fixed detail workbench boundary.
export function getContentAreaClassName({
  hasActiveRecording,
  isCreatingRecording,
  view
}: {
  hasActiveRecording: boolean;
  isCreatingRecording: boolean;
  view: WorkspaceView;
}) {
  if (view === "recordings" && isCreatingRecording) {
    return "content-area content-area-document";
  }

  if (view === "recordings" && hasActiveRecording) {
    return "content-area content-area-document";
  }

  return view === "recordings" && !hasActiveRecording
    ? "content-area content-area-recordings-list"
    : "content-area";
}

// VosioWorkspace composes the workspace shell and routes each view into its working area.
export function VosioWorkspace({
  activeRecordingId,
  aiOutputs,
  deletedRecordings = [],
  isCreatingRecording = false,
  initialTranscriptDeepLink = null,
  initialTranscriptTab = "transcript",
  initialTranscriptTabFromCookie = false,
  initialTranscriptTabFromUrl = false,
  navigationHrefOverrides,
  newRecordingCaptureSlots,
  newRecordingUploadRedirectAfterSuccess,
  newRecordingUploadTransport,
  promptTemplates = [],
  recordingStorageConfig = unavailableRecordingStorageConfig,
  recordingMarkers = [],
  recordingOrganization = { client: null, folder: null, project: null, tags: [] },
  recordingOrganizationFilters = { clientId: null, folderId: null, projectId: null, tagIds: [] },
  recordingOrganizationOptions = { clients: [], folders: [], projects: [], tags: [] },
  recordings,
  recordingsError = null,
  recordingsSearchQuery = "",
  recordingSearchError = null,
  recordingSearchNextHref = null,
  recordingSearchPage = null,
  recordingSearchPreviousHref = null,
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
      <WorkspaceSidebar
        activeView={view}
        navigationHrefOverrides={navigationHrefOverrides}
        userEmail={userEmail}
      />

      <section
        className={getContentAreaClassName({
          hasActiveRecording: activeRecording !== null,
          isCreatingRecording,
          view
        })}
      >
        {transcriptSearchWarning ? <TranscriptSearchWarningNotice /> : null}
        <div className="workspace-grid workspace-grid-wide">
          {isCreatingRecording ? (
            <NewRecordingWorkspace
              captureSlots={newRecordingCaptureSlots}
              recordingStorageConfig={recordingStorageConfig}
              uploadRedirectAfterSuccess={newRecordingUploadRedirectAfterSuccess}
              uploadTransport={newRecordingUploadTransport}
              userSettings={userSettings}
            />
          ) : view === "recordings" && !activeRecording ? (
            <RecordingsManager
              errorCode={recordingsError}
              filters={recordingOrganizationFilters}
              organizationOptions={recordingOrganizationOptions}
              recordings={recordings}
              searchQuery={recordingsSearchQuery}
              searchError={recordingSearchError}
              searchNextHref={recordingSearchNextHref}
              searchPage={recordingSearchPage}
              searchPreviousHref={recordingSearchPreviousHref}
            />
          ) : view === "ai" || view === "templates" || view === "documentation" || view === "trash" || view === "settings" ? (
            <UtilityWorkspaceView
              aiOutputs={aiOutputs}
              deletedRecordings={deletedRecordingViews}
              promptTemplates={promptTemplates}
              recordingStorageConfig={recordingStorageConfig}
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
              initialDeepLink={initialTranscriptDeepLink}
              initialTab={initialTranscriptTab}
              initialTabFromCookie={initialTranscriptTabFromCookie}
              initialTabFromUrl={initialTranscriptTabFromUrl}
              recordingOrganizationOptions={recordingOrganizationOptions}
              userSettings={userSettings}
            />
          )}
        </div>
      </section>

      <MobileNav
        activeView={view}
        hrefOverrides={navigationHrefOverrides}
        userEmail={userEmail}
      />
    </main>
  );
}
