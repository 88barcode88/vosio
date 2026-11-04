import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), types: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/ai/queries", () => ({ getAccessibleOutputTypes: mocks.types }));
import { GET } from "../../app/api/ai-outputs/[outputId]/route";

const transcriptId = "00000000-0000-4000-8000-000000000a01";
const outputId = "00000000-0000-4000-8000-000000000a02";
const savedOutput = {
  created_at: "2026-11-04T10:00:00.000Z", id: outputId, output_json: { a: 1 }, output_text: "saved",
  processing_job_id: "job-1", transcript_id: transcriptId
};
type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };

// deferred lets a test hold the output query open while observing which other queries already started.
function deferred(): Deferred {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// mockSession models an RLS-scoped session: rows are only visible when the output belongs to the requested scope.
function mockSession(options: {
  sub?: string | null; output?: unknown; outputGate?: Deferred; rowsError?: unknown; typesError?: boolean;
}) {
  const started: string[] = [];
  const eqCalls: Array<[string, string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { eqCalls.push([table, column, value]); return query; }),
      order: vi.fn(() => {
        started.push(table);
        return Promise.resolve({ data: options.rowsError ? null : [{ id: `${table}-row` }], error: options.rowsError ?? null });
      }),
      maybeSingle: vi.fn(() => {
        started.push(table);
        const result = { data: options.output ?? null, error: null };
        return options.outputGate ? options.outputGate.promise.then(() => result) : Promise.resolve(result);
      })
    };
    return query;
  });
  mocks.types.mockImplementation(async () => {
    started.push("types");
    if (options.typesError) throw new Error("Unable to load saved AI output types");
    return options.output ? new Map([[outputId, "summary"]]) : new Map();
  });
  const getClaims = vi.fn(async () => options.sub === null
    ? { data: null, error: null }
    : { data: { claims: { sub: options.sub ?? "user-1" } }, error: null });
  mocks.client.mockResolvedValue({ auth: { getClaims }, from });
  return { from, started, eqCalls, getClaims };
}

// request calls the route handler with a transcript scope.
function request(scopeTranscriptId = transcriptId) {
  return GET(new NextRequest(`https://vosio.test/api/ai-outputs/${outputId}?transcriptId=${scopeTranscriptId}`),
    { params: Promise.resolve({ outputId }) });
}

describe("GET /api/ai-outputs/[outputId]", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 401 without an authenticated subject and reads nothing", async () => {
    const session = mockSession({ sub: null, output: savedOutput });
    const response = await request();
    expect(response.status).toBe(401);
    expect(session.from).not.toHaveBeenCalled();
    expect(mocks.types).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign output hidden by RLS", async () => {
    mockSession({ output: null });
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "AI výstup nebyl nalezen." });
  });

  it("returns the same 404 on transcript mismatch and scopes the output query to the transcript", async () => {
    const session = mockSession({ output: null });
    const otherTranscript = "00000000-0000-4000-8000-000000000a09";
    const response = await request(otherTranscript);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "AI výstup nebyl nalezen." });
    expect(session.eqCalls).toContainEqual(["ai_outputs", "id", outputId]);
    expect(session.eqCalls).toContainEqual(["ai_outputs", "transcript_id", otherTranscript]);
  });

  it("returns 404, not 500, for a missing output even when the type lookup fails", async () => {
    mockSession({ output: null, typesError: true, rowsError: { message: "boom" } });
    const response = await request();
    expect(response.status).toBe(404);
  });

  it("returns 500 for an existing output when the type lookup or projection rows fail", async () => {
    mockSession({ output: savedOutput, typesError: true });
    expect((await request()).status).toBe(500);
    mockSession({ output: savedOutput, rowsError: { message: "boom" } });
    expect((await request()).status).toBe(500);
  });

  it("returns the unchanged success JSON shape without a transcripts lookup", async () => {
    const session = mockSession({ output: savedOutput });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      output: { ...savedOutput, processing_type: "summary" },
      structuredItems: {
        chapters: [{ id: "transcript_chapters-row" }],
        decisions: [{ id: "transcript_decisions-row" }],
        risks: [{ id: "transcript_risks-row" }],
        tasks: [{ id: "transcript_tasks-row" }]
      }
    });
    expect(session.from.mock.calls.flat()).not.toContain("transcripts");
    expect(mocks.types).toHaveBeenCalledWith(expect.anything(), [{ id: outputId }]);
  });

  it("starts row and type queries without awaiting the output query", async () => {
    const gate = deferred();
    const session = mockSession({ output: savedOutput, outputGate: gate });
    const pending = request();
    await vi.waitFor(() => expect(session.started).toEqual(expect.arrayContaining([
      "ai_outputs", "transcript_tasks", "transcript_chapters", "transcript_decisions", "transcript_risks", "types"
    ])));
    gate.resolve(undefined);
    expect((await pending).status).toBe(200);
  });
});
