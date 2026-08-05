export const MAX_LIVE_MARKER_OFFSET_MS = 86_400_000;

type ExpectedLiveMarker = {
  attempt: {
    clientMarkerId: string;
    markerType: string;
    note: string | null;
    offsetMs: number;
  };
  recordingId: string;
};

// getLiveMarkerOffsetMs derives a schema-safe offset from one monotonic recording clock.
export function getLiveMarkerOffsetMs({
  nowMs,
  startedAtMs
}: {
  nowMs: number;
  startedAtMs: number;
}) {
  const elapsedMs = Math.round(nowMs - startedAtMs);

  if (!Number.isFinite(elapsedMs)) {
    return 0;
  }

  return Math.min(MAX_LIVE_MARKER_OFFSET_MS, Math.max(0, elapsedMs));
}

// isLiveMarkerSaveResponse verifies that the server confirmed this exact marker attempt.
export function isLiveMarkerSaveResponse(
  value: unknown,
  { attempt, recordingId }: ExpectedLiveMarker
) {
  if (!value || typeof value !== "object" || !("marker" in value)) {
    return false;
  }

  const marker = value.marker;

  if (!marker || typeof marker !== "object") {
    return false;
  }

  const row = marker as Record<string, unknown>;

  return row.client_marker_id === attempt.clientMarkerId
    && row.recording_id === recordingId
    && row.offset_ms === attempt.offsetMs
    && row.marker_type === attempt.markerType
    && row.note === attempt.note;
}
