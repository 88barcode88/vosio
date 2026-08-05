import { describe, expect, it, vi } from "vitest";
import {
  listTranscripts,
  listTranscriptsForRecording
} from "@/lib/transcripts/queries";

// createTranscriptQueryMock builds the fluent Supabase boundary used by transcript reads.
function createTranscriptQueryMock() {
  const query = {
    eq: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    returns: vi.fn(),
    select: vi.fn()
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.returns.mockResolvedValue({ data: [], error: null });

  return query;
}

describe("transcript queries", () => {
  it("orders general and detail reads by created time and id deterministically", async () => {
    const listQuery = createTranscriptQueryMock();
    const detailQuery = createTranscriptQueryMock();

    await listTranscripts({ from: vi.fn(() => listQuery) } as never);
    await listTranscriptsForRecording(
      { from: vi.fn(() => detailQuery) } as never,
      "recording-1"
    );

    expect(listQuery.order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }]
    ]);
    expect(detailQuery.eq).toHaveBeenCalledWith("recording_id", "recording-1");
    expect(detailQuery.order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }]
    ]);
    expect(detailQuery.limit).toHaveBeenCalledWith(1);
  });
});
