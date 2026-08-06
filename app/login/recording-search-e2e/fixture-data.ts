import type { RecordingClientView } from "@/lib/recordings/client-view";
import type { TranscriptRow } from "@/lib/transcripts/types";

export const searchFixtureRecordingId = "00000000-0000-4000-8000-000000000201";
export const searchFixtureTranscriptId = "00000000-0000-4000-8000-000000000202";
export const searchFixtureUserId = "00000000-0000-4000-8000-000000000203";

export type SearchFixtureCandidate = {
  ownerUserId: string;
  recording: RecordingClientView;
  transcript: TranscriptRow;
};

// createSearchFixtureTranscriptCandidates includes rows that the development selector must exclude.
export function createSearchFixtureTranscriptCandidates(): SearchFixtureCandidate[] {
  const currentRecording = createRecording("completed", "Vlastní aktuální Lucern call");

  return [
    {
      ownerUserId: searchFixtureUserId,
      recording: currentRecording,
      transcript: createTranscript({
        createdAt: "2026-08-05T10:00:00.000Z",
        id: searchFixtureTranscriptId,
        rawText: "Úvod. Řešíme Lucern CRM dnes.",
        segments: [
          { end_ms: 1_000, speaker: 1, start_ms: 0, text: "Úvod." },
          { end_ms: 8_500, speaker: 2, start_ms: 8_000, text: "Řešíme Lucern" },
          { end_ms: 9_000, speaker: 2, start_ms: 8_500, text: " CRM dnes." }
        ],
        userId: searchFixtureUserId
      })
    },
    {
      ownerUserId: searchFixtureUserId,
      recording: currentRecording,
      transcript: createTranscript({
        createdAt: "2026-08-04T10:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000206",
        rawText: "Older transcript secret",
        segments: [],
        userId: searchFixtureUserId
      })
    },
    {
      ownerUserId: "00000000-0000-4000-8000-000000000299",
      recording: currentRecording,
      transcript: createTranscript({
        createdAt: "2026-08-06T10:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000207",
        rawText: "Foreign transcript secret",
        segments: [],
        userId: "00000000-0000-4000-8000-000000000299"
      })
    },
    {
      ownerUserId: searchFixtureUserId,
      recording: createRecording("deleted", "Deleted fixture recording"),
      transcript: createTranscript({
        createdAt: "2026-08-07T10:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000208",
        rawText: "Deleted transcript secret",
        segments: [],
        userId: searchFixtureUserId
      })
    }
  ];
}

// selectCurrentOwnedSearchFixtureCandidate mirrors the detail boundary over untrusted fixture candidates.
export function selectCurrentOwnedSearchFixtureCandidate(
  candidates: SearchFixtureCandidate[],
  recordingId: string,
  userId: string
) {
  return candidates
    .filter((candidate) =>
      candidate.ownerUserId === userId
      && candidate.recording.id === recordingId
      && candidate.recording.status !== "deleted"
      && candidate.transcript.recording_id === recordingId
      && candidate.transcript.user_id === userId
    )
    .sort((left, right) =>
      right.transcript.created_at.localeCompare(left.transcript.created_at)
      || right.transcript.id.localeCompare(left.transcript.id)
    )[0] ?? null;
}

// createRecording builds one safe fixture recording with no Storage locator.
function createRecording(
  status: RecordingClientView["status"],
  title: string
): RecordingClientView {
  return {
    audioAvailability: status === "deleted" ? "none" : "single",
    created_at: "2026-08-05T10:00:00.000Z",
    duration_seconds: 60,
    file_size_bytes: 1_024,
    id: searchFixtureRecordingId,
    mime_type: "audio/webm",
    source_type: "upload",
    status,
    title,
    updated_at: "2026-08-05T10:01:00.000Z"
  };
}

// createTranscript builds one candidate row with explicit owner and ordering metadata.
function createTranscript({
  createdAt,
  id,
  rawText,
  segments,
  userId
}: {
  createdAt: string;
  id: string;
  rawText: string;
  segments: unknown[];
  userId: string;
}): TranscriptRow {
  return {
    created_at: createdAt,
    id,
    language: "cs",
    raw_text: rawText,
    recording_id: searchFixtureRecordingId,
    segments,
    speakers: [],
    transcription_job_id: null,
    user_id: userId
  };
}
