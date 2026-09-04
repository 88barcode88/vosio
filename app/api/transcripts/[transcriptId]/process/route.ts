import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { runManualAiJob } from "@/lib/ai/manual-processing.server";
import { getSafeProviderErrorDetail } from "@/lib/ai/processing-service.server";
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
  status: "queued" | "running" | "done" | "failed";
  transcript_id: string;
  user_id: string;
};

// routeErrorResponse returns safe AI processing errors without logging transcript content.
function routeErrorResponse(error: unknown, fallbackMessage: string, status = 500) {
  const detail = getSafeProviderErrorDetail(error);
  if (error instanceof Error) console.error("[Vosio AI processing]", error.message);
  return NextResponse.json({ detail, error: fallbackMessage }, { status });
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
    .select("id,status,transcript_id,user_id,execution_mode,processing_type,model").eq("id", jobId).maybeSingle<ExistingJob>();
  return data;
}

// acceptedJobResponse returns the durable status envelope used by initial and retried transport calls.
function acceptedJobResponse(job: Pick<ExistingJob, "id" | "status">) {
  return NextResponse.json({ job: { id: job.id, status: job.status } }, { status: 202 });
}

// isSameAcceptedRequest rejects UUID reuse for a different manual request identity.
function isSameAcceptedRequest(
  job: ExistingJob,
  input: { model: string; processingType: string; transcriptId: string; userId: string }
) {
  return job.execution_mode === "manual"
    && job.user_id === input.userId
    && job.transcript_id === input.transcriptId
    && job.model === input.model
    && job.processing_type === input.processingType;
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
      return isSameAcceptedRequest(existingJob, {
        model: requestedModel,
        processingType: body.data.processingType,
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

    const requestedModelOption = getAiModelOption(requestedModel);
    const requestedProvider = getAiProviderForModel(requestedModel);
    const providerConfigurationError = getAiProviderConfigurationError(requestedProvider);
    if (providerConfigurationError) {
      return NextResponse.json({ error: providerConfigurationError }, { status: 503 });
    }

    const promptTemplate = await resolveEffectivePrompt(body.data.processingType);
    const providerConfig = {
      provider: requestedProvider,
      response_format: promptTemplate.output_schema ? "json_schema" : "text",
      ...(requestedModelOption?.reasoningEffort ? { reasoning_effort: requestedModelOption.reasoningEffort } : {}),
      ...(requestedModelOption?.geminiThinkingLevel ? { thinking_level: requestedModelOption.geminiThinkingLevel } : {})
    };
    const admin = createAdminClient();
    const { data: job, error: jobError } = await admin.from("ai_processing_jobs").insert({
      execution_mode: "manual",
      id: body.data.requestId,
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
      started_at: null,
      status: "queued",
      transcript_id: transcript.id,
      user_id: user.id
    }).select("id").single();

    if (jobError || !job) {
      const racedJob = await findExistingJob(body.data.requestId);
      if (racedJob && isSameAcceptedRequest(racedJob, {
        model: requestedModel,
        processingType: body.data.processingType,
        transcriptId: transcript.id,
        userId: user.id
      })) {
        return acceptedJobResponse(racedJob);
      }
      console.error("[Vosio AI processing] job_insert_failed");
      return NextResponse.json({ error: "Nepodařilo se založit AI zpracování." }, { status: 500 });
    }

    try {
      after(() => runManualAiJob({
        jobId: job.id,
        metadata: body.data.metadata,
        temperature: body.data.temperature ?? 0.2,
        transcriptId: transcript.id,
        userId: user.id
      }));
    } catch {
      await admin.from("ai_processing_jobs").update({
        completed_at: new Date().toISOString(),
        error_message: "AI zpracování se nepodařilo naplánovat.",
        status: "failed"
      }).eq("id", job.id).eq("user_id", user.id).eq("transcript_id", transcript.id).eq("status", "queued");
      return NextResponse.json({ error: "AI zpracování se nepodařilo naplánovat." }, { status: 500 });
    }

    return NextResponse.json({ job: { id: job.id, status: "queued" } }, { status: 202 });
  } catch (error) {
    return routeErrorResponse(error, "Nepodařilo se zpracovat přepis přes AI.");
  }
}
