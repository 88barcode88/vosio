import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ScenarioState = {
  aiJobs: Array<{
    executionMode: "automatic" | "manual";
    generationIdentity: string | null;
    id: string;
    transcriptId: string;
  }>;
  deleteCalls: number;
  automaticEligible: boolean;
  completionGenerationKey: string | null;
  insertManualAfterTransitionWinner: boolean;
  mode: "regular" | "segmented";
  outputs: Array<{ id: string; jobId: string }>;
  providerRuns: number;
  transitionCalls: number;
  transitionWins: number;
  recording: {
    id: string;
    mime_type: string;
    status: string;
    storage_path: string;
    title: string;
    user_id: string;
  };
  regularJob: {
    id: string;
    provider_config: Record<string, unknown>;
    provider_job_id: string;
    status: string;
  };
  segmentJobs: Array<{
    created_at: string;
    id: string;
    provider_config: Record<string, unknown>;
    provider_job_id: string;
    status: string;
  }>;
  transcript: {
    id: string;
    raw_text: string;
    recording_id: string;
    segments: unknown[];
    speakers: unknown[];
    transcription_job_id: string | null;
    user_id: string;
  };
};

const mocks = vi.hoisted(() => ({
  activeState: null as unknown,
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getSonioxTranscript: vi.fn(),
  getSonioxTranscription: vi.fn(),
  mapSonioxStatus: vi.fn(),
  persistTranscriptCompletionTransition: vi.fn(),
  reconcileAutomaticTimeline: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/ai/automatic-timeline.server", () => ({
  createAutomaticTimelineGenerationIdentity: (input: {
    jobIds?: string[];
    kind: "async" | "segmented";
    transcriptionJobId?: string;
  }) => input.kind === "segmented"
    ? `segmented:${[...(input.jobIds ?? [])].sort().join("|")}`
    : `async:${input.transcriptionJobId}`,
  createAutomaticTimelineIdempotencyKey: (generationIdentity: string) =>
    `atl-test:${generationIdentity}`,
  persistTranscriptCompletionTransition: mocks.persistTranscriptCompletionTransition,
  reconcileAutomaticTimeline: mocks.reconcileAutomaticTimeline
}));
vi.mock("@/lib/soniox/client", () => ({
  createSonioxTranscription: vi.fn(),
  getSonioxTranscript: mocks.getSonioxTranscript,
  getSonioxTranscription: mocks.getSonioxTranscription,
  getSonioxTranscriptionOptions: vi.fn(() => ({})),
  mapSonioxStatus: mocks.mapSonioxStatus
}));
vi.mock("@/lib/transcripts/search-index", () => ({
  replaceTranscriptSearchChunks: vi.fn(async () => ({ status: "complete" }))
}));
vi.mock("@/lib/transcripts/search-warning", () => ({
  getTranscriptSearchWarningPayload: vi.fn(() => ({}))
}));
vi.mock("@/lib/transcripts/speakers", () => ({
  extractTranscriptSpeakerSummaries: vi.fn(() => [])
}));

import { GET } from "@/../app/api/recordings/[recordingId]/transcription/route";

const recordingId = "00000000-0000-4000-8000-000000000501";
const transcriptId = "00000000-0000-4000-8000-000000000502";
const userId = "user-terminal-idempotency";

// createAdminQuery models the durable rows whose preservation is observable across terminal polls.
function createAdminQuery(state: ScenarioState, tableName: string) {
  let operation: "delete" | "select" | "update" = "select";
  let updatePayload: Record<string, unknown> = {};

  const execute = () => {
    if (tableName === "transcription_jobs") {
      if (operation === "update") {
        return { data: null, error: null };
      }

      return {
        data: state.mode === "segmented" ? state.segmentJobs : state.regularJob,
        error: null
      };
    }

    if (tableName === "transcripts") {
      if (operation === "update") {
        Object.assign(state.transcript, updatePayload);
      }

      return { data: { ...state.transcript }, error: null };
    }

    if (tableName === "ai_processing_jobs" && operation === "delete") {
      const deletedIds = new Set(
        state.aiJobs
          .filter((job) => job.transcriptId === transcriptId)
          .map((job) => job.id)
      );
      state.deleteCalls += 1;
      state.aiJobs = state.aiJobs.filter((job) => !deletedIds.has(job.id));
      state.outputs = state.outputs.filter((output) => !deletedIds.has(output.jobId));
      return { data: null, error: null };
    }

    if (tableName === "recordings" && operation === "update") {
      Object.assign(state.recording, updatePayload);
    }

    return { data: null, error: null };
  };
  const query = {
    delete: vi.fn(() => {
      operation = "delete";
      return query;
    }),
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => execute()),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(async () => execute()),
    then: (
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(execute()).then(resolve, reject),
    update: vi.fn((payload: Record<string, unknown>) => {
      operation = "update";
      updatePayload = payload;
      return query;
    })
  };

  return query;
}

