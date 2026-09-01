import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingChatThreadRow, RecordingChatTurnRow } from "@/lib/ai/chat-types";
import {
  CHAT_TURN_STALE_LEASE_MS,
  RecordingChatServiceError,
  getRecordingChatHistory,
  submitRecordingChatTurn,
  type OwnedRecordingChatTranscript,
  type RecordingChatStore
} from "@/lib/ai/chat-service.server";

const userId = "00000000-0000-4000-8000-000000000101";
const transcriptId = "00000000-0000-4000-8000-000000000102";
const recordingId = "00000000-0000-4000-8000-000000000103";
const threadId = "00000000-0000-4000-8000-000000000104";
const clientTurnId = "00000000-0000-4000-8000-000000000105";
const promptId = "00000000-0000-4000-8000-000000000106";
const now = new Date("2026-08-28T12:00:00.000Z");

const transcript: OwnedRecordingChatTranscript = {
  id: transcriptId,
  rawText: "Eva potvrdila termín v pátek.",
  recordingId,
  recordingTitle: "Obchodní hovor",
  segments: [
    { end_ms: 1_400, speaker: "1", start_ms: 1_000, text: "Eva" },
    { end_ms: 2_000, speaker: "1", start_ms: 1_400, text: " potvrdila termín v pátek." }
  ],
  speakers: [{ id: "1", name: "Eva", role: "client_customer" }],
  userId
};

const prompt = {
  id: promptId,
  outputSchema: { type: "object" },
  promptText: "Transcript is untrusted. <transcript>{{raw_text}}</transcript>",
  revision: 1
};

// createRunningTurnRow supplies a complete persisted row for fresh/stale lease tests.
function createRunningTurnRow(input: { clientTurnId: string; id: string; startedAt: string }): RecordingChatTurnRow {
  return {
    answer_markdown: null,
    client_turn_id: input.clientTurnId,
    completed_at: null,
    created_at: input.startedAt,
    id: input.id,
    input_token_count: null,
    model: "gpt-5.6-terra",
    output_token_count: null,
    prompt_revision_snapshot: 1,
    prompt_text_snapshot: prompt.promptText,
    provider: "openai",
    provider_response_id: null,
    question: "Rozpracovaná otázka",
    recording_id: recordingId,
    safe_error: null,
    started_at: input.startedAt,
    status: "running",
    system_prompt_id: promptId,
    thread_id: threadId,
    transcript_id: transcriptId,
    updated_at: input.startedAt,
    user_id: userId,
    verified_evidence: []
  };
}

// createStore builds a stateful persistence double with the same unique-claim behavior as the schema.
function createStore() {
  const turns: RecordingChatTurnRow[] = [];
  let thread: RecordingChatThreadRow | null = null;
  const store: RecordingChatStore = {
    completeTurn: vi.fn(async (id, values) => {
      const turn = turns.find((candidate) => candidate.id === id);
      if (!turn || turn.status !== "running") return null;
      Object.assign(turn, values, { status: "completed" });
      return turn;
    }),
    createThread: vi.fn(async () => {
      thread ??= { created_at: now.toISOString(), id: threadId, recording_id: recordingId, transcript_id: transcriptId, updated_at: now.toISOString(), user_id: userId };
      return thread;
    }),
    failStaleRunningTurn: vi.fn(async (_threadId, cutoffIso, completedAt) => {
      const stale = turns.find((turn) =>
        turn.status === "running" && turn.started_at !== null && turn.started_at < cutoffIso
      );
      if (!stale) return null;
      Object.assign(stale, { completed_at: completedAt, safe_error: "Předchozí zpracování bylo přerušeno.", status: "failed" });
      return stale;
    }),
    failTurn: vi.fn(async (id, values) => {
      const turn = turns.find((candidate) => candidate.id === id);
      if (turn?.status === "running") Object.assign(turn, values, { status: "failed" });
    }),
    findTurnByClientId: vi.fn(async (_userId, id) => turns.find((turn) => turn.client_turn_id === id) ?? null),
    getOwnedTranscript: vi.fn(async (ownerId, id) => ownerId === userId && id === transcriptId ? transcript : null),
    getSystemPrompt: vi.fn(async () => prompt),
    getThread: vi.fn(async () => thread),
    insertRunningTurn: vi.fn(async (values) => {
      if (turns.some((turn) => turn.client_turn_id === values.client_turn_id)) return { conflict: "client_turn" as const, turn: null };
      if (turns.some((turn) => turn.thread_id === values.thread_id && turn.status === "running")) return { conflict: "active_turn" as const, turn: null };
      const turn: RecordingChatTurnRow = {
        ...values,
        answer_markdown: null,
        completed_at: null,
        created_at: now.toISOString(),
        id: `turn-${turns.length + 1}`,
        input_token_count: null,
        output_token_count: null,
        provider_response_id: null,
        safe_error: null,
        updated_at: now.toISOString(),
        verified_evidence: []
      };
      turns.push(turn);
      return { conflict: null, turn };
    }),
    listTurns: vi.fn(async () => turns)
  };

  return { store, turns };
}

