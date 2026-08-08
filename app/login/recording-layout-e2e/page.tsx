import { notFound } from "next/navigation";
import { TranscriptTabs } from "@/components/transcript-tabs";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
import type { RecordingClientView } from "@/lib/recordings/client-view";
import type { RecordingMarkerRow } from "@/lib/recording-markers/types";
import { defaultUserSettings } from "@/lib/settings/types";
import type { TranscriptTab } from "@/components/transcript-tabs/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

export const dynamic = "force-dynamic";

const transcriptId = "00000000-0000-4000-8000-000000000301";
const recordingId = "00000000-0000-4000-8000-000000000302";
const userId = "00000000-0000-4000-8000-000000000303";
const emptyStructuredItems: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: []
};
const fixtureAiOutputs: AiOutputView[] = [{
  created_at: "2026-08-06T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000304",
  output_json: { markdown: "E2E AI SENTINEL" },
  output_text: null,
  processing_job_id: "00000000-0000-4000-8000-000000000305",
  processing_type: "summary",
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
const fixtureModes = ["blocks", "raw", "ai", "timeline", "files"] as const;
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

// createFixtureRecording exposes stored single-file audio through the production player.
function createFixtureRecording(): RecordingClientView {
  return {
    audioAvailability: "single",
    created_at: "2026-08-06T10:00:00.000Z",
    duration_seconds: 2_700,
    file_size_bytes: 1_024,
    id: recordingId,
    mime_type: "audio/e2e-sentinel",
    source_type: "upload",
    status: "completed",
    title: "Dlouhý testovací hovor",
    updated_at: "2026-08-06T10:01:00.000Z"
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
    <section className="recording-workbench" aria-label="Test detailu nahrávky">
      <header className="recording-object-header">Dlouhý testovací hovor</header>
      <div className="recording-workbench-grid">
        <section className="transcript-panel">
          <TranscriptTabs
            activeAiOutputs={fixtureAiOutputs}
            activeRecording={createFixtureRecording()}
            activeRecordingMarkers={fixtureMarkers}
            activeStructuredItems={emptyStructuredItems}
            activeTranscript={createFixtureTranscript(fixtureMode)}
            initialTab={getFixtureInitialTab(mode)}
            initialTabFromCookie
            userSettings={defaultUserSettings}
          />
        </section>
        <aside className="recording-rail">Testovací panel</aside>
      </div>
    </section>
  );
}
