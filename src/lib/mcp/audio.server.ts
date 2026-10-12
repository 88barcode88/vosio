import "server-only";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { getAuthorizedAudioLocator } from "@/lib/recordings/audio-locator.server";
import { getAudioPlaybackEligibility } from "@/lib/recordings/audio-playback";
import { RECORDINGS_BUCKET } from "@/lib/recordings/types";
import { resolveRecordingCapabilities } from "@/lib/recording-sharing/resolve-capabilities";
import { getMcpConfig } from "./config.server";
import { McpContentError, type VosioContentContext } from "./content.server";

// Keep MCP audio outside the application's manager-only Trash read surface.
async function requireActiveAudio(context: VosioContentContext, recordingId: string) {
  const result = await context.supabase.rpc("get_accessible_recording_v1", { p_recording_id: recordingId });
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1 || result.data[0]?.id !== recordingId || result.data[0].status === "deleted") throw new McpContentError("denied");
}

// Read a bounded private Storage range after current authority; internal signing credentials never leave the server.
export async function readAuthorizedAudioChunk(context: VosioContentContext, recordingId: string, start: number, maximum: number) {
  if (!z.string().uuid().safeParse(recordingId).success || !Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_048_576 || start > Number.MAX_SAFE_INTEGER - maximum) throw new McpContentError("invalid_arguments");
  const config = getMcpConfig();
  if (!config || context.resourceUrl !== config.resourceUrl || !context.scopes.includes("vosio:read")) throw new McpContentError("denied");
  await requireActiveAudio(context, recordingId);
  const locator = await getAuthorizedAudioLocator(context.supabase, recordingId, 15000);
  if (!locator?.storage_path || !getAudioPlaybackEligibility(locator).eligible) throw new McpContentError("denied");
  const signed = await context.supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(locator.storage_path, 5);
  if (signed.error || !signed.data?.signedUrl) throw new McpContentError("denied");
  const storageUrl = new URL(signed.data.signedUrl);
  if (storageUrl.origin !== config.supabaseUrl || !storageUrl.pathname.startsWith(`/storage/v1/object/sign/${RECORDINGS_BUCKET}/`)) throw new McpContentError("denied");
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(storageUrl, { headers: { Range: `bytes=${start}-${start + maximum - 1}` }, cache: "no-store", redirect: "error", signal });
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  const contentLength = Number(response.headers.get("content-length"));
  const partial = response.status === 206 && range && Number(range[1]) === start && Number(range[2]) >= start && Number(range[2]) - start + 1 <= maximum && Number(range[3]) > Number(range[2]);
  const whole = response.status === 200 && start === 0 && response.headers.has("content-length") && Number.isSafeInteger(contentLength) && contentLength > 0 && contentLength <= maximum;
  if (!response.body || !partial && !whole) { await response.body?.cancel(); throw new McpContentError("unavailable"); }
  const expected = partial && range ? Number(range[2]) - start + 1 : contentLength;
  const reader = response.body.getReader();
  const pieces: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > maximum) throw new McpContentError("unavailable");
      pieces.push(part.value);
    }
    if (count !== expected || !(await resolveRecordingCapabilities(context.supabase, recordingId)).read) throw new McpContentError("denied");
    await requireActiveAudio(context, recordingId);
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = Buffer.concat(pieces);
  const mimeType = locator.mime_type && /^audio\/[a-z0-9.+-]+$/i.test(locator.mime_type) ? locator.mime_type : "application/octet-stream";
  return { bytes, mimeType, contentRange: partial ? response.headers.get("content-range") : null, status: partial ? 206 : 200 };
}
