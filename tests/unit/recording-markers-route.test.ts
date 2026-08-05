import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECORDING_MARKER_COLUMNS,
  type RecordingMarkerRow
} from "@/lib/recording-markers/types";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient
}));

import { POST } from "../../app/api/recordings/[recordingId]/markers/route";

const recordingId = "5ad31215-9b8f-4c68-9e2f-89f4d31f96b0";
const clientMarkerId = "6bd31215-9b8f-4c68-9e2f-89f4d31f96b1";
const markerId = "7cd31215-9b8f-4c68-9e2f-89f4d31f96b2";
const userId = "8dd31215-9b8f-4c68-9e2f-89f4d31f96b3";
const validBody = {
  clientMarkerId,
  markerType: "important",
  note: null,
  offsetMs: 12_340
};
const markerRow: RecordingMarkerRow = {
  client_marker_id: clientMarkerId,
  created_at: "2026-08-05T12:00:00.000Z",
  id: markerId,
  marker_type: "important",
  note: null,
  offset_ms: 12_340,
  recording_id: recordingId,
  updated_at: "2026-08-05T12:00:00.000Z",
  user_id: userId
};
const markerRowWithSecret = {
  ...markerRow,
  internal_secret: "must-not-leak"
};
const retryMismatchCases: Array<[string, Partial<RecordingMarkerRow>]> = [
  ["client UUID", { client_marker_id: "9ed31215-9b8f-4c68-9e2f-89f4d31f96b4" }],
  ["recording", { recording_id: "9ed31215-9b8f-4c68-9e2f-89f4d31f96b4" }],
  ["owner", { user_id: "9ed31215-9b8f-4c68-9e2f-89f4d31f96b4" }],
  ["offset", { offset_ms: 12_341 }],
  ["type", { marker_type: "task" }],
  ["note", { note: "different" }]
];

type DbError = {
  code?: string;
  message: string;
};

// createSupabaseMock exposes auth, owned-recording, insert and conflict-read chains.
function createSupabaseMock({
  existingResult = { data: markerRow, error: null },
  insertResult = { data: markerRow, error: null },
  recordingResult = { data: { id: recordingId }, error: null },
  user = { id: userId },
  userError = null
}: {
  existingResult?: { data: typeof markerRow | null; error: DbError | null };
  insertResult?: { data: typeof markerRow | null; error: DbError | null };
  recordingResult?: { data: { id: string } | null; error: DbError | null };
  user?: { id: string } | null;
  userError?: DbError | null;
} = {}) {
  const recordingMaybeSingle = vi.fn().mockResolvedValue(recordingResult);
  const recordingNeq = vi.fn(() => ({ maybeSingle: recordingMaybeSingle }));
  const recordingEqUser = vi.fn(() => ({ neq: recordingNeq }));
  const recordingEqId = vi.fn(() => ({ eq: recordingEqUser }));
  const recordingSelect = vi.fn(() => ({ eq: recordingEqId }));

  const insertSingle = vi.fn().mockResolvedValue(insertResult);
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const existingMaybeSingle = vi.fn().mockResolvedValue(existingResult);
  const existingEqClientMarkerId = vi.fn(() => ({ maybeSingle: existingMaybeSingle }));
  const existingEqUserId = vi.fn(() => ({ eq: existingEqClientMarkerId }));
  const markerSelect = vi.fn(() => ({ eq: existingEqUserId }));

  const from = vi.fn((tableName: string) => {
    if (tableName === "recordings") {
      return { select: recordingSelect };
    }

    if (tableName === "recording_markers") {
      return { insert, select: markerSelect };
    }

    throw new Error(`Unexpected table: ${tableName}`);
  });
  const getUser = vi.fn().mockResolvedValue({
    data: { user },
    error: userError
  });

  return {
    existingEqClientMarkerId,
    existingEqUserId,
    existingMaybeSingle,
    from,
    getUser,
    insert,
    insertSelect,
    insertSingle,
    markerSelect,
    recordingEqId,
    recordingEqUser,
    recordingMaybeSingle,
    recordingNeq,
    recordingSelect,
    supabase: { auth: { getUser }, from }
  };
}

// callRoute invokes the marker endpoint with App Router's asynchronous params contract.
function callRoute(id: string, body: unknown = validBody) {
  return POST(new Request(`https://vosio.test/api/recordings/${id}/markers`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }) as never, {
    params: Promise.resolve({ recordingId: id })
  });
}

// callRouteWithRawBody invokes malformed JSON paths without pre-serializing the body.
function callRouteWithRawBody(id: string, body: string) {
  return POST(new Request(`https://vosio.test/api/recordings/${id}/markers`, {
    body,
    headers: { "Content-Type": "application/json" },
    method: "POST"
  }) as never, {
    params: Promise.resolve({ recordingId: id })
  });
}

beforeEach(() => {
  mocks.createClient.mockReset();
});

