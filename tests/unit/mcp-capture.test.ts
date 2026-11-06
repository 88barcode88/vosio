import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCaptureRequest, uuidV5 } from "@/lib/mcp/capture.server";
import { handleMcpEdge } from "@/lib/mcp/edge-handler.server";
import { McpAuthError } from "@/lib/mcp/auth.server";
import { parseMcpConfig } from "@/lib/mcp/config.server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), store: { record: vi.fn(), byRecording: vi.fn(), byRequest: vi.fn(), complete: vi.fn(), limit: vi.fn() } }));
vi.mock("@/lib/mcp/config.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/config.server")>(), loadMcpConfig: mocks.load }));
vi.mock("@/lib/mcp/auth.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/auth.server")>(), authenticateBridgeRequest: mocks.auth }));
vi.mock("@/lib/mcp/capture-store.server", async (original) => ({ ...await original<typeof import("@/lib/mcp/capture-store.server")>(),
  recordCaptureBinding: mocks.store.record, getCaptureBindingByRecording: mocks.store.byRecording, getCaptureBindingByRequest: mocks.store.byRequest,
  completeCaptureBinding: mocks.store.complete, readRecordingsBucketLimit: mocks.store.limit }));

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-0000000000ff";
const upstreamClientId = "10000000-0000-4000-8000-000000000004";
const extension = "abcdefghijklmnopabcdefghijklmnop";
const otherExtension = "ponmlkjihgfedcbaponmlkjihgfedcba";
const webOrigin = "https://web.example";
const publicUrl = "https://public.example";
const resourceUrl = `${publicUrl}/functions/v1/vosio-mcp`;
const env: Record<string, string | undefined> = { RECORDING_TRANSCRIPTION_DISPATCH_TOKEN: "dispatch-secret" };

type Recording = { id: string; user: string; title: string; status: string; revision: number; requestId: string; parts: Map<number, number>; completions: Map<string, { status: string; revision: number }>; operation?: { id: string; phase: string } };
type Binding = { recordingId: string; extensionId: string; userId: string; requestId: string; completedAt: string | null; completion: Record<string, unknown> | null };
const sim = { recordings: new Map<string, Recording>(), bindings: new Map<string, Binding>(), objects: new Set<string>(), operations: new Map<string, string>(), nextId: 1, prepareTranscription: vi.fn(), failPrepare: false };

