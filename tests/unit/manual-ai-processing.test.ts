import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runManualAiJob } from "@/lib/ai/manual-processing.server";
import { getManualAiFailureMessage, SafeAiProviderError } from "@/lib/ai/provider-errors";

const job = {
  id: "00000000-0000-4000-8000-000000000901",
  model: "gpt-5.6-terra",
  prompt_output_schema_snapshot: { type: "object" },
  prompt_text_snapshot: "Shrň {{raw_text}}",
  provider: "openai" as const,
  provider_config: {
    metadata: { source: "manual-button", workspace: "sales" },
    reasoning_effort: "high",
    temperature: 0.7
  },
  transcript_id: "00000000-0000-4000-8000-000000000902",
  user_id: "00000000-0000-4000-8000-000000000903"
};

const transcript = {
  id: job.transcript_id,
  raw_text: "Potvrzený přepis.",
  segments: [],
  speakers: [],
  user_id: job.user_id
};

// createDependencies exposes the claim boundary independently from Supabase transport details.
function createDependencies() {
  return {
    claimJob: vi.fn().mockResolvedValue(job),
    executeJob: vi.fn().mockResolvedValue({ id: "output-1" }),
    findOutput: vi.fn().mockResolvedValue(null),
    loadTranscript: vi.fn().mockResolvedValue(transcript),
    settle: vi.fn().mockResolvedValue(true)
  };
}

describe("durable manual AI processing", () => {
  it("lets only the callback that atomically claims queued work execute the provider", async () => {
    const dependencies = createDependencies();
    dependencies.claimJob.mockResolvedValueOnce(job).mockResolvedValueOnce(null);

    await Promise.all([
      runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies),
      runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies)
    ]);

    expect(dependencies.executeJob).toHaveBeenCalledTimes(1);
  });

  it("builds the provider payload only from the claimed durable snapshot", async () => {
    const dependencies = createDependencies();

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(dependencies.executeJob).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({ providerConfig: job.provider_config }),
      metadata: job.provider_config.metadata,
      temperature: job.provider_config.temperature
    }));
  });

  it("uses the identical claimed provider payload for initial and reconciled callbacks", async () => {
    const initialDependencies = createDependencies();
    const reconciledDependencies = createDependencies();
    const identity = { jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id };

    await runManualAiJob(identity, initialDependencies);
    await runManualAiJob(identity, reconciledDependencies);

    const initialPayload = initialDependencies.executeJob.mock.calls[0]![0];
    const reconciledPayload = reconciledDependencies.executeJob.mock.calls[0]![0];
    expect({
      job: reconciledPayload.job,
      metadata: reconciledPayload.metadata,
      temperature: reconciledPayload.temperature
    }).toEqual({
      job: initialPayload.job,
      metadata: initialPayload.metadata,
      temperature: initialPayload.temperature
    });
  });

  it("does not call the provider when raw output already exists for the claimed job", async () => {
    const dependencies = createDependencies();
    dependencies.findOutput.mockResolvedValue({ id: "output-existing" });

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(dependencies.executeJob).not.toHaveBeenCalled();
    expect(dependencies.settle).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }),
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
      expect.objectContaining({ succeeded: true })
    );
  });

  it("does not treat an output from another transcript as this job's durable output", async () => {
    const dependencies = createDependencies();
    dependencies.findOutput.mockImplementation(async (_jobId, transcriptId) => (
      transcriptId === job.transcript_id ? null : { id: "output-from-another-transcript" }
    ));

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(dependencies.findOutput).toHaveBeenCalledWith(job.id, job.transcript_id, job.user_id);
    expect(dependencies.executeJob).toHaveBeenCalledTimes(1);
  });

  it("filters every durable output lookup by transcript identity in the server adapter", () => {
    const source = readFileSync("src/lib/ai/manual-processing.server.ts", "utf8");
    expect(source).toContain('.eq("transcript_id", transcriptId)');
  });

  it("settles provider failures with stable safe copy", async () => {
    const dependencies = createDependencies();
    dependencies.executeJob.mockRejectedValue(new SafeAiProviderError({
      failureCode: "rate_limited",
      retryAfterAt: "2026-09-04T15:00:00.000Z"
    }));

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(dependencies.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        failureCode: "rate_limited",
        retryAfterAt: "2026-09-04T15:00:00.000Z",
        succeeded: false
      })
    );
  });

  it("preserves a rate limit without inventing a deadline or calling the provider twice", async () => {
    const dependencies = createDependencies();
    dependencies.executeJob.mockRejectedValue(new SafeAiProviderError({ failureCode: "rate_limited", retryAfterAt: null }));

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(dependencies.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ failureCode: "rate_limited", retryAfterAt: null, succeeded: false })
    );
    expect(dependencies.executeJob).toHaveBeenCalledTimes(1);
    expect(getManualAiFailureMessage("rate_limited")).toBe(
      "AI služba dočasně omezuje požadavky. Zkuste to znovu později."
    );
  });

  it("never persists an arbitrary worker error message", async () => {
    const dependencies = createDependencies();
    const sentinel = "SECRET-SENTINEL-worker-error";
    dependencies.executeJob.mockRejectedValue(new Error(sentinel));

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(JSON.stringify(dependencies.settle.mock.calls)).not.toContain(sentinel);
    expect(dependencies.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ failureCode: "unknown", succeeded: false })
    );
  });

  it("repairs durable output after any worker exception without a second provider call", async () => {
    const dependencies = createDependencies();
    dependencies.executeJob.mockRejectedValue(new Error("settlement lost"));
    dependencies.findOutput.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "output-durable" });
    await expect(runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies))
      .resolves.toMatchObject({ outputId: "output-durable" });
    expect(dependencies.executeJob).toHaveBeenCalledTimes(1);
    expect(dependencies.settle).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ succeeded: true }));
  });

  it("surfaces a lost exact-token settlement instead of reporting fake completion", async () => {
    const dependencies = createDependencies();
    dependencies.findOutput.mockResolvedValue({ id: "output-durable" });
    dependencies.settle.mockResolvedValue(false);
    await expect(runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies))
      .rejects.toThrow("manual_ai_settlement_not_persisted");
    expect(dependencies.executeJob).not.toHaveBeenCalled();
  });
});
