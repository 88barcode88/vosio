import { describe, expect, it, vi } from "vitest";
import { bulkShareRecordings } from "@/lib/recording-sharing/bulk";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const attempt = { requestId: a, recordingIds: [b, a, b], visibility: "selected" as const, projectId: null, recipients: [{ userId: b, role: "reader" as const }] };
describe("atomic bulk caller", () => {
  it("uses one RPC and preserves exact retry identity and complete payload", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "network" }, data: null }).mockResolvedValue({ error: null, data: [{ recording_id: a, visibility: "selected" }, { recording_id: b, visibility: "selected" }] });
    await expect(bulkShareRecordings({ rpc } as never, attempt)).rejects.toThrow();
    await bulkShareRecordings({ rpc } as never, attempt);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0]![0]).toBe("bulk_share_recordings_v1");
  });
  it.each([[], [{ recording_id: a, visibility: "selected" }], [{ recording_id: a, visibility: "private" }, { recording_id: b, visibility: "selected" }]].map((data) => ({ data })))("rejects partial or mismatched receipts", async ({ data }) => {
    await expect(bulkShareRecordings({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as never, attempt)).rejects.toThrow();
  });
  it("rejects oversized raw selection before DB work", async () => {
    const rpc = vi.fn();
    await expect(bulkShareRecordings({ rpc } as never, { ...attempt, recordingIds: Array(101).fill(a) })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
