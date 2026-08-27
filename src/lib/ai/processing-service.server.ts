import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePossibleJson, type AiProviderProcessingResult } from "@/lib/ai/common";
import { runGeminiProcessing } from "@/lib/ai/gemini";
import { runOpenAIProcessing } from "@/lib/ai/openai";
import {
  persistCompletedAiProcessing,
  type CompletedAiProcessingInput,
  type ProcessingPersistenceDependencies
} from "@/lib/ai/process-route-orchestration";
import { getAiProviderConfigurationError } from "@/lib/env.server";
import type { AiProviderId } from "@/lib/model-options";
import { buildAiTranscriptPromptContext } from "@/lib/transcripts/ai-context";
import { getTranscriptSpeakerContext } from "@/lib/transcripts/speakers";

export type PersistedAiProcessingJob = {
  id: string;
  model: string;
  outputSchemaSnapshot: unknown;
  promptTextSnapshot: string;
  provider: AiProviderId;
  providerConfig: Record<string, unknown>;
};

export type PersistedAiTranscript = {
  id: string;
  rawText: string;
  segments: unknown;
  speakers: unknown;
  userId: string;
};

type RunProvider = (input: {
  model: string;
  outputSchema: unknown;
  prompt: string;
  provider: AiProviderId;
  providerConfig: Record<string, unknown>;
  temperature: number;
}) => Promise<AiProviderProcessingResult>;

type PersistCompleted = (
  input: CompletedAiProcessingInput,
  dependencies?: ProcessingPersistenceDependencies
) => Promise<unknown>;

type ProcessingServiceDependencies = {
  persistCompleted?: PersistCompleted;
  runProvider?: RunProvider;
};

// getSafeProviderErrorDetail exposes provider setup/model errors without credentials.
export function getSafeProviderErrorDetail(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  return error.message
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/AIza[0-9A-Za-z_-]+/g, "AIza***");
}

// getAiProviderFailureMessage maps provider failures to stable Czech UI copy.
export function getAiProviderFailureMessage(provider: AiProviderId) {
  return provider === "gemini"
    ? "Gemini zpracování selhalo. Zkontrolujte GEMINI_API_KEY, dostupnost modelu v Google AI účtu nebo zvolte OpenAI model."
    : "OpenAI zpracování selhalo. Zkontrolujte OPENAI_API_KEY, dostupnost modelu nebo zkuste jiný model.";
}

// renderPersistedPrompt fills only the immutable prompt snapshot with persisted transcript context.
export function renderPersistedPrompt(input: {
  metadata: Record<string, unknown>;
  promptText: string;
  speakerContext: unknown;
  transcriptSegments: unknown;
  transcriptText: string;
}) {
  const metadataJson = JSON.stringify(input.metadata);
  const speakersJson = JSON.stringify(input.speakerContext ?? []);
  const segmentsJson = JSON.stringify(input.transcriptSegments ?? []);

  return input.promptText
    .replaceAll("{{raw_text}}", input.transcriptText)
    .replaceAll("{{transcript_text}}", input.transcriptText)
    .replaceAll("{{transcript}}", input.transcriptText)
    .replaceAll("{{segments}}", segmentsJson)
    .replaceAll("{{transcript_segments}}", segmentsJson)
    .replaceAll("{{speakers}}", speakersJson)
    .replaceAll("{{metadata}}", metadataJson)
    .replaceAll("{{custom_prompt}}", "");
}

// runConfiguredProvider dispatches through the snapshot provider after server configuration checks.
async function runConfiguredProvider(input: Parameters<RunProvider>[0]) {
  const configurationError = getAiProviderConfigurationError(input.provider);

  if (configurationError) {
    throw new Error(configurationError);
  }

  const reasoningEffort = input.providerConfig.reasoning_effort;
  const thinkingLevel = input.providerConfig.thinking_level;

  return input.provider === "gemini"
    ? runGeminiProcessing({
      ...input,
      thinkingLevel: thinkingLevel === "medium" || thinkingLevel === "high"
        ? thinkingLevel
        : thinkingLevel === null ? null : undefined
    })
    : runOpenAIProcessing({
      ...input,
      reasoningEffort: reasoningEffort === "high" || reasoningEffort === "xhigh"
        ? reasoningEffort
        : reasoningEffort === null ? null : undefined
    });
}

// executePersistedAiProcessing runs and persists one already-created immutable AI job snapshot.
export async function executePersistedAiProcessing(
  input: {
    admin: SupabaseClient;
    completeJob?: ProcessingPersistenceDependencies["completeJob"];
    job: PersistedAiProcessingJob;
    metadata?: Record<string, unknown>;
    temperature?: number;
    transcript: PersistedAiTranscript;
  },
  dependencies: ProcessingServiceDependencies = {}
) {
  const speakerContext = getTranscriptSpeakerContext(
    input.transcript.speakers,
    input.transcript.segments
  );
  const transcriptPromptContext = buildAiTranscriptPromptContext(
    input.transcript.segments,
    input.transcript.speakers
  );
  const prompt = renderPersistedPrompt({
    metadata: {
      ...(input.metadata ?? {}),
      transcript_segments_compacted: true,
      transcript_segments_truncated: transcriptPromptContext.truncated,
      transcript_tokens_seen: transcriptPromptContext.total_tokens_seen,
      speaker_context: speakerContext,
      speaker_context_used: speakerContext.length > 0
    },
    promptText: input.job.promptTextSnapshot,
    speakerContext,
    transcriptSegments: transcriptPromptContext.segments,
    transcriptText: input.transcript.rawText
  });
  const result = await (dependencies.runProvider ?? runConfiguredProvider)({
    model: input.job.model,
    outputSchema: input.job.outputSchemaSnapshot,
    prompt,
    provider: input.job.provider,
    providerConfig: input.job.providerConfig,
    temperature: input.temperature ?? 0.2
  });
  const persistenceInput: CompletedAiProcessingInput = {
    admin: input.admin,
    inputTokenCount: result.inputTokenCount,
    jobId: input.job.id,
    outputJson: input.job.outputSchemaSnapshot ? parsePossibleJson(result.outputText) : null,
    outputText: result.outputText,
    outputTokenCount: result.outputTokenCount,
    transcriptId: input.transcript.id,
    transcriptSegments: input.transcript.segments,
    userId: input.transcript.userId
  };
  const persist = dependencies.persistCompleted ?? persistCompletedAiProcessing;

  return input.completeJob
    ? persist(persistenceInput, { completeJob: input.completeJob })
    : persist(persistenceInput);
}
