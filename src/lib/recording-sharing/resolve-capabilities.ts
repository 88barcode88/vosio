import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordingCapabilities } from "./types";

export const NO_RECORDING_CAPABILITIES: Readonly<RecordingCapabilities> = Object.freeze({
  read: false, editTitle: false, editSpeakers: false, editTaskStatus: false,
  manageAccess: false, delete: false, restore: false, purge: false,
  runPersonalAi: false, usePrivateChat: false
});

// Resolve current authority only through the session RPC; malformed/unavailable facts grant nothing.
export async function resolveRecordingCapabilities(
  supabase: SupabaseClient, recordingId: string
): Promise<RecordingCapabilities> {
  try {
    const { data, error } = await supabase.rpc("recording_capabilities_v1", { p_recording_id: recordingId });
    if (error || !data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(NO_RECORDING_CAPABILITIES).some((key) => typeof data[key] !== "boolean")
      || !data.read) return { ...NO_RECORDING_CAPABILITIES };
    return Object.fromEntries(Object.keys(NO_RECORDING_CAPABILITIES).map((key) => [key, data[key]])) as RecordingCapabilities;
  } catch {
    return { ...NO_RECORDING_CAPABILITIES };
  }
}
