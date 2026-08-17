import { notFound } from "next/navigation";
import { TranscriptTabs } from "@/components/transcript-tabs";
import type { StructuredAiItems } from "@/lib/ai/structured-types";
import type { RecordingAudioAvailability, RecordingClientView } from "@/lib/recordings/client-view";
import { defaultUserSettings } from "@/lib/settings/types";
import type { TranscriptRow } from "@/lib/transcripts/types";

export const dynamic = "force-dynamic";

const transcriptId = "00000000-0000-4000-8000-000000000101";
const recordingId = "00000000-0000-4000-8000-000000000102";
const userId = "00000000-0000-4000-8000-000000000103";
const fixtureModes = ["single", "none", "segmented", "untimed"] as const;
type FixtureMode = (typeof fixtureModes)[number];

// isFixtureMode narrows the development query to one supported audio contract.
function isFixtureMode(value: string | undefined): value is FixtureMode {
  return fixtureModes.some((mode) => mode === value);
}

// createFixtureTranscript provides one independently addressable evidence speaker block.
function createFixtureTranscript(mode: FixtureMode): TranscriptRow {
  return {
    created_at: "2026-08-05T10:00:00.000Z",
    id: transcriptId,
    language: "cs",
    raw_text: "Uvod. Schvalili jsme termin.",
    recording_id: recordingId,
    segments: mode === "untimed"
      ? [{ speaker: 2, text: "Schvalili jsme termin." }]
      : [
        { end_ms: 1_000, speaker: 1, start_ms: 0, text: "Uvod." },
        { end_ms: 8_400, speaker: 2, start_ms: 8_000, text: "Schvalili" },
        { end_ms: 8_900, speaker: 2, start_ms: 8_400, text: " jsme termin." }
      ],
    speakers: [],
    transcription_job_id: null,
    user_id: userId
  };
}

// createFixtureRecording exposes only the safe audio availability selected by the fixture.
function createFixtureRecording(audioAvailability: RecordingAudioAvailability): RecordingClientView {
  return {
    audioAvailability,
    created_at: "2026-08-05T10:00:00.000Z",
    duration_seconds: 60,
    file_size_bytes: 1_024,
    id: recordingId,
    mime_type: "audio/webm",
    source_type: "upload",
    status: "completed",
    title: `Evidence ${audioAvailability}`,
    updated_at: "2026-08-05T10:01:00.000Z"
  };
}

// createFixtureItems selects stored or legacy evidence rows for each E2E case.
function createFixtureItems(mode: FixtureMode): StructuredAiItems {
  const evidenceStartMs = mode === "segmented" || mode === "untimed" ? null : 8_000;
  const evidenceEndMs = mode === "segmented" || mode === "untimed" ? null : 8_900;
  const base = {
    ai_output_id: "00000000-0000-4000-8000-000000000104",
    evidence_end_ms: evidenceEndMs,
    evidence_quote: "Schvalili jsme termin",
    evidence_start_ms: evidenceStartMs,
    position: 1,
    processing_job_id: "00000000-0000-4000-8000-000000000105",
    raw_item: {},
    source_type: "explicit" as const,
    transcript_id: transcriptId,
    user_id: userId
  };

  if (mode === "single") {
    return {
      chapters: [],
      decisions: [],
      risks: [],
      tasks: [{
        ...base,
        deadline: null,
        deadline_confidence: null,
        deadline_normalized: null,
        description: null,
        owner_category: "Moje práce",
        owner_name: null,
        status: "new",
        title: "Potvrdit termin"
      }]
    };
  }

  if (mode === "none") {
    return {
      chapters: [],
      decisions: [],
      risks: [{
        ...base,
        impact: "Bez audia se ma stale otevrit prepis.",
        mitigation: null,
        owner_category: null,
        owner_role: null,
        title: "Transcript-only riziko"
      }],
      tasks: []
    };
  }

  return {
    chapters: [],
    decisions: [{
      ...base,
      owner_category: null,
      owner_role: null,
      status: "decided",
      title: mode === "untimed" ? "Legacy untimed rozhodnuti" : "Legacy segmented rozhodnuti"
    }],
    risks: [],
    tasks: []
  };
}

// RecordingEvidenceFixturePage exposes real evidence navigation only on the local dev server.
export default async function RecordingEvidenceFixturePage({
  searchParams
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const { mode } = await searchParams;

  if (!isFixtureMode(mode)) {
    notFound();
  }

  return (
    <main data-e2e-evidence-mode={mode}>
      <h1>Recording evidence E2E fixture</h1>
      <TranscriptTabs
        activeAiOutputs={[]}
        activeRecording={createFixtureRecording(mode === "untimed" ? "none" : mode)}
        activeStructuredItems={createFixtureItems(mode)}
        activeTranscript={createFixtureTranscript(mode)}
        initialTab="ai"
        initialTabFromCookie
        userSettings={defaultUserSettings}
      />
    </main>
  );
}
