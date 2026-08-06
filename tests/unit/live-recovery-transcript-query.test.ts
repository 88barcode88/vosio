import { describe, expect, it, vi } from "vitest";
import { getTranscriptSummary } from "../../app/api/recordings/[recordingId]/recover-live/route";

const recordingId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000020";

type TranscriptRow = {
  created_at: string;
  id: string;
  raw_text: string;
  recording_id: string;
  segments: unknown[];
  speakers: unknown[];
  user_id: string;
};

// createTranscriptQueryMock applies the route's real filters, ordering and limit to in-memory rows.
function createTranscriptQueryMock(initialRows: TranscriptRow[]) {
  let rows = [...initialRows];
  const query = {
    eq: vi.fn((column: keyof TranscriptRow, value: string) => {
      rows = rows.filter((row) => row[column] === value);
      return query;
    }),
    limit: vi.fn((count: number) => {
      rows = rows.slice(0, count);
      return query;
    }),
    maybeSingle: vi.fn(async () => rows.length > 1
      ? { data: null, error: { message: "multiple rows" } }
      : { data: rows[0] ?? null, error: null }),
    order: vi.fn((column: keyof TranscriptRow, options: { ascending: boolean }) => {
      rows.sort((left, right) => {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        return options.ascending ? comparison : -comparison;
      });
      return query;
    }),
    select: vi.fn(() => query)
  };

  return query;
}

describe("live recovery transcript lookup", () => {
  it("deterministically selects one latest owned row when timestamps tie", async () => {
    const createdAt = "2026-08-05T12:00:00.000Z";
    const lowerId = "00000000-0000-4000-8000-000000000101";
    const higherId = "00000000-0000-4000-8000-000000000102";
    const query = createTranscriptQueryMock([
      {
        created_at: createdAt,
        id: lowerId,
        raw_text: "older tie",
        recording_id: recordingId,
        segments: [],
        speakers: [],
        user_id: userId
      },
      {
        created_at: createdAt,
        id: higherId,
        raw_text: "deterministic winner",
        recording_id: recordingId,
        segments: [],
        speakers: [],
        user_id: userId
      },
      {
        created_at: "2026-08-06T12:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000103",
        raw_text: "foreign owner",
        recording_id: recordingId,
        segments: [],
        speakers: [],
        user_id: "00000000-0000-4000-8000-000000000099"
      }
    ]);
    const admin = { from: vi.fn().mockReturnValue(query) };

    await expect(getTranscriptSummary({ admin: admin as never, recordingId, userId }))
      .resolves.toMatchObject({
        hasTranscript: true,
        transcript: { id: higherId, raw_text: "deterministic winner" }
      });
    expect(query.eq).toHaveBeenNthCalledWith(1, "recording_id", recordingId);
    expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", userId);
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });
});
