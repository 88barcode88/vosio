import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient
}));

import { GET } from "../../app/api/recordings/[recordingId]/audio/route";

const recordingId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

type RecordingResult = {
  data: {
    id: string;
    mime_type: string | null;
    storage_path: string | null;
    user_id: string;
  } | null;
  error: { message: string } | null;
};

// createSupabaseMock provides an observable auth, ownership-query and Storage-signing chain.
function createSupabaseMock({
  recordingResult = {
    data: {
      id: recordingId,
      mime_type: "audio/webm",
      storage_path: "user/recording/audio.webm",
      user_id: userId
    },
    error: null
  },
  signedUrlResult = {
    data: { signedUrl: "https://signed.example/audio" },
    error: null
  },
  user = { id: userId },
  userError = null
}: {
  recordingResult?: RecordingResult;
  signedUrlResult?: {
    data: { signedUrl: unknown } | null;
    error: { message: string } | null;
  };
  user?: { id: string } | null;
  userError?: { message: string } | null;
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue(recordingResult);
  const eqUserId = vi.fn(() => ({ maybeSingle }));
  const eqRecordingId = vi.fn(() => ({ eq: eqUserId }));
  const select = vi.fn(() => ({ eq: eqRecordingId }));
  const from = vi.fn(() => ({ select }));
  const createSignedUrl = vi.fn().mockResolvedValue(signedUrlResult);
  const storageFrom = vi.fn(() => ({ createSignedUrl }));
  const getUser = vi.fn().mockResolvedValue({
    data: { user },
    error: userError
  });
  const supabase = {
    auth: { getUser },
    from,
    storage: { from: storageFrom }
  };

  return {
    createSignedUrl,
    eqRecordingId,
    eqUserId,
    from,
    getUser,
    maybeSingle,
    select,
    storageFrom,
    supabase
  };
}

// callRoute invokes the route with App Router's asynchronous params contract.
function callRoute(id: string) {
  return GET(new Request(`https://vosio.test/api/recordings/${id}/audio`) as never, {
    params: Promise.resolve({ recordingId: id })
  });
}

beforeEach(() => {
  mocks.createClient.mockReset();
});

describe("GET recording audio", () => {
  it("returns 400 before auth for an invalid recording UUID", async () => {
    const response = await callRoute("not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns 401 before querying or signing when signed out", async () => {
    const mock = createSupabaseMock({ user: null });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);

    expect(response.status).toBe(401);
    expect(mock.from).not.toHaveBeenCalled();
    expect(mock.createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns a private sanitized 500 when request client creation throws", async () => {
    mocks.createClient.mockRejectedValue(new Error("provider client detail"));

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual({ error: "Audio se nepodařilo načíst." });
    expect(JSON.stringify(body)).not.toContain("provider client detail");
  });

  it("returns a private sanitized 500 when auth throws", async () => {
    const mock = createSupabaseMock();
    mock.getUser.mockRejectedValue(new Error("provider auth detail"));
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual({ error: "Audio se nepodařilo načíst." });
    expect(JSON.stringify(body)).not.toContain("provider auth detail");
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("returns 404 and never signs a missing or non-owned recording", async () => {
    const mock = createSupabaseMock({
      recordingResult: { data: null, error: null }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);

    expect(response.status).toBe(404);
    expect(mock.select).toHaveBeenCalledWith("id,user_id,storage_path,mime_type");
    expect(mock.eqRecordingId).toHaveBeenCalledWith("id", recordingId);
    expect(mock.eqUserId).toHaveBeenCalledWith("user_id", userId);
    expect(mock.createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns a private sanitized 500 when the ownership query throws", async () => {
    const mock = createSupabaseMock();
    mock.maybeSingle.mockRejectedValue(new Error("provider database detail"));
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual({ error: "Audio se nepodařilo načíst." });
    expect(JSON.stringify(body)).not.toContain("provider database detail");
    expect(mock.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    [null, "no_audio"],
    ["user/recording/live/", "segmented"]
  ])("returns 409 for ineligible storage %s", async (storagePath, reason) => {
    const mock = createSupabaseMock({
      recordingResult: {
        data: {
          id: recordingId,
          mime_type: "audio/webm",
          storage_path: storagePath,
          user_id: userId
        },
        error: null
      }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Audio nelze přehrát.", reason });
    expect(mock.createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 502 without leaking the path when Storage signing fails", async () => {
    const mock = createSupabaseMock({
      signedUrlResult: { data: null, error: { message: "private storage failure" } }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.parse(serialized)).toEqual({
      error: "Odkaz na audio se nepodařilo vytvořit."
    });
    expect(serialized).not.toContain("user/recording/audio.webm");
    expect(serialized).not.toContain("private storage failure");
  });

  it("returns a private sanitized 502 when Storage signing throws", async () => {
    const mock = createSupabaseMock();
    mock.createSignedUrl.mockRejectedValue(new Error("provider signing detail"));
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toEqual({ error: "Odkaz na audio se nepodařilo vytvořit." });
    expect(JSON.stringify(body)).not.toContain("provider signing detail");
    expect(JSON.stringify(body)).not.toContain("user/recording/audio.webm");
  });

  it.each([
    123,
    { href: "https://signed.example/audio" },
    "   ",
    "ftp://signed.example/audio",
    " https://signed.example/audio "
  ])("returns 502 for a malformed signed URL payload %#", async (signedUrl) => {
    const mock = createSupabaseMock({
      signedUrlResult: { data: { signedUrl }, error: null }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: "Odkaz na audio se nepodařilo vytvořit."
    });
  });

  it("signs only the owned single object and returns the exact private response", async () => {
    const mock = createSupabaseMock();
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mock.storageFrom).toHaveBeenCalledWith("recordings");
    expect(mock.createSignedUrl).toHaveBeenCalledWith("user/recording/audio.webm", 300);
    expect(await response.json()).toEqual({
      expiresIn: 300,
      mimeType: "audio/webm",
      url: "https://signed.example/audio"
    });
  });
});
