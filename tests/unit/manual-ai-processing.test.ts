import { describe, expect, it, vi } from "vitest";
import { runManualAiJob } from "@/lib/ai/manual-processing.server";

const job = {
  id: "00000000-0000-4000-8000-000000000901",
  model: "gpt-5.6-terra",
  output_schema_snapshot: { type: "object" },
  prompt_text_snapshot: "Shrň {{raw_text}}",
  provider: "openai" as const,
  provider_config: { reasoning_effort: "high" },
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
    settleDone: vi.fn().mockResolvedValue(undefined),
    settleFailed: vi.fn().mockResolvedValue(undefined)
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

  it("does not call the provider when raw output already exists for the claimed job", async () => {
    const dependencies = createDependencies();
    dependencies.findOutput.mockResolvedValue({ id: "output-existing" });

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(dependencies.executeJob).not.toHaveBeenCalled();
    expect(dependencies.settleDone).toHaveBeenCalledWith(job.id, job.user_id, job.transcript_id);
  });

  it("settles provider failures with stable safe copy", async () => {
    const dependencies = createDependencies();
    dependencies.executeJob.mockRejectedValue(new Error("secret provider request abc-123"));

    await runManualAiJob({ jobId: job.id, transcriptId: job.transcript_id, userId: job.user_id }, dependencies);

    expect(dependencies.settleFailed).toHaveBeenCalledWith(
      job.id,
      job.user_id,
      job.transcript_id,
      "OpenAI zpracování selhalo. Zkontrolujte OPENAI_API_KEY, dostupnost modelu nebo zkuste jiný model."
    );
  });
});
