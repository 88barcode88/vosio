import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecordingWorkbench } from "@/components/workspace/recording-workbench";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import type { RecordingRow } from "@/lib/recordings/types";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/components/transcript-tabs", () => ({ TranscriptTabs: () => <div>Saved content</div> }));
vi.mock("@/components/transcript-tabs/export-controls", () => ({ ExportControls: () => null }));
vi.mock("@/components/transcription-controls", () => ({ TranscriptionControls: () => <div>Provider controls</div> }));
vi.mock("@/components/delete-recording-form", () => ({ DeleteRecordingForm: () => <div>Delete recording</div> }));
vi.mock("@/components/workspace/recording-detail-title-editor", () => ({ RecordingDetailTitleEditor: () => <div>Edit title</div> }));
vi.mock("@/components/workspace/recording-organization-editor", () => ({ RecordingOrganizationEditor: () => <div>Edit organization</div> }));
vi.mock("@/components/workspace/recording-access-manager", () => ({ RecordingAccessManager: ({ projectId }: { projectId: string | null }) => <div>Access manager:{projectId ?? "standalone"}</div> }));

// Render the production workbench with explicit server capabilities and no provider effects.
function renderWorkbench(overrides: Partial<RecordingRow>) {
  const recording: RecordingRow = { id: "recording", title: "Shared recording", source_type: "upload", status: "completed", created_at: "2026-09-22T00:00:00Z", updated_at: "2026-09-22T00:00:00Z", duration_seconds: null, file_size_bytes: null, mime_type: "audio/webm", client_id: null, folder_id: null, project_id: "project", visibility: "project", ...overrides };
  return renderToStaticMarkup(<RecordingWorkbench activeAiOutputs={[]} activeRecording={recording}
    activeRecordingMarkers={[]} activeRecordingOrganization={{ client: null, project: null, folder: null, tags: [] }}
    activeStructuredItems={{ tasks: [], chapters: [], decisions: [], risks: [] }} activeTranscript={null}
    initialDeepLink={null} initialTab="transcript" initialTabFromCookie={false} initialTabFromUrl={false}
    recordingOrganizationOptions={{ clients: [], projects: [], folders: [], tags: [] }} userSettings={getUserSettingsFromMetadata({})} />);
}

describe("server-resolved sharing controls", () => {
  it.each([undefined, { ...NO_RECORDING_CAPABILITIES, read: true }])("keeps saved content but hides actions without server grants", (capabilities) => {
    const html = renderWorkbench({ capabilities });
    expect(html).toContain("Saved content");
    expect(html).not.toMatch(/Access manager|Delete recording|Edit title|Provider controls|Edit organization/);
  });
  it("gives E title controls but no management, destruction or provider controls", () => {
    const html = renderWorkbench({ capabilities: { ...NO_RECORDING_CAPABILITIES, read: true, editTitle: true, editSpeakers: true, editTaskStatus: true } });
    expect(html).toContain("Edit title");
    expect(html).not.toMatch(/Access manager|Delete recording|Provider controls|Edit organization/);
  });
  it("mounts shared-project founder management without foreign personal AI", () => {
    const html = renderWorkbench({ capabilities: { ...NO_RECORDING_CAPABILITIES, read: true, manageAccess: true, delete: true } });
    expect(html).toContain("Sdílet</summary>");
    expect(html).not.toContain("Access manager:project");
    expect(html).toContain("Delete recording");
    expect(html).not.toContain("Provider controls");
  });
  it("supports standalone owner management but withholds project-private exact sharing", () => {
    const capabilities = { ...NO_RECORDING_CAPABILITIES, read: true, manageAccess: true };
    expect(renderWorkbench({ project_id: null, visibility: "private", capabilities })).toContain("Sdílet</summary>");
    expect(renderWorkbench({ visibility: "private", capabilities })).not.toContain("Access manager");
  });
});
