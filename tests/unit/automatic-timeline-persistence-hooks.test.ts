import { describe, expect, it, vi } from "vitest";
import { scheduleCaptureTimelineIntent } from "@/lib/ai/automatic-timeline.server";
vi.mock("server-only", () => ({}));
describe("capture timeline scheduling consumes private DB snapshots", () => {
  it("sends only identity, never mutable model/provider or prompt arguments", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const user = { user_metadata: { vosio_settings: { autoTimelineAfterTranscription: true, defaultOpenaiModel: "gpt-5.6-sol" } } };
    expect(await scheduleCaptureTimelineIntent({ rpc } as never,"transcript",user as never)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("schedule_capture_automatic_intents_v2",{ p_transcript_id: "transcript" });
  });
  it("never schedules opt-out and fails closed on revoked DB authorization", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null,error: { code: "42501" } });
    expect(await scheduleCaptureTimelineIntent({ rpc } as never,"transcript",{ user_metadata: {} } as never)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    await expect(scheduleCaptureTimelineIntent({ rpc } as never,"transcript",{ user_metadata: { vosio_settings: { autoTimelineAfterTranscription: true } } } as never)).rejects.toThrow("not authorized");
  });
});
