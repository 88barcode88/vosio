import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { captureScopeSchema } from "@/lib/recordings/capture";

export const bulkSharingSchema = z.object({ requestId: z.uuid(), recordingIds: z.array(z.uuid().transform((id) => id.toLowerCase())).min(1).max(100), ...captureScopeSchema.shape }).strict();
export type BulkSharingAttempt = z.infer<typeof bulkSharingSchema>;

// Validate the complete historical receipt, never accept a partial result or retry with a new identity.
export async function bulkShareRecordings(client: SupabaseClient, input: BulkSharingAttempt) {
  const payload = bulkSharingSchema.parse(input);
  captureScopeSchema.parse({ projectId: payload.projectId, visibility: payload.visibility, recipients: payload.recipients });
  const expected = [...new Set(payload.recordingIds)].sort();
  const { data, error } = await client.rpc("bulk_share_recordings_v1", {
    p_request_id: payload.requestId, p_recording_ids: payload.recordingIds,
    p_visibility: payload.visibility, p_recipients: payload.recipients
  });
  if (error) throw new Error("Sdílení nebylo potvrzeno. Zopakujte stejné uložení celého výběru.");
  const result = z.array(z.object({ recording_id: z.uuid(), visibility: z.enum(["private", "project", "selected"]) })).parse(data);
  if (result.length !== expected.length || result.some((row, index) => row.recording_id !== expected[index] || row.visibility !== payload.visibility)) throw new Error("Výsledek sdílení nebyl potvrzen. Zopakujte stejné uložení.");
  return result;
}
