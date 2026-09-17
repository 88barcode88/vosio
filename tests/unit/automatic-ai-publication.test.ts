import { describe, expect, it, vi } from "vitest";
import { persistCompletedAiProcessing } from "@/lib/ai/process-route-orchestration";
import { executePersistedAiProcessing } from "@/lib/ai/processing-service.server";

describe("automatic atomic publication strategy", () => {
  it.each(["expired lease", "replaced lease", "old generation", "projection failure"])("never falls back to raw writes after %s", async () => {
    const single = vi.fn(async () => ({ data: null, error: { code: "conflict" } }));
    const admin = { from: vi.fn(), rpc: vi.fn(() => ({ select: () => ({ single }) })) };
    const completeJob = vi.fn(), persistStructuredRows = vi.fn();
    await expect(persistCompletedAiProcessing({ admin: admin as never, inputTokenCount: 4, outputTokenCount: 2,
      jobId: "job", transcriptId: "transcript", userId: "owner", transcriptSegments: [], outputText: "raw", outputJson: null
    }, { automaticPublication: { generationKey: "generation", leaseToken: "lease" }, completeJob, persistStructuredRows })).rejects.toThrow();
    expect(admin.from).not.toHaveBeenCalled();
    expect(completeJob).not.toHaveBeenCalled();
    expect(persistStructuredRows).not.toHaveBeenCalled();
  });
  it("publishes raw result, reserved output identity, projections and usage in one RPC", async () => {
    const rpc = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: "result" }, error: null }) }) }));
    const output = await persistCompletedAiProcessing({ admin: { rpc } as never, inputTokenCount: 4, outputTokenCount: 2,
      jobId: "job", transcriptId: "transcript", userId: "owner", transcriptSegments: [], outputText: "raw",
      outputJson: { action_items: [{ title: "Synthetic task" }] }
    }, { automaticPublication: { generationKey: "generation", leaseToken: "lease" } });
    expect(output.id).toBe("result");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("publish_automatic_ai_output_v2", expect.objectContaining({
      p_generation_key: "generation", p_lease_token: "lease", p_input_token_count: 4, p_output_token_count: 2,
      p_output_id: expect.any(String), p_projections: expect.objectContaining({ chapters: [], decisions: [], risks: [] })
    }));
  });
  it("propagates automatic publication authority and timeout through the shared provider service", async () => {
    const runProvider = vi.fn(async () => ({ outputText: "output", inputTokenCount: 2, outputTokenCount: 1, providerResponseId: null }));
    const persistCompleted = vi.fn(async () => ({}));
    await executePersistedAiProcessing({ admin: {} as never,
      automaticPublication: { generationKey: "generation", leaseToken: "lease" },
      job: { id: "job", model: "gpt-5.6-terra", provider: "openai", providerConfig: {}, promptTextSnapshot: "{{transcript}}", outputSchemaSnapshot: null },
      transcript: { id: "transcript", userId: "owner", rawText: "Synthetic", segments: [], speakers: [] }
    }, { runProvider, persistCompleted });
    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(persistCompleted).toHaveBeenCalledWith(expect.anything(), { automaticPublication: { generationKey: "generation", leaseToken: "lease" } });
  });
});
