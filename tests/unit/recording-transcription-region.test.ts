import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  createSonioxTranscription: vi.fn(),
  getSonioxTranscript: vi.fn(),
  getSonioxTranscription: vi.fn(),
  mapSonioxStatus: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/soniox/client", () => ({
  createSonioxTranscription: mocks.createSonioxTranscription,
  getSonioxTranscript: mocks.getSonioxTranscript,
  getSonioxTranscription: mocks.getSonioxTranscription,
  getSonioxTranscriptionOptions: vi.fn(() => ({ model: "stt-async-v4" })),
  mapSonioxStatus: mocks.mapSonioxStatus
}));
vi.mock("@/lib/transcripts/search-index", () => ({ replaceTranscriptSearchChunks: vi.fn() }));
vi.mock("@/lib/transcripts/search-warning", () => ({ getTranscriptSearchWarningPayload: vi.fn() }));
vi.mock("@/lib/transcripts/speakers", () => ({ extractTranscriptSpeakerSummaries: vi.fn() }));
vi.mock("@/lib/transcripts/retranscription", () => ({ getRetranscriptionCleanupTranscriptId: vi.fn() }));

import { GET, POST } from "@/../app/api/recordings/[recordingId]/transcription/route";

const recordingId = "00000000-0000-4000-8000-000000000201";
const userId = "user-region";

type QueryResult = { data?: unknown; error: { message: string } | null };

// createQuery builds a minimal awaitable Supabase query and exposes write/select arguments to assertions.
function createQuery(input: {
  maybeSingle?: QueryResult;
  result?: QueryResult;
  single?: QueryResult;
}) {
  const query = {
    delete: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    insert: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => input.maybeSingle ?? input.result ?? { data: null, error: null }),
    order: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => input.single ?? input.result ?? { data: null, error: null }),
    then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(
      input.result ?? { data: null, error: null }
    ).then(resolve),
    update: vi.fn()
  };

  for (const method of ["delete", "eq", "in", "insert", "limit", "order", "select", "update"] as const) {
    query[method].mockReturnValue(query);
  }

  return query;
}

// mockAuthenticatedRecording returns one owned audio recording and a controllable metadata region.
function mockAuthenticatedRecording(region: unknown, storagePath = `${userId}/${recordingId}/recording.m4a`) {
  const getUser = vi.fn(async () => ({
    data: {
      user: {
        id: userId,
        user_metadata: { vosio_settings: { sonioxRegion: region } }
      }
    },
    error: null
  }));
  const recordingQuery = createQuery({
    result: {
      data: {
        id: recordingId,
        mime_type: "audio/mp4",
        status: "uploaded",
        storage_path: storagePath,
        title: "Regional fixture",
        user_id: userId
      },
      error: null
    }
  });

  mocks.createClient.mockResolvedValue({
    auth: { getUser },
    from: vi.fn(() => recordingQuery)
  });

  return getUser;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSonioxTranscription.mockResolvedValue({ id: "provider-new", status: "running" });
  mocks.getSonioxTranscription.mockResolvedValue({ id: "provider-existing", status: "running" });
  mocks.mapSonioxStatus.mockReturnValue("running");
});

