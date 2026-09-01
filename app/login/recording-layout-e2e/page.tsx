import { notFound } from "next/navigation";
import { VosioWorkspace } from "@/components/vosio-workspace";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import type { RecordingRow } from "@/lib/recordings/types";
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import { defaultUserSettings } from "@/lib/settings/types";
import type { TranscriptTab } from "@/components/transcript-tabs/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

export const dynamic = "force-dynamic";

const transcriptId = "00000000-0000-4000-8000-000000000301";
const recordingId = "00000000-0000-4000-8000-000000000302";
const userId = "00000000-0000-4000-8000-000000000303";
const fixtureStructuredItems: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: [{
    ai_output_id: "00000000-0000-4000-8000-000000000304",
    deadline: null,
    deadline_confidence: null,
    deadline_normalized: null,
    description: "Ověřit mobilní dotykové cíle bez skutečné mutace.",
    evidence_end_ms: null,
    evidence_quote: null,
    evidence_start_ms: null,
    id: "00000000-0000-4000-8000-000000000307",
    owner_category: "Moje práce",
    owner_name: null,
    position: 1,
    processing_job_id: "00000000-0000-4000-8000-000000000305",
    raw_item: {},
    source_type: "explicit",
    status: "new",
    title: "E2E úkol",
    transcript_id: transcriptId,
    user_id: userId
  }]
};
const fixtureAiOutputs: AiOutputView[] = [{
  created_at: "2026-08-06T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000304",
  output_json: { markdown: "E2E AI SENTINEL" },
  output_text: null,
  processing_job_id: "00000000-0000-4000-8000-000000000305",
  processing_type: "follow_up_email",
  transcript_id: transcriptId,
  user_id: userId
}];
const fixtureMarkers: RecordingMarkerRow[] = [{
  client_marker_id: "e2e-marker-1",
  created_at: "2026-08-06T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000306",
  marker_type: "important",
  note: "E2E TIMELINE SENTINEL",
  offset_ms: 120_000,
  recording_id: recordingId,
  updated_at: "2026-08-06T10:00:00.000Z",
  user_id: userId
}];
const fixtureScopePattern = /^[0-9a-f]{12}$/;
const fixtureModes = ["blocks", "raw", "ai", "timeline", "files", "chat"] as const;
type FixtureMode = (typeof fixtureModes)[number];

// createFixtureSegments produces alternating speaker blocks that overflow the detail viewport.
function createFixtureSegments() {
  return Array.from({ length: 45 }, (_, index) => ({
    end_ms: (index + 1) * 60_000,
    speaker: index % 2,
    start_ms: index * 60_000,
    text: index === 44
      ? "POSLEDNÍ VĚTA PŘEPISU"
      : `Testovací věta ${index + 1}.`
  }));
}

// createFixtureRawText provides enough lines to exercise the raw transcript scrollbar.
function createFixtureRawText() {
  const lines = Array.from({ length: 45 }, (_, index) => `Testovací raw věta ${index + 1}.`);
  lines.push("POSLEDNÍ RAW VĚTA PŘEPISU");
  return lines.join("\n");
}

// createFixtureTranscript switches between timestamped blocks and the raw-text fallback.
function createFixtureTranscript(mode: "blocks" | "raw"): TranscriptRow {
  const segments = mode === "blocks" ? createFixtureSegments() : [];

  return {
    created_at: "2026-08-06T10:00:00.000Z",
    id: transcriptId,
    language: "cs",
    raw_text: mode === "raw" ? createFixtureRawText() : "",
    recording_id: recordingId,
    segments,
    speakers: [],
    transcription_job_id: null,
    user_id: userId
  };
}

// createFixtureRecording exposes stored single-file audio through the production detail workspace.
function createFixtureRecording(): RecordingRow {
  return {
    client_id: null,
    created_at: "2026-08-06T10:00:00.000Z",
    duration_seconds: 2_700,
    error_message: null,
    file_size_bytes: 1_024,
    folder_id: null,
    id: recordingId,
    mime_type: "audio/e2e-sentinel",
    project_id: null,
    source_type: "upload",
    status: "completed",
    storage_path: `${userId}/${recordingId}/fixture.wav`,
    title: "Dlouhý testovací hovor",
    updated_at: "2026-08-06T10:01:00.000Z",
    user_id: userId
  };
}

// isFixtureMode narrows query values to the deterministic layout regression modes.
function isFixtureMode(value: string | undefined): value is FixtureMode {
  return fixtureModes.some((mode) => mode === value);
}

// getFixtureInitialTab maps transcript-content fixture modes to the transcript tab.
function getFixtureInitialTab(mode: FixtureMode): TranscriptTab {
  return mode === "blocks" || mode === "raw" ? "transcript" : mode;
}

// RecordingLayoutE2EPage exposes the real detail hierarchy only on the local dev server.
export default async function RecordingLayoutE2EPage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string; scope?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const { mode, scope } = await searchParams;

  if (
    !scope
    || !fixtureScopePattern.test(scope)
    || !isFixtureMode(mode)
  ) {
    notFound();
  }

  const fixtureMode = mode === "raw" ? "raw" : "blocks";

  return (
    <VosioWorkspace
      activeRecordingId={recordingId}
      aiOutputs={fixtureAiOutputs}
      initialTranscriptTab={getFixtureInitialTab(mode)}
      initialTranscriptTabFromCookie
      recordingMarkers={fixtureMarkers}
      recordingOrganization={{ client: null, folder: null, project: null, tags: [] }}
      recordingOrganizationOptions={{ clients: [], folders: [], projects: [], tags: [] }}
      recordings={[createFixtureRecording()]}
      structuredItems={fixtureStructuredItems}
      transcripts={[createFixtureTranscript(fixtureMode)]}
      userSettings={defaultUserSettings}
      userEmail="detail-e2e@vosio.local"
    />
  );
}
