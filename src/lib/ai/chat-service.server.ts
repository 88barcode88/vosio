import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRecordingChatContext } from "@/lib/ai/chat-context";
import {
  projectRecordingChatThread,
  projectRecordingChatTurn,
  type PersistedRecordingChatEvidence,
  type RecordingChatProviderResult,
  type RecordingChatThreadRow,
  type RecordingChatTurnRow
} from "@/lib/ai/chat-types";
import { parsePossibleJson } from "@/lib/ai/common";
import { runGeminiChat } from "@/lib/ai/gemini";
import { runOpenAIChat } from "@/lib/ai/openai";
import {
  getAiProviderFailureMessage,
  getSafeProviderErrorDetail
} from "@/lib/ai/processing-service.server";
import { getAiProviderConfigurationError } from "@/lib/env.server";
import { getAiModelOption, type AiProviderId } from "@/lib/model-options";
import { createRateLimiter, type RateLimitResult } from "@/lib/rate-limit";
import { resolveEvidenceLocation } from "@/lib/transcripts/evidence-location";
import { getTranscriptSpeakerContext } from "@/lib/transcripts/speakers";

export const CHAT_QUESTION_MAX_CHARS = 8_000;
export const CHAT_TURN_STALE_LEASE_MS = 10 * 60_000;
export const CHAT_RATE_LIMIT_REQUESTS = 10;
export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;

const recordingChatRateLimit = createRateLimiter({
  limit: CHAT_RATE_LIMIT_REQUESTS,
  windowMs: CHAT_RATE_LIMIT_WINDOW_MS
});

const CHAT_TURN_SELECT = "id,client_turn_id,thread_id,transcript_id,recording_id,user_id,question,status,provider,model,system_prompt_id,prompt_text_snapshot,prompt_revision_snapshot,provider_response_id,input_token_count,output_token_count,answer_markdown,verified_evidence,safe_error,started_at,completed_at,created_at,updated_at";
const CHAT_THREAD_SELECT = "id,user_id,recording_id,transcript_id,created_at,updated_at";

export type OwnedRecordingChatTranscript = {
  id: string;
  rawText: string;
  recordingId: string;
  recordingTitle: string;
  segments: unknown;
  speakers: unknown;
  userId: string;
};

export type RecordingChatSystemPrompt = {
  id: string;
  outputSchema: unknown;
  promptText: string;
  revision: number;
};

type RunningTurnValues = Omit<RecordingChatTurnRow,
  "answer_markdown" | "completed_at" | "created_at" | "id" | "input_token_count" |
  "output_token_count" | "provider_response_id" | "safe_error" | "updated_at" | "verified_evidence"
>;

export type RecordingChatStore = {
  completeTurn: (id: string, values: {
    answer_markdown: string;
    completed_at: string;
    input_token_count: number | null;
    output_token_count: number | null;
    provider_response_id: string | null;
    verified_evidence: PersistedRecordingChatEvidence[];
  }) => Promise<RecordingChatTurnRow | null>;
  createThread: (input: { recordingId: string; transcriptId: string; userId: string }) => Promise<RecordingChatThreadRow>;
  failStaleRunningTurn: (threadId: string, cutoffIso: string, completedAt: string) => Promise<RecordingChatTurnRow | null>;
  failTurn: (id: string, values: { completed_at: string; safe_error: string }) => Promise<void>;
  findTurnByClientId: (userId: string, clientTurnId: string) => Promise<RecordingChatTurnRow | null>;
  getOwnedTranscript: (userId: string, transcriptId: string) => Promise<OwnedRecordingChatTranscript | null>;
  getSystemPrompt: () => Promise<RecordingChatSystemPrompt | null>;
  getThread: (userId: string, transcriptId: string) => Promise<RecordingChatThreadRow | null>;
  insertRunningTurn: (values: RunningTurnValues) => Promise<{
    conflict: "active_turn" | "client_turn" | "unique" | null;
    turn: RecordingChatTurnRow | null;
  }>;
  listTurns: (userId: string, threadId: string) => Promise<RecordingChatTurnRow[]>;
};