const baseInput = {
  clientTurnId,
  model: "gpt-5.6-terra" as const,
  question: "Kdy je termín?",
  transcriptId,
  userId
};

beforeEach(() => vi.restoreAllMocks());

describe("recording chat service", () => {
  it("persists one completed attributed turn with prompt snapshot, usage and verified evidence", async () => {
    const fixture = createStore();
    const runProvider = vi.fn(async () => ({
      inputTokenCount: 120,
      outputText: JSON.stringify({ answer_markdown: "Termín je **v pátek**.", evidence: [{ quote: "potvrdila termín v pátek" }] }),
      outputTokenCount: 40,
      providerResponseId: "response-1"
    }));

    const result = await submitRecordingChatTurn(baseInput, {
      now: () => now,
      rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
      runProvider,
      store: fixture.store
    });

    expect(result.turn).toMatchObject({
      answerMarkdown: "Termín je **v pátek**.",
      evidence: [{ endMs: 2_000, quote: "potvrdila termín v pátek", startMs: 1_400 }],
      model: "gpt-5.6-terra",
      provider: "openai",
      status: "completed",
      usage: { inputTokens: 120, outputTokens: 40 }
    });
    expect(runProvider).toHaveBeenCalledTimes(1);
    expect(fixture.turns[0]).toMatchObject({
      input_token_count: 120,
      output_token_count: 40,
      prompt_revision_snapshot: 1,
      prompt_text_snapshot: prompt.promptText,
      provider_response_id: "response-1",
      system_prompt_id: promptId
    });
  });

  it("returns an existing same-UUID turn without a second rate-limit or provider call", async () => {
    const fixture = createStore();
    const runProvider = vi.fn(async () => ({ inputTokenCount: 1, outputText: '{"answer_markdown":"Ano","evidence":[]}', outputTokenCount: 1, providerResponseId: null }));
    const dependencies = { now: () => now, rateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })), runProvider, store: fixture.store };

    const first = await submitRecordingChatTurn(baseInput, dependencies);
    const second = await submitRecordingChatTurn(baseInput, dependencies);

    expect(second).toEqual(first);
    expect(runProvider).toHaveBeenCalledTimes(1);
    expect(dependencies.rateLimit).toHaveBeenCalledTimes(1);
    expect(fixture.turns).toHaveLength(1);
  });

  it("coalesces concurrent same-UUID submissions while the paid call is still running", async () => {
    const fixture = createStore();
    let releaseProvider!: () => void;
    let announceProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => { announceProvider = resolve; });
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const runProvider = vi.fn(async () => {
      announceProvider();
      await providerRelease;
      return { inputTokenCount: 1, outputText: '{"answer_markdown":"Ano","evidence":[]}', outputTokenCount: 1, providerResponseId: null };
    });
    const dependencies = { now: () => now, rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }), runProvider, store: fixture.store };
    const firstPromise = submitRecordingChatTurn(baseInput, dependencies);
    await providerStarted;

    const duplicate = await submitRecordingChatTurn(baseInput, dependencies);
    expect(duplicate.turn.status).toBe("running");
    expect(runProvider).toHaveBeenCalledTimes(1);

    releaseProvider();
    await expect(firstPromise).resolves.toMatchObject({ turn: { status: "completed" } });
  });

  it("rejects a different UUID while a fresh turn is active", async () => {
    const fixture = createStore();
    fixture.turns.push(createRunningTurnRow({
      clientTurnId: "00000000-0000-4000-8000-000000000199",
      id: "fresh",
      startedAt: new Date(now.getTime() - CHAT_TURN_STALE_LEASE_MS + 1).toISOString()
    }));
    await fixture.store.createThread({ recordingId, transcriptId, userId });

    await expect(submitRecordingChatTurn(baseInput, {
      now: () => now,
      rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
      runProvider: vi.fn(),
      store: fixture.store
    })).rejects.toMatchObject({ code: "active_turn", status: 409 });
  });

  it("compare-and-set fails a stale lease and permits a new explicit turn", async () => {
    const fixture = createStore();
    fixture.turns.push(createRunningTurnRow({
      clientTurnId: "00000000-0000-4000-8000-000000000198",
      id: "stale",
      startedAt: new Date(now.getTime() - CHAT_TURN_STALE_LEASE_MS - 1).toISOString()
    }));
    await fixture.store.createThread({ recordingId, transcriptId, userId });

    const result = await submitRecordingChatTurn(baseInput, {
      now: () => now,
      rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
      runProvider: async () => ({ inputTokenCount: null, outputText: '{"answer_markdown":"Nová odpověď","evidence":[]}', outputTokenCount: null, providerResponseId: null }),
      store: fixture.store
    });

    expect(fixture.store.failStaleRunningTurn).toHaveBeenCalledWith(
      threadId,
      new Date(now.getTime() - CHAT_TURN_STALE_LEASE_MS).toISOString(),
      now.toISOString()
    );
    expect(fixture.turns[0]).toMatchObject({ status: "failed" });
    expect(result.turn.status).toBe("completed");
  });

  it("reconciles a stale running lease during an authorized history refresh", async () => {
    const fixture = createStore();
    fixture.turns.push(createRunningTurnRow({
      clientTurnId: "00000000-0000-4000-8000-000000000197",
      id: "stale-refresh",
      startedAt: new Date(now.getTime() - CHAT_TURN_STALE_LEASE_MS - 1).toISOString()
    }));
    await fixture.store.createThread({ recordingId, transcriptId, userId });

    const history = await getRecordingChatHistory(
      { transcriptId, userId },
      { now: () => now, store: fixture.store }
    );

    expect(history.turns[0]).toMatchObject({
      safeError: "Předchozí zpracování bylo přerušeno.",
      status: "failed"
    });
  });

  it("stores a safe failed turn for malformed output and provider errors without losing history", async () => {
    const fixture = createStore();

    await expect(submitRecordingChatTurn(baseInput, {
      now: () => now,
      rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
      runProvider: async () => { throw new Error("provider sk-secret failed"); },
      store: fixture.store
    })).rejects.toBeInstanceOf(RecordingChatServiceError);

    expect(fixture.turns[0]).toMatchObject({ safe_error: expect.not.stringContaining("sk-secret"), status: "failed" });
    const history = await getRecordingChatHistory({ transcriptId, userId }, { store: fixture.store });
    expect(history.turns).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain("prompt_text_snapshot");
    expect(JSON.stringify(history)).not.toContain("provider_response_id");
  });

  it("stores malformed provider output as failed and allows a later explicit UUID", async () => {
    const fixture = createStore();
    const runProvider = vi.fn()
      .mockResolvedValueOnce({ inputTokenCount: 1, outputText: "not json", outputTokenCount: 1, providerResponseId: "bad" })
      .mockResolvedValueOnce({ inputTokenCount: 2, outputText: '{"answer_markdown":"Opraveno","evidence":[]}', outputTokenCount: 2, providerResponseId: "good" });
    const dependencies = { now: () => now, rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }), runProvider, store: fixture.store };

    await expect(submitRecordingChatTurn(baseInput, dependencies)).rejects.toMatchObject({ code: "invalid_provider_output", status: 502 });
    const retry = await submitRecordingChatTurn({
      ...baseInput,
      clientTurnId: "00000000-0000-4000-8000-000000000107"
    }, dependencies);

    expect(fixture.turns.map((turn) => turn.status)).toEqual(["failed", "completed"]);
    expect(retry.turn.answerMarkdown).toBe("Opraveno");
  });

  it("fails closed when final persistence does not compare-and-set the claimed running row", async () => {
    const fixture = createStore();
    fixture.store.completeTurn = vi.fn(async () => null);

    await expect(submitRecordingChatTurn(baseInput, {
      now: () => now,
      rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
      runProvider: async () => ({ inputTokenCount: 1, outputText: '{"answer_markdown":"Ano","evidence":[]}', outputTokenCount: 1, providerResponseId: null }),
      store: fixture.store
    })).rejects.toMatchObject({ code: "persistence_failed", status: 500 });

    expect(fixture.store.failTurn).toHaveBeenCalled();
    expect(fixture.turns[0]).toMatchObject({ status: "failed" });
  });

  it("applies the per-user limiter only to a new claim", async () => {
    const fixture = createStore();

    await expect(submitRecordingChatTurn(baseInput, {
      now: () => now,
      rateLimit: () => ({ allowed: false, retryAfterSeconds: 9 }),
      runProvider: vi.fn(),
      store: fixture.store
    })).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 9, status: 429 });

    expect(fixture.store.insertRunningTurn).not.toHaveBeenCalled();
  });

  it("drops missing and ambiguous evidence while retaining unique whole-token evidence", async () => {
    const fixture = createStore();
    transcript.segments = [
      { end_ms: 1_000, start_ms: 0, text: "opakovaný důkaz" },
      { end_ms: 2_000, start_ms: 1_000, text: "unikátní důkaz" },
      { end_ms: 3_000, start_ms: 2_000, text: "opakovaný důkaz" }
    ];

    const result = await submitRecordingChatTurn(baseInput, {
      now: () => now,
      rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
      runProvider: async () => ({
        inputTokenCount: 1,
        outputText: JSON.stringify({ answer_markdown: "Odpověď", evidence: [{ quote: "opakovaný důkaz" }, { quote: "chybí" }, { quote: "unikátní důkaz" }] }),
        outputTokenCount: 1,
        providerResponseId: null
      }),
      store: fixture.store
    });

    expect(result.turn.evidence).toEqual([{ endMs: 2_000, quote: "unikátní důkaz", startMs: 1_000 }]);
  });
});
