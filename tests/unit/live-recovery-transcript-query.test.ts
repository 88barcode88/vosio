import { describe, expect, it, vi } from "vitest";
import { listTranscriptsForRecording } from "@/lib/transcripts/queries";

describe("live recovery transcript lookup", () => {
  it("reads the latest accessible generation deterministically through session RLS", async () => {
    const rows = [{ id: "latest", raw_text: "saved" }];
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), returns: vi.fn().mockResolvedValue({ data: rows, error: null }) };
    for (const method of ["select", "eq", "order", "limit"] as const) query[method].mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue(query) };
    await expect(listTranscriptsForRecording(client as never, "recording")).resolves.toEqual(rows);
    expect(query.eq).toHaveBeenCalledWith("recording_id", "recording");
    expect(query.eq).toHaveBeenCalledTimes(1);
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
  });
});
