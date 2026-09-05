import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runManualAiJob } from "@/lib/ai/manual-processing.server";
import { getAiProviderConfigurationError } from "@/lib/env.server";
import { aiModelIds, DEFAULT_AI_MODEL_ID, getAiModelOption, type AiProviderId } from "@/lib/model-options";
import {
  quickPromptProcessingTypes,
  type EffectivePromptRpcRow,
  type QuickPromptProcessingType,
} from "@/lib/prompt-templates/effective";
import { createRateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({ transcriptId: z.uuid() });
// Next requires a statically analyzable literal; the runtime contract test locks it to the shared budget.
export const maxDuration = 300;
const aiProcessingRateLimit = createRateLimiter({ limit: 10, windowMs: 60_000 });
const requestBodySchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
  model: z.enum(aiModelIds).optional(),
  processingType: z.enum(quickPromptProcessingTypes),
  requestId: z.uuid(),
  temperature: z.number().min(0).max(2).optional()
});

type RouteContext = { params: Promise<{ transcriptId: string }> };
type ExistingJob = {
  execution_mode: string;
  id: string;
  model: string;
  processing_type: string;
  prompt_output_schema_snapshot: unknown;
  provider: AiProviderId;
  provider_config: unknown;
  status: "queued" | "running" | "done" | "failed";
  transcript_id: string;
  user_id: string;
};

// routeErrorResponse returns safe AI processing errors without logging transcript content.
function routeErrorResponse(_error: unknown, fallbackMessage: string, status = 500) {
  console.error("[Vosio AI processing] request_failed");
  return NextResponse.json({ error: fallbackMessage }, { status });
}

// getAiProviderForModel resolves an allowed app model to its provider adapter.
function getAiProviderForModel(modelId: string): AiProviderId {
  return getAiModelOption(modelId)?.provider ?? "openai";
}

// getAuthenticatedTranscript verifies ownership through the request-scoped RLS client.
async function getAuthenticatedTranscript(transcriptId: string) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 }) };
  }

  const { data: transcript, error: transcriptError } = await supabase
    .from("transcripts").select("id,user_id").eq("id", transcriptId).eq("user_id", user.id).single();
  if (transcriptError || !transcript) {
    return { error: NextResponse.json({ error: "Přepis nebyl nalezen." }, { status: 404 }) };
  }
  return { transcript, user };
}

// resolveEffectivePrompt loads owner-specific text with the authoritative system schema through RLS.
async function resolveEffectivePrompt(processingType: QuickPromptProcessingType) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("resolve_effective_prompt_template_v1", { p_processing_type: processingType })
    .returns<EffectivePromptRpcRow[]>().single();
  if (error || !data) throw new Error("Prompt šablona nebyla nalezena.");
  return data;
}

// findExistingJob resolves retry identity before rate limiting or provider work.
async function findExistingJob(jobId: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("ai_processing_jobs")
    .select("id,status,transcript_id,user_id,execution_mode,processing_type,model,prompt_output_schema_snapshot,provider,provider_config")
    .eq("id", jobId).maybeSingle<ExistingJob>();
  return data;
}

// acceptedJobResponse returns the durable status envelope used by initial and retried transport calls.
function acceptedJobResponse(job: Pick<ExistingJob, "id" | "status">) {
  return NextResponse.json({ job: { id: job.id, status: job.status } }, { status: 202 });
}

// canonicalizeJson sorts object keys recursively so JSONB identity is independent of key order.
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalizeJson(child)]));
}

// hasSameJsonValue compares only normalized JSON values and never includes their contents in an error.
function hasSameJsonValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalizeJson(left)) === JSON.stringify(canonicalizeJson(right));
}

// createProviderConfigSnapshot normalizes every durable provider input supported by this route.
function createProviderConfigSnapshot(input: {
  metadata: Record<string, unknown>;
  model: string;
  outputSchema: unknown;
  temperature: number;
}) {
  const modelOption = getAiModelOption(input.model);
  const provider = getAiProviderForModel(input.model);
  return {
    metadata: input.metadata,
    provider,
    response_format: input.outputSchema ? "json_schema" : "text",
    temperature: input.temperature,
    ...(modelOption?.reasoningEffort ? { reasoning_effort: modelOption.reasoningEffort } : {}),
    ...(modelOption?.geminiThinkingLevel ? { thinking_level: modelOption.geminiThinkingLevel } : {})
  };
}

// isSameAcceptedRequest rejects UUID reuse for a different manual request identity.
function isSameAcceptedRequest(
  job: ExistingJob,
  input: {
    model: string;
    processingType: string;
    providerConfig: Record<string, unknown>;
    transcriptId: string;
    userId: string;
  }
) {
  return job.execution_mode === "manual"
    && job.user_id === input.userId
    && job.transcript_id === input.transcriptId
    && job.model === input.model
    && job.processing_type === input.processingType
    && job.provider === input.providerConfig.provider
    && hasSameJsonValue(job.provider_config, input.providerConfig);
}