// createScenario provides one successful automatic output plus an unrelated manual output.
function createScenario(mode: "regular" | "segmented", persistedGenerationMatches = true) {
  const segmentJobs = [0, 1].map((index) => ({
    created_at: `2026-08-27T08:00:0${index}.000Z`,
    id: `segment-job-${index}`,
    provider_config: {
      audio_source: "supabase_recording_segment",
      batch_id: "batch-current",
      region: "eu",
      segment_index: index
    },
    provider_job_id: `provider-segment-${index}`,
    status: "done"
  }));
  const currentMarker = mode === "segmented" ? segmentJobs.at(-1)!.id : "regular-job-current";
  const currentGeneration = mode === "segmented"
    ? `segmented:${segmentJobs.map((job) => job.id).sort().join("|")}`
    : "async:regular-job-current";
  const persistedGeneration = persistedGenerationMatches ? currentGeneration : "async:regular-job-previous";
  const state: ScenarioState = {
    aiJobs: [
      {
        executionMode: "manual",
        generationIdentity: null,
        id: "manual-job",
        transcriptId
      },
      {
        executionMode: "automatic",
        generationIdentity: persistedGeneration,
        id: "automatic-job",
        transcriptId
      }
    ],
    automaticEligible: true,
    completionGenerationKey: `atl-test:${persistedGeneration}`,
    deleteCalls: 0,
    insertManualAfterTransitionWinner: false,
    mode,
    outputs: [
      { id: "manual-output", jobId: "manual-job" },
      { id: "automatic-output", jobId: "automatic-job" }
    ],
    providerRuns: 1,
    transitionCalls: 0,
    transitionWins: 0,
    recording: {
      id: recordingId,
      mime_type: "audio/webm",
      status: "completed",
      storage_path: mode === "segmented"
        ? `${userId}/${recordingId}/live/`
        : `${userId}/${recordingId}/recording.webm`,
      title: "Terminal poll fixture",
      user_id: userId
    },
    regularJob: {
      id: "regular-job-current",
      provider_config: { region: "eu" },
      provider_job_id: "provider-regular-current",
      status: "done"
    },
    segmentJobs,
    transcript: {
      id: transcriptId,
      raw_text: "Persisted transcript",
      recording_id: recordingId,
      segments: [],
      speakers: [],
      transcription_job_id: persistedGenerationMatches ? currentMarker : "regular-job-previous",
      user_id: userId
    }
  };
  const admin = { from: vi.fn((tableName: string) => createAdminQuery(state, tableName)) };
  const recordingQuery = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: state.recording, error: null })),
    select: vi.fn()
  };
  recordingQuery.eq.mockReturnValue(recordingQuery);
  recordingQuery.select.mockReturnValue(recordingQuery);

  mocks.activeState = state;
  mocks.createAdminClient.mockReturnValue(admin);
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: userId,
            user_metadata: { vosio_settings: { autoTimelineAfterTranscription: true } }
          }
        },
        error: null
      }))
    },
    from: vi.fn(() => recordingQuery)
  });

  return state;
}

