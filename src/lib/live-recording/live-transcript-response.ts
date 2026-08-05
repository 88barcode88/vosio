import { getTranscriptSearchWarningPayload } from "@/lib/transcripts/search-warning";

type SavedLiveTranscript = {
  id: string;
};

// buildLiveTranscriptSuccessPayload exposes only the public transcript id and nonfatal warnings.
export function buildLiveTranscriptSuccessPayload(
  transcript: SavedLiveTranscript,
  indexResult: { status: string }
) {
  return {
    transcript: { id: transcript.id },
    ...getTranscriptSearchWarningPayload(indexResult)
  };
}
