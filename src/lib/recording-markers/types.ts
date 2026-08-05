export const RECORDING_MARKER_TYPES = [
  "important",
  "task",
  "decision",
  "follow_up"
] as const;

export const RECORDING_MARKER_COLUMNS = [
  "id",
  "client_marker_id",
  "recording_id",
  "user_id",
  "offset_ms",
  "marker_type",
  "note",
  "created_at",
  "updated_at"
].join(",");

export type RecordingMarkerType = (typeof RECORDING_MARKER_TYPES)[number];

export type RecordingMarkerRow = {
  client_marker_id: string;
  created_at: string;
  id: string;
  marker_type: RecordingMarkerType;
  note: string | null;
  offset_ms: number;
  recording_id: string;
  updated_at: string;
  user_id: string;
};

export type RecordingMarkerRequest = {
  clientMarkerId: string;
  markerType: RecordingMarkerType;
  note: string | null;
  offsetMs: number;
};

// pickRecordingMarkerRow maps database results to the explicit public marker response shape.
export function pickRecordingMarkerRow(value: unknown): RecordingMarkerRow {
  const row = value as RecordingMarkerRow;

  return {
    client_marker_id: row.client_marker_id,
    created_at: row.created_at,
    id: row.id,
    marker_type: row.marker_type,
    note: row.note,
    offset_ms: row.offset_ms,
    recording_id: row.recording_id,
    updated_at: row.updated_at,
    user_id: row.user_id
  };
}
