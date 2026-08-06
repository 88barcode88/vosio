import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickRecordingMarkerRow,
  RECORDING_MARKER_COLUMNS,
  type RecordingMarkerRow
} from "@/lib/recording-markers/types";

// listRecordingMarkers loads one recording's markers through RLS in deterministic timeline order.
export async function listRecordingMarkers(
  supabase: SupabaseClient,
  recordingId: string
): Promise<RecordingMarkerRow[]> {
  const { data, error } = await supabase
    .from("recording_markers")
    .select(RECORDING_MARKER_COLUMNS)
    .eq("recording_id", recordingId)
    .order("offset_ms", { ascending: true })
    .order("id", { ascending: true })
    .returns<RecordingMarkerRow[]>();

  if (error) {
    throw new Error(`Unable to load recording markers: ${error.message}`);
  }

  return (data ?? []).map(pickRecordingMarkerRow);
}
