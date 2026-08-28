import type { AiProviderId } from "@/lib/model-options";

export type RecordingChatTurnStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export type RecordingChatMessage = {
  content: string;
  role: "user" | "assistant";
};

export type RecordingChatEvidence = {
  endMs: number;
  quote: string;
  startMs: number;
};

export type PersistedRecordingChatEvidence = {
  end_ms: number;
  quote: string;
  start_ms: number;
};

export type RecordingChatProviderResult = {
  inputTokenCount: number | null;
  outputText: string;
  outputTokenCount: number | null;
  providerResponseId: string | null;
};

export type RecordingChatTurnRow = {
  answer_markdown: string | null;
  client_turn_id: string;
  completed_at: string | null;
  created_at: string;
  id: string;
  input_token_count: number | null;
  model: string;
  output_token_count: number | null;
  prompt_revision_snapshot: number;
  prompt_text_snapshot: string;
  provider: AiProviderId;
  provider_response_id: string | null;
  question: string;
  recording_id: string;
  safe_error: string | null;
  started_at: string | null;
  status: RecordingChatTurnStatus;
  system_prompt_id: string;
  thread_id: string;
  transcript_id: string;
  updated_at: string;
  user_id: string;
  verified_evidence: unknown;
};

export type RecordingChatThreadRow = {
  created_at: string;
  id: string;
  recording_id: string;
  transcript_id: string;
  updated_at: string;
  user_id: string;
};

export type SafeRecordingChatTurn = {
  answerMarkdown: string | null;
  clientTurnId: string;
  completedAt: string | null;
  createdAt: string;
  evidence: RecordingChatEvidence[];
  id: string;
  model: string;
  provider: AiProviderId;
  question: string;
  safeError: string | null;
  startedAt: string | null;
  status: RecordingChatTurnStatus;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
};

export type SafeRecordingChatThread = {
  createdAt: string;
  id: string;
  transcriptId: string;
  updatedAt: string;
};

// parsePersistedEvidence accepts only the server-owned evidence shape exposed to clients.
export function parsePersistedEvidence(value: unknown): RecordingChatEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const candidate = item as Record<string, unknown>;
    const quote = candidate.quote;
    const startMs = candidate.start_ms;
    const endMs = candidate.end_ms;

    return typeof quote === "string" &&
      Number.isSafeInteger(startMs) && Number(startMs) >= 0 &&
      Number.isSafeInteger(endMs) && Number(endMs) >= Number(startMs)
      ? [{ endMs: Number(endMs), quote, startMs: Number(startMs) }]
      : [];
  });
}

// projectRecordingChatTurn removes prompt/provider internals before a row reaches the browser.
export function projectRecordingChatTurn(row: RecordingChatTurnRow): SafeRecordingChatTurn {
  return {
    answerMarkdown: row.answer_markdown,
    clientTurnId: row.client_turn_id,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    evidence: parsePersistedEvidence(row.verified_evidence),
    id: row.id,
    model: row.model,
    provider: row.provider,
    question: row.question,
    safeError: row.safe_error,
    startedAt: row.started_at,
    status: row.status,
    usage: {
      inputTokens: row.input_token_count,
      outputTokens: row.output_token_count
    }
  };
}

// projectRecordingChatThread exposes only stable identity and timestamps needed by chat UI.
export function projectRecordingChatThread(row: RecordingChatThreadRow): SafeRecordingChatThread {
  return {
    createdAt: row.created_at,
    id: row.id,
    transcriptId: row.transcript_id,
    updatedAt: row.updated_at
  };
}