// Deterministic UUID for synthetic rows.
function nextUuid() { return `20000000-0000-4000-8000-${String(sim.nextId++).padStart(12, "0")}`; }
// Build an in-memory user-JWT Supabase client that mirrors the capture RPC contracts closely enough for the endpoint logic.
function userClient(user = userId) {
  const open = ["created", "uploading", "failed"];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const recording = sim.recordings.get(String(args.p_recording_id));
    const error = (code: string) => ({ data: null, error: { code } });
    switch (name) {
      case "create_recording_with_access_v1": {
        const existing = [...sim.recordings.values()].find((row) => row.requestId === args.p_request_id && row.user === user);
        if (existing) return existing.title === args.p_title ? { data: existing.id, error: null } : error("22023");
        const row: Recording = { id: nextUuid(), user, title: String(args.p_title), status: "created", revision: 0, requestId: String(args.p_request_id), parts: new Map(), completions: new Map() };
        sim.recordings.set(row.id, row); return { data: row.id, error: null };
      }
      case "get_recording_capture_state_v1": return recording && recording.user === user && recording.status !== "deleted" ? { data: { recordingId: recording.id, status: recording.status, captureRevision: recording.revision }, error: null } : { data: null, error: null };
      case "prepare_recording_live_part_v1": {
        if (!recording || !open.includes(recording.status)) return error("42501");
        if (recording.revision !== args.p_expected_capture_revision) return error("40001");
        recording.parts.set(Number(args.p_part_index), Number(args.p_file_size_bytes)); recording.status = "uploading";
        return { data: `${user}/${recording.id}/live/part-${String(args.p_part_index).padStart(6, "0")}.webm`, error: null };
      }
      case "complete_recording_live_parts_v1": {
        if (!recording) return error("42501");
        const receipt = recording.completions.get(String(args.p_request_id));
        if (receipt) return { data: { recordingId: recording.id, status: receipt.status, captureRevision: receipt.revision, transcriptId: null, jobId: null }, error: null };
        if (recording.revision !== args.p_expected_capture_revision) return error("40001");
        if (!open.includes(recording.status)) return error("55000");
        const missing = [...recording.parts.keys()].some((index) => !sim.objects.has(`${user}/${recording.id}/live/part-${String(index).padStart(6, "0")}.webm`)) || recording.parts.size === 0;
        if (missing) return error("55000");
        recording.status = "uploaded"; recording.revision += 1; recording.completions.set(String(args.p_request_id), { status: "uploaded", revision: recording.revision });
        return { data: { recordingId: recording.id, status: "uploaded", captureRevision: recording.revision, transcriptId: null, jobId: null }, error: null };
      }
      case "prepare_recording_transcription_v1": {
        sim.prepareTranscription(args);
        if (sim.failPrepare) return error("55000");
        const key = String(args.p_request_id); const id = sim.operations.get(key) ?? nextUuid(); sim.operations.set(key, id);
        if (recording) recording.operation = { id, phase: "prepared" };
        return { data: { operationId: id, phase: recording?.operation?.phase ?? "prepared" }, error: null };
      }
      case "start_recording_transcription_v1": {
        const row = [...sim.recordings.values()].find((candidate) => candidate.operation?.id === args.p_operation_id);
        if (!row?.operation) return error("42501");
        if (row.operation.phase === "prepared") { row.operation.phase = "started"; row.status = "transcribing"; row.revision += 1; }
        return { data: { operationId: row.operation.id, phase: row.operation.phase }, error: null };
      }
      case "get_managed_recording_transcription_v1": {
        const row = sim.recordings.get(String((args.p_recording_ids as string[])[0]));
        return { data: row?.operation ? [{ recording_id: row.id, operation_id: row.operation.id, phase: row.operation.phase }] : [], error: null };
      }
      default: throw new Error(`unexpected rpc ${name}`);
    }
  };
  const storage = { from: () => ({ createSignedUploadUrl: async (path: string) => sim.objects.has(path) ? { data: null, error: { message: "The resource already exists", statusCode: "409" } } : { data: { signedUrl: `http://kong:8000/storage/v1/object/upload/sign/recordings/${path}?token=tok`, token: "tok&1", path }, error: null } }) };
  return { rpc, storage };
}
// Create an identity for the capture extension; overrides model another grant, extension or token kind.
function identity(overrides: Record<string, unknown> = {}) {
  return { supabase: userClient(), userId, grantId: "30000000-0000-4000-8000-000000000001", scopes: ["vosio:capture"], resourceUrl, redirectUri: `https://${extension}.chromiumapp.org/oauth`, email: "user@example.com", userMetadata: {}, ...overrides };
}
// Send one capture request as the extension (or with overridden headers) and parse the JSON answer.
async function call(path: string, body: unknown = {}, headers: Record<string, string> = {}, method = "POST") {
  const config = parseMcpConfig({ enabled: true, webOrigin, publicSupabaseUrl: publicUrl, upstreamClientId }, { SUPABASE_URL: "http://kong:8000", SUPABASE_SERVICE_ROLE_KEY: "admin", SUPABASE_ANON_KEY: "public-key", MCP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), MCP_SUPABASE_CLIENT_SECRET: "disposable-secret-value" })!;
  const request = new Request(`${resourceUrl}/capture${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${"a".repeat(43)}`, Origin: `chrome-extension://${extension}`, ...headers }, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
  const response = await handleCaptureRequest(request, `${path}`, config, env);
  return { response, json: await response.json().catch(() => null) as Record<string, unknown> | null };
}
// Create one bound recording through the endpoint and return its id.
async function createRecording(requestId = nextUuid(), title = "Meet – 06.11.2026 14:00") {
  const { json } = await call("/recordings", { requestId, title, startedAt: "2026-11-06T13:00:00.000Z" });
  return json!.recordingId as string;
}
// Register parts, "upload" them in the simulated Storage and return the registration answer.
async function registerParts(recordingId: string, revision: number, sizes: number[], upload = true) {
  const result = await call(`/recordings/${recordingId}/parts`, { captureRevision: revision, mimeType: "audio/webm", parts: sizes.map((sizeBytes, index) => ({ index, sizeBytes })) });
  if (upload) sizes.forEach((_size, index) => sim.objects.add(`${userId}/${recordingId}/live/part-${String(index).padStart(6, "0")}.webm`));
  return result;
}

beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(console, "info").mockImplementation(() => undefined);
  Object.assign(sim, { recordings: new Map(), bindings: new Map(), objects: new Set(), operations: new Map(), nextId: 1, failPrepare: false }); sim.prepareTranscription = vi.fn();
  mocks.auth.mockImplementation(async () => identity());
  mocks.store.limit.mockResolvedValue(52_428_800);
  mocks.store.record.mockImplementation(async (input: { userId: string; extensionId: string; recordingId: string; requestId: string }) => {
    const existing = [...sim.bindings.values()].find((row) => row.userId === input.userId && row.extensionId === input.extensionId && row.requestId === input.requestId);
    const binding = existing ?? { ...input, completedAt: null, completion: null }; sim.bindings.set(binding.recordingId, binding);
    return { recordingId: binding.recordingId, extensionId: binding.extensionId, requestId: binding.requestId, createdGrantId: null, createdAt: "2026-11-06T13:00:00Z", completedAt: binding.completedAt, completion: binding.completion };
  });
  mocks.store.byRecording.mockImplementation(async (user: string, ext: string, recordingId: string) => {
    const row = sim.bindings.get(recordingId);
    return row && row.userId === user && row.extensionId === ext ? { recordingId, extensionId: ext, requestId: row.requestId, createdGrantId: null, createdAt: "2026-11-06T13:00:00Z", completedAt: row.completedAt, completion: row.completion } : null;
  });
  mocks.store.complete.mockImplementation(async (_user: string, _ext: string, recordingId: string, completion: Record<string, unknown>) => {
    const row = sim.bindings.get(recordingId)!; row.completedAt ??= "2026-11-06T13:05:00Z"; row.completion ??= completion; return row;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("capture config", () => {
  it("returns recording settings, the public key and no secret", async () => {
    const { response, json } = await call("/config");
    expect(response.status).toBe(200);
    expect(json).toEqual({ audioBitsPerSecond: 64_000, maxPartBytes: 52_428_800, mimeType: "audio/webm", recorderMimeType: "audio/webm;codecs=opus", storage: { apiKey: "public-key" }, webOrigin, account: { email: "user@example.com" } });
    expect(JSON.stringify(json)).not.toContain("admin");
  });
  it("uses the user's recording quality and fails closed without a storage limit", async () => {
    mocks.auth.mockImplementation(async () => identity({ userMetadata: { vosio_settings: { liveAudioQuality: "high" } } }));
    expect((await call("/config")).json!.audioBitsPerSecond).toBe(96_000);
    mocks.store.limit.mockResolvedValue(null);
    const unavailable = await call("/config"); expect(unavailable.response.status).toBe(503); expect(unavailable.json).toMatchObject({ error: { code: "unavailable" } });
  });
});

describe("capture authentication", () => {
  it.each([["web page", webOrigin], ["other extension", `chrome-extension://${otherExtension}`], ["missing", ""]])("rejects a foreign Origin (%s) without touching anything", async (_name, origin) => {
    const { response, json } = await call("/recordings", { requestId: nextUuid(), title: "x", startedAt: "2026-11-06T13:00:00Z" }, { Origin: origin });
    expect(response.status).toBe(403); expect(json).toMatchObject({ error: { code: "origin_mismatch" } }); expect(sim.recordings.size).toBe(0);
  });
  it.each([["read", ["vosio:read"]], ["write", ["vosio:read", "vosio:write"]], ["mixed", ["vosio:capture", "vosio:read"]]])("rejects a %s token with insufficient_scope", async (_name, scopes) => {
    mocks.auth.mockImplementation(async () => identity({ scopes, redirectUri: "https://host.example/callback" }));
    const { response, json } = await call("/config"); expect(response.status).toBe(403); expect(json).toMatchObject({ error: { code: "insufficient_scope" } });
  });
  it("rejects a capture identity without a redirect URI", async () => {
    mocks.auth.mockImplementation(async () => identity({ redirectUri: null }));
    expect((await call("/config")).json).toMatchObject({ error: { code: "insufficient_scope" } });
  });
  it("maps revoked or invalid tokens to 401 with a challenge and rate limiting to 429", async () => {
    mocks.auth.mockRejectedValue(new McpAuthError("invalid_token"));
    const denied = await call("/config"); expect(denied.response.status).toBe(401); expect(denied.json).toMatchObject({ error: { code: "unauthorized" } });
    expect(denied.response.headers.get("www-authenticate")).toContain("resource-metadata");
    mocks.auth.mockRejectedValue(new McpAuthError("rate_limited")); expect((await call("/config")).response.status).toBe(429);
    mocks.auth.mockRejectedValue(new McpAuthError("unavailable")); expect((await call("/config")).response.status).toBe(503);
  });
  it("accepts only POST, known paths and strict JSON bodies", async () => {
    expect((await call("/config", {}, {}, "GET")).response.status).toBe(405);
    expect((await call("/unknown")).response.status).toBe(404);
    expect((await call(`/recordings/not-a-uuid/status`)).response.status).toBe(404);
    for (const body of ["{", { extra: 1 }, []]) expect((await call("/config", body)).json).toMatchObject({ error: { code: "invalid_request" } });
    expect((await call("/config", {}, { "Content-Type": "text/plain" })).response.status).toBe(400);
  });
  it("is reachable through the Edge dispatcher and rejects MCP bearers there", async () => {
    mocks.load.mockResolvedValue(parseMcpConfig({ enabled: true, webOrigin, publicSupabaseUrl: publicUrl, upstreamClientId }, { SUPABASE_URL: "http://kong:8000", SUPABASE_SERVICE_ROLE_KEY: "admin", SUPABASE_ANON_KEY: "public-key", MCP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), MCP_SUPABASE_CLIENT_SECRET: "disposable-secret-value" }));
    const request = () => new Request("http://internal/vosio-mcp/capture/config", { method: "POST", headers: { "Content-Type": "application/json", Origin: `chrome-extension://${extension}` }, body: "{}" });
    expect((await handleMcpEdge(request())).status).toBe(200);
    mocks.auth.mockImplementation(async () => identity({ scopes: ["vosio:read"] }));
    expect((await handleMcpEdge(request())).status).toBe(403);
  });
});

describe("recording creation, upload and completion", () => {
  it("runs the three-part flow: create, register, upload, complete and dispatch", async () => {
    const requestId = nextUuid(); const created = await call("/recordings", { requestId, title: "Teams – 06.11.2026 14:00", startedAt: "2026-11-06T13:00:00+01:00" });
    expect(created.response.status).toBe(200);
    const recordingId = created.json!.recordingId as string;
    expect(created.json).toEqual({ recordingId, captureRevision: 0, status: "created", detailUrl: `${webOrigin}/recordings/${recordingId}` });
    const registered = await registerParts(recordingId, 0, [1000, 2000, 3000]);
    expect(registered.response.status).toBe(200);
    expect(registered.json!.parts).toHaveLength(3);
    (registered.json!.parts as Array<{ index: number; state: string; uploadUrl: string }>).forEach((part, index) => {
      expect(part).toMatchObject({ index, state: "ready" });
      expect(part.uploadUrl).toBe(`${publicUrl}/storage/v1/object/upload/sign/recordings/${userId}/${recordingId}/live/part-${String(index).padStart(6, "0")}.webm?token=tok%261`);
      expect(part.uploadUrl).not.toContain("kong");
    });
    const completionId = nextUuid();
    const done = await call(`/recordings/${recordingId}/complete`, { requestId: completionId, captureRevision: registered.json!.captureRevision, durationSeconds: 3601.4, partCount: 3 });
    expect(done.response.status).toBe(200);
    const operationId = sim.recordings.get(recordingId)!.operation!.id;
    expect(done.json).toEqual({ recordingId, status: "transcribing", transcription: { state: "queued", operationId }, detailUrl: `${webOrigin}/recordings/${recordingId}` });
    expect(sim.prepareTranscription).toHaveBeenCalledWith(expect.objectContaining({ p_request_id: uuidV5(completionId), p_purpose: "capture", p_expected_capture_revision: 1, p_region: "global" }));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${webOrigin}/api/jobs/recording-transcription/dispatch`);
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer dispatch-secret" }, body: JSON.stringify({ operationId }) });
    const status = await call(`/recordings/${recordingId}/status`);
    expect(status.json).toEqual({ recordingId, status: "transcribing", captureRevision: 2, transcriptionState: "queued", detailUrl: `${webOrigin}/recordings/${recordingId}` });
  });
  it("creates idempotently by requestId and rejects a changed title for the same request", async () => {
    const requestId = nextUuid(); const first = await createRecording(requestId); const second = await createRecording(requestId);
    expect(second).toBe(first); expect(sim.recordings.size).toBe(1);
    const changed = await call("/recordings", { requestId, title: "Different", startedAt: "2026-11-06T13:00:00Z" });
    expect(changed.response.status).toBe(400);
    expect((await call("/recordings", { requestId: "bad", title: "x", startedAt: "2026-11-06T13:00:00Z" })).response.status).toBe(400);
    expect((await call("/recordings", { requestId: nextUuid(), title: "x".repeat(201), startedAt: "2026-11-06T13:00:00Z" })).response.status).toBe(400);
  });
  it("replays the stored completion for a repeated requestId without a second operation or dispatch", async () => {
    const recordingId = await createRecording(); const registered = await registerParts(recordingId, 0, [500]);
    const body = { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 60, partCount: 1 };
    const first = await call(`/recordings/${recordingId}/complete`, body); const again = await call(`/recordings/${recordingId}/complete`, body);
    expect(again.json).toEqual(first.json); expect(sim.operations.size).toBe(1); expect(fetch).toHaveBeenCalledOnce(); expect(mocks.store.complete).toHaveBeenCalledOnce();
  });
  it("retries a lost completion response after the binding was never stored, reusing the same transcription request", async () => {
    const recordingId = await createRecording(); const registered = await registerParts(recordingId, 0, [500]);
    const body = { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 60, partCount: 1 };
    mocks.store.complete.mockRejectedValueOnce(new Error("binding unavailable"));
    const first = await call(`/recordings/${recordingId}/complete`, body); expect(first.response.status).toBe(200);
    const again = await call(`/recordings/${recordingId}/complete`, body); expect(again.json).toEqual(first.json);
    expect(sim.operations.size).toBe(1); expect(sim.recordings.get(recordingId)!.completions.size).toBe(1);
  });
  it("lets the same extension and user continue the recording from a new grant", async () => {
    const recordingId = await createRecording();
    mocks.auth.mockImplementation(async () => identity({ grantId: "30000000-0000-4000-8000-0000000000aa" }));
    const registered = await registerParts(recordingId, 0, [900]); expect(registered.response.status).toBe(200);
    expect((await call(`/recordings/${recordingId}/status`)).response.status).toBe(200);
  });
  it("returns state exists for a part already stored and still completes", async () => {
    const recordingId = await createRecording(); sim.objects.add(`${userId}/${recordingId}/live/part-000000.webm`);
    const registered = await registerParts(recordingId, 0, [700], false);
    expect(registered.json!.parts).toEqual([{ index: 0, state: "exists" }]);
    const done = await call(`/recordings/${recordingId}/complete`, { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 5, partCount: 1 });
    expect(done.response.status).toBe(200);
  });
});

describe("capture limits and conflicts", () => {
  it("rejects oversized, non-contiguous and wrongly typed parts", async () => {
    const recordingId = await createRecording();
    expect((await registerParts(recordingId, 0, [52_428_801], false)).json).toMatchObject({ error: { code: "part_too_large" } });
    for (const parts of [[{ index: 1, sizeBytes: 5 }], [{ index: 0, sizeBytes: 5 }, { index: 2, sizeBytes: 5 }], [{ index: 0, sizeBytes: 0 }], []]) expect((await call(`/recordings/${recordingId}/parts`, { captureRevision: 0, mimeType: "audio/webm", parts })).response.status).toBe(400);
    expect((await call(`/recordings/${recordingId}/parts`, { captureRevision: 0, mimeType: "audio/webm;codecs=opus", parts: [{ index: 0, sizeBytes: 5 }] })).response.status).toBe(400);
  });
  it("refuses completion with a missing part, without starting the transcription", async () => {
    const recordingId = await createRecording(); const registered = await registerParts(recordingId, 0, [10, 20], false);
    sim.objects.add(`${userId}/${recordingId}/live/part-000000.webm`);
    const done = await call(`/recordings/${recordingId}/complete`, { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 5, partCount: 2 });
    expect(done.response.status).toBe(409); expect(done.json).toMatchObject({ error: { code: "incomplete_parts" } });
    expect(sim.operations.size).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it("reports a stale revision and a recording already closed by the web as revision_conflict", async () => {
    const recordingId = await createRecording();
    expect((await registerParts(recordingId, 5, [10], false)).json).toMatchObject({ error: { code: "revision_conflict" } });
    const registered = await registerParts(recordingId, 0, [10]);
    const row = sim.recordings.get(recordingId)!; row.status = "uploaded"; row.revision += 1;
    const done = await call(`/recordings/${recordingId}/complete`, { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 5, partCount: 1 });
    expect(done.response.status).toBe(409); expect(done.json).toMatchObject({ error: { code: "revision_conflict" } });
    expect((await call(`/recordings/${recordingId}/status`)).json).toMatchObject({ status: "uploaded", captureRevision: 1, transcriptionState: null });
    expect((await registerParts(recordingId, row.revision, [10], false)).json).toMatchObject({ error: { code: "revision_conflict" } });
  });
  it("answers 410 for a recording deleted in Vosio on every step", async () => {
    const recordingId = await createRecording(); sim.recordings.get(recordingId)!.status = "deleted";
    for (const [path, body] of [["parts", { captureRevision: 0, mimeType: "audio/webm", parts: [{ index: 0, sizeBytes: 5 }] }], ["complete", { requestId: nextUuid(), captureRevision: 0, durationSeconds: 5, partCount: 1 }], ["status", {}]] as const) {
      const { response, json } = await call(`/recordings/${recordingId}/${path}`, body); expect(response.status).toBe(410); expect(json).toMatchObject({ error: { code: "recording_deleted" } });
    }
  });
});

describe("capture ownership", () => {
  it("gives the same 404 for unknown, foreign-user and foreign-extension recordings", async () => {
    const recordingId = await createRecording();
    const unknown = await call(`/recordings/${nextUuid()}/status`);
    mocks.auth.mockImplementation(async () => identity({ userId: otherUserId, supabase: userClient(otherUserId) }));
    const otherUser = await call(`/recordings/${recordingId}/status`);
    mocks.auth.mockImplementation(async () => identity({ redirectUri: `https://${otherExtension}.chromiumapp.org/oauth` }));
    const otherExt = await call(`/recordings/${recordingId}/status`, {}, { Origin: `chrome-extension://${otherExtension}` });
    for (const answer of [unknown, otherUser, otherExt]) { expect(answer.response.status).toBe(404); expect(answer.json).toEqual({ error: { code: "not_found", message: "Nahrávka nebyla nalezena." } }); }
    mocks.auth.mockImplementation(async () => identity({ userId: otherUserId, supabase: userClient(otherUserId) }));
    for (const path of ["parts", "complete"]) {
      const body = path === "parts" ? { captureRevision: 0, mimeType: "audio/webm", parts: [{ index: 0, sizeBytes: 5 }] } : { requestId: nextUuid(), captureRevision: 0, durationSeconds: 5, partCount: 1 };
      expect((await call(`/recordings/${recordingId}/${path}`, body)).response.status).toBe(404);
    }
  });
});

describe("transcription start failures", () => {
  it("keeps the audio saved and reports not_started when preparing the transcription fails, then retries on repeat", async () => {
    const recordingId = await createRecording(); const registered = await registerParts(recordingId, 0, [10]);
    const body = { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 5, partCount: 1 };
    sim.failPrepare = true;
    const first = await call(`/recordings/${recordingId}/complete`, body);
    expect(first.response.status).toBe(200); expect(first.json).toMatchObject({ status: "uploaded", transcription: { state: "not_started", operationId: null } });
    expect(mocks.store.complete).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    sim.failPrepare = false;
    const retry = await call(`/recordings/${recordingId}/complete`, body);
    expect(retry.json).toMatchObject({ status: "transcribing", transcription: { state: "queued" } });
  });
  it("does not fail the request when the web dispatch is unreachable or unconfigured", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network"));
    const recordingId = await createRecording(); const registered = await registerParts(recordingId, 0, [10]);
    const done = await call(`/recordings/${recordingId}/complete`, { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 5, partCount: 1 });
    expect(done.response.status).toBe(200); expect(done.json).toMatchObject({ transcription: { state: "queued" } });
  });
  it("uses an approved model override and treats an unapproved one as not_started", async () => {
    const recordingId = await createRecording(); const registered = await registerParts(recordingId, 0, [10]);
    const body = { requestId: nextUuid(), captureRevision: registered.json!.captureRevision, durationSeconds: 5, partCount: 1 };
    env.SONIOX_ASYNC_MODEL = "not-approved-model";
    try {
      expect((await call(`/recordings/${recordingId}/complete`, body)).json).toMatchObject({ transcription: { state: "not_started" } });
      expect(sim.prepareTranscription).not.toHaveBeenCalled();
    } finally { delete env.SONIOX_ASYNC_MODEL; }
    expect((await call(`/recordings/${recordingId}/complete`, body)).json).toMatchObject({ transcription: { state: "queued" } });
    expect(sim.prepareTranscription).toHaveBeenCalledWith(expect.objectContaining({ p_model: expect.stringMatching(/^stt-async-v/) }));
  });
});

describe("deterministic transcription request id", () => {
  it("derives a stable RFC 4122 version-5 UUID", () => {
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
    expect(uuidV5("same")).toBe(uuidV5("same")); expect(uuidV5("a")).not.toBe(uuidV5("b"));
  });
});
