import "server-only";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import process from "node:process";
import { z } from "zod";
import { createRateLimiter } from "@/lib/rate-limit";
import { captureReceiptSchema, captureStateSchema } from "@/lib/recordings/capture";
import { getLiveAudioMaxFileSizeBytes } from "@/lib/recordings/live-audio-limit";
import { liveAudioQualityOptions, RECORDINGS_BUCKET } from "@/lib/recordings/types";
import { DEFAULT_SONIOX_ASYNC_MODEL, isApprovedSonioxAsyncModel } from "@/lib/model-options";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import { authenticateBridgeRequest, McpAuthError } from "./auth.server";
import { captureCompletionSchema, completeCaptureBinding, getCaptureBindingByRecording, readRecordingsBucketLimit, recordCaptureBinding, type CaptureCompletion } from "./capture-store.server";
import type { McpConfig } from "./config.server";
import { extensionIdFromRedirect, MCP_SCOPE_CAPTURE } from "./scopes";

type Environment = Record<string, string | undefined>;
type Identity = Awaited<ReturnType<typeof authenticateBridgeRequest>>;
type Context = { identity: Identity; extensionId: string; config: McpConfig; env: Environment };

const MESSAGES: Record<string, string> = {
  invalid_request: "Neplatný požadavek.", unauthorized: "Je potřeba znovu spárovat rozšíření.", insufficient_scope: "Toto připojení nemá oprávnění nahrávat.",
  origin_mismatch: "Požadavek nepochází ze spárovaného rozšíření.", not_found: "Nahrávka nebyla nalezena.",
  revision_conflict: "Nahrávka se mezitím změnila. Načtěte její aktuální stav.", incomplete_parts: "Některá část audia chybí nebo neodpovídá.",
  recording_deleted: "Nahrávka byla ve Vosiu smazána.", part_too_large: "Část audia překračuje povolený limit.",
  rate_limited: "Příliš mnoho požadavků. Zkuste to za chvíli.", unavailable: "Služba je dočasně nedostupná. Zkuste to znovu."
};
// Namespace for deriving the transcription request id from the completion request id (UUIDv5), fixed forever for idempotence.
const TRANSCRIPTION_NAMESPACE = "6f1d3a4e-5b8c-4d2e-9a7f-3c0b1e2d4f58";
const MAX_BODY_BYTES = 65536;
const userLimit = createRateLimiter({ limit: 120, windowMs: 60_000 });

const uuid = z.string().uuid();
const emptySchema = z.object({}).strict();
const createSchema = z.object({ requestId: uuid, title: z.string().trim().min(1).max(200), startedAt: z.string().datetime({ offset: true }) }).strict();
const partsSchema = z.object({
  captureRevision: z.number().int().nonnegative(), mimeType: z.literal("audio/webm"),
  parts: z.array(z.object({ index: z.number().int().min(0).max(999), sizeBytes: z.number().int().positive() }).strict()).min(1).max(1000)
}).strict().refine((body) => body.parts.every((part, position) => part.index === position), "Parts must be contiguous from 0.");
const completeSchema = z.object({
  requestId: uuid, captureRevision: z.number().int().nonnegative(), durationSeconds: z.number().positive().max(7 * 86400), partCount: z.number().int().min(1).max(1000)
}).strict();
const operationSchema = z.object({ operationId: uuid, phase: z.string() });

class CaptureFailure extends Error {
  // Carry a fixed HTTP status and wire code; messages never contain database or provider details.
  constructor(readonly status: number, readonly code: keyof typeof MESSAGES, readonly headers: Record<string, string> = {}) { super(MESSAGES[code]); }
}

// Build the exact D8 error envelope; detail is never included.
function failureResponse(failure: CaptureFailure) {
  return Response.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status, headers: failure.headers });
}

// Record fixed operation metadata only; recording content, tokens and storage locators never enter the audit.
function audit(operation: string, result: string) {
  // eslint-disable-next-line no-console -- Deliberate metadata-only operational audit.
  console.info(JSON.stringify({ event: "vosio_capture", operation, result }));
}

