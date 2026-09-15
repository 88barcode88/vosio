import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), execute: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/ai/processing-service.server", () => ({ executePersistedAiProcessing: mocks.execute }));
import { scheduleAutomaticOutputs } from "@/lib/ai/automatic-timeline.server";
import { automaticOutputTypes } from "@/lib/settings/types";
beforeEach(() => vi.clearAllMocks());

it("persists independent jobs before deferred fan-out and survives the first enqueue failure", async () => {
  const intents = automaticOutputTypes.map((type) => ({ processing_type: type, completion_generation_key: "gen", automatic_idempotency_key: type,
    transcript_id: "t", user_id: "u", model: "gpt-5.6-terra", provider: "openai", provider_config: {}, prompt_text_snapshot: "Synthetic" }));
  const rpc = vi.fn((name: string, input: Record<string, unknown>) => {
    const type = String(input.p_processing_type ?? input.p_job_id);
    const job = { ...intents.find((intent) => intent.processing_type === type), id: type, status: name.includes("claim") ? "running" : "queued", attempt_count: 1, max_attempts: 3 };
    const chain = { returns: () => chain, single: async () => ({ data: type === "summary" ? null : job, error: type === "summary" ? {} : null }),
      maybeSingle: async () => ({ data: job, error: null }) };
    return chain;
  });
  const from = vi.fn((table: string) => {
    const chain = { select: () => chain, eq: () => chain, in: () => chain,
      limit: async () => ({ data: intents, error: null }),
      single: async () => ({ data: { id: "t", user_id: "u", completion_generation_key: "gen", raw_text: "Synthetic", segments: [], speakers: [] }, error: null }),
      maybeSingle: async () => ({ data: table === "ai_outputs" ? null : {}, error: null }) };
    return chain;
  });
  const result = await scheduleAutomaticOutputs({ admin: { from, rpc } as never, transcriptId: "t", userId: "u" });
  expect(result.status).toBe("queued"); expect(rpc).toHaveBeenCalledTimes(6); expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.after).toHaveBeenCalledOnce();
  await mocks.after.mock.calls[0][0]();
  expect(mocks.execute).toHaveBeenCalledTimes(5);
  for (const [input] of mocks.execute.mock.calls) expect(input.automaticPublication).toMatchObject({ generationKey: "gen", leaseToken: expect.any(String) });
});
