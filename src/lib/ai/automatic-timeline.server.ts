import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executePersistedAiProcessing } from "@/lib/ai/processing-service.server";
import { getAiModelOption, type AiProviderId } from "@/lib/model-options";
import {
  getUserSettingsFromMetadata,
  hasAutomaticTimelineConsent
} from "@/lib/settings/metadata";

const AUTOMATIC_TIMELINE_LEASE_SECONDS = 900;
const AUTOMATIC_TIMELINE_PROCESSING_TYPE = "timeline_chapters";
const AUTOMATIC_TIMELINE_SAFE_ERROR = "Automatické vytvoření časové osy selhalo.";

type AutomaticTimelineGenerationInput =
  | { kind: "async"; transcriptionJobId: string }
  | { jobIds: string[]; kind: "segmented" }
  | { kind: "import" | "live"; transcriptId: string };

type AutomaticTimelineGenerationKind = AutomaticTimelineGenerationInput["kind"];

type AutomaticTimelineJobRow = {
  attempt_count: number;
  automatic_idempotency_key: string;
  id: string;
  lease_token: string | null;
  max_attempts: number;
  model: string;
  prompt_output_schema_snapshot: unknown;
  prompt_text_snapshot: string;
  provider: AiProviderId;
  provider_config: Record<string, unknown> | null;
  status: "cancelled" | "done" | "failed" | "queued" | "running";
  transcript_id: string;
  user_id: string;
};

type AutomaticTimelineIntentRow = {
  automatic_idempotency_key: string;
  consent_snapshot: true;
  created_at: string;
  id: string;
  model: string;
  prompt_id: string;
  prompt_name_snapshot: string;
  prompt_output_schema_snapshot: unknown;
  prompt_override_id: string | null;
  prompt_revision_snapshot: number | null;
  prompt_source: "system" | "user_override";
  prompt_text_snapshot: string;
  provider: AiProviderId;
  provider_config: Record<string, unknown> | null;
  transcript_id: string;
  user_id: string;
};

type EnqueueAutomaticTimelineJobInput = {
  idempotencyKey: string;
  model: string;
  outputSchemaSnapshot: unknown;
  overrideId: string | null;
  promptId: string;
  promptNameSnapshot: string;
  promptRevisionSnapshot: number | null;
  promptSource: "system" | "user_override";
  promptTextSnapshot: string;
  provider: AiProviderId;
  providerConfig: Record<string, unknown>;
  transcriptId: string;
  userId: string;
};

type AutomaticTimelineResult = {
  status:
    | "busy"
    | "done"
    | "already_done"
    | "failed"
    | "not_scheduled"
    | "terminal_failed";
};

type CompletionTransitionRow = {
  automatic_timeline_scheduled: boolean;
  is_new_generation: boolean;
  transcript_id: string;
};

type CompleteGenerationInput = {
  admin: SupabaseClient;
  automaticTimelineEnabled: boolean;
  completionGenerationKey: string;
  durationSeconds: number | null;
  generationKind: AutomaticTimelineGenerationKind;
  model: string;
  provider: AiProviderId;
  providerConfig: Record<string, unknown>;
  transcriptId: string;
  transcriptionJobId: string | null;
  userId: string;
};

type CompletionDependencies = {
  completeGeneration?: (
    input: CompleteGenerationInput
  ) => Promise<CompletionTransitionRow>;
};

type ReconcileDependencies = {
  claimJob?: (
    input: { admin: SupabaseClient; jobId: string; leaseToken: string; now: string }
  ) => Promise<AutomaticTimelineJobRow | null>;
  executeJob?: typeof executePersistedAiProcessing;
  enqueueJob?: (
    input: EnqueueAutomaticTimelineJobInput,
    admin: SupabaseClient
  ) => Promise<AutomaticTimelineJobRow>;
  findIntent?: (
    input: { admin: SupabaseClient; transcriptId: string; userId: string }
  ) => Promise<AutomaticTimelineIntentRow | null>;
  findJob?: (
    input: { admin: SupabaseClient; jobId?: string; transcriptId: string; userId: string }
  ) => Promise<AutomaticTimelineJobRow | null>;
  findOutput?: (
    input: { admin: SupabaseClient; jobId: string; userId: string }
  ) => Promise<{ id: string } | null>;
  loadTranscript?: (
    input: { admin: SupabaseClient; transcriptId: string; userId: string }
  ) => Promise<{
    id: string;
    rawText: string;
    segments: unknown;
    speakers: unknown;
    userId: string;
  }>;
  settleJob?: (
    input: {
      admin: SupabaseClient;
      errorMessage: string | null;
      inputTokenCount: number | null;
      jobId: string;
      leaseToken: string;
      outputTokenCount: number | null;
      succeeded: boolean;
    }
  ) => Promise<boolean>;
};

