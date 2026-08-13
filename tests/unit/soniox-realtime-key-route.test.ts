import { beforeEach, describe, expect, it, vi } from "vitest";
import { SonioxRequestError } from "@/lib/soniox/client";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSonioxTemporaryKey: vi.fn(),
  getSonioxRealtimeClientConfig: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient
}));

vi.mock("@/lib/soniox/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/soniox/client")>(),
  createSonioxTemporaryKey: mocks.createSonioxTemporaryKey,
  getSonioxRealtimeClientConfig: mocks.getSonioxRealtimeClientConfig
}));

import { POST } from "../../app/api/soniox/realtime-key/route";

// mockAuthenticatedUser configures the route's trusted Supabase Auth result.
function mockAuthenticatedUser(region: "global" | "eu") {
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: `user-${region}`,
            user_metadata: { vosio_settings: { sonioxRegion: region } }
          }
        },
        error: null
      })
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSonioxTemporaryKey.mockResolvedValue({
    api_key: "temporary-browser-key",
    expires_at: "2026-08-12T12:00:00.000Z"
  });
  mocks.getSonioxRealtimeClientConfig.mockImplementation((region: "global" | "eu") => ({
    region,
    websocketUrl: region === "eu"
      ? "wss://stt-rt.eu.soniox.com/transcribe-websocket"
      : "wss://stt-rt.soniox.com/transcribe-websocket"
  }));
});

describe("POST /api/soniox/realtime-key regional routing", () => {
  it.each([
    ["global", "wss://stt-rt.soniox.com/transcribe-websocket"],
    ["eu", "wss://stt-rt.eu.soniox.com/transcribe-websocket"]
  ] as const)("routes an authenticated %s user through the exact provider region", async (region, websocketUrl) => {
    mockAuthenticatedUser(region);

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createSonioxTemporaryKey).toHaveBeenCalledWith({
      clientReferenceId: expect.stringMatching(`^vosio-live:user-${region}:`),
      region
    });
    expect(mocks.getSonioxRealtimeClientConfig).toHaveBeenCalledWith(region);
    expect(payload).toEqual({
      api_key: "temporary-browser-key",
      expires_at: "2026-08-12T12:00:00.000Z",
      region,
      stt_ws_url: websocketUrl
    });
  });

  it("returns EU project guidance and the provider request id for a structured EU permission error", async () => {
    mockAuthenticatedUser("eu");
    mocks.createSonioxTemporaryKey.mockRejectedValue(new SonioxRequestError({
      errorType: "permission_denied",
      message: "EU project does not permit this key.",
      requestId: "req-eu-403",
      status: 403
    }));

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      code: "soniox_eu_access_required",
      error: "Region EU vyžaduje Soniox EU projekt a odpovídající regionální API key.",
      request_id: "req-eu-403"
    });
    expect(JSON.stringify(payload)).not.toContain("temporary-browser-key");
  });

  it("omits request_id when Soniox did not provide one", async () => {
    mockAuthenticatedUser("eu");
    mocks.createSonioxTemporaryKey.mockRejectedValue(new SonioxRequestError({
      errorType: "unauthenticated",
      message: "Authentication failed.",
      status: 401
    }));

    const response = await POST();
    const payload = await response.json();

    expect(payload).toEqual({
      code: "soniox_eu_access_required",
      error: "Region EU vyžaduje Soniox EU projekt a odpovídající regionální API key."
    });
    expect(payload).not.toHaveProperty("request_id");
  });

  it("keeps a structured EU internal failure generic", async () => {
    mockAuthenticatedUser("eu");
    mocks.createSonioxTemporaryKey.mockRejectedValue(new SonioxRequestError({
      errorType: "internal_error",
      message: "Provider unavailable.",
      requestId: "req-eu-500",
      status: 500
    }));

    const response = await POST();
    const payload = await response.json();

    expect(payload).toEqual({
      code: "soniox_request_failed",
      error: "Nepodařilo se vytvořit realtime klíč.",
      request_id: "req-eu-500"
    });
  });

  it("keeps a structured global authentication failure on the generic auth/config message", async () => {
    mockAuthenticatedUser("global");
    mocks.createSonioxTemporaryKey.mockRejectedValue(new SonioxRequestError({
      errorType: "unauthenticated",
      message: "Authentication failed.",
      requestId: "req-global-401",
      status: 401
    }));

    const response = await POST();
    const payload = await response.json();

    expect(payload).toEqual({
      code: "soniox_auth_or_region",
      error: "Nepodařilo se vytvořit realtime klíč.",
      request_id: "req-global-401"
    });
    expect(JSON.stringify(payload)).not.toContain("EU projekt");
    expect(JSON.stringify(payload)).not.toContain("support@soniox.com");
  });
});