describe("recording transcription Soniox region", () => {
  it("distinguishes a transient recording lookup failure from a missing recording", async () => {
    const recordingQuery = createQuery({
      result: { data: null, error: { message: "temporary database failure" } }
    });
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId, user_metadata: {} } },
          error: null
        }))
      },
      from: vi.fn(() => recordingQuery)
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Nahrávku se teď nepodařilo načíst. Zkuste kontrolu znovu."
    });
    expect(recordingQuery.maybeSingle).toHaveBeenCalledOnce();
    expect(recordingQuery.single).not.toHaveBeenCalled();
  });

  it("returns not found only when the owned recording row is genuinely absent", async () => {
    const recordingQuery = createQuery({ result: { data: null, error: null } });
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: userId, user_metadata: {} } },
          error: null
        }))
      },
      from: vi.fn(() => recordingQuery)
    });

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Nahrávka nebyla nalezena." });
  });

  it.each([
    ["eu", "eu"],
    ["jp", "global"]
  ] as const)("normalizes metadata region %s to %s for a new job and Soniox", async (metadataRegion, expectedRegion) => {
    const getUser = mockAuthenticatedRecording(metadataRegion);
    const latestJobQuery = createQuery({ maybeSingle: { data: null, error: null } });
    const initialJobQuery = createQuery({
      single: { data: { id: "job-new", provider_job_id: null, status: "queued" }, error: null }
    });
    const updatedJobQuery = createQuery({
      single: { data: { id: "job-new", provider_job_id: "provider-new", status: "running" }, error: null }
    });
    const recordingUpdateQuery = createQuery({ result: { data: null, error: null } });
    const queries = [latestJobQuery, initialJobQuery, updatedJobQuery, recordingUpdateQuery];
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => queries.shift()),
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(async () => ({
            data: { signedUrl: "https://storage.test/audio" },
            error: null
          }))
        }))
      }
    });

    const response = await POST(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`, { method: "POST" }),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(initialJobQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      provider_config: expect.objectContaining({ region: expectedRegion })
    }));
    expect(mocks.createSonioxTranscription).toHaveBeenCalledWith(expect.objectContaining({ region: expectedRegion }));
  });

  it("polls a regular job with its stored region even when current metadata differs", async () => {
    mockAuthenticatedRecording("global");
    const latestJobQuery = createQuery({
      maybeSingle: {
        data: {
          id: "job-existing",
          provider_config: { region: "eu" },
          provider_job_id: "provider-existing",
          status: "running"
        },
        error: null
      }
    });
    const statusUpdateQuery = createQuery({ result: { data: null, error: null } });
    const queries = [latestJobQuery, statusUpdateQuery];
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => queries.shift()) });

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(latestJobQuery.select).toHaveBeenCalledWith(expect.stringContaining("provider_config"));
    expect(mocks.getSonioxTranscription).toHaveBeenCalledWith("eu", "provider-existing");
    expect(statusUpdateQuery.update).toHaveBeenCalledWith(expect.not.objectContaining({ provider_config: expect.anything() }));
  });

  it("loads a completed regular transcript with the stored EU job region", async () => {
    mockAuthenticatedRecording("global");
    const latestJobQuery = createQuery({
      maybeSingle: {
        data: {
          id: "job-completed-eu",
          provider_config: { region: "eu" },
          provider_job_id: "provider-completed-eu",
          status: "running"
        },
        error: null
      }
    });
    const statusUpdateQuery = createQuery({ result: { data: null, error: null } });
    const transcriptLookupQuery = createQuery({ maybeSingle: { data: null, error: null } });
    const transcriptInsertQuery = createQuery({
      single: {
        data: {
          id: "transcript-regular",
          raw_text: "Completed EU text",
          recording_id: recordingId,
          segments: [],
          speakers: [],
          user_id: userId
        },
        error: null
      }
    });
    const recordingUpdateQuery = createQuery({ result: { data: null, error: null } });
    const queries = [
      latestJobQuery,
      statusUpdateQuery,
      transcriptLookupQuery,
      transcriptInsertQuery,
      recordingUpdateQuery
    ];
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => queries.shift()) });
    mocks.getSonioxTranscription.mockResolvedValue({
      audio_duration_ms: 1_000,
      id: "provider-completed-eu",
      status: "completed"
    });
    mocks.getSonioxTranscript.mockResolvedValue({ text: "Completed EU text", tokens: [] });
    mocks.mapSonioxStatus.mockReturnValue("done");

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.getSonioxTranscription).toHaveBeenCalledWith("eu", "provider-completed-eu");
    expect(mocks.getSonioxTranscript).toHaveBeenCalledWith("eu", "provider-completed-eu");
  });

  it.each([
    ["missing", { model: "stt-async-v4" }],
    ["invalid", { model: "stt-async-v4", region: "moon" }]
  ] as const)("uses explicit global routing for a legacy job with %s region", async (_label, providerConfig) => {
    mockAuthenticatedRecording("eu");
    const latestJobQuery = createQuery({
      maybeSingle: {
        data: {
          id: "job-legacy",
          provider_config: providerConfig,
          provider_job_id: "provider-legacy",
          status: "running"
        },
        error: null
      }
    });
    const statusUpdateQuery = createQuery({ result: { data: null, error: null } });
    const queries = [latestJobQuery, statusUpdateQuery];
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => queries.shift()) });

    await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(mocks.getSonioxTranscription).toHaveBeenCalledWith("global", "provider-legacy");
  });

  it("stores and sends the selected region for every new segmented job", async () => {
    mockAuthenticatedRecording("eu", `${userId}/${recordingId}/live/`);
    const existingBatchQuery = createQuery({ result: { data: [], error: null } });
    const initialJobQuery = createQuery({
      single: {
        data: {
          id: "segment-job",
          provider_config: { audio_source: "supabase_recording_segment", region: "eu" },
          provider_job_id: null,
          status: "queued"
        },
        error: null
      }
    });
    const updatedJobQuery = createQuery({
      single: {
        data: {
          id: "segment-job",
          provider_config: { audio_source: "supabase_recording_segment", region: "eu" },
          provider_job_id: "provider-segment",
          status: "running"
        },
        error: null
      }
    });
    const recordingUpdateQuery = createQuery({ result: { data: null, error: null } });
    const queries = [existingBatchQuery, initialJobQuery, updatedJobQuery, recordingUpdateQuery];
    const list = vi.fn(async () => ({ data: [{ name: "0001.webm" }], error: null }));
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: "https://storage.test/segment" },
      error: null
    }));
    mocks.createSonioxTranscription.mockResolvedValue({ id: "provider-segment", status: "running" });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => queries.shift()),
      storage: { from: vi.fn(() => ({ createSignedUrl, list })) }
    });

    const response = await POST(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`, { method: "POST" }),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(initialJobQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      provider_config: expect.objectContaining({ region: "eu", segment_index: 0 })
    }));
    expect(mocks.createSonioxTranscription).toHaveBeenCalledWith(expect.objectContaining({ region: "eu" }));
  });

  it("polls every running job in a multi-segment batch with its stored EU region", async () => {
    mockAuthenticatedRecording("global", `${userId}/${recordingId}/live/`);
    const segmentJobs = [0, 1].map((segmentIndex) => ({
      created_at: `2026-08-12T12:00:0${segmentIndex}.000Z`,
      id: `segment-job-${segmentIndex}`,
      provider_config: {
        audio_source: "supabase_recording_segment",
        batch_id: "batch-eu-running",
        region: "eu",
        segment_index: segmentIndex
      },
      provider_job_id: `provider-segment-${segmentIndex}`,
      status: "running"
    }));
    const segmentBatchQuery = createQuery({ result: { data: segmentJobs, error: null } });
    const segmentUpdateQueries = segmentJobs.map((job) => createQuery({
      single: { data: job, error: null }
    }));
    const queries = [segmentBatchQuery, ...segmentUpdateQueries];
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => queries.shift()) });
    mocks.getSonioxTranscription.mockImplementation(async (_region, providerJobId: string) => ({
      id: providerJobId,
      status: "running"
    }));
    mocks.mapSonioxStatus.mockReturnValue("running");

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.getSonioxTranscription).toHaveBeenCalledTimes(2);
    expect(mocks.getSonioxTranscription).toHaveBeenNthCalledWith(1, "eu", "provider-segment-0");
    expect(mocks.getSonioxTranscription).toHaveBeenNthCalledWith(2, "eu", "provider-segment-1");
    for (const query of segmentUpdateQueries) {
      expect(query.update).toHaveBeenCalledWith(expect.not.objectContaining({ provider_config: expect.anything() }));
    }
  });

  it("loads a completed segmented transcript with the job region instead of current metadata", async () => {
    mockAuthenticatedRecording("global", `${userId}/${recordingId}/live/`);
    const segmentBatchQuery = createQuery({
      result: {
        data: [{
          created_at: "2026-08-12T12:00:00.000Z",
          id: "segment-job",
          provider_config: {
            audio_source: "supabase_recording_segment",
            batch_id: "batch-eu",
            region: "eu",
            segment_index: 0
          },
          provider_job_id: "provider-segment",
          status: "done"
        }],
        error: null
      }
    });
    const transcriptLookupQuery = createQuery({ maybeSingle: { data: null, error: null } });
    const transcriptInsertQuery = createQuery({
      single: {
        data: {
          id: "transcript-segment",
          raw_text: "Segment text",
          recording_id: recordingId,
          segments: [],
          speakers: [],
          user_id: userId
        },
        error: null
      }
    });
    const recordingUpdateQuery = createQuery({ result: { data: null, error: null } });
    const queries = [
      segmentBatchQuery,
      transcriptLookupQuery,
      transcriptInsertQuery,
      recordingUpdateQuery
    ];
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => queries.shift()) });
    mocks.getSonioxTranscription.mockResolvedValue({
      audio_duration_ms: 1_000,
      id: "provider-segment",
      status: "done"
    });
    mocks.getSonioxTranscript.mockResolvedValue({ text: "Segment text", tokens: [] });

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.getSonioxTranscription).toHaveBeenCalledWith("eu", "provider-segment");
    expect(mocks.getSonioxTranscript).toHaveBeenCalledWith("eu", "provider-segment");
  });
});
