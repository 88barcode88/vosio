import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import { createAdminClient } from "@/lib/supabase/admin";

// Read the exact technical locator only after current session authority; never use it as authorization.
export async function getAuthorizedAudioLocator(session: SupabaseClient, recordingId: string, timeoutMs?: number) {
  if (!(await resolveRecordingCapabilities(session, recordingId)).read) return null;
  const { data, error } = await (timeoutMs === undefined ? createAdminClient() : createAdminClient({ fetchTimeoutMs: timeoutMs })).from("recordings")
    .select("id,user_id,storage_path,mime_type").eq("id", recordingId).maybeSingle();
  if (error) throw new Error("Unable to load audio locator");
  if (!data || data.id !== recordingId || typeof data.user_id !== "string") return null;
  if (data.storage_path !== null) {
    const prefix = `${data.user_id}/${recordingId}/`;
    if (typeof data.storage_path !== "string" || !data.storage_path.startsWith(prefix)
      || data.storage_path.includes("\\")) return null;
    const relative = data.storage_path.slice(prefix.length);
    if (relative !== "live/" && relative.split("/").some((part: string) => !part || part === "." || part === "..")) return null;
  }
  return data as { id: string; user_id: string; storage_path: string | null; mime_type: string | null };
}