type SubmitDependencies = {
  now?: () => Date;
  rateLimit?: (userId: string, nowMs?: number) => RateLimitResult;
  runProvider?: (input: {
    messages: import("@/lib/ai/chat-types").RecordingChatMessage[];
    model: string;
    outputSchema: unknown;
    provider: AiProviderId;
    systemInstruction: string;
  }) => Promise<RecordingChatProviderResult>;
  store: RecordingChatStore;
};

export class RecordingChatServiceError extends Error {
  // constructor preserves one fixed public code/message without exposing provider or transcript content.
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly publicMessage: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(publicMessage);
    this.name = "RecordingChatServiceError";
  }
}

// throwStoreError converts a database detail into a fixed message before it can cross the service boundary.
function throwStoreError(): never {
  throw new RecordingChatServiceError(
    "persistence_failed",
    500,
    "Chat se nepodařilo bezpečně uložit."
  );
}

// isUniqueViolation recognizes only the Postgres class used by both chat uniqueness guards.
function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

// createRecordingChatStore binds owner reads to the authenticated client and writes to the server-only admin client.
export function createRecordingChatStore(authenticated: SupabaseClient, admin: SupabaseClient): RecordingChatStore {
  return {
    async completeTurn(id, values) {
      const { data, error } = await admin
        .from("transcript_chat_turns")
        .update({ ...values, safe_error: null, status: "completed" })
        .eq("id", id)
        .eq("status", "running")
        .select(CHAT_TURN_SELECT)
        .maybeSingle();

      if (error) throwStoreError();
      return data as RecordingChatTurnRow | null;
    },

    async createThread(input) {
      const payload = {
        recording_id: input.recordingId,
        transcript_id: input.transcriptId,
        user_id: input.userId
      };
      const inserted = await admin
        .from("transcript_chat_threads")
        .insert(payload)
        .select(CHAT_THREAD_SELECT)
        .single();

      if (!inserted.error && inserted.data) {
        return inserted.data as RecordingChatThreadRow;
      }

      if (!isUniqueViolation(inserted.error)) throwStoreError();
      const existing = await admin
        .from("transcript_chat_threads")
        .select(CHAT_THREAD_SELECT)
        .eq("user_id", input.userId)
        .eq("transcript_id", input.transcriptId)
        .eq("recording_id", input.recordingId)
        .maybeSingle();

      if (existing.error || !existing.data) throwStoreError();
      return existing.data as RecordingChatThreadRow;
    },

    async failStaleRunningTurn(threadId, cutoffIso, completedAt) {
      const { data, error } = await admin
        .from("transcript_chat_turns")
        .update({
          completed_at: completedAt,
          safe_error: "Předchozí zpracování bylo přerušeno. Otázku můžete odeslat znovu.",
          status: "failed"
        })
        .eq("thread_id", threadId)
        .eq("status", "running")
        .lt("started_at", cutoffIso)
        .select(CHAT_TURN_SELECT)
        .maybeSingle();

      if (error) throwStoreError();
      return data as RecordingChatTurnRow | null;
    },

    async failTurn(id, values) {
      const { error } = await admin
        .from("transcript_chat_turns")
        .update({ ...values, status: "failed" })
        .eq("id", id)
        .eq("status", "running");

      if (error) throwStoreError();
    },

    async findTurnByClientId(userId, clientTurnId) {
      const { data, error } = await authenticated
        .from("transcript_chat_turns")
        .select(CHAT_TURN_SELECT)
        .eq("user_id", userId)
        .eq("client_turn_id", clientTurnId)
        .maybeSingle();

      if (error) throwStoreError();
      return data as RecordingChatTurnRow | null;
    },

    async getOwnedTranscript(userId, transcriptId) {
      const transcriptResult = await authenticated
        .from("transcripts")
        .select("id,recording_id,user_id,raw_text,segments,speakers")
        .eq("id", transcriptId)
        .eq("user_id", userId)
        .maybeSingle();

      if (transcriptResult.error) throwStoreError();
      if (!transcriptResult.data) return null;
      const transcript = transcriptResult.data as {
        id: string;
        raw_text: string;
        recording_id: string;
        segments: unknown;
        speakers: unknown;
        user_id: string;
      };
      const recordingResult = await authenticated
        .from("recordings")
        .select("id,user_id,title")
        .eq("id", transcript.recording_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (recordingResult.error) throwStoreError();
      if (!recordingResult.data) return null;

      return {
        id: transcript.id,
        rawText: transcript.raw_text,
        recordingId: transcript.recording_id,
        recordingTitle: (recordingResult.data as { title: string }).title,
        segments: transcript.segments,
        speakers: transcript.speakers,
        userId: transcript.user_id
      };
    },

    async getSystemPrompt() {
      const { data, error } = await authenticated
        .from("prompt_templates")
        .select("id,prompt_text,output_schema")
        .eq("processing_type", "recording_chat")
        .eq("is_system", true)
        .is("user_id", null)
        .maybeSingle();

      if (error) throwStoreError();
      if (!data) return null;

      return {
        id: (data as { id: string }).id,
        outputSchema: (data as { output_schema: unknown }).output_schema,
        promptText: (data as { prompt_text: string }).prompt_text,
        revision: 1
      };
    },

    async getThread(userId, transcriptId) {
      const { data, error } = await authenticated
        .from("transcript_chat_threads")
        .select(CHAT_THREAD_SELECT)
        .eq("user_id", userId)
        .eq("transcript_id", transcriptId)
        .maybeSingle();

      if (error) throwStoreError();
      return data as RecordingChatThreadRow | null;
    },

    async insertRunningTurn(values) {
      const { data, error } = await admin
        .from("transcript_chat_turns")
        .insert(values)
        .select(CHAT_TURN_SELECT)
        .single();

      if (isUniqueViolation(error)) {
        return { conflict: "unique", turn: null };
      }

      if (error || !data) throwStoreError();
      return { conflict: null, turn: data as RecordingChatTurnRow };
    },

    async listTurns(userId, threadId) {
      const { data, error } = await authenticated
        .from("transcript_chat_turns")
        .select(CHAT_TURN_SELECT)
        .eq("user_id", userId)
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (error) throwStoreError();
      return (data ?? []) as RecordingChatTurnRow[];
    }
  };
}

// runConfiguredChatProvider checks server configuration and dispatches through the existing model catalog.
async function runConfiguredChatProvider(input: Parameters<NonNullable<SubmitDependencies["runProvider"]>>[0]) {
  const configurationError = getAiProviderConfigurationError(input.provider);

  if (configurationError) {
    throw new Error(configurationError);
  }

  return input.provider === "gemini"
    ? runGeminiChat(input)
    : runOpenAIChat(input);
}

// normalizeEvidenceKey deduplicates cosmetically equivalent provider quotes before verification.
function normalizeEvidenceKey(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// parseAndVerifyProviderOutput accepts only system-owned output fields and derives evidence times from saved tokens.
function parseAndVerifyProviderOutput(outputText: string, transcriptSegments: unknown) {
  const parsed = parsePossibleJson(outputText);

  if (!parsed || typeof parsed !== "object") {
    throw new RecordingChatServiceError("invalid_provider_output", 502, "AI vrátila neplatnou odpověď.");
  }

  const object = parsed as Record<string, unknown>;
  const answerMarkdown = typeof object.answer_markdown === "string" ? object.answer_markdown.trim() : "";

  if (!answerMarkdown || answerMarkdown.length > 100_000) {
    throw new RecordingChatServiceError("invalid_provider_output", 502, "AI vrátila neplatnou odpověď.");
  }

  const evidenceItems = Array.isArray(object.evidence) ? object.evidence.slice(0, 8) : [];
  const seen = new Set<string>();
  const evidence = evidenceItems.flatMap<PersistedRecordingChatEvidence>((item) => {
    const quote = item && typeof item === "object" && typeof (item as { quote?: unknown }).quote === "string"
      ? (item as { quote: string }).quote.trim()
      : "";
    const key = normalizeEvidenceKey(quote);

    if (!quote || quote.length > 800 || seen.has(key)) {
      return [];
    }

    seen.add(key);
    const location = resolveEvidenceLocation(transcriptSegments, quote);

    return location
      ? [{ end_ms: location.endMs, quote, start_ms: location.startMs }]
      : [];
  });

  return { answerMarkdown, evidence };
}

// requireOwnedTranscript returns 404 for both missing and foreign rows to avoid ownership disclosure.
async function requireOwnedTranscript(store: RecordingChatStore, userId: string, transcriptId: string) {
  const transcript = await store.getOwnedTranscript(userId, transcriptId);

  if (!transcript) {
    throw new RecordingChatServiceError("not_found", 404, "Přepis nebyl nalezen.");
  }

  return transcript;
}

// getRecordingChatHistory returns an owner-scoped projection without prompt snapshots or provider internals.
export async function getRecordingChatHistory(
  input: { transcriptId: string; userId: string },
  dependencies: { now?: () => Date; store: RecordingChatStore }
) {
  await requireOwnedTranscript(dependencies.store, input.userId, input.transcriptId);
  const thread = await dependencies.store.getThread(input.userId, input.transcriptId);

  if (!thread) {
    return { thread: null, turns: [] };
  }

  const now = dependencies.now?.() ?? new Date();
  await dependencies.store.failStaleRunningTurn(
    thread.id,
    new Date(now.getTime() - CHAT_TURN_STALE_LEASE_MS).toISOString(),
    now.toISOString()
  );
  const turns = await dependencies.store.listTurns(input.userId, thread.id);

  return {
    thread: projectRecordingChatThread(thread),
    turns: turns.map(projectRecordingChatTurn)
  };
}

// submitRecordingChatTurn claims, runs and persists exactly one owner-authorized provider turn.
export async function submitRecordingChatTurn(
  input: {
    clientTurnId: string;
    model: string;
    question: string;
    transcriptId: string;
    userId: string;
  },
  dependencies: SubmitDependencies
) {
  const now = dependencies.now?.() ?? new Date();
  const store = dependencies.store;
  const transcript = await requireOwnedTranscript(store, input.userId, input.transcriptId);
  const existingBeforeThread = await store.findTurnByClientId(input.userId, input.clientTurnId);

  if (existingBeforeThread) {
    if (existingBeforeThread.transcript_id !== input.transcriptId) {
      throw new RecordingChatServiceError("client_turn_conflict", 409, "Toto odeslání už patří jinému chatu.");
    }

    const existingThread = await store.getThread(input.userId, input.transcriptId);
    if (!existingThread) throwStoreError();
    return { thread: projectRecordingChatThread(existingThread), turn: projectRecordingChatTurn(existingBeforeThread) };
  }

  const modelOption = getAiModelOption(input.model);

  if (!modelOption) {
    throw new RecordingChatServiceError("invalid_model", 400, "Vybraný AI model není podporovaný.");
  }

  const thread = await store.getThread(input.userId, input.transcriptId) ?? await store.createThread({
    recordingId: transcript.recordingId,
    transcriptId: transcript.id,
    userId: input.userId
  });
  await store.failStaleRunningTurn(
    thread.id,
    new Date(now.getTime() - CHAT_TURN_STALE_LEASE_MS).toISOString(),
    now.toISOString()
  );

  const afterReconciliation = await store.findTurnByClientId(input.userId, input.clientTurnId);

  if (afterReconciliation) {
    return { thread: projectRecordingChatThread(thread), turn: projectRecordingChatTurn(afterReconciliation) };
  }

  const rateLimit = (dependencies.rateLimit ?? recordingChatRateLimit)(input.userId, now.getTime());

  if (!rateLimit.allowed) {
    throw new RecordingChatServiceError(
      "rate_limited",
      429,
      "Příliš mnoho AI požadavků za sebou. Zkuste to za chvíli.",
      rateLimit.retryAfterSeconds
    );
  }

  const systemPrompt = await store.getSystemPrompt();

  if (!systemPrompt) {
    throw new RecordingChatServiceError("prompt_unavailable", 503, "Chat prompt není v databázi dostupný.");
  }

  const startedAt = now.toISOString();
  const inserted = await store.insertRunningTurn({
    client_turn_id: input.clientTurnId,
    model: input.model,
    prompt_revision_snapshot: systemPrompt.revision,
    prompt_text_snapshot: systemPrompt.promptText,
    provider: modelOption.provider,
    question: input.question,
    recording_id: transcript.recordingId,
    started_at: startedAt,
    status: "running",
    system_prompt_id: systemPrompt.id,
    thread_id: thread.id,
    transcript_id: transcript.id,
    user_id: input.userId
  });

  if (!inserted.turn) {
    const duplicate = await store.findTurnByClientId(input.userId, input.clientTurnId);

    if (duplicate && duplicate.transcript_id === input.transcriptId) {
      return { thread: projectRecordingChatThread(thread), turn: projectRecordingChatTurn(duplicate) };
    }

    throw new RecordingChatServiceError("active_turn", 409, "Jiná odpověď se právě zpracovává.");
  }

  const claimedTurn = inserted.turn;

  try {
    const storedHistory = await store.listTurns(input.userId, thread.id);
    const context = buildRecordingChatContext({
      history: storedHistory
        .filter((turn) => turn.id !== claimedTurn.id)
        .map((turn) => ({
          answerMarkdown: turn.answer_markdown,
          createdAt: turn.created_at,
          question: turn.question,
          status: turn.status
        })),
      question: input.question,
      rawText: transcript.rawText,
      segments: transcript.segments,
      speakerContext: getTranscriptSpeakerContext(transcript.speakers, transcript.segments),
      speakers: transcript.speakers,
      systemPrompt: systemPrompt.promptText
    });
    const result = await (dependencies.runProvider ?? runConfiguredChatProvider)({
      messages: context.messages,
      model: input.model,
      outputSchema: systemPrompt.outputSchema,
      provider: modelOption.provider,
      systemInstruction: context.systemInstruction
    });
    const parsed = parseAndVerifyProviderOutput(result.outputText, transcript.segments);
    const completed = await store.completeTurn(claimedTurn.id, {
      answer_markdown: parsed.answerMarkdown,
      completed_at: (dependencies.now?.() ?? new Date()).toISOString(),
      input_token_count: result.inputTokenCount,
      output_token_count: result.outputTokenCount,
      provider_response_id: result.providerResponseId,
      verified_evidence: parsed.evidence
    });

    if (!completed) throwStoreError();

    return {
      thread: projectRecordingChatThread(thread),
      turn: projectRecordingChatTurn(completed)
    };
  } catch (error) {
    const safeDetail = getSafeProviderErrorDetail(error);
    const safeError = error instanceof RecordingChatServiceError && error.code === "invalid_provider_output"
      ? error.publicMessage
      : getAiProviderFailureMessage(modelOption.provider);

    // The sanitized helper is intentionally evaluated but never persisted because provider text may echo user content.
    void safeDetail;
    await store.failTurn(claimedTurn.id, {
      completed_at: (dependencies.now?.() ?? new Date()).toISOString(),
      safe_error: safeError
    }).catch(() => undefined);

    if (error instanceof RecordingChatServiceError) {
      throw error;
    }

    throw new RecordingChatServiceError("provider_failed", 502, safeError);
  }
}
