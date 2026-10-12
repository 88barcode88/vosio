import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ locator: vi.fn(), caps: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/recordings/audio-locator.server", () => ({ getAuthorizedAudioLocator: mocks.locator }));
vi.mock("@/lib/recording-sharing/resolve-capabilities", () => ({ resolveRecordingCapabilities: mocks.caps }));
vi.mock("@/lib/mcp/config.server", () => ({ getMcpConfig: mocks.config }));
import { readAuthorizedAudioChunk } from "@/lib/mcp/audio.server";
const recordingId = "11111111-1111-4111-8111-111111111111";
const resourceUrl = "https://vosio.example/api/mcp";
const sign = vi.fn(); const fetchMock = vi.fn(); const active = vi.fn();
const context = { supabase: { rpc: active, storage: { from: () => ({ createSignedUrl: sign }) } } as unknown as SupabaseClient, scopes: ["vosio:read"], resourceUrl };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  mocks.config.mockReturnValue({ resourceUrl, supabaseUrl: "https://storage.example" });
  mocks.locator.mockResolvedValue({ id: recordingId, storage_path: `owner/${recordingId}/audio.webm`, mime_type: "audio/webm" });
  mocks.caps.mockResolvedValue({ read: true });
  active.mockResolvedValue({ data: [{ id: recordingId, status: "completed" }], error: null });
  sign.mockResolvedValue({ data: { signedUrl: "https://storage.example/storage/v1/object/sign/recordings/fixture?token=internal-only" }, error: null });
  fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "Content-Range": "bytes 0-2/3" } }));
});
describe("controlled MCP audio", () => {
  it("returns only bounded audio bytes and never the internal signed locator", async () => {
    const result = await readAuthorizedAudioChunk(context, recordingId, 0, 65536);
    expect(result.bytes).toEqual(Buffer.from([1, 2, 3])); expect(JSON.stringify(result)).not.toMatch(/token|storage_path|signedUrl/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Range: "bytes=0-65535" }, redirect: "error", cache: "no-store" });
    expect(sign).toHaveBeenCalledWith(`owner/${recordingId}/audio.webm`, 5);
  });
  it("denies the next request after recording access is revoked", async () => {
    await readAuthorizedAudioChunk(context, recordingId, 0, 65536);
    mocks.locator.mockResolvedValue(null);
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 65536)).rejects.toMatchObject({ code: "denied" }); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("drops buffered bytes when authority is revoked during fetch", async () => {
    mocks.caps.mockResolvedValue({ read: false });
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 65536)).rejects.toMatchObject({ code: "denied" });
  });
  it("denies deleted audio even when the owner retains application Trash read authority", async () => {
    active.mockResolvedValueOnce({ data: [{ id: recordingId, status: "deleted" }], error: null });
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 65536)).rejects.toMatchObject({ code: "denied" });
    expect(sign).not.toHaveBeenCalled();
    active.mockResolvedValueOnce({ data: [{ id: recordingId, status: "completed" }], error: null }).mockResolvedValueOnce({ data: [{ id: recordingId, status: "deleted" }], error: null });
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 65536)).rejects.toMatchObject({ code: "denied" });
  });
  it("rejects a wrong installation, scope, offset or oversized chunk", async () => {
    for (const candidate of [{ ...context, scopes: [] }, { ...context, resourceUrl: "https://other.example/api/mcp" }]) await expect(readAuthorizedAudioChunk(candidate, recordingId, 0, 65536)).rejects.toMatchObject({ code: "denied" });
    await expect(readAuthorizedAudioChunk(context, recordingId, -1, 65536)).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 1_048_577)).rejects.toMatchObject({ code: "invalid_arguments" }); expect(sign).not.toHaveBeenCalled();
  });
  it("refuses external signing URLs and unbounded full-object responses", async () => {
    sign.mockResolvedValueOnce({ data: { signedUrl: "https://evil.example/audio" }, error: null });
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 65536)).rejects.toMatchObject({ code: "denied" }); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Length": "9000000" } }));
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 65536)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("rejects an upstream stream that exceeds its declared range", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { "Content-Range": "bytes 0-2/8" } }));
    await expect(readAuthorizedAudioChunk(context, recordingId, 0, 3)).rejects.toMatchObject({ code: "unavailable" });
  });
});
