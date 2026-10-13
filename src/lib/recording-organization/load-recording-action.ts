"use server";

import { parseOrganizationId } from "@/lib/recording-organization/validation";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import { getRecordingById } from "@/lib/recordings/queries";
import { createClient } from "@/lib/supabase/server";

// loadRecordingOrganizationAction reads only assignment ids for an authorized private recording.
export async function loadRecordingOrganizationAction(recordingId: string) {
  try {
    const id = parseOrganizationId(recordingId);
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    const capabilities = await resolveRecordingCapabilities(supabase, id);
    if (!capabilities.manageAccess) return null;
    const recording = await getRecordingById(supabase, id);
    if (!recording || recording.visibility !== "private") return null;
    return {
      id: recording.id,
      client_id: recording.client_id,
      project_id: recording.project_id,
      folder_id: recording.folder_id,
      tag_ids: recording.tag_ids ?? []
    };
  } catch {
    return null;
  }
}
