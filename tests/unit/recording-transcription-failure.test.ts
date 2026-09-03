import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  createSonioxTranscription: vi.fn(),
  getSonioxTranscription: vi.fn()
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/ai/automatic-timeline.server", () => ({
  createAutomaticTimelineGenerationIdentity: vi.fn(),
  persistTranscriptCompletionTransition: vi.fn(),
  reconcileAutomaticTimeline: vi.fn()
}));
vi.mock("@/lib/soniox/client", () => ({
  createSonioxTranscription: mocks.createSonioxTranscription,
  getSonioxTranscript: vi.fn(),
  getSonioxTranscription: mocks.getSonioxTranscription,
  getSonioxTranscriptionOptions: vi.fn(() => ({ model: "stt-async-v5" })),
  mapSonioxStatus: vi.fn((status: string) => status)
}));
vi.mock("@/lib/transcripts/search-index", () => ({ replaceTranscriptSearchChunks: vi.fn() }));
vi.mock("@/lib/transcripts/search-warning", () => ({ getTranscriptSearchWarningPayload: vi.fn() }));
vi.mock("@/lib/transcripts/speakers", () => ({ extractTranscriptSpeakerSummaries: vi.fn() }));

import {
  GET,
  POST,
  settleTranscriptionProviderFailure
} from "@/../app/api/recordings/[recordingId]/transcription/route";

const recordingId = "00000000-0000-4000-8000-000000000601";
const userId = "owner-failure";

// createWriteQuery records terminal job and recording writes without emulating unrelated Supabase reads.
function createWriteQuery() {
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: { data: null; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
    update: vi.fn()
  };
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.update.mockReturnValue(query);
  return query;
}

type QueryResult = { data: unknown; error: { message: string } | null };

// createQuery models the fluent Supabase reads and writes exercised by provider failure exits.
function createQuery(result: QueryResult) {
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    insert: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    order: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => result),
    then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
    update: vi.fn()
  };
  for (const method of ["eq", "in", "insert", "limit", "order", "select", "update"] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

// mockAuthenticatedRecording returns the owned audio row used by POST and GET failure tests.
function mockAuthenticatedRecording(storagePath: string) {
  const recordingQuery = createQuery({
    data: {
      id: recordingId,
      mime_type: "audio/webm",
      status: "uploaded",
      storage_path: storagePath,
      title: "Failure fixture",
      user_id: userId
    },
    error: null
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
}

// createFailureAdmin returns ordered table queries plus canonical Storage operations.
function createFailureAdmin(queries: ReturnType<typeof createQuery>[], partNames: string[] = []) {
  return {
    from: vi.fn(() => queries.shift()),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://storage.test/audio" }, error: null })),
        list: vi.fn(async () => ({ data: partNames.map((name) => ({ name })), error: null }))
      }))
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createSonioxTranscription.mockRejectedValue(new Error("provider create details"));
  mocks.getSonioxTranscription.mockRejectedValue(new Error("provider poll details"));
});

