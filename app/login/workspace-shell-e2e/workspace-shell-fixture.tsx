import { VosioWorkspace } from "@/components/vosio-workspace";
import type { RecordingRow } from "@/lib/recordings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";
import type { NavigationHrefOverrides, WorkspaceView } from "@/lib/workspace-data";

const recordingId = "00000000-0000-4000-8000-000000000601";
const transcriptId = "00000000-0000-4000-8000-000000000602";
const userId = "00000000-0000-4000-8000-000000000603";
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
  scope,
  view
}: {
  scope: string;
  view: WorkspaceShellFixtureView;
}) {
  const isDetail = view === "detail";
  const recording = createFixtureRecording();

  return (
    <VosioWorkspace
      activeRecordingId={isDetail ? recording.id : undefined}
      aiOutputs={[]}
      initialTranscriptTabFromCookie={isDetail}
      isCreatingRecording={view === "new"}
      navigationHrefOverrides={createFixtureNavigationOverrides(scope)}
      recordings={isDetail ? [recording] : []}
      transcripts={isDetail ? [createFixtureTranscript()] : []}
      userEmail="shell@example.cz"
      view={getWorkspaceView(view)}
    />
  );
}