// Derive a deterministic RFC 4122 version-5 UUID so a repeated completion reuses one transcription request.
export function uuidV5(name: string, namespace = TRANSCRIPTION_NAMESPACE) {
  const hash = createHash("sha1").update(Buffer.from(namespace.replaceAll("-", ""), "hex")).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Read a bounded JSON body and validate it with a strict schema; anything else is invalid_request.
async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json") || Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new CaptureFailure(400, "invalid_request");
  const text = await request.text().catch(() => null);
  if (text === null || text.length > MAX_BODY_BYTES) throw new CaptureFailure(400, "invalid_request");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new CaptureFailure(400, "invalid_request"); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CaptureFailure(400, "invalid_request");
  return parsed.data;
}

// Translate a database error code from a user-JWT RPC into the wire failure; `closed` means the recording is no longer open for upload.
function failFromRpc(error: { code?: string }, closed = false): CaptureFailure {
  switch (error.code) {
    case "40001": return new CaptureFailure(409, "revision_conflict");
    case "55000": return new CaptureFailure(409, closed ? "revision_conflict" : "incomplete_parts");
    case "22023": return new CaptureFailure(400, "invalid_request");
    case "42501": return new CaptureFailure(404, "not_found");
    default: return new CaptureFailure(503, "unavailable");
  }
}

// Recording statuses that still accept parts and completion.
const OPEN_STATUSES = ["created", "uploading", "failed"];

// Map a failed upload-step RPC; a denied write on a recording the web already closed or deleted is a conflict/410, not a 404.
async function failFromWrite(ctx: Context, recordingId: string, error: { code?: string }): Promise<CaptureFailure> {
  if (error.code === "42501") {
    const state = await readState(ctx.identity, recordingId).catch(() => undefined);
    if (state === null) return new CaptureFailure(410, "recording_deleted");
    if (state && !OPEN_STATUSES.includes(state.status)) return new CaptureFailure(409, "revision_conflict");
  }
  return failFromRpc(error, true);
}

// Read the safe capture state under the user's JWT; null means the recording is deleted or no longer accessible.
async function readState(identity: Identity, recordingId: string) {
  const { data, error } = await identity.supabase.rpc("get_recording_capture_state_v1", { p_recording_id: recordingId });
  if (error) throw new CaptureFailure(503, "unavailable");
  if (data === null) return null;
  const parsed = captureStateSchema.safeParse(data);
  if (!parsed.success || parsed.data.recordingId !== recordingId) throw new CaptureFailure(503, "unavailable");
  return parsed.data;
}

// Resolve a recording the extension created for this user: unknown and foreign ids are the same 404, deleted ones 410.
async function requireBound(ctx: Context, recordingId: string) {
  const binding = await getCaptureBindingByRecording(ctx.identity.userId, ctx.extensionId, recordingId).catch(() => { throw new CaptureFailure(503, "unavailable"); });
  if (!binding) throw new CaptureFailure(404, "not_found");
  const state = await readState(ctx.identity, recordingId);
  if (!state) throw new CaptureFailure(410, "recording_deleted");
  return { binding, state };
}

// Link to the recording's detail page in this installation's web app.
function detailUrl(ctx: Context, recordingId: string) { return `${ctx.config.origin}/recordings/${recordingId}`; }

// Use the shared default model unless an approved override is configured; an unapproved override is a configuration error.
function resolveModel(env: Environment) {
  const override = env.SONIOX_ASYNC_MODEL?.trim();
  if (!override) return DEFAULT_SONIOX_ASYNC_MODEL;
  if (!isApprovedSonioxAsyncModel(override)) throw new Error("Unapproved transcription model.");
  return override;
}

// Ask the web to run one started operation; failures never reach the extension (the operation stays recoverable).
async function dispatchOperation(ctx: Context, operationId: string) {
  const token = ctx.env.RECORDING_TRANSCRIPTION_DISPATCH_TOKEN;
  if (!token) return;
  try {
    await fetch(`${ctx.config.origin}/api/jobs/recording-transcription/dispatch`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operationId }) });
  } catch { audit("dispatch", "error"); }
}