describe("transcription provider failure settlement", () => {
  it("fails only the affected regular job and restores the recording to uploaded", async () => {
    const jobs = createWriteQuery();
    const recording = createWriteQuery();
    const admin = { from: vi.fn((table: string) => table === "transcription_jobs" ? jobs : recording) };

    await settleTranscriptionProviderFailure({
      admin: admin as never,
      jobIds: ["job-1"],
      providerError: new Error("Soniox request sk-secret123 failed"),
      recordingId: "recording-1",
      userId: "user-1"
    });

    expect(jobs.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "Soniox request sk-*** failed",
      status: "failed"
    }));
    expect(jobs.in).toHaveBeenCalledWith("id", ["job-1"]);
    expect(recording.update).toHaveBeenCalledWith({
      error_message: "Přepis u poskytovatele selhal. Zkuste jej spustit znovu.",
      status: "uploaded"
    });
  });

  it("fails every job in one affected segmented batch without rewriting audio metadata", async () => {
    const jobs = createWriteQuery();
    const recording = createWriteQuery();
    const admin = { from: vi.fn((table: string) => table === "transcription_jobs" ? jobs : recording) };

    await settleTranscriptionProviderFailure({
      admin: admin as never,
      jobIds: ["part-job-0", "part-job-1"],
      recordingId: "recording-1",
      userId: "user-1"
    });

    expect(jobs.in).toHaveBeenCalledWith("id", ["part-job-0", "part-job-1"]);
    expect(recording.update).toHaveBeenCalledWith(expect.not.objectContaining({
      duration_seconds: expect.anything(),
      file_size_bytes: expect.anything(),
      mime_type: expect.anything(),
      storage_path: expect.anything()
    }));
  });

  it("settles a regular provider create rejection and keeps recording retryable", async () => {
    mockAuthenticatedRecording(`${userId}/${recordingId}/recording.webm`);
    const latest = createQuery({ data: null, error: null });
    const inserted = createQuery({ data: { id: "regular-create", provider_job_id: null, status: "queued" }, error: null });
    const jobFailure = createQuery({ data: null, error: null });
    const recordingFailure = createQuery({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(createFailureAdmin([
      latest,
      inserted,
      jobFailure,
      recordingFailure
    ]));

    const response = await POST(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`, { method: "POST" }),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(500);
    expect(jobFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "provider create details",
      status: "failed"
    }));
    expect(recordingFailure.update).toHaveBeenCalledWith(expect.objectContaining({ status: "uploaded" }));
    expect(JSON.stringify(await response.json())).not.toContain("provider create details");
  });

  it("settles the affected segmented batch when provider create rejects", async () => {
    mockAuthenticatedRecording(`${userId}/${recordingId}/live/`);
    const existingBatch = createQuery({ data: [], error: null });
    const inserted = createQuery({
      data: { id: "segment-create", provider_config: {}, provider_job_id: null, status: "queued" },
      error: null
    });
    const batchFailure = createQuery({ data: null, error: null });
    const recordingFailure = createQuery({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(createFailureAdmin(
      [existingBatch, inserted, batchFailure, recordingFailure],
      ["part-000000.webm"]
    ));

    const response = await POST(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`, { method: "POST" }),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(500);
    expect(batchFailure.in).toHaveBeenCalledWith("id", ["segment-create"]);
    expect(batchFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "provider create details"
    }));
    expect(recordingFailure.update).toHaveBeenCalledWith(expect.objectContaining({ status: "uploaded" }));
    expect(JSON.stringify(await response.json())).not.toContain("provider create details");
  });

  it("settles a regular terminal poll rejection instead of stranding transcribing", async () => {
    mockAuthenticatedRecording(`${userId}/${recordingId}/recording.webm`);
    const latest = createQuery({
      data: {
        id: "regular-poll",
        provider_config: { region: "global" },
        provider_job_id: "provider-regular",
        status: "running"
      },
      error: null
    });
    const jobFailure = createQuery({ data: null, error: null });
    const recordingFailure = createQuery({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(createFailureAdmin([latest, jobFailure, recordingFailure]));

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(500);
    expect(jobFailure.in).toHaveBeenCalledWith("id", ["regular-poll"]);
    expect(jobFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "provider poll details"
    }));
    expect(recordingFailure.update).toHaveBeenCalledWith(expect.objectContaining({ status: "uploaded" }));
    expect(JSON.stringify(await response.json())).not.toContain("provider poll details");
  });

  it("settles a segmented terminal poll rejection as one affected batch", async () => {
    mockAuthenticatedRecording(`${userId}/${recordingId}/live/`);
    const jobs = [0, 1].map((index) => ({
      created_at: `2026-09-03T12:00:0${index}.000Z`,
      id: `segment-poll-${index}`,
      provider_config: {
        audio_source: "supabase_recording_segment",
        batch_id: "batch-poll",
        region: "global",
        segment_index: index
      },
      provider_job_id: `provider-segment-${index}`,
      status: "running"
    }));
    const latestBatch = createQuery({ data: jobs, error: null });
    const batchFailure = createQuery({ data: null, error: null });
    const recordingFailure = createQuery({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(createFailureAdmin([
      latestBatch,
      batchFailure,
      recordingFailure
    ]));

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(500);
    expect(batchFailure.in).toHaveBeenCalledWith("id", ["segment-poll-0", "segment-poll-1"]);
    expect(batchFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "provider poll details"
    }));
    expect(recordingFailure.update).toHaveBeenCalledWith(expect.objectContaining({ status: "uploaded" }));
    expect(JSON.stringify(await response.json())).not.toContain("provider poll details");
  });

  it("preserves a regular terminal provider detail only on the failed job", async () => {
    mockAuthenticatedRecording(`${userId}/${recordingId}/recording.webm`);
    mocks.getSonioxTranscription.mockResolvedValue({
      error_message: "regular terminal detail",
      id: "provider-regular",
      status: "failed"
    });
    const latest = createQuery({
      data: {
        id: "regular-terminal",
        provider_config: { region: "global" },
        provider_job_id: "provider-regular",
        status: "running"
      },
      error: null
    });
    const statusUpdate = createQuery({ data: null, error: null });
    const jobFailure = createQuery({ data: null, error: null });
    const recordingFailure = createQuery({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(createFailureAdmin([
      latest,
      statusUpdate,
      jobFailure,
      recordingFailure
    ]));

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(statusUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "regular terminal detail",
      status: "failed"
    }));
    expect(jobFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "regular terminal detail"
    }));
    expect(recordingFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "Přepis u poskytovatele selhal. Zkuste jej spustit znovu."
    }));
    expect(JSON.stringify(await response.json())).not.toContain("regular terminal detail");
  });

  it("preserves a segmented terminal provider detail while failing the current batch", async () => {
    mockAuthenticatedRecording(`${userId}/${recordingId}/live/`);
    const jobs = [0, 1].map((index) => ({
      created_at: `2026-09-03T12:00:0${index}.000Z`,
      id: `segment-terminal-${index}`,
      provider_config: {
        audio_source: "supabase_recording_segment",
        batch_id: "batch-terminal",
        region: "global",
        segment_index: index
      },
      provider_job_id: `provider-segment-${index}`,
      status: "running"
    }));
    mocks.getSonioxTranscription
      .mockResolvedValueOnce({
        error_message: "segment terminal detail",
        id: "provider-segment-0",
        status: "failed"
      })
      .mockResolvedValueOnce({ id: "provider-segment-1", status: "running" });
    const latestBatch = createQuery({ data: jobs, error: null });
    const failedRefresh = createQuery({ data: { ...jobs[0], status: "failed" }, error: null });
    const runningRefresh = createQuery({ data: jobs[1], error: null });
    const batchFailure = createQuery({ data: null, error: null });
    const recordingFailure = createQuery({ data: null, error: null });
    mocks.createAdminClient.mockReturnValue(createFailureAdmin([
      latestBatch,
      failedRefresh,
      runningRefresh,
      batchFailure,
      recordingFailure
    ]));

    const response = await GET(
      new NextRequest(`http://localhost/api/recordings/${recordingId}/transcription`),
      { params: Promise.resolve({ recordingId }) }
    );

    expect(response.status).toBe(200);
    expect(failedRefresh.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "segment terminal detail",
      status: "failed"
    }));
    expect(batchFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "segment terminal detail"
    }));
    expect(recordingFailure.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: "Přepis u poskytovatele selhal. Zkuste jej spustit znovu."
    }));
    expect(JSON.stringify(await response.json())).not.toContain("segment terminal detail");
  });
});
