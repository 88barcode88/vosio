import { describe, expect, it, vi } from "vitest";
import { executeTranscriptionWork } from "@/lib/recordings/transcription-worker.server";
const m = vi.hoisted(() => ({ text: vi.fn() }));
vi.mock("@/lib/env.server", () => ({ getServerEnv: () => ({ sonioxAsyncModel: "stt-async-v5" }) }));
vi.mock("@/lib/soniox/client", () => ({ getSonioxTranscript: m.text, createSonioxTranscription: vi.fn(), getSonioxTranscription: vi.fn() }));
vi.mock("@/lib/transcripts/capture-index.server", () => ({ indexCapturedTranscript: vi.fn(async () => ({ status: "ready" })) }));
describe("durable terminal finalization", () => {
  it("combines exact segment jobs and delegates history-preserving idempotent writes only to finalize RPC", async () => {
    m.text.mockImplementation(async (_region, id) => ({ id, text: id, tokens: [{ start_ms: 0, end_ms: 50 }] }));
    const operation = "00000000-0000-4000-8000-000000000001";
    const claim = "00000000-0000-4000-8000-000000000002";
    const manifest = [0, 1].map((position) => ({ jobId: `00000000-0000-4000-8000-00000000000${position + 3}`, providerJobId: `provider-${position}`, position, audioDurationMs: 1500 }));
    const rpc = vi.fn().mockImplementation(async (name) => ({ data: name === "finalize_recording_transcription_v1" ? { operationId: operation, phase: "completed", transcriptId: claim } : true, error: null }));
    const from = vi.fn();
    const work = { operation_id: operation, job_id: null, claim_id: claim, client_reference_id: operation, region: "eu", model: "stt-async-v5", work_kind: "finalize", storage_path: null, provider_job_id: null, manifest };
    await executeTranscriptionWork({ rpc, from } as never, work);
    const finalized = rpc.mock.calls.at(-1)!;
    expect(finalized[0]).toBe("finalize_recording_transcription_v1");
    expect(finalized[1]).toMatchObject({ p_operation_id: operation, p_claim_id: claim, p_raw_text: "provider-0\n\nprovider-1", p_duration_seconds: 3, p_segments: [{ start_ms: 0, end_ms: 50 }, { start_ms: 1500, end_ms: 1550 }] });
    expect(from).not.toHaveBeenCalled();
    // Replaying the identical DB-issued claim submits the identical finalization payload, not cleanup/AI.
    await executeTranscriptionWork({ rpc, from } as never, work);
    expect(rpc.mock.calls.at(-1)).toEqual(finalized);
    expect(rpc.mock.calls.every(([name]) => ["refresh_recording_transcription_claim_v1", "finalize_recording_transcription_v1"].includes(name))).toBe(true);
  });
});