// createAutomaticTimelineGenerationIdentity derives one stable authority-backed generation identity.
export function createAutomaticTimelineGenerationIdentity(input: AutomaticTimelineGenerationInput) {
  if (input.kind === "segmented") {
    const digest = createHash("sha256")
      .update([...new Set(input.jobIds)].sort().join("\n"), "utf8")
      .digest("hex");

    return `segmented:${digest}`;
  }

  if ("transcriptId" in input) {
    return `${input.kind}:${input.transcriptId}`;
  }

  return `${input.kind}:${input.transcriptionJobId}`;
}

// createAutomaticTimelineIdempotencyKey hides the persisted generation identity behind a stable digest.
export function createAutomaticTimelineIdempotencyKey(generationIdentity: string) {
  const digest = createHash("sha256")
    .update(`vosio:auto-timeline:v1\n${generationIdentity}`, "utf8")
    .digest("hex");

  return `atl_v1_${digest}`;
}

// enqueueAutomaticTimelineJob persists one exact snapshot through the service-role-only RPC.
async function enqueueAutomaticTimelineJob(
  input: EnqueueAutomaticTimelineJobInput,
  admin: SupabaseClient
) {
  const { data, error } = await admin
    .rpc("enqueue_automatic_timeline_job_v1", {
      p_automatic_idempotency_key: input.idempotencyKey,
      p_model: input.model,
      p_prompt_id: input.promptId,
      p_prompt_name_snapshot: input.promptNameSnapshot,
      p_prompt_output_schema_snapshot: input.outputSchemaSnapshot,
      p_prompt_override_id: input.overrideId,
      p_prompt_revision_snapshot: input.promptRevisionSnapshot,
      p_prompt_source: input.promptSource,
      p_prompt_text_snapshot: input.promptTextSnapshot,
      p_provider: input.provider,
      p_provider_config: input.providerConfig,
      p_transcript_id: input.transcriptId,
      p_user_id: input.userId
    })
    .returns<AutomaticTimelineJobRow[]>()
    .single();

  if (error || !data) {
    throw new Error("Automatickou časovou osu se nepodařilo zařadit.");
  }

  return data;
}

// completeTranscriptGeneration persists completion, generation arbitration and exact prompt intent atomically.
async function completeTranscriptGeneration(input: CompleteGenerationInput) {
  const { data, error } = await input.admin
    .rpc("complete_transcript_generation_v1", {
      p_automatic_timeline_enabled: input.automaticTimelineEnabled,
      p_completion_generation_key: input.completionGenerationKey,
      p_duration_seconds: input.durationSeconds,
      p_generation_kind: input.generationKind,
      p_model: input.model,
      p_provider: input.provider,
      p_provider_config: input.providerConfig,
      p_transcript_id: input.transcriptId,
      p_transcription_job_id: input.transcriptionJobId,
      p_user_id: input.userId
    })
    .returns<CompletionTransitionRow[]>()
    .single();

  if (error || !data) {
    throw new Error("Dokončení přepisu se nepodařilo atomicky uložit.");
  }

  return data;
}

// persistTranscriptCompletionTransition snapshots consent/config in the sole completion transition.
export async function persistTranscriptCompletionTransition(
  input: {
    admin: SupabaseClient;
    durationSeconds: number | null;
    generationIdentity: string;
    generationKind: AutomaticTimelineGenerationKind;
    transcriptId: string;
    transcriptionJobId: string | null;
    user: User;
  },
  dependencies: CompletionDependencies = {}
) {
  const settings = getUserSettingsFromMetadata(input.user.user_metadata);
  const model = settings.defaultOpenaiModel;
  const modelOption = getAiModelOption(model);
  const provider = modelOption?.provider ?? "openai";
  const providerConfig = {
    provider,
    reasoning_effort: modelOption?.reasoningEffort ?? null,
    thinking_level: modelOption?.geminiThinkingLevel ?? null
  };

  return (dependencies.completeGeneration ?? completeTranscriptGeneration)({
    admin: input.admin,
    automaticTimelineEnabled: hasAutomaticTimelineConsent(input.user.user_metadata),
    completionGenerationKey: createAutomaticTimelineIdempotencyKey(input.generationIdentity),
    durationSeconds: input.durationSeconds,
    generationKind: input.generationKind,
    model,
    provider,
    providerConfig,
    transcriptId: input.transcriptId,
    transcriptionJobId: input.transcriptionJobId,
    userId: input.user.id
  });
}

