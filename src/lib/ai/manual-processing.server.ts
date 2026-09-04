import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  executePersistedAiProcessing,
  type PersistedAiProcessingJob,
  type PersistedAiTranscript
} from "@/lib/ai/processing-service.server";
import { getSafeAiFailure, SafeAiProviderError, type SafeAiFailure } from "@/lib/ai/provider-errors";
import type { AiProviderId } from "@/lib/model-options";
import { createAdminClient } from "@/lib/supabase/admin";

type ClaimedManualAiJob = {
  id: string;
  model: string;
  prompt_output_schema_snapshot: unknown;
  prompt_text_snapshot: string;
  provider: AiProviderId;
  provider_config: Record<string, unknown>;
  transcript_id: string;
  user_id: string;
};

type ManualAiJobIdentity = {
  jobId: string;
  transcriptId: string;
  userId: string;
};

type ManualSettlement = SafeAiFailure & {
  inputTokenCount: number | null;
  outputTokenCount: number | null;
  succeeded: boolean;
};

export type ManualAiProcessingDependencies = {
  claimJob: (identity: ManualAiJobIdentity, leaseToken: string) => Promise<ClaimedManualAiJob | null>;
  executeJob: (input: {
    completeJob: (_admin: SupabaseClient, jobId: string, usage: { inputTokenCount: number | null; outputTokenCount: number | null }) => Promise<void>;
    job: PersistedAiProcessingJob;
    metadata?: Record<string, unknown>;
    temperature?: number;
    transcript: PersistedAiTranscript;
  }) => Promise<unknown>;
  findOutput: (jobId: string, transcriptId: string, userId: string) => Promise<{ id: string } | null>;
  loadTranscript: (transcriptId: string, userId: string) => Promise<PersistedAiTranscript | null>;
  settle: (identity: ManualAiJobIdentity, leaseToken: string, settlement: ManualSettlement) => Promise<boolean>;
};

// readProviderExecutionSnapshot validates the complete normalized provider input stored with a new manual job.
function readProviderExecutionSnapshot(providerConfig: Record<string, unknown>) {
  const metadata = providerConfig.metadata;
  const temperature = providerConfig.temperature;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
    || typeof temperature !== "number" || !Number.isFinite(temperature)
    || temperature < 0 || temperature > 2) {
    throw new SafeAiProviderError({ failureCode: "execution_interrupted", retryAfterAt: null });
  }
  return { metadata: metadata as Record<string, unknown>, temperature };
}

// runManualAiJob owns one accepted manual generation behind an exact database lease.
export async function runManualAiJob(
  identity: ManualAiJobIdentity,
  dependencies?: ManualAiProcessingDependencies
) {
  const owner = dependencies ?? createManualAiProcessingDependencies();
  const leaseToken = randomUUID();
  const job = await owner.claimJob(identity, leaseToken);
  if (!job) return { status: "not_claimed" as const };

  // settleExactly fails loudly on DB errors or a lost/wrong lease instead of inventing completion.
  const settleExactly = async (settlement: ManualSettlement) => {
    const settled = await owner.settle(identity, leaseToken, settlement);
    if (!settled) throw new Error("manual_ai_settlement_not_persisted");
  };

  try {
    const existingOutput = await owner.findOutput(job.id, job.transcript_id, job.user_id);
    if (existingOutput) {
      await settleExactly({ failureCode: "unknown", inputTokenCount: null, outputTokenCount: null, retryAfterAt: null, succeeded: true });
      return { outputId: existingOutput.id, status: "already_completed" as const };
    }

    const transcript = await owner.loadTranscript(job.transcript_id, job.user_id);
    if (!transcript) throw new SafeAiProviderError({ failureCode: "execution_interrupted", retryAfterAt: null });
    const executionSnapshot = readProviderExecutionSnapshot(job.provider_config);

    await owner.executeJob({
      completeJob: async (_admin, _jobId, usage) => settleExactly({
        failureCode: "unknown",
        inputTokenCount: usage.inputTokenCount,
        outputTokenCount: usage.outputTokenCount,
        retryAfterAt: null,
        succeeded: true
      }),
      job: {
        id: job.id,
        model: job.model,
        outputSchemaSnapshot: job.prompt_output_schema_snapshot,
        promptTextSnapshot: job.prompt_text_snapshot,
        provider: job.provider,
        providerConfig: job.provider_config
      },
      metadata: executionSnapshot.metadata,
      temperature: executionSnapshot.temperature,
      transcript
    });
    return { status: "done" as const };
  } catch (error) {
    const durableOutput = await owner.findOutput(job.id, job.transcript_id, job.user_id);
    if (durableOutput) {
      await settleExactly({ failureCode: "unknown", inputTokenCount: null, outputTokenCount: null, retryAfterAt: null, succeeded: true });
      return { outputId: durableOutput.id, status: "already_completed" as const };
    }
    const failure = getSafeAiFailure(error);
    await settleExactly({ ...failure, inputTokenCount: null, outputTokenCount: null, succeeded: false });
    return { status: "failed" as const };
  }
}

