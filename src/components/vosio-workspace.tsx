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
import type { AiArchiveFilters } from "@/lib/ai/archive";
import type { AiArchiveItem } from "@/lib/ai/types";
import type { InstallationStatus } from "@/lib/installation-status.server";
import type { PromptTemplateActions } from "@/components/prompt-template-editor";
import type { PromptTemplateNavigationState } from "@/lib/prompt-templates/navigation";
import type { EffectivePromptTemplate } from "@/lib/prompt-templates/types";
import { toRecordingClientView } from "@/lib/recordings/client-view";
import {
  unavailableRecordingStorageConfig,
  type RecordingStorageConfig
} from "@/lib/recordings/storage-config";
import type { RecordingStatusCounts } from "@/lib/recordings/queries";
import type {
  ActiveRecordingStatus,
  RecordingRow,
  RecordingSearchPage
} from "@/lib/recordings/types";
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
import type { TrashRecordingAction } from "@/components/purge-recording-form";
import type {
  TrashPurgeItemAction,
  TrashRestoreBulkAction
} from "@/components/workspace/trash-recordings-manager";

type VosioWorkspaceProps = {
  activeRecordingId?: string;
  aiOutputs: AiOutputView[];
  aiArchiveBaseHref?: string;
  aiArchiveActionAlert?: string | null;
  aiArchiveDeleteAction?: (formData: FormData) => Promise<void>;
  aiArchiveFilters?: AiArchiveFilters;
  aiArchiveItems?: AiArchiveItem[];
  deletedRecordings?: RecordingRow[];
  isCreatingRecording?: boolean;
  initialTranscriptDeepLink?: ResolvedTranscriptDeepLink | null;
  initialTranscriptTab?: TranscriptTab;
  initialTranscriptTabFromCookie?: boolean;
  initialTranscriptTabFromUrl?: boolean;
  installationStatus?: InstallationStatus;
  navigationHrefOverrides?: NavigationHrefOverrides;
  newRecordingCaptureSlots?: NewRecordingCaptureSlots;
  newRecordingUploadRedirectAfterSuccess?: "detail" | "list" | "stay";
  newRecordingUploadTransport?: RecordingUploadTransport;
  promptTemplates?: EffectivePromptTemplate[];
  promptTemplateActions?: PromptTemplateActions;
  promptTemplateBaseHref?: string;
  promptTemplateNavigationState?: PromptTemplateNavigationState;
  recordingStorageConfig?: RecordingStorageConfig;
  recordingMarkers?: RecordingMarkerRow[];
  recordingOrganization?: RecordingOrganization;
  recordingOrganizationFilters?: RecordingOrganizationFilters;
  recordingOrganizationOptions?: RecordingOrganizationOptions;
  recordingStatus?: ActiveRecordingStatus | null;
  recordingStatusCounts?: RecordingStatusCounts;
  recordings: RecordingRow[];
  recordingsError?: string | null;
  recordingsSearchParams?: string;
  recordingsSearchQuery?: string;
  recordingSearchError?: string | null;
  recordingSearchNextHref?: string | null;
  recordingSearchPage?: RecordingSearchPage | null;
  recordingSearchPreviousHref?: string | null;
  disableAccountSecurity?: boolean;
  settingsStatus?: "error" | "saved" | null;
  settingsFormDisabled?: boolean;
  structuredItems?: StructuredAiItems;
  templateStatus?: "created" | "duplicated" | "error" | "saved" | null;
  trashActionAlert?: string | null;
  trashActionContext?: Record<string, string>;
  trashNowMs?: number;
  trashPurgeItemAction?: TrashPurgeItemAction;
  trashPurgeAction?: TrashRecordingAction;
  trashRestoreBulkAction?: TrashRestoreBulkAction;
  trashRestoreAction?: TrashRecordingAction;
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
    : "content-area content-area-document";
}

// VosioWorkspace composes the workspace shell and routes each view into its working area.
export function VosioWorkspace({
  activeRecordingId,
  aiOutputs,
  aiArchiveActionAlert,
  aiArchiveBaseHref,
  aiArchiveDeleteAction,
  aiArchiveFilters = { processingType: null, recordingId: null },
  aiArchiveItems = [],
  deletedRecordings = [],
  isCreatingRecording = false,
  initialTranscriptDeepLink = null,
  initialTranscriptTab = "transcript",
  initialTranscriptTabFromCookie = false,
  initialTranscriptTabFromUrl = false,
  installationStatus,
  navigationHrefOverrides,
  newRecordingCaptureSlots,
  newRecordingUploadRedirectAfterSuccess,
  newRecordingUploadTransport,
  promptTemplates = [],
  promptTemplateActions,
  promptTemplateBaseHref,
  promptTemplateNavigationState = { kind: "list" },
  recordingStorageConfig = unavailableRecordingStorageConfig,
  recordingMarkers = [],
  recordingOrganization = { client: null, folder: null, project: null, tags: [] },
  recordingOrganizationFilters = { clientId: null, folderId: null, projectId: null, tagIds: [] },
  recordingOrganizationOptions = { clients: [], folders: [], projects: [], tags: [] },
  recordingStatus = null,
  recordingStatusCounts,
  recordings,
  recordingsError = null,
  recordingsSearchParams = "",
  recordingsSearchQuery = "",
  recordingSearchError = null,
  recordingSearchNextHref = null,
  recordingSearchPage = null,
  recordingSearchPreviousHref = null,
  disableAccountSecurity = false,
  settingsStatus = null,
  settingsFormDisabled = false,
  structuredItems = getEmptyStructuredAiItems(),
  templateStatus = null,
  trashActionAlert = null,
  trashActionContext,
  trashNowMs,
  trashPurgeItemAction,
  trashPurgeAction,
  trashRestoreBulkAction,
  trashRestoreAction,
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
              recordingStatus={recordingStatus}
              recordingStatusCounts={recordingStatusCounts}
              recordings={recordings}
              recordingsSearchParams={recordingsSearchParams}
              searchQuery={recordingsSearchQuery}
              searchError={recordingSearchError}
              searchNextHref={recordingSearchNextHref}
              searchPage={recordingSearchPage}
              searchPreviousHref={recordingSearchPreviousHref}
            />
          ) : view === "ai" || view === "templates" || view === "documentation" || view === "trash" || view === "settings" ? (
            <UtilityWorkspaceView
              aiArchiveActionAlert={aiArchiveActionAlert}
              aiArchiveBaseHref={aiArchiveBaseHref}
              aiArchiveDeleteAction={aiArchiveDeleteAction}
              aiArchiveFilters={aiArchiveFilters}
              aiArchiveItems={aiArchiveItems}
              aiOutputs={aiOutputs}
              deletedRecordings={deletedRecordingViews}
              disableAccountSecurity={disableAccountSecurity}
              installationStatus={installationStatus}
              promptTemplates={promptTemplates}
              promptTemplateActions={promptTemplateActions}
              promptTemplateBaseHref={promptTemplateBaseHref}
              promptTemplateNavigationState={promptTemplateNavigationState}
              recordingStorageConfig={recordingStorageConfig}
              settings={userSettings}
              settingsFormDisabled={settingsFormDisabled}
              settingsStatus={settingsStatus}
              templateStatus={templateStatus}
              trashActionAlert={trashActionAlert}
              trashActionContext={trashActionContext}
              trashNowMs={trashNowMs}
              trashPurgeItemAction={trashPurgeItemAction}
              trashPurgeAction={trashPurgeAction}
              trashRestoreBulkAction={trashRestoreBulkAction}
              trashRestoreAction={trashRestoreAction}
              usageState={usageState}
              userEmail={userEmail}
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
