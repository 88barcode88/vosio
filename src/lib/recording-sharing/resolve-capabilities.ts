import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordingCapabilities } from "./types";

export const NO_RECORDING_CAPABILITIES: Readonly<RecordingCapabilities> = Object.freeze({
  read: false, editTitle: false, editSpeakers: false, editTaskStatus: false,
  manageAccess: false, delete: false, restore: false, purge: false,
  runPersonalAi: false, usePrivateChat: false
});

// Validates one RPC capability payload; malformed or unreadable facts grant nothing.
function normalizeCapabilities(data: unknown): RecordingCapabilities {
  const value = data as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(NO_RECORDING_CAPABILITIES).some((key) => typeof value[key] !== "boolean")
    || !value.read) return { ...NO_RECORDING_CAPABILITIES };
  return Object.fromEntries(Object.keys(NO_RECORDING_CAPABILITIES).map((key) => [key, value[key]])) as RecordingCapabilities;
}

// Resolve current authority only through the session RPC; malformed/unavailable facts grant nothing.
export async function resolveRecordingCapabilities(
  supabase: SupabaseClient, recordingId: string
): Promise<RecordingCapabilities> {
  try {
    const { data, error } = await supabase.rpc("recording_capabilities_v1", { p_recording_id: recordingId });
    return error ? { ...NO_RECORDING_CAPABILITIES } : normalizeCapabilities(data);
  } catch {
    return { ...NO_RECORDING_CAPABILITIES };
  }
}

// Server-side limit of recording_capabilities_batch_v1; larger id lists are split into several calls.
const CAPABILITIES_BATCH_LIMIT = 1000;

// Resolves capabilities for many recordings with one RPC per 1000 ids; every requested id gets an entry and a failed chunk grants nothing.
export async function resolveRecordingCapabilitiesBatch(
  supabase: SupabaseClient, recordingIds: readonly string[]
): Promise<Map<string, RecordingCapabilities>> {
  const ids = [...new Set(recordingIds)];
  const result = new Map(ids.map((id) => [id, { ...NO_RECORDING_CAPABILITIES }] as const));
  const chunks = Array.from({ length: Math.ceil(ids.length / CAPABILITIES_BATCH_LIMIT) },
    (_, index) => ids.slice(index * CAPABILITIES_BATCH_LIMIT, (index + 1) * CAPABILITIES_BATCH_LIMIT));
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const { data, error } = await supabase.rpc("recording_capabilities_batch_v1", { p_recording_ids: chunk });
      if (error || !Array.isArray(data)) return;
      for (const row of data) {
        if (row && typeof row.recording_id === "string" && result.has(row.recording_id)) {
          result.set(row.recording_id, normalizeCapabilities(row.capabilities));
        }
      }
    } catch {
      // Fail closed: the chunk keeps NO_RECORDING_CAPABILITIES for every id.
    }
  }));
  return result;
}