// findAutomaticTimelineIntent returns only a durable completion-time opt-in snapshot.
async function findAutomaticTimelineIntent(input: {
  admin: SupabaseClient;
  transcriptId: string;
  userId: string;
}) {
  const { data, error } = await input.admin
    .from("automatic_timeline_intents")
    .select("id,transcript_id,user_id,automatic_idempotency_key,consent_snapshot,provider,model,prompt_id,prompt_override_id,prompt_source,prompt_name_snapshot,prompt_text_snapshot,prompt_output_schema_snapshot,prompt_revision_snapshot,provider_config,created_at")
    .eq("transcript_id", input.transcriptId)
    .eq("user_id", input.userId)
    .eq("consent_snapshot", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Trvalý záměr automatické časové osy se nepodařilo načíst.");
  }

  return data as AutomaticTimelineIntentRow | null;
}

// getAutomaticTimelineJobInput restores the exact immutable job snapshot from durable intent.
function getAutomaticTimelineJobInput(intent: AutomaticTimelineIntentRow) {
  return {
    idempotencyKey: intent.automatic_idempotency_key,
    model: intent.model,
    outputSchemaSnapshot: intent.prompt_output_schema_snapshot,
    overrideId: intent.prompt_override_id,
    promptId: intent.prompt_id,
    promptNameSnapshot: intent.prompt_name_snapshot,
    promptRevisionSnapshot: intent.prompt_revision_snapshot,
    promptSource: intent.prompt_source,
    promptTextSnapshot: intent.prompt_text_snapshot,
    provider: intent.provider,
    providerConfig: intent.provider_config ?? {},
    transcriptId: intent.transcript_id,
    userId: intent.user_id
  } satisfies EnqueueAutomaticTimelineJobInput;
}