// Prepare and start the transcription under the user's JWT, then dispatch it; returns not_started on any failure.
async function startTranscription(ctx: Context, recordingId: string, completionRequestId: string, captureRevision: number): Promise<{ state: "queued" | "not_started"; operationId: string | null }> {
  try {
    const settings = getUserSettingsFromMetadata(ctx.identity.userMetadata);
    const prepared = await ctx.identity.supabase.rpc("prepare_recording_transcription_v1", {
      p_recording_id: recordingId, p_request_id: uuidV5(completionRequestId), p_expected_capture_revision: captureRevision,
      p_region: settings.sonioxRegion, p_model: resolveModel(ctx.env), p_purpose: "capture"
    });
    if (prepared.error) { audit("transcription_prepare", "error"); return { state: "not_started", operationId: null }; }
    const operation = operationSchema.parse(prepared.data);
    const started = await ctx.identity.supabase.rpc("start_recording_transcription_v1", { p_operation_id: operation.operationId });
    if (started.error) { audit("transcription_start", "error"); return { state: "not_started", operationId: null }; }
    const receipt = operationSchema.parse(started.data);
    if (receipt.operationId !== operation.operationId) return { state: "not_started", operationId: null };
    if (["started", "accepted"].includes(receipt.phase)) await dispatchOperation(ctx, receipt.operationId);
    return { state: "queued", operationId: receipt.operationId };
  } catch { audit("transcription", "error"); return { state: "not_started", operationId: null }; }
}

// POST /capture/config: recording settings of this installation and user.
async function config(ctx: Context) {
  const limit = getLiveAudioMaxFileSizeBytes(await readRecordingsBucketLimit());
  if (limit === null) throw new CaptureFailure(503, "unavailable");
  const quality = getUserSettingsFromMetadata(ctx.identity.userMetadata).liveAudioQuality;
  return Response.json({ audioBitsPerSecond: liveAudioQualityOptions[quality].audioBitsPerSecond, maxPartBytes: limit, mimeType: "audio/webm", recorderMimeType: "audio/webm;codecs=opus",
    storage: { apiKey: ctx.config.publishableKey }, webOrigin: ctx.config.origin, account: { email: ctx.identity.email } });
}

// POST /capture/recordings: create (idempotently by requestId) a private recording and bind it to this extension.
async function createRecording(ctx: Context, request: Request) {
  const body = await readBody(request, createSchema);
  const created = await ctx.identity.supabase.rpc("create_recording_with_access_v1", { p_request_id: body.requestId, p_title: body.title, p_source_type: "in_app_recording", p_project_id: null, p_visibility: "private", p_recipients: [] });
  if (created.error) throw created.error.code === "42501" ? new CaptureFailure(410, "recording_deleted") : failFromRpc(created.error);
  const recordingId = uuid.safeParse(created.data);
  if (!recordingId.success) throw new CaptureFailure(503, "unavailable");
  const binding = await recordCaptureBinding({ userId: ctx.identity.userId, extensionId: ctx.extensionId, recordingId: recordingId.data, requestId: body.requestId, grantId: ctx.identity.grantId })
    .catch((error: { code?: string }) => { throw error?.code === "22023" || error?.code === "23505" ? new CaptureFailure(400, "invalid_request") : new CaptureFailure(503, "unavailable"); });
  if (!binding || binding.recordingId !== recordingId.data) throw new CaptureFailure(400, "invalid_request");
  const state = await readState(ctx.identity, recordingId.data);
  if (!state) throw new CaptureFailure(410, "recording_deleted");
  audit("create", "ok");
  return Response.json({ recordingId: recordingId.data, captureRevision: state.captureRevision, status: state.status, detailUrl: detailUrl(ctx, recordingId.data) });
}