// POST durably accepts one idempotent manual AI job and releases provider work to Next after().
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = routeParamsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ error: "Neplatné ID přepisu." }, { status: 400 });
    const body = requestBodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: "Neplatný požadavek na AI zpracování." }, { status: 400 });
    }

    const authenticated = await getAuthenticatedTranscript(params.data.transcriptId);
    if (authenticated.error) return authenticated.error;
    const { transcript, user } = authenticated;
    const requestedModel = body.data.model ?? DEFAULT_AI_MODEL_ID;
    const existingJob = await findExistingJob(body.data.requestId);
    if (existingJob) {
      const providerConfig = createProviderConfigSnapshot({
        metadata: body.data.metadata ?? {},
        model: requestedModel,
        outputSchema: existingJob.prompt_output_schema_snapshot,
        temperature: body.data.temperature ?? 0.2
      });
      return isSameAcceptedRequest(existingJob, {
        model: requestedModel,
        processingType: body.data.processingType,
        providerConfig,
        transcriptId: transcript.id,
        userId: user.id
      })
        ? acceptedJobResponse(existingJob)
        : NextResponse.json({ error: "Požadavek nelze přijmout." }, { status: 409 });
    }

    const rateLimit = aiProcessingRateLimit(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Příliš mnoho AI požadavků za sebou. Zkuste to za chvíli." },
        { headers: { "Retry-After": String(rateLimit.retryAfterSeconds) }, status: 429 }
      );
    }

    const requestedProvider = getAiProviderForModel(requestedModel);
    const providerConfigurationError = getAiProviderConfigurationError(requestedProvider);
    if (providerConfigurationError) {
      return NextResponse.json({ error: providerConfigurationError }, { status: 503 });
    }

    const promptTemplate = await resolveEffectivePrompt(body.data.processingType);
    const providerConfig = createProviderConfigSnapshot({
      metadata: body.data.metadata ?? {},
      model: requestedModel,
      outputSchema: promptTemplate.output_schema,
      temperature: body.data.temperature ?? 0.2,
    });
    const admin = createAdminClient();
    const { data: job, error: jobError } = await admin.from("ai_processing_jobs").insert({
      attempt_count: 0,
      execution_mode: "manual",
      failure_code: null,
      id: body.data.requestId,
      lease_expires_at: null,
      lease_token: null,
      max_attempts: 1,
      model: requestedModel,
      processing_type: body.data.processingType,
      prompt_id: promptTemplate.system_prompt_id,
      prompt_override_id: promptTemplate.override_id,
      prompt_source: promptTemplate.source,
      prompt_name_snapshot: promptTemplate.name,
      prompt_text_snapshot: promptTemplate.prompt_text,
      prompt_output_schema_snapshot: promptTemplate.output_schema,
      prompt_revision_snapshot: promptTemplate.revision,
      prompt_snapshot_exact: true,
      provider: requestedProvider,
      provider_config: providerConfig,
      retry_after_at: null,
      started_at: null,
      status: "queued",
      transcript_id: transcript.id,
      user_id: user.id
    }).select("id").single();

    if (jobError || !job) {
      const racedJob = await findExistingJob(body.data.requestId);
      if (racedJob) {
        const racedProviderConfig = createProviderConfigSnapshot({
          metadata: body.data.metadata ?? {},
          model: requestedModel,
          outputSchema: racedJob.prompt_output_schema_snapshot,
          temperature: body.data.temperature ?? 0.2
        });
        if (isSameAcceptedRequest(racedJob, {
          model: requestedModel,
          processingType: body.data.processingType,
          providerConfig: racedProviderConfig,
          transcriptId: transcript.id,
          userId: user.id
        })) {
          return acceptedJobResponse(racedJob);
        }
        return NextResponse.json({ error: "Požadavek nelze přijmout." }, { status: 409 });
      }
      console.error("[Vosio AI processing] job_insert_failed");
      return NextResponse.json({ error: "Nepodařilo se založit AI zpracování." }, { status: 500 });
    }

    try {
      after(() => runManualAiJob({
        jobId: job.id,
        transcriptId: transcript.id,
        userId: user.id
      }));
    } catch {
      const { data: terminalizedJob, error: terminalizeError } = await admin.from("ai_processing_jobs").update({
        completed_at: new Date().toISOString(),
        error_message: null,
        failure_code: "execution_interrupted",
        status: "failed"
      }).eq("id", job.id).eq("user_id", user.id).eq("transcript_id", transcript.id).eq("status", "queued")
        .select("id").maybeSingle<{ id: string }>();
      if (terminalizeError || !terminalizedJob) {
        console.error("[Vosio AI processing] schedule_terminalization_failed");
        return NextResponse.json(
          { error: "AI zpracování se nepodařilo naplánovat ani bezpečně ukončit." },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "AI zpracování se nepodařilo naplánovat." }, { status: 500 });
    }

    return NextResponse.json({ job: { id: job.id, status: "queued" } }, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error, "Nepodařilo se zpracovat přepis přes AI.");
  }
}
