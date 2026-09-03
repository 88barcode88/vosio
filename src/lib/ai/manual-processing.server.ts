import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  executePersistedAiProcessing,
  getAiProviderFailureMessage,
  type PersistedAiProcessingJob,
  type PersistedAiTranscript
} from "@/lib/ai/processing-service.server";
import type { AiProviderId } from "@/lib/model-options";
import { createAdminClient } from "@/lib/supabase/admin";

type ClaimedManualAiJob = {
  id: string;
  model: string;
  output_schema_snapshot: unknown;
  prompt_text_snapshot: string;
  provider: AiProviderId;
  provider_config: Record<string, unknown>;
  transcript_id: string;
  user_id: string;
};

type ManualAiJobIdentity = {
  jobId: string;
  metadata?: Record<string, unknown>;
  temperature?: number;
  transcriptId: string;
  userId: string;
};

export type ManualAiProcessingDependencies = {
  claimJob: (identity: ManualAiJobIdentity) => Promise<ClaimedManualAiJob | null>;
  executeJob: (input: {
    job: PersistedAiProcessingJob;
    metadata?: Record<string, unknown>;
    temperature?: number;
    transcript: PersistedAiTranscript;
  }) => Promise<unknown>;
  findOutput: (jobId: string, userId: string) => Promise<{ id: string } | null>;
  loadTranscript: (transcriptId: string, userId: string) => Promise<PersistedAiTranscript | null>;
  settleDone: (jobId: string, userId: string, transcriptId: string) => Promise<void>;
  settleFailed: (jobId: string, userId: string, transcriptId: string, errorMessage: string) => Promise<void>;
};

// runManualAiJob owns one accepted manual generation after the HTTP response has been released.
export async function runManualAiJob(
  identity: ManualAiJobIdentity,
  dependencies?: ManualAiProcessingDependencies
) {
  const owner = dependencies ?? createManualAiProcessingDependencies();
  const job = await owner.claimJob(identity);

  if (!job) {
    return { status: "not_claimed" as const };
  }

  const existingOutput = await owner.findOutput(job.id, job.user_id);
  if (existingOutput) {
    await owner.settleDone(job.id, job.user_id, job.transcript_id);
    return { outputId: existingOutput.id, status: "already_completed" as const };
  }

  const transcript = await owner.loadTranscript(job.transcript_id, job.user_id);
  if (!transcript) {
    await owner.settleFailed(
      job.id,
      job.user_id,
      job.transcript_id,
      "AI zpracování nelze dokončit, protože přepis už není dostupný."
    );
    return { status: "failed" as const };
  }

  try {
    await owner.executeJob({
      job: {
        id: job.id,
        model: job.model,
        outputSchemaSnapshot: job.output_schema_snapshot,
        promptTextSnapshot: job.prompt_text_snapshot,
        provider: job.provider,
        providerConfig: job.provider_config
      },
      metadata: identity.metadata,
      temperature: identity.temperature,
      transcript
    });
    return { status: "done" as const };
  } catch {
    await owner.settleFailed(
      job.id,
      job.user_id,
      job.transcript_id,
      getAiProviderFailureMessage(job.provider)
    );
    return { status: "failed" as const };
  }
}

// createManualAiProcessingDependencies binds the durable owner to one server-only Supabase admin client.
function createManualAiProcessingDependencies(): ManualAiProcessingDependencies {
  const admin = createAdminClient();

  return {
    claimJob: (identity) => claimManualAiJob(admin, identity),
    executeJob: (input) => executePersistedAiProcessing({ admin, ...input }),
    findOutput: (jobId, userId) => findManualAiOutput(admin, jobId, userId),
    loadTranscript: (transcriptId, userId) => loadManualAiTranscript(admin, transcriptId, userId),
    settleDone: (jobId, userId, transcriptId) => settleManualAiJobDone(admin, jobId, userId, transcriptId),
    settleFailed: (jobId, userId, transcriptId, errorMessage) =>
      settleManualAiJobFailed(admin, jobId, userId, transcriptId, errorMessage)
  };
}

// claimManualAiJob atomically changes exactly one queued manual job to running.
async function claimManualAiJob(admin: SupabaseClient, identity: ManualAiJobIdentity) {
  const { data, error } = await admin
    .from("ai_processing_jobs")
    .update({ error_message: null, started_at: new Date().toISOString(), status: "running" })
    .eq("id", identity.jobId)
    .eq("user_id", identity.userId)
    .eq("transcript_id", identity.transcriptId)
    .eq("execution_mode", "manual")
    .eq("status", "queued")
    .select("id,model,output_schema_snapshot,prompt_text_snapshot,provider,provider_config,transcript_id,user_id")
    .maybeSingle<ClaimedManualAiJob>();

  if (error) {
    console.error("[Vosio manual AI owner] claim_failed");
    return null;
  }

  return data;
}

// findManualAiOutput checks the durable raw artifact before any paid provider call.
async function findManualAiOutput(admin: SupabaseClient, jobId: string, userId: string) {
  const { data } = await admin
    .from("ai_outputs")
    .select("id")
    .eq("processing_job_id", jobId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string }>();

  return data;
}

// loadManualAiTranscript reloads the exact owner-scoped transcript after the queued job is claimed.
async function loadManualAiTranscript(admin: SupabaseClient, transcriptId: string, userId: string) {
  const { data, error } = await admin
    .from("transcripts")
    .select("id,raw_text,segments,speakers,user_id")
    .eq("id", transcriptId)
    .eq("user_id", userId)
    .maybeSingle<{
      id: string;
      raw_text: string;
      segments: unknown;
      speakers: unknown;
      user_id: string;
    }>();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    rawText: data.raw_text,
    segments: data.segments,
    speakers: data.speakers,
    userId: data.user_id
  };
}

// settleManualAiJobDone repairs an accepted job whose raw output already exists.
async function settleManualAiJobDone(
  admin: SupabaseClient,
  jobId: string,
  userId: string,
  transcriptId: string
) {
  await admin
    .from("ai_processing_jobs")
    .update({ completed_at: new Date().toISOString(), error_message: null, status: "done" })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("transcript_id", transcriptId)
    .eq("status", "running");
}

// settleManualAiJobFailed stores only stable public failure copy for later rehydration.
async function settleManualAiJobFailed(
  admin: SupabaseClient,
  jobId: string,
  userId: string,
  transcriptId: string,
  errorMessage: string
) {
  await admin
    .from("ai_processing_jobs")
    .update({ completed_at: new Date().toISOString(), error_message: errorMessage, status: "failed" })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("transcript_id", transcriptId)
    .eq("status", "running");
}