// pollTerminalGeneration runs the authenticated route against one already-terminal Soniox generation.
function pollTerminalGeneration() {
  return GET(
    new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
    { params: Promise.resolve({ recordingId }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSonioxTranscription.mockResolvedValue({
    audio_duration_ms: 1_000,
    status: "completed"
  });
  mocks.getSonioxTranscript.mockImplementation(async (_region, providerJobId: string) => ({
    text: `Transcript ${providerJobId}`,
    tokens: []
  }));
  mocks.mapSonioxStatus.mockReturnValue("done");
  mocks.persistTranscriptCompletionTransition.mockImplementation(async (input: {
    generationIdentity: string;
    transcriptionJobId: string | null;
    transcriptId: string;
  }) => {
    const state = mocks.activeState as ScenarioState;
    const completionGenerationKey = `atl-test:${input.generationIdentity}`;
    state.transitionCalls += 1;

    if (state.completionGenerationKey !== completionGenerationKey) {
      const deletedIds = new Set(state.aiJobs.map((job) => job.id));
      state.deleteCalls += 1;
      state.transitionWins += 1;
      state.aiJobs = [];
      state.outputs = state.outputs.filter((output) => !deletedIds.has(output.jobId));
      state.automaticEligible = true;
      state.completionGenerationKey = completionGenerationKey;
      state.transcript.transcription_job_id = input.transcriptionJobId;

      if (state.insertManualAfterTransitionWinner) {
        state.aiJobs.push({
          executionMode: "manual",
          generationIdentity: null,
          id: "manual-job-new-generation",
          transcriptId
        });
        state.outputs.push({ id: "manual-output-new-generation", jobId: "manual-job-new-generation" });
      }
    }

    return {
      automatic_timeline_scheduled: state.automaticEligible,
      is_new_generation: state.transitionWins === 1,
      transcript_id: input.transcriptId
    };
  });
  mocks.reconcileAutomaticTimeline.mockImplementation(async (input: {
    transcriptId: string;
  }) => {
    const state = mocks.activeState as ScenarioState;
    let existing = state.aiJobs.find((job) =>
      job.executionMode === "automatic" && job.transcriptId === input.transcriptId
    );

    if (!existing && state.automaticEligible) {
      state.providerRuns += 1;
      const jobId = `automatic-job-${state.providerRuns}`;
      existing = {
        executionMode: "automatic",
        generationIdentity: state.completionGenerationKey?.replace("atl-test:", "") ?? null,
        id: jobId,
        transcriptId: input.transcriptId
      };
      state.aiJobs.push(existing);
      state.outputs.push({ id: `automatic-output-${state.providerRuns}`, jobId });
    }

    return existing ? { status: "already_done" } : { status: "not_scheduled" };
  });
});

describe("terminal transcription polling idempotency", () => {
  it.each(["regular", "segmented"] as const)(
    "preserves manual and automatic outputs across repeated concurrent %s terminal polls",
    async (mode) => {
      const state = createScenario(mode);

      const repeatedResponse = await pollTerminalGeneration();
      const concurrentResponses = await Promise.all([
        pollTerminalGeneration(),
        pollTerminalGeneration()
      ]);

      expect(repeatedResponse.status).toBe(200);
      expect(concurrentResponses.map((response) => response.status)).toEqual([200, 200]);
      expect(state.deleteCalls).toBe(0);
      expect(state.aiJobs.map((job) => job.id).sort()).toEqual(["automatic-job", "manual-job"]);
      expect(state.outputs.map((output) => output.id).sort()).toEqual([
        "automatic-output",
        "manual-output"
      ]);
      expect(state.providerRuns).toBe(1);
      expect(mocks.persistTranscriptCompletionTransition).toHaveBeenCalledTimes(3);
      expect(mocks.reconcileAutomaticTimeline).toHaveBeenCalledTimes(3);
    }
  );

  it.each(["regular", "segmented"] as const)(
    "cleans transcript-dependent AI when a genuinely new %s retranscription generation completes",
    async (mode) => {
      const state = createScenario(mode, false);
      const expectedGeneration = mode === "segmented"
        ? "segmented:segment-job-0|segment-job-1"
        : "async:regular-job-current";

      const response = await pollTerminalGeneration();

      expect(response.status).toBe(200);
      expect(state.deleteCalls).toBe(1);
      expect(state.transcript.transcription_job_id).toBe(
        mode === "segmented" ? "segment-job-1" : "regular-job-current"
      );
      expect(state.aiJobs).toEqual([
        expect.objectContaining({
          executionMode: "automatic",
          generationIdentity: expectedGeneration
        })
      ]);
      expect(state.outputs).toHaveLength(1);
      expect(state.providerRuns).toBe(2);
      expect(mocks.persistTranscriptCompletionTransition).toHaveBeenCalledOnce();
    }
  );

  it.each(["regular", "segmented"] as const)(
    "does not backfill a historical %s completion from current enabled settings",
    async (mode) => {
      const state = createScenario(mode);
      state.aiJobs = state.aiJobs.filter((job) => job.executionMode === "manual");
      state.outputs = state.outputs.filter((output) => output.jobId === "manual-job");
      state.automaticEligible = false;

      const response = await pollTerminalGeneration();

      expect(response.status).toBe(200);
      expect(state.providerRuns).toBe(1);
      expect(state.aiJobs.map((job) => job.id)).toEqual(["manual-job"]);
      expect(mocks.persistTranscriptCompletionTransition).toHaveBeenCalledOnce();
      expect(mocks.reconcileAutomaticTimeline).not.toHaveBeenCalled();
    }
  );

  it.each(["regular", "segmented"] as const)(
    "lets exactly one %s replacement transition clean old AI and preserves a new manual output",
    async (mode) => {
      const state = createScenario(mode, false);
      state.insertManualAfterTransitionWinner = true;

      const responses = await Promise.all([pollTerminalGeneration(), pollTerminalGeneration()]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(state.transitionCalls).toBe(2);
      expect(state.transitionWins).toBe(1);
      expect(state.deleteCalls).toBe(1);
      expect(state.aiJobs.map((job) => job.id).sort()).toEqual([
        "automatic-job-2",
        "manual-job-new-generation"
      ]);
      expect(state.outputs.map((output) => output.id).sort()).toEqual([
        "automatic-output-2",
        "manual-output-new-generation"
      ]);
      expect(state.providerRuns).toBe(2);
    }
  );
});
