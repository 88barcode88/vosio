import { describe, expect, it, vi } from "vitest";
import {
  createAutomaticTimelineGenerationIdentity,
  createAutomaticTimelineIdempotencyKey,
  enqueueAutomaticTimelineAfterCompletion,
  reconcileAutomaticTimeline
} from "@/lib/ai/automatic-timeline.server";

const promptSnapshot = {
  name: "Časová osa",
  output_schema: { type: "object" },
  override_id: "override-id",
  processing_type: "timeline_chapters" as const,
  prompt_text: "effective timeline prompt",
  revision: 4,
  source: "user_override" as const,
  system_prompt_id: "system-prompt-id"
};

describe("automatic timeline orchestration", () => {
  it("derives stable non-PII identities for all persisted completion paths", () => {
    const single = createAutomaticTimelineGenerationIdentity({
      kind: "async",
      transcriptionJobId: "job-single"
    });
    const segmentedA = createAutomaticTimelineGenerationIdentity({
      jobIds: ["job-b", "job-a"],
      kind: "segmented"
    });
    const segmentedB = createAutomaticTimelineGenerationIdentity({
      jobIds: ["job-a", "job-b"],
      kind: "segmented"
    });

    expect(single).toBe("async:job-single");
    expect(segmentedA).toBe(segmentedB);
    expect(segmentedA).toMatch(/^segmented:[a-f0-9]{64}$/u);
    expect(createAutomaticTimelineGenerationIdentity({ kind: "live", transcriptId: "transcript-live" }))
      .toBe("live:transcript-live");
    expect(createAutomaticTimelineGenerationIdentity({ kind: "import", transcriptId: "transcript-import" }))
      .toBe("import:transcript-import");

    const key = createAutomaticTimelineIdempotencyKey(segmentedA);
    expect(key).toMatch(/^atl_v1_[a-f0-9]{64}$/u);
    expect(key).not.toContain("job-a");
  });

  it("does nothing when dedicated consent is disabled even if legacy automation is enabled", async () => {
    const resolvePrompt = vi.fn();
    const enqueueJob = vi.fn();
    const reconcileJob = vi.fn();

    const result = await enqueueAutomaticTimelineAfterCompletion({
      admin: {} as never,
      authenticatedClient: {} as never,
      generationIdentity: "async:job-id",
      transcriptId: "transcript-id",
      user: {
        id: "user-id",
        user_metadata: {
          vosio_settings: {
            autoProcessAfterTranscription: true,
            autoProcessingTypes: ["summary"]
          }
        }
      } as never
    }, { enqueueJob, reconcileJob, resolvePrompt });

    expect(result).toEqual({ status: "disabled" });
    expect(resolvePrompt).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(reconcileJob).not.toHaveBeenCalled();
  });

  it("snapshots the current default model, effective prompt, provider and reasoning before one enqueue", async () => {
    const enqueueJob = vi.fn(async (input) => ({
      ...input,
      attempt_count: 0,
      id: "job-id",
      max_attempts: 3,
      status: "queued"
    }));
    const reconcileJob = vi.fn(async () => ({ status: "done" as const }));

    const result = await enqueueAutomaticTimelineAfterCompletion({
      admin: {} as never,
      authenticatedClient: {} as never,
      generationIdentity: "async:job-id",
      transcriptId: "transcript-id",
      user: {
        id: "user-id",
        user_metadata: {
          vosio_settings: {
            autoTimelineAfterTranscription: true,
            defaultOpenaiModel: "gpt-5.6-terra"
          }
        }
      } as never
    }, {
      enqueueJob,
      reconcileJob,
      resolvePrompt: vi.fn(async () => promptSnapshot)
    });

    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: createAutomaticTimelineIdempotencyKey("async:job-id"),
      model: "gpt-5.6-terra",
      outputSchemaSnapshot: { type: "object" },
      promptRevisionSnapshot: 4,
      promptSource: "user_override",
      promptTextSnapshot: "effective timeline prompt",
      provider: "openai",
      providerConfig: {
        provider: "openai",
        reasoning_effort: "high",
        response_format: "json_schema",
        thinking_level: null
      },
      transcriptId: "transcript-id",
      userId: "user-id"
    }), expect.anything());
    expect(reconcileJob).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "done" });
  });

  it("executes only a successfully claimed retry and leaves terminal jobs untouched", async () => {
    const executeJob = vi.fn();
    const settleJob = vi.fn();
    const result = await reconcileAutomaticTimeline({
      admin: {} as never,
      jobId: "job-id",
      transcriptId: "transcript-id",
      userId: "user-id"
    }, {
      claimJob: vi.fn(async () => null),
      executeJob,
      findJob: vi.fn(async () => ({
        attempt_count: 3,
        id: "job-id",
        max_attempts: 3,
        status: "failed"
      } as never)),
      findOutput: vi.fn(),
      loadTranscript: vi.fn(),
      settleJob
    });

    expect(result).toEqual({ status: "terminal_failed" });
    expect(executeJob).not.toHaveBeenCalled();
    expect(settleJob).not.toHaveBeenCalled();
  });

  it("claims one retry, runs the immutable snapshot and settles its lease", async () => {
    const settleJob = vi.fn(async () => true);
    const executeJob = vi.fn(async (input: {
      completeJob?: (
        admin: never,
        jobId: string,
        usage: { inputTokenCount: number | null; outputTokenCount: number | null }
      ) => Promise<void>;
    }) => {
      await input.completeJob?.({} as never, "job-id", {
        inputTokenCount: 12,
        outputTokenCount: 8
      });
      return { id: "output-id" };
    });
    const job = {
      attempt_count: 0,
      automatic_idempotency_key: "atl_v1_key",
      id: "job-id",
      lease_token: null,
      max_attempts: 3,
      model: "gpt-5.6-terra",
      prompt_output_schema_snapshot: { type: "object" },
      prompt_text_snapshot: "snapshotted prompt",
      provider: "openai" as const,
      provider_config: { reasoning_effort: "high" },
      status: "failed" as const,
      transcript_id: "transcript-id",
      user_id: "user-id"
    };

    const result = await reconcileAutomaticTimeline({
      admin: {} as never,
      transcriptId: "transcript-id",
      userId: "user-id"
    }, {
      claimJob: vi.fn(async () => ({ ...job, attempt_count: 1, status: "running" as const })),
      executeJob: executeJob as never,
      findJob: vi.fn(async () => job),
      findOutput: vi.fn(async () => null),
      loadTranscript: vi.fn(async () => ({
        id: "transcript-id",
        rawText: "persisted transcript",
        segments: [],
        speakers: [],
        userId: "user-id"
      })),
      settleJob
    });

    expect(result).toEqual({ status: "done" });
    expect(executeJob).toHaveBeenCalledOnce();
    expect(settleJob).toHaveBeenCalledWith(expect.objectContaining({
      inputTokenCount: 12,
      jobId: "job-id",
      outputTokenCount: 8,
      succeeded: true
    }));
  });

  it("settles a durable output without making another paid provider call", async () => {
    const executeJob = vi.fn();
    const settleJob = vi.fn(async () => true);
    const queuedJob = {
      attempt_count: 0,
      automatic_idempotency_key: "atl_v1_key",
      id: "job-id",
      lease_token: null,
      max_attempts: 3,
      model: "gpt-5.6-terra",
      prompt_output_schema_snapshot: { type: "object" },
      prompt_text_snapshot: "snapshotted prompt",
      provider: "openai" as const,
      provider_config: {},
      status: "queued" as const,
      transcript_id: "transcript-id",
      user_id: "user-id"
    };

    const result = await reconcileAutomaticTimeline({
      admin: {} as never,
      transcriptId: "transcript-id",
      userId: "user-id"
    }, {
      claimJob: vi.fn(async () => ({ ...queuedJob, attempt_count: 1, status: "running" as const })),
      executeJob,
      findJob: vi.fn(async () => queuedJob),
      findOutput: vi.fn(async () => ({ id: "existing-output" })),
      loadTranscript: vi.fn(),
      settleJob
    });

    expect(result).toEqual({ status: "done" });
    expect(executeJob).not.toHaveBeenCalled();
    expect(settleJob).toHaveBeenCalledWith(expect.objectContaining({ succeeded: true }));
  });
});
