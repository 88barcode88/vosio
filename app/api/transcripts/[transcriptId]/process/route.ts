import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  executePersistedAiProcessing,
  getAiProviderFailureMessage,
  getSafeProviderErrorDetail
} from "@/lib/ai/processing-service.server";
import { getAiProviderConfigurationError } from "@/lib/env.server";
import {
  aiModelIds,
  DEFAULT_AI_MODEL_ID,
  getAiModelOption,
  type AiProviderId
} from "@/lib/model-options";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  quickPromptProcessingTypes,
  type EffectivePromptRpcRow,
  type QuickPromptProcessingType,
} from "@/lib/prompt-templates/effective";

const routeParamsSchema = z.object({
  transcriptId: z.uuid()
});

// Caps paid OpenAI/Gemini calls per user so a runaway client cannot burn provider credit.
const aiProcessingRateLimit = createRateLimiter({ limit: 10, windowMs: 60_000 });

const requestBodySchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
  model: z.enum(aiModelIds).optional(),
  processingType: z.enum(quickPromptProcessingTypes),
  temperature: z.number().min(0).max(2).optional()
});

type RouteContext = {
  params: Promise<{
    transcriptId: string;
  }>;
};

// routeErrorResponse returns safe AI processing errors without logging transcript content.
function routeErrorResponse(error: unknown, fallbackMessage: string, status = 500) {
  const detail = getSafeProviderErrorDetail(error);

  if (error instanceof Error) {
    console.error("[Vosio AI processing]", error.message);
  }

  return NextResponse.json({ detail, error: fallbackMessage }, { status });
}

// getAiProviderForModel resolves an allowed app model to its provider adapter.
function getAiProviderForModel(modelId: string): AiProviderId {
  return getAiModelOption(modelId)?.provider ?? "openai";
}

// getAuthenticatedTranscript verifies ownership and loads transcript text, segments and speakers through RLS.
async function getAuthenticatedTranscript(transcriptId: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 }) };
  }

  const { data: transcript, error: transcriptError } = await supabase
    .from("transcripts")
    .select("id,raw_text,segments,speakers,user_id")
    .eq("id", transcriptId)
    .eq("user_id", user.id)
    .single();

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
    .returns<EffectivePromptRpcRow[]>()
    .single();

  if (error || !data) {
    throw new Error("Prompt šablona nebyla nalezena.");
  }

  return data;
}

// POST processes a completed transcript through the selected AI prompt template.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = routeParamsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Neplatné ID přepisu." }, { status: 400 });
    }

    const body = requestBodySchema.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return NextResponse.json({ error: "Neplatný požadavek na AI zpracování." }, { status: 400 });
    }

    const authenticated = await getAuthenticatedTranscript(params.data.transcriptId);

    if (authenticated.error) {
      return authenticated.error;
    }

    const { transcript, user } = authenticated;
    const rateLimit = aiProcessingRateLimit(user.id);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Příliš mnoho AI požadavků za sebou. Zkuste to za chvíli." },
        { headers: { "Retry-After": String(rateLimit.retryAfterSeconds) }, status: 429 }
      );
    }

    const requestedModel = body.data.model ?? DEFAULT_AI_MODEL_ID;
    const requestedModelOption = getAiModelOption(requestedModel);
    const requestedProvider = getAiProviderForModel(requestedModel);
    const requestedTemperature = body.data.temperature ?? 0.2;
    const providerConfigurationError = getAiProviderConfigurationError(requestedProvider);

    if (providerConfigurationError) {
      return NextResponse.json({ error: providerConfigurationError }, { status: 503 });
    }

    const promptTemplate = await resolveEffectivePrompt(body.data.processingType);
    const admin = createAdminClient();
    const { data: job, error: jobError } = await admin
      .from("ai_processing_jobs")
      .insert({
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
        provider_config: {
          provider: requestedProvider,
          response_format: promptTemplate.output_schema ? "json_schema" : "text",
          ...(requestedModelOption?.reasoningEffort
            ? { reasoning_effort: requestedModelOption.reasoningEffort }
            : {}),
          ...(requestedModelOption?.geminiThinkingLevel
            ? { thinking_level: requestedModelOption.geminiThinkingLevel }
            : {})
        },
        started_at: new Date().toISOString(),
        status: "running",
        transcript_id: transcript.id,
        user_id: user.id
      })
      .select("id")
      .single();

    if (jobError || !job) {
      if (jobError) {
        console.error("[Vosio AI processing]", jobError.message);
      }

      return NextResponse.json(
        {
          error: "Nepodařilo se založit AI zpracování. Zkontrolujte, že je v Supabase aplikovaná migrace pro vybraný AI provider."
        },
        { status: 500 }
      );
    }

    try {
      const output = await executePersistedAiProcessing({
        admin,
        job: {
          id: job.id,
          model: requestedModel,
          outputSchemaSnapshot: promptTemplate.output_schema,
          promptTextSnapshot: promptTemplate.prompt_text,
          provider: requestedProvider,
          providerConfig: {
            provider: requestedProvider,
            response_format: promptTemplate.output_schema ? "json_schema" : "text",
            ...(requestedModelOption?.reasoningEffort
              ? { reasoning_effort: requestedModelOption.reasoningEffort }
              : {}),
            ...(requestedModelOption?.geminiThinkingLevel
              ? { thinking_level: requestedModelOption.geminiThinkingLevel }
              : {})
          }
        },
        metadata: body.data.metadata,
        temperature: requestedTemperature,
        transcript: {
          id: transcript.id,
          rawText: transcript.raw_text,
          segments: transcript.segments,
          speakers: transcript.speakers,
          userId: user.id
        }
      });

      return NextResponse.json({ job: { id: job.id, status: "done" }, output });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "AI zpracování selhalo.";

      await admin
        .from("ai_processing_jobs")
        .update({
          completed_at: new Date().toISOString(),
          error_message: errorMessage,
          status: "failed"
        })
        .eq("id", job.id);

      return routeErrorResponse(error, getAiProviderFailureMessage(requestedProvider), 502);
    }
  } catch (error) {
    return routeErrorResponse(error, "Nepodařilo se zpracovat přepis přes AI.");
  }
}
