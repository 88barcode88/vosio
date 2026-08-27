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

const durableIntent = {
  automatic_idempotency_key: createAutomaticTimelineIdempotencyKey("async:job-id"),
  consent_snapshot: true as const,
  created_at: "2026-08-27T12:00:00.000Z",
  id: "intent-id",
  model: "gpt-5.6-terra",
  prompt_id: "system-prompt-id",
  prompt_name_snapshot: "Časová osa",
  prompt_output_schema_snapshot: { type: "object" },
  prompt_override_id: "override-id",
  prompt_revision_snapshot: 4,
  prompt_source: "user_override" as const,
  prompt_text_snapshot: "effective timeline prompt",
  provider: "openai" as const,
  provider_config: {
    provider: "openai",
    reasoning_effort: "high",
    response_format: "json_schema",
    thinking_level: null
  },
  transcript_id: "transcript-id",
  user_id: "user-id"
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
    const persistIntent = vi.fn();
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
    }, { persistIntent, reconcileJob, resolvePrompt });

    expect(result).toEqual({ status: "disabled" });
    expect(resolvePrompt).not.toHaveBeenCalled();
    expect(persistIntent).not.toHaveBeenCalled();
    expect(reconcileJob).not.toHaveBeenCalled();
  });

  it("durably snapshots consent, model, prompt, provider and reasoning before reconciliation", async () => {
    const persistIntent = vi.fn(async () => durableIntent);
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
      persistIntent,
      reconcileJob,
      resolvePrompt: vi.fn(async () => promptSnapshot)
    });

    expect(persistIntent).toHaveBeenCalledOnce();
    expect(persistIntent).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(persistIntent.mock.invocationCallOrder[0]).toBeLessThan(
      reconcileJob.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({ status: "done" });
  });

  it("recovers a durable intent on the next detail open after the first enqueue attempt fails", async () => {
    let persistedIntent: typeof durableIntent | null = null;

    await expect(enqueueAutomaticTimelineAfterCompletion({
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
      persistIntent: vi.fn(async () => {
        persistedIntent = durableIntent;
        return durableIntent;
      }),
      reconcileJob: vi.fn(async () => {
        throw new Error("first enqueue failed");
      }),
      resolvePrompt: vi.fn(async () => promptSnapshot)
    })).rejects.toThrow("first enqueue failed");

    expect(persistedIntent).toEqual(durableIntent);

    const providerRun = vi.fn(async () => ({ id: "output-id" }));
    const queuedJob = {
      attempt_count: 0,
      automatic_idempotency_key: durableIntent.automatic_idempotency_key,
      id: "job-id",
      lease_token: null,
      max_attempts: 3,
      model: durableIntent.model,
      prompt_output_schema_snapshot: durableIntent.prompt_output_schema_snapshot,
      prompt_text_snapshot: durableIntent.prompt_text_snapshot,
      provider: durableIntent.provider,
      provider_config: durableIntent.provider_config,
      status: "queued" as const,
      transcript_id: durableIntent.transcript_id,
      user_id: durableIntent.user_id
    };
    const enqueueJob = vi.fn(async () => queuedJob);
    const result = await reconcileAutomaticTimeline({
      admin: {} as never,
      transcriptId: "transcript-id",
      userId: "user-id"
    }, {
      claimJob: vi.fn(async () => ({ ...queuedJob, attempt_count: 1, status: "running" as const })),
      enqueueJob,
      executeJob: providerRun as never,
      findIntent: vi.fn(async () => persistedIntent),
      findJob: vi.fn(async () => null),
      findOutput: vi.fn(async () => null),
      loadTranscript: vi.fn(async () => ({
        id: "transcript-id",
        rawText: "persisted transcript",
        segments: [],
        speakers: [],
        userId: "user-id"
      })),
      settleJob: vi.fn(async () => true)
    });

    expect(result).toEqual({ status: "done" });
    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(providerRun).toHaveBeenCalledOnce();
  });

  it("uses one durable job and one provider run across concurrent repeated detail opens", async () => {
    let durableJob: Record<string, unknown> | null = null;
    let durableInsertCount = 0;
    let claimed = false;
    const providerRun = vi.fn(async () => ({ id: "output-id" }));
    const enqueueJob = vi.fn(async () => {
      if (!durableJob) {
        durableInsertCount += 1;
        durableJob = {
          attempt_count: 0,
          automatic_idempotency_key: durableIntent.automatic_idempotency_key,
          id: "job-id",
          lease_token: null,
          max_attempts: 3,
          model: durableIntent.model,
          prompt_output_schema_snapshot: durableIntent.prompt_output_schema_snapshot,
          prompt_text_snapshot: durableIntent.prompt_text_snapshot,
          provider: durableIntent.provider,
          provider_config: durableIntent.provider_config,
          status: "queued",
          transcript_id: durableIntent.transcript_id,
          user_id: durableIntent.user_id
        };
      }
      return durableJob as never;
    });
    const dependencies = {
      claimJob: vi.fn(async () => {
        if (claimed) {
          return null;
        }
        claimed = true;
        return { ...durableJob, attempt_count: 1, status: "running" } as never;
      }),
      enqueueJob,
      executeJob: providerRun as never,
      findIntent: vi.fn(async () => durableIntent),
      findJob: vi.fn(async () => durableJob as never),
      findOutput: vi.fn(async () => null),
      loadTranscript: vi.fn(async () => ({
        id: "transcript-id",
        rawText: "persisted transcript",
        segments: [],
        speakers: [],
        userId: "user-id"
      })),
      settleJob: vi.fn(async () => true)
    };

    const results = await Promise.all([
      reconcileAutomaticTimeline({
        admin: {} as never,
        transcriptId: "transcript-id",
        userId: "user-id"
      }, dependencies),
      reconcileAutomaticTimeline({
        admin: {} as never,
        transcriptId: "transcript-id",
        userId: "user-id"
      }, dependencies)
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["busy", "done"]);
    expect(enqueueJob).toHaveBeenCalledTimes(2);
    expect(durableInsertCount).toBe(1);
    expect(durableJob).toEqual(expect.objectContaining({ id: "job-id" }));
    expect(providerRun).toHaveBeenCalledOnce();
  });

  it("does not create a job for a historical or disabled completion without durable intent", async () => {
    const enqueueJob = vi.fn();
    const result = await reconcileAutomaticTimeline({
      admin: {} as never,
      transcriptId: "historical-transcript",
      userId: "user-id"
    }, {
      enqueueJob,
      findIntent: vi.fn(async () => null),
      findJob: vi.fn(async () => null)
    });

    expect(result).toEqual({ status: "not_scheduled" });
    expect(enqueueJob).not.toHaveBeenCalled();
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