describe("POST recording marker", () => {
  it("returns 400 before auth for an invalid recording UUID", async () => {
    const response = await callRoute("not-a-uuid");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Neplatné ID nahrávky." });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", null],
    ["invalid client UUID", { ...validBody, clientMarkerId: "invalid" }],
    ["invalid marker type", { ...validBody, markerType: "other" }],
    ["negative offset", { ...validBody, offsetMs: -1 }],
    ["offset over 24 hours", { ...validBody, offsetMs: 86_400_001 }],
    ["long note", { ...validBody, note: "x".repeat(281) }]
  ])("returns 400 before auth for %s", async (_label, body) => {
    const response = body === null
      ? await callRouteWithRawBody(recordingId, "{")
      : await callRoute(recordingId, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Neplatná data momentu." });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns 401 before querying when signed out", async () => {
    const mock = createSupabaseMock({ user: null });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Nejste přihlášený." });
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("returns the same 401 without leaking an auth provider error", async () => {
    const mock = createSupabaseMock({
      user: null,
      userError: { message: "private auth detail" }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Nejste přihlášený." });
    expect(JSON.stringify(body)).not.toContain("private auth detail");
    expect(mock.from).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign", { data: null, error: null }],
    ["deleted", { data: null, error: null }],
    ["database error", { data: null, error: { message: "private database detail" } }]
  ])("returns the same 404 without leaking a %s recording", async (_label, recordingResult) => {
    const mock = createSupabaseMock({ recordingResult });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Nahrávka nebyla nalezena." });
    expect(JSON.stringify(body)).not.toContain("private database detail");
    expect(mock.recordingEqId).toHaveBeenCalledWith("id", recordingId);
    expect(mock.recordingEqUser).toHaveBeenCalledWith("user_id", userId);
    expect(mock.recordingNeq).toHaveBeenCalledWith("status", "deleted");
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("returns the same 404 when the owned-recording query throws", async () => {
    const mock = createSupabaseMock();
    mock.recordingMaybeSingle.mockRejectedValue(new Error("private recording exception"));
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Nahrávka nebyla nalezena." });
    expect(JSON.stringify(body)).not.toContain("private recording exception");
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("inserts the normalized own marker and returns the exact row with 201", async () => {
    const mock = createSupabaseMock({
      insertResult: { data: markerRowWithSecret, error: null }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId.toUpperCase(), {
      clientMarkerId: clientMarkerId.toUpperCase(),
      markerType: "important",
      offsetMs: 12_340
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ marker: markerRow });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mock.insert).toHaveBeenCalledWith({
      client_marker_id: clientMarkerId,
      marker_type: "important",
      note: null,
      offset_ms: 12_340,
      recording_id: recordingId,
      user_id: userId
    });
    expect(mock.insertSelect).toHaveBeenCalledWith(RECORDING_MARKER_COLUMNS);
    expect(mock.insertSingle).toHaveBeenCalledOnce();
    expect(mock.markerSelect).not.toHaveBeenCalled();
    expect(mock.from.mock.calls).toEqual([
      ["recordings"],
      ["recording_markers"]
    ]);
  });

  it("returns a sanitized 500 for a non-unique insert error", async () => {
    const mock = createSupabaseMock({
      insertResult: {
        data: null,
        error: { code: "42501", message: "private policy detail" }
      }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Moment se nepodařilo uložit." });
    expect(JSON.stringify(body)).not.toContain("private policy detail");
    expect(mock.markerSelect).not.toHaveBeenCalled();
  });

  it("returns a sanitized 500 when the marker insert throws", async () => {
    const mock = createSupabaseMock();
    mock.insertSingle.mockRejectedValue(new Error("private insert exception"));
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Moment se nepodařilo uložit." });
    expect(JSON.stringify(body)).not.toContain("private insert exception");
    expect(mock.markerSelect).not.toHaveBeenCalled();
  });

  it("returns the existing own marker with 200 for an exact unique-conflict retry", async () => {
    const mock = createSupabaseMock({
      existingResult: { data: markerRowWithSecret, error: null },
      insertResult: {
        data: null,
        error: { code: "23505", message: "unique conflict detail" }
      }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marker: markerRow });
    expect(mock.markerSelect).toHaveBeenCalledWith(RECORDING_MARKER_COLUMNS);
    expect(mock.existingEqUserId).toHaveBeenCalledWith("user_id", userId);
    expect(mock.existingEqClientMarkerId).toHaveBeenCalledWith(
      "client_marker_id",
      clientMarkerId
    );
    expect(mock.from.mock.calls).toEqual([
      ["recordings"],
      ["recording_markers"],
      ["recording_markers"]
    ]);
  });

  it.each(retryMismatchCases)("returns 409 when a reused client UUID changes the %s", async (_label, override) => {
    const mock = createSupabaseMock({
      existingResult: {
        data: { ...markerRow, ...override },
        error: null
      },
      insertResult: {
        data: null,
        error: { code: "23505", message: "unique conflict detail" }
      }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Identifikátor momentu už byl použit." });
    expect(JSON.stringify(body)).not.toContain("unique conflict detail");
  });

  it.each([
    ["missing", { data: null, error: null }],
    ["database error", { data: null, error: { message: "private retry read detail" } }]
  ])("returns a sanitized 500 when the conflicted marker is %s", async (_label, existingResult) => {
    const mock = createSupabaseMock({
      existingResult,
      insertResult: {
        data: null,
        error: { code: "23505", message: "unique conflict detail" }
      }
    });
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Moment se nepodařilo ověřit." });
    expect(JSON.stringify(body)).not.toContain("private retry read detail");
    expect(JSON.stringify(body)).not.toContain("unique conflict detail");
  });

  it("returns a sanitized 500 when the conflict lookup throws", async () => {
    const mock = createSupabaseMock({
      insertResult: {
        data: null,
        error: { code: "23505", message: "unique conflict detail" }
      }
    });
    mock.existingMaybeSingle.mockRejectedValue(new Error("private retry exception"));
    mocks.createClient.mockResolvedValue(mock.supabase);

    const response = await callRoute(recordingId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Moment se nepodařilo ověřit." });
    expect(JSON.stringify(body)).not.toContain("private retry exception");
  });
});