// createManualAiProcessingDependencies binds the durable owner to one server-only Supabase admin client.
function createManualAiProcessingDependencies(): ManualAiProcessingDependencies {
  const admin = createAdminClient();
  return {
    claimJob: (identity, leaseToken) => claimManualAiJob(admin, identity, leaseToken),
    executeJob: (input) => executePersistedAiProcessing({ admin, ...input }),
    findOutput: (jobId, transcriptId, userId) => findManualAiOutput(admin, jobId, transcriptId, userId),
    loadTranscript: (transcriptId, userId) => loadManualAiTranscript(admin, transcriptId, userId),
    settle: (identity, leaseToken, settlement) => settleManualAiJob(admin, identity, leaseToken, settlement)
  };
}

// claimManualAiJob calls the atomic queued-only RPC with a fresh exact lease token.
async function claimManualAiJob(admin: SupabaseClient, identity: ManualAiJobIdentity, leaseToken: string) {
  const { data, error } = await admin.rpc("claim_manual_ai_job_v1", {
    p_job_id: identity.jobId,
    p_lease_token: leaseToken,
    p_now: new Date().toISOString(),
    p_transcript_id: identity.transcriptId,
    p_user_id: identity.userId
  }).returns<ClaimedManualAiJob[]>().maybeSingle();
  if (error) throw new Error("manual_ai_claim_failed");
  return data;
}

// findManualAiOutput checks the durable raw artifact before every possible provider call or settlement retry.
async function findManualAiOutput(admin: SupabaseClient, jobId: string, transcriptId: string, userId: string) {
  const { data, error } = await admin.from("ai_outputs").select("id")
    .eq("processing_job_id", jobId).eq("transcript_id", transcriptId).eq("user_id", userId).maybeSingle<{ id: string }>();
  if (error) throw new Error("manual_ai_output_check_failed");
  return data;
}

// loadManualAiTranscript reloads the exact owner-scoped transcript after the queued job is claimed.
async function loadManualAiTranscript(admin: SupabaseClient, transcriptId: string, userId: string) {
  const { data, error } = await admin.from("transcripts").select("id,raw_text,segments,speakers,user_id")
    .eq("id", transcriptId).eq("user_id", userId).maybeSingle<{
      id: string; raw_text: string; segments: unknown; speakers: unknown; user_id: string;
    }>();
  if (error || !data) return null;
  return { id: data.id, rawText: data.raw_text, segments: data.segments, speakers: data.speakers, userId: data.user_id };
}

// settleManualAiJob invokes exact-token settlement and treats both RPC error and false as failure.
async function settleManualAiJob(
  admin: SupabaseClient,
  identity: ManualAiJobIdentity,
  leaseToken: string,
  settlement: ManualSettlement
) {
  const { data, error } = await admin.rpc("settle_manual_ai_job_v1", {
    p_failure_code: settlement.succeeded ? null : settlement.failureCode,
    p_input_token_count: settlement.inputTokenCount,
    p_job_id: identity.jobId,
    p_lease_token: leaseToken,
    p_now: new Date().toISOString(),
    p_output_token_count: settlement.outputTokenCount,
    p_retry_after_at: settlement.retryAfterAt,
    p_succeeded: settlement.succeeded,
    p_transcript_id: identity.transcriptId,
    p_user_id: identity.userId
  });
  if (error) throw new Error("manual_ai_settlement_failed");
  return data === true;
}
