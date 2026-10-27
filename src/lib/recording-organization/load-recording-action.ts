"use server";

import { parseOrganizationId } from "@/lib/recording-organization/validation";
import type { RecordingOrganizationSnapshot } from "@/lib/recording-organization/types";
import { createClient } from "@/lib/supabase/server";

// loadRecordingOrganizationAction reads manager-authorized assignment ids and allowed targets, redacting foreign taxonomy.
export async function loadRecordingOrganizationAction(recordingId: string): Promise<RecordingOrganizationSnapshot | null> {
  try {
    const id = parseOrganizationId(recordingId);
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    const result = await supabase.rpc("recording_organization_context_v1", { p_recording_id: id });
    if (result.error || !result.data || result.data.id !== id) return null;
    return result.data as RecordingOrganizationSnapshot;
  } catch {
    return null;
  }
}
