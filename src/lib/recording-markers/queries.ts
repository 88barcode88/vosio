import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/pagination";
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
  const rows = await fetchAllRows<RecordingMarkerRow>("Unable to load recording markers", (from, to) => supabase
    .from("recording_markers")
    .select(RECORDING_MARKER_COLUMNS.split(",").filter((column) => column !== "user_id").join(","))
    .eq("recording_id", recordingId)
    .order("offset_ms", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
    .returns<RecordingMarkerRow[]>());

  return rows.map(pickRecordingMarkerRow);
}
