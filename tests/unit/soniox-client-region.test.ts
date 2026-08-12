import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConnectionConfig } from "@soniox/client";
import {
  createSonioxTemporaryKey,
  createSonioxTranscription,
  getSonioxRealtimeClientConfig,
  getSonioxTranscript,
  getSonioxTranscription
} from "@/lib/soniox/client";

const testEnv = vi.hoisted(() => ({
  sonioxApiKey: "server-only-test-key",
  sonioxAsyncModel: "stt-async-v5"
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => testEnv
}));

// jsonResponse builds the minimal successful Soniox response used by fetch mocks.
function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

describe("Soniox client regional routing", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an EU realtime key with a fixed 60-second connection window", async () => {
    let usedServerOnlyAuthorization = false;

    fetchMock.mockImplementation(async (_input, init) => {
      const headers = new Headers(init?.headers);
      usedServerOnlyAuthorization =
        headers.get("Authorization") === `Bearer ${testEnv.sonioxApiKey}`;

      return jsonResponse({ api_key: "temporary-key", expires_at: "future" });
    });

    await createSonioxTemporaryKey({ clientReferenceId: "live-1", region: "eu" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.eu.soniox.com/v1/auth/temporary-api-key"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      client_reference_id: "live-1",
      expires_in_seconds: 60,
      single_use: true,
      usage_type: "transcribe_websocket"
    });
    expect(usedServerOnlyAuthorization).toBe(true);
  });

  it("uses the exact global host without inserting a global subdomain", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ api_key: "temporary-key", expires_at: "future" })
    );

    await createSonioxTemporaryKey({ clientReferenceId: "live-2", region: "global" });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toBe("https://api.soniox.com/v1/auth/temporary-api-key");
    expect(requestUrl).not.toContain("api.global.soniox.com");
  });

  it("routes create, status, and transcript calls through their explicit regions", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "queued" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", status: "completed" }))
      .mockResolvedValueOnce(jsonResponse({ id: "job-1", text: "Hotovo", tokens: [] }));

    await createSonioxTranscription({
      audioUrl: "https://storage.example/audio.m4a",
      clientReferenceId: "recording-1",
      options: {
        enable_language_identification: true,
        enable_speaker_diarization: true,
        language_hints: ["cs"],
        model: "stt-async-v5"
      },
      region: "eu"
    });
    await getSonioxTranscription("global", "job-1");
    await getSonioxTranscript("eu", "job-1");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.eu.soniox.com/v1/transcriptions",
      "https://api.soniox.com/v1/transcriptions/job-1",
      "https://api.eu.soniox.com/v1/transcriptions/job-1/transcript"
    ]);
  });

  it.each([
    ["global", undefined, "wss://stt-rt.soniox.com/transcribe-websocket"],
    ["eu", "eu", "wss://stt-rt.eu.soniox.com/transcribe-websocket"]
  ] as const)(
    "returns the final %s websocket URL expected by the public SDK resolver",
    (region, sdkRegion, expectedWebsocketUrl) => {
      const realtimeConfig = getSonioxRealtimeClientConfig(region);
      const sdkDerivedConfig = resolveConnectionConfig({
        api_key: "temporary-test-key",
        ...(sdkRegion ? { region: sdkRegion } : {})
      });
      const sdkExplicitConfig = resolveConnectionConfig({
        api_key: "temporary-test-key",
        stt_ws_url: realtimeConfig.websocketUrl
      });

      expect(realtimeConfig).toEqual({ region, websocketUrl: expectedWebsocketUrl });
      expect(realtimeConfig.websocketUrl).toBe(sdkDerivedConfig.stt_ws_url);
      expect(sdkExplicitConfig.stt_ws_url).toBe(sdkDerivedConfig.stt_ws_url);
    }
  );

  it("redacts the server-only API key from provider error text", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ message: `Rejected bearer ${testEnv.sonioxApiKey}` }),
        { headers: { "Content-Type": "application/json" }, status: 401 }
      )
    );

    const error = await createSonioxTemporaryKey({
      clientReferenceId: "live-error",
      region: "global"
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain(testEnv.sonioxApiKey);
  });
});
