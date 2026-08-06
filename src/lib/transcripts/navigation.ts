// getTranscriptAnchorId creates a stable timestamp anchor or a deterministic block fallback.
export function getTranscriptAnchorId(
  startMs: number | null,
  fallbackIndex: number,
  timestampOccurrence = 1
): string {
  if (startMs === null) {
    return `transcript-block-${fallbackIndex + 1}`;
  }

  const baseAnchorId = `transcript-at-${startMs}`;
  return timestampOccurrence > 1
    ? `${baseAnchorId}-${timestampOccurrence}`
    : baseAnchorId;
}
