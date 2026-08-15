import { VosioWorkspace } from "@/components/vosio-workspace";
import type { RecordingStorageConfig } from "@/lib/recordings/storage-config";
import { ACCEPTED_RECORDING_MIME_TYPES, type RecordingRow } from "@/lib/recordings/types";
import { defaultUserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type { CurrentMonthUsageState } from "@/lib/usage/summary";
import type { NavigationHrefOverrides, WorkspaceView } from "@/lib/workspace-data";
import {
  inertTrashAction,
  inertTrashBulkRestoreAction,
  inertTrashPurgeItemAction,
  rejectTrashAction,
  rejectTrashBulkRestoreAction,
  rejectTrashPurgeItemAction
} from "./actions";

const recordingId = "00000000-0000-4000-8000-000000000601";
const transcriptId = "00000000-0000-4000-8000-000000000602";
const userId = "00000000-0000-4000-8000-000000000603";
const deletedRecordingId = "00000000-0000-4000-8000-000000000604";
const fixtureScopePattern = /^[0-9a-f]{12}$/;
const fixtureViews = [
  "detail",
  "documentation",
  "new",
  "recordings",
  "settings",
  "templates",
  "trash"
] as const;

const settingsFixtureStorage: RecordingStorageConfig = {
  allowedMimeTypes: [...ACCEPTED_RECORDING_MIME_TYPES],
  bucketMaxFileSizeBytes: 100 * 1024 * 1024,
  detectedGlobalMaxFileSizeBytes: null,
  maxFileSizeBytes: 50 * 1024 * 1024,
  planMaxFileSizeBytes: 50 * 1024 * 1024
};

const settingsFixtureUsage: CurrentMonthUsageState = {
  error: null,
  summary: {
    ai: {
      estimatedCostUsd: 0.024,
      inputTokens: 4_200,
      jobCount: 4,
      jobsMissingTokenUsage: 1,
      modelBreakdown: [],
      outputTokens: 1_100,
      unpricedModelIds: ["custom-model"]
    },
    period: { endIso: "2026-09-01T00:00:00.000Z", startIso: "2026-08-01T00:00:00.000Z" },
    recordings: {
      count: 5,
      deletedCount: 1,
      totalDurationSeconds: 5_400,
      totalFileSizeBytes: 26 * 1024 * 1024,
      withDurationCount: 3,
      withFileSizeCount: 2
    },
    soniox: {
      asyncDurationSeconds: 5_400,
      asyncEstimatedCostUsd: 0.15,
      billableDurationSeconds: 5_400,
      estimatedCostUsd: 0.15,
      jobCount: 3,
      jobsMissingDurationCount: 1,
      jobsWithDurationCount: 2,
      realtimeDurationSeconds: 0,
      realtimeEstimatedCostUsd: 0
    }
  }
};

export type WorkspaceShellFixtureView = (typeof fixtureViews)[number];

// isWorkspaceShellFixtureScope rejects unscoped access to the development-only product shell.
export function isWorkspaceShellFixtureScope(value: string | undefined): value is string {
  return Boolean(value && fixtureScopePattern.test(value));
}

// isWorkspaceShellFixtureView narrows the route segment to one intentional fixture surface.
export function isWorkspaceShellFixtureView(value: string | undefined): value is WorkspaceShellFixtureView {
  return fixtureViews.some((view) => view === value);
}

// createFixtureNavigationOverrides keeps product navigation inside the scoped development fixture.
function createFixtureNavigationOverrides(scope: string): NavigationHrefOverrides {
  // fixtureHref keeps every overridden destination under the same random fixture scope.
  const fixtureHref = (view: WorkspaceShellFixtureView) =>
    `/login/workspace-shell-e2e/${view}?scope=${scope}`;

  return {
    "/documentation": fixtureHref("documentation"),
    "/recordings": fixtureHref("recordings"),
    "/recordings/new": fixtureHref("new"),
    "/settings": fixtureHref("settings"),
    "/templates": fixtureHref("templates"),
    "/trash": fixtureHref("trash")
  };
}

// createFixtureRecording supplies a completed text-only recording for exact workbench geometry.
function createFixtureRecording(): RecordingRow {
  return {
    client_id: null,
    created_at: "2026-08-09T10:00:00.000Z",
    duration_seconds: 5_400,
    error_message: null,
    file_size_bytes: null,
    folder_id: null,
    id: recordingId,
    mime_type: null,
    project_id: null,
    source_type: "realtime",
    status: "completed",
    storage_path: null,
    title: "Dlouhý detail shellu",
    updated_at: "2026-08-09T11:30:00.000Z",
    user_id: userId
  };
}

// createDeletedFixtureRecordings supplies safe local-only rows for Trash interaction and layout checks.
function createDeletedFixtureRecordings(): RecordingRow[] {
  return [
    {
      ...createFixtureRecording(),
      deleted_at: "2026-08-09T12:00:00.000Z",
      duration_seconds: 2_580,
      file_size_bytes: 28_400_000,
      id: deletedRecordingId,
      mime_type: "audio/m4a",
      source_type: "upload",
      status: "deleted",
      storage_path: `${userId}/${deletedRecordingId}/recording.m4a`,
      title: "Produktový rozhovor k novému webu",
      updated_at: "2026-08-09T12:10:00.000Z"
    },
    {
      ...createFixtureRecording(),
      deleted_at: "2026-08-08T09:00:00.000Z",
      duration_seconds: 1_240,
      file_size_bytes: null,
      id: "00000000-0000-4000-8000-000000000605",
      status: "deleted",
      title: "Textový přepis bez audia",
      updated_at: "2026-08-08T09:30:00.000Z"
    }
  ];
}

// createFixtureTranscript provides enough real transcript rows to require the intended inner scroll owner.
function createFixtureTranscript(): TranscriptRow {
  return {
    created_at: "2026-08-09T11:30:00.000Z",
    id: transcriptId,
    language: "cs",
    raw_text: "",
    recording_id: recordingId,
    segments: Array.from({ length: 80 }, (_, index) => ({
      end_ms: (index + 1) * 30_000,
      speaker: index % 2,
      start_ms: index * 30_000,
      text: index === 79
        ? "KONEC DLOUHÉHO DETAILU SHELLU"
        : `Dlouhá testovací věta detailu ${index + 1}.`
    })),
    speakers: [],
    transcription_job_id: null,
    user_id: userId
  };
}

// getWorkspaceView maps detail and create fixture states onto their real recordings workspace owner.
function getWorkspaceView(view: WorkspaceShellFixtureView): WorkspaceView {
  return view === "detail" || view === "new" ? "recordings" : view;
}

// WorkspaceShellFixture mounts the real Vosio shell with bounded local-only data and navigation.
export function WorkspaceShellFixture({
  trashMode = "populated",
  scope,
  view
}: {
  trashMode?: "empty" | "failure" | "populated";
  scope: string;
  view: WorkspaceShellFixtureView;
}) {
  const isDetail = view === "detail";
  const recording = createFixtureRecording();

  return (
    <VosioWorkspace
      activeRecordingId={isDetail ? recording.id : undefined}
      aiOutputs={[]}
      deletedRecordings={view === "trash" && trashMode !== "empty" ? createDeletedFixtureRecordings() : []}
      initialTranscriptTabFromCookie={isDetail}
      isCreatingRecording={view === "new"}
      navigationHrefOverrides={createFixtureNavigationOverrides(scope)}
      recordings={view === "recordings" || isDetail ? [recording] : []}
      recordingStorageConfig={settingsFixtureStorage}
      settingsFormDisabled={view === "settings"}
      transcripts={isDetail ? [createFixtureTranscript()] : []}
      trashActionContext={{ fixtureScope: scope }}
      trashNowMs={Date.parse("2026-08-13T12:00:00.000Z")}
      trashPurgeItemAction={trashMode === "failure" ? rejectTrashPurgeItemAction : inertTrashPurgeItemAction}
      trashPurgeAction={trashMode === "failure" ? rejectTrashAction : inertTrashAction}
      trashRestoreBulkAction={trashMode === "failure" ? rejectTrashBulkRestoreAction : inertTrashBulkRestoreAction}
      trashRestoreAction={trashMode === "failure" ? rejectTrashAction : inertTrashAction}
      usageState={settingsFixtureUsage}
      userSettings={{ ...defaultUserSettings, supabaseStoragePlan: "free" }}
      userEmail="shell@example.cz"
      view={getWorkspaceView(view)}
    />
  );
}