// POST /capture/recordings/{id}/parts: register every part and issue one-shot signed upload URLs on the public Supabase address.
async function registerParts(ctx: Context, recordingId: string, request: Request) {
  const body = await readBody(request, partsSchema);
  const { state: first } = await requireBound(ctx, recordingId);
  if (first.captureRevision !== body.captureRevision) throw new CaptureFailure(409, "revision_conflict");
  const maxPartBytes = getLiveAudioMaxFileSizeBytes(await readRecordingsBucketLimit());
  if (maxPartBytes === null) throw new CaptureFailure(503, "unavailable");
  if (body.parts.some((part) => part.sizeBytes > maxPartBytes)) throw new CaptureFailure(413, "part_too_large");
  const bucket = ctx.identity.supabase.storage.from(RECORDINGS_BUCKET);
  const parts: Array<{ index: number; state: "ready"; uploadUrl: string } | { index: number; state: "exists" }> = [];
  let revision = first.captureRevision;
  for (const part of body.parts) {
    if (part.index > 0) { const current = await readState(ctx.identity, recordingId); if (!current) throw new CaptureFailure(410, "recording_deleted"); revision = current.captureRevision; }
    const expectedPath = `${ctx.identity.userId}/${recordingId}/live/part-${String(part.index).padStart(6, "0")}.webm`;
    const prepared = await ctx.identity.supabase.rpc("prepare_recording_live_part_v1", { p_recording_id: recordingId, p_expected_capture_revision: revision, p_part_index: part.index, p_mime_type: body.mimeType, p_file_size_bytes: part.sizeBytes });
    if (prepared.error) throw await failFromWrite(ctx, recordingId, prepared.error);
    if (prepared.data !== expectedPath) throw new CaptureFailure(503, "unavailable");
    const signed = await bucket.createSignedUploadUrl(expectedPath);
    if (signed.error) {
      // An already stored object is not an error: /complete verifies the manifest and is authoritative.
      if (/already exists|duplicate/i.test(signed.error.message) || (signed.error as { statusCode?: string }).statusCode === "409") { parts.push({ index: part.index, state: "exists" }); continue; }
      throw new CaptureFailure(503, "unavailable");
    }
    const token = signed.data?.token;
    if (!token) throw new CaptureFailure(503, "unavailable");
    parts.push({ index: part.index, state: "ready", uploadUrl: `${ctx.config.publicSupabaseUrl}/storage/v1/object/upload/sign/${RECORDINGS_BUCKET}/${expectedPath}?token=${encodeURIComponent(token)}` });
  }
  const final = await readState(ctx.identity, recordingId);
  if (!final) throw new CaptureFailure(410, "recording_deleted");
  audit("parts", "ok");
  return Response.json({ captureRevision: final.captureRevision, parts });
}

// Replay a stored completion result exactly as first returned.
function completionResponse(ctx: Context, recordingId: string, completion: CaptureCompletion) {
  return Response.json({ recordingId, status: completion.status, transcription: completion.transcription, detailUrl: detailUrl(ctx, recordingId) });
}

// POST /capture/recordings/{id}/complete: verify the manifest, close the upload and start the transcription (idempotent by requestId).
async function completeRecording(ctx: Context, recordingId: string, request: Request) {
  const body = await readBody(request, completeSchema);
  const { binding, state } = await requireBound(ctx, recordingId);
  const stored = captureCompletionSchema.safeParse(binding.completion);
  if (binding.completedAt && stored.success) return completionResponse(ctx, recordingId, stored.data);
  const done = await ctx.identity.supabase.rpc("complete_recording_live_parts_v1", { p_recording_id: recordingId, p_request_id: body.requestId, p_expected_capture_revision: body.captureRevision, p_duration_seconds: Math.max(1, Math.round(body.durationSeconds)) });
  // A recording the web already closed (recovery) is reported as a revision conflict so the extension reads /status and stops.
  if (done.error) throw done.error.code === "55000" ? failFromRpc(done.error, !OPEN_STATUSES.includes(state.status)) : await failFromWrite(ctx, recordingId, done.error);
  const receipt = captureReceiptSchema.safeParse(done.data);
  if (!receipt.success || receipt.data.recordingId !== recordingId) throw new CaptureFailure(503, "unavailable");
  const transcription = await startTranscription(ctx, recordingId, body.requestId, receipt.data.captureRevision);
  const completion: CaptureCompletion = { requestId: body.requestId, status: transcription.state === "queued" ? "transcribing" : receipt.data.status, transcription };
  // Only a started transcription is stored; otherwise a repeated /complete retries it idempotently.
  if (transcription.state === "queued") await completeCaptureBinding(ctx.identity.userId, ctx.extensionId, recordingId, completion).catch(() => audit("complete_store", "error"));
  audit("complete", transcription.state);
  return completionResponse(ctx, recordingId, completion);
}

