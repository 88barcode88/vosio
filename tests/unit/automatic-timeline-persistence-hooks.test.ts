import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type HookScenario = {
  events: string[];
  existingLiveTranscript: { id: string; transcription_job_id: string | null } | null;
  route: "import" | "live";
};

const mocks = vi.hoisted(() => ({
  activeScenario: null as HookScenario | null,
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  persistTranscriptCompletionTransition: vi.fn(),
  reconcileAutomaticTimeline: vi.fn(),
  replaceTranscriptSearchChunks: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/ai/automatic-timeline.server", () => ({
  createAutomaticTimelineGenerationIdentity: (input: {
    kind: "import" | "live";
    transcriptId: string;
  }) => `${input.kind}:${input.transcriptId}`,
  persistTranscriptCompletionTransition: mocks.persistTranscriptCompletionTransition,
  reconcileAutomaticTimeline: mocks.reconcileAutomaticTimeline
}));
vi.mock("@/lib/transcripts/search-index", () => ({
  replaceTranscriptSearchChunks: mocks.replaceTranscriptSearchChunks
}));
vi.mock("@/lib/transcripts/speakers", () => ({
  extractTranscriptSpeakerSummaries: vi.fn(() => [])
}));

import { POST as importTranscript } from "@/../app/api/recordings/import-transcript/route";
import { POST as persistLiveTranscript } from "@/../app/api/recordings/[recordingId]/live-transcript/route";

const userId = "00000000-0000-4000-8000-000000000601";
const recordingId = "00000000-0000-4000-8000-000000000602";
const transcriptId = "00000000-0000-4000-8000-000000000603";

// createAdminQuery records durable write settlement in the same order the route awaits it.
function createAdminQuery(scenario: HookScenario, tableName: string) {
  let operation: "delete" | "insert" | "select" | "update" = "select";
  let payload: Record<string, unknown> = {};

  const executeSingle = () => {
    if (tableName === "recordings" && operation === "insert") {
      scenario.events.push("recording-persisted");
      return { data: { id: recordingId }, error: null };
    }

    if (tableName === "transcripts" && (operation === "insert" || operation === "update")) {
      scenario.events.push("transcript-persisted");
      return {
        data: {
          id: transcriptId,
          raw_text: String(payload.raw_text ?? "persisted transcript"),
          recording_id: recordingId,
          segments: payload.segments ?? [],
          speakers: payload.speakers ?? [],
          user_id: userId
        },
        error: null
      };
    }

    if (tableName === "transcription_jobs" && operation === "insert") {
      scenario.events.push("transcription-job-persisted");
      return { data: { id: "00000000-0000-4000-8000-000000000604" }, error: null };
    }

    return { data: null, error: null };
  };

  const executeAwait = () => {
    if (tableName === "transcripts" && operation === "update") {
      scenario.events.push("generation-marker-persisted");
    }
    if (tableName === "recordings" && operation === "update") {
      scenario.events.push("completion-persisted");
    }
    return { data: null, error: null };
  };

  const query = {
    delete: vi.fn(() => {
      operation = "delete";
      return query;
    }),
    eq: vi.fn(() => query),
    insert: vi.fn((nextPayload: Record<string, unknown>) => {
      operation = "insert";
      payload = nextPayload;
      return query;
    }),
    maybeSingle: vi.fn(async () => ({
      data: tableName === "transcripts" ? scenario.existingLiveTranscript : null,
      error: null
    })),
    select: vi.fn(() => query),
    single: vi.fn(async () => executeSingle()),
    then: (
      resolve: (value: { data: null; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(executeAwait()).then(resolve, reject),
    update: vi.fn((nextPayload: Record<string, unknown>) => {
      operation = "update";
      payload = nextPayload;
      return query;
    })
  };

  return query;
}

// installScenario wires authenticated and admin clients without any provider or network call.
function installScenario(scenario: HookScenario) {
  mocks.activeScenario = scenario;
  const admin = { from: vi.fn((tableName: string) => createAdminQuery(scenario, tableName)) };
  const ownedRecordingQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => ({
      data: { id: recordingId, user_id: userId },
      error: null
    }))
  };
  ownedRecordingQuery.eq.mockReturnValue(ownedRecordingQuery);
  ownedRecordingQuery.select.mockReturnValue(ownedRecordingQuery);

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
    from: vi.fn(() => ownedRecordingQuery)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.persistTranscriptCompletionTransition.mockImplementation(async () => {
    mocks.activeScenario?.events.push("completion-and-intent-committed");
    return {
      automatic_timeline_scheduled: true,
      is_new_generation: true,
      transcript_id: transcriptId
    };
  });
  mocks.reconcileAutomaticTimeline.mockImplementation(async () => {
    mocks.activeScenario?.events.push("reconciled");
    return { status: "not_scheduled" };
  });
  mocks.replaceTranscriptSearchChunks.mockImplementation(async () => {
    mocks.activeScenario?.events.push("search-index-persisted");
    return { status: "complete" };
  });
});

describe("automatic timeline persistence hooks", () => {
  it("attempts a new live intent only after transcript, generation marker and completion persist", async () => {
    const scenario: HookScenario = {
      events: [],
      existingLiveTranscript: { id: transcriptId, transcription_job_id: null },
      route: "live"
    };
    installScenario(scenario);

    const response = await persistLiveTranscript(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/live-transcript`, {
        body: JSON.stringify({ rawText: "Live transcript", segments: [] }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(scenario.events).toEqual([
      "transcript-persisted",
      "search-index-persisted",
      "transcription-job-persisted",
      "completion-and-intent-committed",
      "reconciled"
    ]);
  });

  it("reconciles a repeated live completion without resnapshotting current enabled settings", async () => {
    const scenario: HookScenario = {
      events: [],
      existingLiveTranscript: {
        id: transcriptId,
        transcription_job_id: "00000000-0000-4000-8000-000000000605"
      },
      route: "live"
    };
    installScenario(scenario);

    const response = await persistLiveTranscript(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/live-transcript`, {
        body: JSON.stringify({ rawText: "Repeated live transcript", segments: [] }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.persistTranscriptCompletionTransition).toHaveBeenCalledOnce();
    expect(mocks.reconcileAutomaticTimeline).toHaveBeenCalledOnce();
    expect(scenario.events.at(-1)).toBe("reconciled");
  });

  it("attempts an imported transcript intent only after the transcript and search index persist", async () => {
    const scenario: HookScenario = {
      events: [],
      existingLiveTranscript: null,
      route: "import"
    };
    installScenario(scenario);

    const response = await importTranscript(new NextRequest("http://localhost/api/recordings/import-transcript", {
      body: JSON.stringify({ rawText: "Imported transcript with enough useful content." }),
      headers: { "content-type": "application/json" },
      method: "POST"
    }));

    expect(response.status).toBe(200);
    expect(scenario.events).toEqual([
      "recording-persisted",
      "transcript-persisted",
      "search-index-persisted",
      "completion-and-intent-committed",
      "reconciled"
    ]);
  });
});
