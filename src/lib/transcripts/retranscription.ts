type RetranscriptionCleanupInput = {
  existingTranscriptId: string | null;
  replacementTranscriptReady: boolean;
};

// getRetranscriptionCleanupTranscriptId protects old transcripts until a replacement is ready to save.
export function getRetranscriptionCleanupTranscriptId(input: RetranscriptionCleanupInput) {
  if (!input.replacementTranscriptReady) {
    return null;
  }

  return input.existingTranscriptId;
}