// POST /capture/recordings/{id}/status: upload/transcription state and detail link, never recording content.
async function recordingStatus(ctx: Context, recordingId: string, request: Request) {
  await readBody(request, emptySchema);
  const { state } = await requireBound(ctx, recordingId);
  let transcriptionState: string | null = null;
  const managed = await ctx.identity.supabase.rpc("get_managed_recording_transcription_v1", { p_recording_ids: [recordingId] });
  const operation = !managed.error && Array.isArray(managed.data) ? managed.data.find((row: { recording_id?: string }) => row.recording_id === recordingId) : null;
  if (state.status === "completed") transcriptionState = "completed";
  else if (state.status === "failed" && operation) transcriptionState = "failed";
  else if (operation?.phase === "manual_required") transcriptionState = "manual_required";
  else if (operation) transcriptionState = state.status === "transcribing" && !["started", "prepared"].includes(operation.phase) ? "running" : "queued";
  return Response.json({ recordingId, status: state.status, captureRevision: state.captureRevision, transcriptionState, detailUrl: detailUrl(ctx, recordingId) });
}

// Handle one /capture/* request: authenticate exactly a {capture} grant, bind to the extension origin, then dispatch the fixed endpoint.
export async function handleCaptureRequest(request: Request, path: string, resolved: McpConfig, env: Environment = process.env): Promise<Response> {
  try {
    const match = /^\/recordings\/([^/]+)\/(parts|complete|status)$/.exec(path);
    if (path !== "/config" && path !== "/recordings" && !match) throw new CaptureFailure(404, "not_found");
    if (request.method !== "POST") throw new CaptureFailure(405, "invalid_request", { Allow: "POST" });
    const identity = await authenticateBridgeRequest(request).catch((error) => {
      if (error instanceof McpAuthError && error.code === "invalid_token") throw new CaptureFailure(401, "unauthorized", { "WWW-Authenticate": `Bearer resource_metadata="${resolved.resourceUrl}/resource-metadata", error="invalid_token"` });
      if (error instanceof McpAuthError && error.code === "rate_limited") throw new CaptureFailure(429, "rate_limited", { "Retry-After": "60" });
      throw new CaptureFailure(503, "unavailable");
    });
    const extensionId = extensionIdFromRedirect(identity.redirectUri);
    if (identity.scopes.length !== 1 || identity.scopes[0] !== MCP_SCOPE_CAPTURE || !extensionId) throw new CaptureFailure(403, "insufficient_scope");
    if (request.headers.get("origin") !== `chrome-extension://${extensionId}`) throw new CaptureFailure(403, "origin_mismatch");
    const rate = userLimit(identity.userId);
    if (!rate.allowed) throw new CaptureFailure(429, "rate_limited", { "Retry-After": String(rate.retryAfterSeconds) });
    const ctx: Context = { identity, extensionId, config: resolved, env };
    if (path === "/config") { await readBody(request, emptySchema); return await config(ctx); }
    if (path === "/recordings") return await createRecording(ctx, request);
    const recordingId = uuid.safeParse(match![1]);
    if (!recordingId.success) throw new CaptureFailure(404, "not_found");
    const action = match![2];
    return await (action === "parts" ? registerParts : action === "complete" ? completeRecording : recordingStatus)(ctx, recordingId.data, request);
  } catch (error) {
    if (error instanceof CaptureFailure) return failureResponse(error);
    audit("request", "error");
    return failureResponse(new CaptureFailure(503, "unavailable"));
  }
}