// findAutomaticTimelineJob returns only the owner-scoped automatic timeline idempotency record.
async function findAutomaticTimelineJob(input: {
  admin: SupabaseClient;
  jobId?: string;
  transcriptId: string;
  userId: string;
}) {
  let query = input.admin
    .from("ai_processing_jobs")
    .select("id,transcript_id,user_id,provider,model,provider_config,status,prompt_text_snapshot,prompt_output_schema_snapshot,automatic_idempotency_key,attempt_count,max_attempts,lease_token")
    .eq("transcript_id", input.transcriptId)
    .eq("user_id", input.userId)
    .eq("execution_mode", "automatic")
    .eq("processing_type", AUTOMATIC_TIMELINE_PROCESSING_TYPE);

  if (input.jobId) {
    query = query.eq("id", input.jobId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Automatickou časovou osu se nepodařilo načíst.");
  }

  return data as AutomaticTimelineJobRow | null;
}

// claimAutomaticTimelineJob atomically claims a queued/retry job or one deterministic stale lease.
async function claimAutomaticTimelineJob(input: {
  admin: SupabaseClient;
  jobId: string;
  leaseToken: string;
  now: string;
}) {
  const { data, error } = await input.admin
    .rpc("claim_automatic_timeline_job_v1", {
      p_job_id: input.jobId,
      p_lease_seconds: AUTOMATIC_TIMELINE_LEASE_SECONDS,
      p_lease_token: input.leaseToken,
      p_now: input.now
    })
    .returns<AutomaticTimelineJobRow[]>()
    .maybeSingle();

  if (error) {
    throw new Error("Automatickou časovou osu se nepodařilo převzít.");
  }

  return data;
}

// findAutomaticTimelineOutput detects a durable output before any retry provider call.
async function findAutomaticTimelineOutput(input: {
  admin: SupabaseClient;
  jobId: string;
  userId: string;
}) {
  const { data, error } = await input.admin
    .from("ai_outputs")
    .select("id")
    .eq("processing_job_id", input.jobId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new Error("Automatický AI výstup se nepodařilo ověřit.");
  }

  return data;
}

// loadAutomaticTimelineTranscript loads persisted provider input only after the owner job is claimed.
async function loadAutomaticTimelineTranscript(input: {
  admin: SupabaseClient;
  transcriptId: string;
  userId: string;
}) {
  const { data, error } = await input.admin
    .from("transcripts")
    .select("id,raw_text,segments,speakers,user_id")
    .eq("id", input.transcriptId)
    .eq("user_id", input.userId)
    .single();

  if (error || !data) {
    throw new Error("Přepis pro automatickou časovou osu nebyl nalezen.");
  }

  return {
    id: data.id,
    rawText: data.raw_text,
    segments: data.segments,
    speakers: data.speakers,
    userId: data.user_id
  };
}

// settleAutomaticTimelineJob settles only the current lease and never exposes provider details.
async function settleAutomaticTimelineJob(input: {
  admin: SupabaseClient;
  errorMessage: string | null;
  inputTokenCount: number | null;
  jobId: string;
  leaseToken: string;
  outputTokenCount: number | null;
  succeeded: boolean;
}) {
  const { data, error } = await input.admin.rpc("settle_automatic_timeline_job_v1", {
    p_error_message: input.errorMessage,
    p_input_token_count: input.inputTokenCount,
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_now: new Date().toISOString(),
    p_output_token_count: input.outputTokenCount,
    p_succeeded: input.succeeded
  });

  if (error) {
    throw new Error("Automatickou časovou osu se nepodařilo uzavřít.");
  }

  return data === true;
}

// reconcileAutomaticTimeline recovers a missing job from durable intent, then resumes bounded execution.
export async function reconcileAutomaticTimeline(
  input: {
    admin: SupabaseClient;
    jobId?: string;
    transcriptId: string;
    userId: string;
  },
  dependencies: ReconcileDependencies = {}
): Promise<AutomaticTimelineResult> {
  const findJob = dependencies.findJob ?? findAutomaticTimelineJob;
  let job = await findJob(input);

  if (!job) {
    const findIntent = dependencies.findIntent ?? findAutomaticTimelineIntent;
    const intent = await findIntent({
      admin: input.admin,
      transcriptId: input.transcriptId,
      userId: input.userId
    });

    if (!intent) {
      return { status: "not_scheduled" };
    }

    const enqueueJob = dependencies.enqueueJob ?? enqueueAutomaticTimelineJob;
    job = await enqueueJob(getAutomaticTimelineJobInput(intent), input.admin);
  }

  if (job.status === "done" || job.status === "cancelled") {
    return { status: "already_done" };
  }

  if (job.status === "failed" && job.attempt_count >= job.max_attempts) {
    return { status: "terminal_failed" };
  }

  const leaseToken = randomUUID();
  const claimJob = dependencies.claimJob ?? claimAutomaticTimelineJob;
  const claimed = await claimJob({
    admin: input.admin,
    jobId: job.id,
    leaseToken,
    now: new Date().toISOString()
  });

  if (!claimed) {
    return job.status === "failed" && job.attempt_count >= job.max_attempts
      ? { status: "terminal_failed" }
      : { status: "busy" };
  }

  const findOutput = dependencies.findOutput ?? findAutomaticTimelineOutput;
  const settleJob = dependencies.settleJob ?? settleAutomaticTimelineJob;
  const existingOutput = await findOutput({
    admin: input.admin,
    jobId: claimed.id,
    userId: input.userId
  });

  if (existingOutput) {
    await settleJob({
      admin: input.admin,
      errorMessage: null,
      inputTokenCount: null,
      jobId: claimed.id,
      leaseToken,
      outputTokenCount: null,
      succeeded: true
    });
    return { status: "done" };
  }

  try {
    const loadTranscript = dependencies.loadTranscript ?? loadAutomaticTimelineTranscript;
    const transcript = await loadTranscript({
      admin: input.admin,
      transcriptId: input.transcriptId,
      userId: input.userId
    });
    const executeJob = dependencies.executeJob ?? executePersistedAiProcessing;

    await executeJob({
      admin: input.admin,
      completeJob: async (_admin, jobId, usage) => {
        const settled = await settleJob({
          admin: input.admin,
          errorMessage: null,
          inputTokenCount: usage.inputTokenCount,
          jobId,
          leaseToken,
          outputTokenCount: usage.outputTokenCount,
          succeeded: true
        });

        if (!settled) {
          throw new Error("Automatický AI job ztratil lease před settlementem.");
        }
      },
      job: {
        id: claimed.id,
        model: claimed.model,
        outputSchemaSnapshot: claimed.prompt_output_schema_snapshot,
        promptTextSnapshot: claimed.prompt_text_snapshot,
        provider: claimed.provider,
        providerConfig: claimed.provider_config ?? {}
      },
      metadata: { automatic_timeline: true },
      transcript
    });

    return { status: "done" };
  } catch {
    const durableOutput = await findOutput({
      admin: input.admin,
      jobId: claimed.id,
      userId: input.userId
    });

    if (durableOutput) {
      await settleJob({
        admin: input.admin,
        errorMessage: null,
        inputTokenCount: null,
        jobId: claimed.id,
        leaseToken,
        outputTokenCount: null,
        succeeded: true
      });
      return { status: "done" };
    }

    await settleJob({
      admin: input.admin,
      errorMessage: AUTOMATIC_TIMELINE_SAFE_ERROR,
      inputTokenCount: null,
      jobId: claimed.id,
      leaseToken,
      outputTokenCount: null,
      succeeded: false
    });

    return claimed.attempt_count >= claimed.max_attempts
      ? { status: "terminal_failed" }
      : { status: "failed" };
  }
}
