import { RealtimeSttSession } from "@soniox/client";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealtimeRecordingOptions } from "@/components/browser-recorder/helpers";
import { getSonioxRegionTarget } from "@/lib/soniox/region";

const { RealtimeSttSession: CommonJsSession } = createRequire(import.meta.url)("@soniox/client") as
  typeof import("@soniox/client");

// TestWebSocket captures the real SDK's browser handshake without contacting Soniox.
class TestWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: TestWebSocket[] = [];

  binaryType = "blob";
  readyState = 0;
  sent: unknown[] = [];

  // Open asynchronously so the SDK can attach its connection listeners first.
  constructor(readonly url: string, readonly protocols?: string | string[]) {
    super();
    TestWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = TestWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  // Capture outgoing configuration and audio frames at the transport boundary.
  send(data: unknown) {
    this.sent.push(data);
  }

  // Deliver a provider frame to the SDK's actual response parser.
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }

  // Release the fake connection when the session cleans up.
  close() {
    this.readyState = TestWebSocket.CLOSED;
  }
}

describe("Soniox browser WebSocket authentication", () => {
  const temporaryKey = "snx_temp_websocket_auth_test";

  beforeEach(() => {
    TestWebSocket.instances = [];
    vi.stubGlobal("WebSocket", TestWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["global", "ESM", RealtimeSttSession],
    ["eu", "ESM", RealtimeSttSession],
    ["global", "CommonJS", CommonJsSession],
    ["eu", "CommonJS", CommonJsSession]
  ] as const)(
    "authenticates the %s %s connection with subprotocols and preserves live STT frames",
    async (region, _format, Session) => {
      const websocketUrl = getSonioxRegionTarget(region).sttWsUrl;
      const session = new Session(
        temporaryKey,
        websocketUrl,
        getRealtimeRecordingOptions("stt-rt-v5", "cs")
      );
      const onResult = vi.fn();
      session.on("result", onResult);

      try {
        await session.connect();
        const socket = TestWebSocket.instances[0]!;

        expect(TestWebSocket.instances).toHaveLength(1);
        expect(socket.url).toBe(websocketUrl);
        expect(socket.protocols).toEqual(["soniox-api-key", temporaryKey]);
        expect(JSON.parse(String(socket.sent[0]))).toEqual({
          model: "stt-rt-v5",
          audio_format: "auto",
          enable_endpoint_detection: false,
          enable_speaker_diarization: true,
          enable_language_identification: true,
          language_hints: ["cs"],
          language_hints_strict: true
        });

        const audio = new Uint8Array([1, 2, 3]);
        session.sendAudio(audio);
        expect(socket.sent[1]).toEqual(audio);

        socket.receive({
          tokens: [{ text: "Ahoj", is_final: true, speaker: "1", language: "cs" }],
          final_audio_proc_ms: 100,
          total_audio_proc_ms: 100
        });
        expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
          tokens: [expect.objectContaining({
            text: "Ahoj",
            is_final: true,
            speaker: "1",
            language: "cs"
          })]
        }));
      } finally {
        session.close();
      }
    }
  );

  it("reports an authentication error delivered after the WebSocket opens", async () => {
    const session = new RealtimeSttSession(
      temporaryKey,
      getSonioxRegionTarget("global").sttWsUrl,
      getRealtimeRecordingOptions("stt-rt-v5", "auto")
    );
    const onError = vi.fn();
    session.on("error", onError);

    try {
      await session.connect();
      TestWebSocket.instances[0]!.receive({
        error_code: 401,
        error_type: "unauthenticated",
        error_message: "Authentication required"
      });

      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
      expect(session.state).toBe("error");
      expect(TestWebSocket.instances[0]!.readyState).toBe(TestWebSocket.CLOSED);
    } finally {
      session.close();
    }
  });
});
