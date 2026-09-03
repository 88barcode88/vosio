import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createAutomaticTimelineGenerationIdentity,
  persistTranscriptCompletionTransition,
  reconcileAutomaticTimeline
} from "@/lib/ai/automatic-timeline.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUserSettingsFromMetadata } from "@/lib/settings/metadata";
import {
  createSonioxTranscription,
  getSonioxTranscriptionOptions,
  getSonioxTranscript,
  getSonioxTranscription,
  mapSonioxStatus
} from "@/lib/soniox/client";
import { sonioxRegionSchema, type SonioxRegion } from "@/lib/soniox/region";
import {
  RECORDINGS_BUCKET,
  isSegmentedRecordingStoragePath,
  isSupportedRecordingMimeType
} from "@/lib/recordings/types";
import { replaceTranscriptSearchChunks } from "@/lib/transcripts/search-index";
import { getTranscriptSearchWarningPayload } from "@/lib/transcripts/search-warning";
import { extractTranscriptSpeakerSummaries } from "@/lib/transcripts/speakers";
import {
  InvalidSafetyPartListingError,
  validateSafetyPartListing
} from "@/lib/live-recording/safety-parts";

const SEGMENTED_AUDIO_SOURCE = "supabase_recording_segment";

const routeParamsSchema = z.object({
  recordingId: z.uuid()
});

type SegmentTranscriptionJob = {
  id: string;
  provider_config: unknown;
  provider_job_id: string | null;
  status: string;
};

type RouteContext = {
  params: Promise<{
    recordingId: string;
  }>;
};

const TRANSCRIPTION_PROVIDER_FAILURE_MESSAGE =
  "Přepis u poskytovatele selhal. Zkuste jej spustit znovu.";

// routeErrorResponse returns a safe API error without leaking provider or transcript details.
function routeErrorResponse(error: unknown, fallbackMessage: string, status = 500) {
  if (error instanceof Error) {
    console.error("[Vosio transcription] Request failed.");
  }

  return NextResponse.json({ error: fallbackMessage }, { status });
}

// settleTranscriptionProviderFailure fails one attempt while preserving the uploaded recording audio.
export async function settleTranscriptionProviderFailure(input: {
  admin: ReturnType<typeof createAdminClient>;
  jobIds: string[];
  recordingId: string;
  userId: string;
}) {
  const completedAt = new Date().toISOString();
  const uniqueJobIds = [...new Set(input.jobIds)];

  if (uniqueJobIds.length > 0) {
    const { error: jobError } = await input.admin
      .from("transcription_jobs")
      .update({
        completed_at: completedAt,
        error_message: TRANSCRIPTION_PROVIDER_FAILURE_MESSAGE,
        status: "failed"
      })
      .eq("recording_id", input.recordingId)
      .eq("user_id", input.userId)
      .in("id", uniqueJobIds);

    if (jobError) {
      throw new Error(`Unable to settle failed transcription jobs: ${jobError.message}`);
    }
  }

  const { error: recordingError } = await input.admin
    .from("recordings")
    .update({
      error_message: TRANSCRIPTION_PROVIDER_FAILURE_MESSAGE,
      status: "uploaded"
    })
    .eq("id", input.recordingId)
    .eq("user_id", input.userId);

  if (recordingError) {
    throw new Error(`Unable to restore uploaded recording state: ${recordingError.message}`);
  }
}

// getAuthenticatedRecording verifies that the current user owns the requested recording.
async function getAuthenticatedRecording(recordingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 }) };
  }

  const { data: recording, error: recordingError } = await supabase
    .from("recordings")
    .select("id,user_id,title,storage_path,mime_type,status")
    .eq("id", recordingId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (recordingError) {
    return {
      error: routeErrorResponse(
        new Error(recordingError.message),
        "Nahrávku se teď nepodařilo načíst. Zkuste kontrolu znovu.",
        503
      )
    };
  }

  if (!recording) {
    return { error: NextResponse.json({ error: "Nahrávka nebyla nalezena." }, { status: 404 }) };
  }

  return { recording, supabase, user };
}

// getLatestJob loads the newest transcription job for a recording.
async function getLatestJob(input: {
  recordingId: string;
  userId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("transcription_jobs")
    .select("id,provider_job_id,status,provider_config")
    .eq("recording_id", input.recordingId)
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

// getProviderConfigString safely reads a string field from a transcription provider_config object.
function getProviderConfigString(providerConfig: unknown, key: string) {
  if (typeof providerConfig !== "object" || providerConfig === null || !(key in providerConfig)) {
    return null;
  }

  const value = providerConfig[key as keyof typeof providerConfig];

  return typeof value === "string" ? value : null;
}

// getProviderConfigNumber safely reads a number field from a transcription provider_config object.
function getProviderConfigNumber(providerConfig: unknown, key: string) {
  if (typeof providerConfig !== "object" || providerConfig === null || !(key in providerConfig)) {
    return null;
  }

  const value = providerConfig[key as keyof typeof providerConfig];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// getTranscriptionJobRegion reads the immutable job region and keeps legacy jobs on the global API.
function getTranscriptionJobRegion(providerConfig: unknown): SonioxRegion {
  const parsed = sonioxRegionSchema.safeParse(getProviderConfigString(providerConfig, "region"));

  return parsed.success ? parsed.data : "global";
}

// getPublicTranscriptionJob keeps internal provider configuration out of API responses.
function getPublicTranscriptionJob(job: SegmentTranscriptionJob) {
  return {
    id: job.id,
    provider_job_id: job.provider_job_id,
    status: job.status
  };
}

// getSegmentJobIndex returns the stored segment index for deterministic transcript merging.
function getSegmentJobIndex(job: SegmentTranscriptionJob) {
  return getProviderConfigNumber(job.provider_config, "segment_index") ?? 0;
}

// sortSegmentJobs orders segment jobs in the same order as their Storage object names.
function sortSegmentJobs(jobs: SegmentTranscriptionJob[]) {
  return [...jobs].sort((a, b) => getSegmentJobIndex(a) - getSegmentJobIndex(b));
}

// getAggregateJobStatus maps a segment batch to one status for the existing client contract.
function getAggregateJobStatus(jobs: SegmentTranscriptionJob[]) {
  if (jobs.some((job) => job.status === "failed")) {
    return "failed";
  }

  if (jobs.length > 0 && jobs.every((job) => job.status === "done")) {
    return "done";
  }

  if (jobs.some((job) => job.status === "running")) {
    return "running";
  }

  return "queued";
}

// getLatestSegmentBatch loads the newest Soniox async batch for a segmented live recording.
async function getLatestSegmentBatch(input: {
  admin: ReturnType<typeof createAdminClient>;
  recordingId: string;
  userId: string;
}) {
  const { data, error } = await input.admin
    .from("transcription_jobs")
    .select("id,provider_job_id,status,provider_config,created_at")
    .eq("recording_id", input.recordingId)
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const segmentJobs = ((data ?? []) as Array<SegmentTranscriptionJob & { created_at: string }>)
    .filter((job) => getProviderConfigString(job.provider_config, "audio_source") === SEGMENTED_AUDIO_SOURCE);
  const latestBatchId = segmentJobs.reduce<string | null>(
    (foundBatchId, job) => foundBatchId ?? getProviderConfigString(job.provider_config, "batch_id"),
    null
  );

  if (!latestBatchId) {
    return [];
  }

  return sortSegmentJobs(
    segmentJobs.filter((job) => getProviderConfigString(job.provider_config, "batch_id") === latestBatchId)
  );
}

// listSegmentStoragePaths returns live recording segment objects under a Storage prefix.
async function listSegmentStoragePaths(
  admin: ReturnType<typeof createAdminClient>,
  storagePrefix: string
) {
  const folder = storagePrefix.replace(/\/$/, "");
  const { data, error } = await admin.storage.from(RECORDINGS_BUCKET).list(folder);

  if (error) {
    throw new Error(`Unable to list live recording segments: ${error.message}`);
  }

  return validateSafetyPartListing(data ?? []).map((part) => `${folder}/${part.name}`);
}

// offsetSegmentTokenTimings shifts token timings by the cumulative duration of previous segments.
function offsetSegmentTokenTimings(token: unknown, offsetMs: number) {
  if (typeof token !== "object" || token === null) {
    return token;
  }

  const nextToken: Record<string, unknown> = { ...(token as Record<string, unknown>) };

  if (typeof nextToken.start_ms === "number") {
    nextToken.start_ms += offsetMs;
  }

  if (typeof nextToken.end_ms === "number") {
    nextToken.end_ms += offsetMs;
  }

  return nextToken;
}

// createSegmentedTranscriptionJobs creates one Soniox async job for each stored live audio part.
async function createSegmentedTranscriptionJobs(input: {
  admin: ReturnType<typeof createAdminClient>;
  recording: { id: string; storage_path: string; user_id: string };
  region: SonioxRegion;
  userId: string;
}) {
  const segmentPaths = await listSegmentStoragePaths(input.admin, input.recording.storage_path);

  if (segmentPaths.length === 0) {
    return {
      response: NextResponse.json(
        { error: "Segmentovaná nahrávka nemá uložené části audia." },
        { status: 409 }
      ),
      status: "invalid"
    };
  }

  const batchId = randomUUID();
  const providerConfig = getSonioxTranscriptionOptions();
  const createdJobs: SegmentTranscriptionJob[] = [];

  for (const [index, segmentPath] of segmentPaths.entries()) {
    const { data: signedUrl, error: signedUrlError } = await input.admin.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(segmentPath, 60 * 60 * 2);

    if (signedUrlError || !signedUrl) {
      throw new Error("Nepodařilo se vytvořit dočasný odkaz na část audia.");
    }

    const { data: initialJob, error: initialJobError } = await input.admin
      .from("transcription_jobs")
      .insert({
        mode: "async",
        provider: "soniox",
        provider_config: {
          ...providerConfig,
          audio_source: SEGMENTED_AUDIO_SOURCE,
          batch_id: batchId,
          segment_count: segmentPaths.length,
          segment_index: index,
          segment_path: segmentPath,
          region: input.region
        },
        recording_id: input.recording.id,
        status: "queued",
        user_id: input.userId
      })
      .select("id,provider_job_id,status,provider_config")
      .single();

    if (initialJobError || !initialJob) {
      throw new Error("Nepodařilo se uložit segmentový přepisovací job.");
    }

    const transcription = await createSonioxTranscription({
      audioUrl: signedUrl.signedUrl,
      clientReferenceId: initialJob.id,
      options: providerConfig,
      region: input.region
    }).catch(async (error: unknown) => {
      await settleTranscriptionProviderFailure({
        admin: input.admin,
        jobIds: [...createdJobs.map((job) => job.id), initialJob.id],
        recordingId: input.recording.id,
        userId: input.userId
      });
      throw error;
    });
    const jobStatus = mapSonioxStatus(transcription.status);
    const { data: job, error: jobError } = await input.admin
      .from("transcription_jobs")
      .update({
        provider_job_id: transcription.id,
        started_at: jobStatus === "running" ? new Date().toISOString() : null,
        status: jobStatus
      })
      .eq("id", initialJob.id)
      .select("id,provider_job_id,status,provider_config")
      .single();

    if (jobError || !job) {
      throw new Error("Nepodařilo se aktualizovat segmentový přepisovací job.");
    }

    createdJobs.push(job as SegmentTranscriptionJob);
  }

  const status = getAggregateJobStatus(createdJobs);

  if (status === "failed") {
    await settleTranscriptionProviderFailure({
      admin: input.admin,
      jobIds: createdJobs.map((job) => job.id),
      recordingId: input.recording.id,
      userId: input.userId
    });
  }

  return {
    response: NextResponse.json({
    job: { provider_job_id: null, status: getAggregateJobStatus(createdJobs) },
    reused: false
    }),
    status
  };
}

// refreshSegmentBatchJobs polls Soniox and persists the latest status for each segment job.
// Segments are independent, so they refresh in parallel to keep the 15s poll fast for long recordings.
async function refreshSegmentBatchJobs(input: {
  admin: ReturnType<typeof createAdminClient>;
  jobs: SegmentTranscriptionJob[];
  recordingId: string;
  userId: string;
}) {
  const refreshResults = await Promise.allSettled(input.jobs.map(async (job) => {
      if (!job.provider_job_id || job.status === "done" || job.status === "failed") {
        return job;
      }

      const transcription = await getSonioxTranscription(
        getTranscriptionJobRegion(job.provider_config),
        job.provider_job_id
      );
      const jobStatus = mapSonioxStatus(transcription.status);
      const { data, error } = await input.admin
        .from("transcription_jobs")
        .update({
          completed_at:
            jobStatus === "done" || jobStatus === "failed" ? new Date().toISOString() : null,
          error_message: transcription.error_message ?? null,
          status: jobStatus
        })
        .eq("id", job.id)
        .select("id,provider_job_id,status,provider_config")
        .single();

      if (error || !data) {
        throw new Error("Nepodařilo se aktualizovat stav segmentového přepisu.");
      }

      return data as SegmentTranscriptionJob;
  }));
  const rejected = refreshResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );

  if (rejected) {
    await settleTranscriptionProviderFailure({
      admin: input.admin,
      jobIds: input.jobs.map((job) => job.id),
      recordingId: input.recordingId,
      userId: input.userId
    });
    throw rejected.reason;
  }
  const refreshedJobs = refreshResults.map(
    (result) => (result as PromiseFulfilledResult<SegmentTranscriptionJob>).value
  );

  return sortSegmentJobs(refreshedJobs);
}

// saveCombinedSegmentTranscript stores one transcript assembled from completed segment jobs.
async function saveCombinedSegmentTranscript(input: {
  admin: ReturnType<typeof createAdminClient>;
  jobs: SegmentTranscriptionJob[];
  recordingId: string;
  userId: string;
}) {
  let cumulativeDurationMs = 0;
  const rawTextParts: string[] = [];
  const combinedTokens: unknown[] = [];

  for (const job of sortSegmentJobs(input.jobs)) {
    if (!job.provider_job_id) {
      throw new Error("Segmentový přepis nemá provider job id.");
    }

    const [transcription, transcript] = await Promise.all([
      getSonioxTranscription(getTranscriptionJobRegion(job.provider_config), job.provider_job_id),
      getSonioxTranscript(getTranscriptionJobRegion(job.provider_config), job.provider_job_id)
    ]);

    rawTextParts.push(transcript.text.trim());
    combinedTokens.push(
      ...transcript.tokens.map((token) => offsetSegmentTokenTimings(token, cumulativeDurationMs))
    );
    cumulativeDurationMs += transcription.audio_duration_ms ?? 0;
  }

  const rawText = rawTextParts.filter(Boolean).join("\n\n");
  const speakers = extractTranscriptSpeakerSummaries(combinedTokens);
  const { data: existingTranscript, error: existingTranscriptError } = await input.admin
    .from("transcripts")
    .select("id")
    .eq("recording_id", input.recordingId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (existingTranscriptError) {
    throw new Error(`Unable to look up saved transcript: ${existingTranscriptError.message}`);
  }

  const transcriptWrite = existingTranscript
    ? await input.admin
      .from("transcripts")
      .update({
        raw_text: rawText,
        segments: combinedTokens,
        speakers
      })
      .eq("id", existingTranscript.id)
      .eq("user_id", input.userId)
      .select("id,recording_id,user_id,raw_text,segments,speakers")
      .single()
    : await input.admin
      .from("transcripts")
      .insert({
        raw_text: rawText,
        recording_id: input.recordingId,
        segments: combinedTokens,
        speakers,
        transcription_job_id: null,
        user_id: input.userId
      })
      .select("id,recording_id,user_id,raw_text,segments,speakers")
      .single();

  if (transcriptWrite.error || !transcriptWrite.data) {
    throw new Error("Unable to save combined segment transcript");
  }

  const indexResult = await replaceTranscriptSearchChunks(input.admin, transcriptWrite.data);

  return {
    durationSeconds: getSonioxAudioDurationSeconds(cumulativeDurationMs),
    indexResult,
    transcriptId: transcriptWrite.data.id
  };
}

// getSonioxAudioDurationSeconds converts provider audio duration metadata into stored seconds.
function getSonioxAudioDurationSeconds(audioDurationMs: number | undefined) {
  if (typeof audioDurationMs !== "number" || !Number.isFinite(audioDurationMs) || audioDurationMs <= 0) {
    return null;
  }

  return Math.max(1, Math.ceil(audioDurationMs / 1000));
}

// resetRecordingTranscriptionState prepares local job state before a manual retranscription.
async function resetRecordingTranscriptionState(input: {
  admin: ReturnType<typeof createAdminClient>;
  recordingId: string;
  userId: string;
}) {
  const now = new Date().toISOString();
  const { error: jobError } = await input.admin
    .from("transcription_jobs")
    .update({
      completed_at: now,
      error_message: "Superseded by manual retranscription",
      status: "cancelled"
    })
    .eq("recording_id", input.recordingId)
    .eq("user_id", input.userId)
    .in("status", ["queued", "running"]);

  if (jobError) {
    throw new Error(`Unable to cancel old transcription jobs: ${jobError.message}`);
  }

  const { error: recordingError } = await input.admin
    .from("recordings")
    .update({ error_message: null, status: "uploaded" })
    .eq("id", input.recordingId)
    .eq("user_id", input.userId);

  if (recordingError) {
    throw new Error(`Unable to reset recording state: ${recordingError.message}`);
  }
}

// POST creates a Soniox async transcription job for an uploaded recording.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = routeParamsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Neplatné ID nahrávky." }, { status: 400 });
    }

    const authenticated = await getAuthenticatedRecording(params.data.recordingId);

    if (authenticated.error) {
      return authenticated.error;
    }

    const { recording, user } = authenticated;
    const region = getUserSettingsFromMetadata(user.user_metadata).sonioxRegion;

    if (!recording.storage_path) {
      return NextResponse.json({ error: "Nahrávka nemá uložený audio soubor." }, { status: 409 });
    }

    if (recording.status === "uploading" || recording.status === "created") {
      return NextResponse.json({ error: "Nahrávka ještě není nahraná." }, { status: 409 });
    }

    const shouldRestart = request.nextUrl.searchParams.get("restart") === "1";
    const admin = createAdminClient();
    const isSegmentedRecording = isSegmentedRecordingStoragePath(recording.storage_path);

    if (!isSegmentedRecording && !isSupportedRecordingMimeType(recording.mime_type)) {
      return NextResponse.json({ error: "Nahrávka nemá podporovaný formát pro přepis." }, { status: 409 });
    }

    if (shouldRestart) {
      await resetRecordingTranscriptionState({
        admin,
        recordingId: recording.id,
        userId: user.id
      });
    }

    if (isSegmentedRecording) {
      const existingSegmentJobs = shouldRestart
        ? []
        : await getLatestSegmentBatch({
          admin,
          recordingId: recording.id,
          userId: user.id
        });

      if (existingSegmentJobs.length > 0) {
        const existingSegmentStatus = getAggregateJobStatus(existingSegmentJobs);

        if (["queued", "running", "done"].includes(existingSegmentStatus)) {
          return NextResponse.json({
            job: { provider_job_id: null, status: existingSegmentStatus },
            reused: true
          });
        }
      }

      const segmentedCreation = await createSegmentedTranscriptionJobs({
        admin,
        recording: {
          id: recording.id,
          storage_path: recording.storage_path,
          user_id: user.id
        },
        region,
        userId: user.id
      });

      if (!["failed", "invalid"].includes(segmentedCreation.status)) {
        const { error: recordingStatusError } = await admin
          .from("recordings")
          .update({ status: "transcribing" })
          .eq("id", recording.id)
          .eq("user_id", user.id);

        if (recordingStatusError) {
          throw new Error(`Unable to update recording status: ${recordingStatusError.message}`);
        }
      }

      return segmentedCreation.response;
    }

    const existingJob = shouldRestart
      ? null
      : await getLatestJob({ recordingId: recording.id, userId: user.id });

    if (existingJob && ["queued", "running", "done"].includes(existingJob.status)) {
      return NextResponse.json({ job: getPublicTranscriptionJob(existingJob), reused: true });
    }

    const { data: signedUrl, error: signedUrlError } = await admin.storage
      .from(RECORDINGS_BUCKET)
      .createSignedUrl(recording.storage_path, 60 * 60 * 2);

    if (signedUrlError || !signedUrl) {
      return NextResponse.json({ error: "Nepodařilo se vytvořit dočasný odkaz na audio." }, { status: 500 });
    }

    const providerConfig = getSonioxTranscriptionOptions();
    const { data: initialJob, error: initialJobError } = await admin
      .from("transcription_jobs")
      .insert({
        mode: "async",
        provider: "soniox",
        provider_config: {
          ...providerConfig,
          audio_source: "supabase_signed_url",
          region
        },
        recording_id: recording.id,
        status: "queued",
        user_id: user.id
      })
      .select("id,provider_job_id,status")
      .single();

    if (initialJobError || !initialJob) {
      return NextResponse.json({ error: "Nepodařilo se uložit přepisovací job." }, { status: 500 });
    }

    const transcription = await createSonioxTranscription({
      audioUrl: signedUrl.signedUrl,
      clientReferenceId: initialJob.id,
      options: providerConfig,
      region
    }).catch(async (error: unknown) => {
      await settleTranscriptionProviderFailure({
        admin,
        jobIds: [initialJob.id],
        recordingId: recording.id,
        userId: user.id
      });
      throw error;
    });

    const jobStatus = mapSonioxStatus(transcription.status);
    const { data: job, error: jobError } = await admin
      .from("transcription_jobs")
      .update({
        provider_job_id: transcription.id,
        started_at: jobStatus === "running" ? new Date().toISOString() : null,
        status: jobStatus
      })
      .eq("id", initialJob.id)
      .select("id,provider_job_id,status")
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Nepodařilo se aktualizovat přepisovací job." }, { status: 500 });
    }

    if (jobStatus === "failed") {
      await settleTranscriptionProviderFailure({
        admin,
        jobIds: [initialJob.id],
        recordingId: recording.id,
        userId: user.id
      });

      return NextResponse.json({ job: { ...job, status: "failed" }, reused: false });
    }

    const { error: recordingStatusError } = await admin
      .from("recordings")
      .update({ status: "transcribing" })
      .eq("id", recording.id)
      .eq("user_id", user.id);

    if (recordingStatusError) {
      throw new Error(`Unable to update recording status: ${recordingStatusError.message}`);
    }

    return NextResponse.json({ job, reused: false });
  } catch (error) {
    if (error instanceof InvalidSafetyPartListingError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return routeErrorResponse(error, "Nepodařilo se založit přepis.");
  }
}

// GET polls Soniox for status and stores the completed transcript when ready.
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const params = routeParamsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Neplatné ID nahrávky." }, { status: 400 });
    }

    const authenticated = await getAuthenticatedRecording(params.data.recordingId);

    if (authenticated.error) {
      return authenticated.error;
    }

    const { recording, user } = authenticated;
    const admin = createAdminClient();

    if (recording.storage_path && isSegmentedRecordingStoragePath(recording.storage_path)) {
      const segmentJobs = await getLatestSegmentBatch({
        admin,
        recordingId: recording.id,
        userId: user.id
      });

      if (segmentJobs.length === 0) {
        return NextResponse.json({ error: "Segmentové přepisovací joby nebyly nalezeny." }, { status: 404 });
      }

      const refreshedJobs = await refreshSegmentBatchJobs({
        admin,
        jobs: segmentJobs,
        recordingId: recording.id,
        userId: user.id
      });
      const jobStatus = getAggregateJobStatus(refreshedJobs);

      if (jobStatus === "failed") {
        await settleTranscriptionProviderFailure({
          admin,
          jobIds: refreshedJobs.map((job) => job.id),
          recordingId: recording.id,
          userId: user.id
        });

        return NextResponse.json({ job: { provider_job_id: null, status: jobStatus } });
      }

      if (jobStatus !== "done") {
        return NextResponse.json({ job: { provider_job_id: null, status: jobStatus } });
      }

      const generationIdentity = createAutomaticTimelineGenerationIdentity({
        jobIds: refreshedJobs.map((job) => job.id),
        kind: "segmented"
      });
      const {
        durationSeconds,
        indexResult,
        transcriptId
      } = await saveCombinedSegmentTranscript({
        admin,
        jobs: refreshedJobs,
        recordingId: recording.id,
        userId: user.id
      });

      const completion = await persistTranscriptCompletionTransition({
        admin,
        durationSeconds,
        generationIdentity,
        generationKind: "segmented",
        transcriptId,
        transcriptionJobId: refreshedJobs.at(-1)?.id ?? null,
        user
      });
      if (completion.automatic_timeline_scheduled) {
        await reconcileAutomaticTimeline({ admin, transcriptId, userId: user.id }).catch(() => {
          console.error("[Vosio automatic timeline] Post-completion enqueue failed.");
        });
      }

      return NextResponse.json({
        job: { provider_job_id: null, status: jobStatus },
        ...getTranscriptSearchWarningPayload(indexResult)
      });
    }

    const latestJob = await getLatestJob({ recordingId: recording.id, userId: user.id });

    if (!latestJob?.provider_job_id) {
      return NextResponse.json({ error: "Přepisovací job nebyl nalezen." }, { status: 404 });
    }

    const region = getTranscriptionJobRegion(latestJob.provider_config);
    const transcription = await getSonioxTranscription(region, latestJob.provider_job_id).catch(
      async (error: unknown) => {
        await settleTranscriptionProviderFailure({
          admin,
          jobIds: [latestJob.id],
          recordingId: recording.id,
          userId: user.id
        });
        throw error;
      }
    );
    const jobStatus = mapSonioxStatus(transcription.status);

    const { error: jobUpdateError } = await admin
      .from("transcription_jobs")
      .update({
        completed_at:
          jobStatus === "done" || jobStatus === "failed" ? new Date().toISOString() : null,
        error_message: transcription.error_message ?? null,
        status: jobStatus
      })
      .eq("id", latestJob.id);

    if (jobUpdateError) {
      throw new Error(`Unable to update transcription job status: ${jobUpdateError.message}`);
    }

    if (jobStatus === "failed") {
      await settleTranscriptionProviderFailure({
        admin,
        jobIds: [latestJob.id],
        recordingId: recording.id,
        userId: user.id
      });

      return NextResponse.json({
        job: { ...getPublicTranscriptionJob(latestJob), status: jobStatus }
      });
    }

    if (jobStatus !== "done") {
      return NextResponse.json({
        job: { ...getPublicTranscriptionJob(latestJob), status: jobStatus }
      });
    }

    const durationSeconds = getSonioxAudioDurationSeconds(transcription.audio_duration_ms);
    const transcript = await getSonioxTranscript(region, latestJob.provider_job_id);
    const speakers = extractTranscriptSpeakerSummaries(transcript.tokens);
    const { data: existingTranscript, error: existingTranscriptError } = await admin
      .from("transcripts")
      .select("id")
      .eq("recording_id", recording.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingTranscriptError) {
      throw new Error(`Unable to look up saved transcript: ${existingTranscriptError.message}`);
    }

    const generationIdentity = createAutomaticTimelineGenerationIdentity({
      kind: "async",
      transcriptionJobId: latestJob.id
    });

    const transcriptWrite = existingTranscript
      ? await admin
        .from("transcripts")
        .update({
          raw_text: transcript.text,
          segments: transcript.tokens,
          speakers
        })
        .eq("id", existingTranscript.id)
        .eq("user_id", user.id)
        .select("id,recording_id,user_id,raw_text,segments,speakers")
        .single()
      : await admin
        .from("transcripts")
        .insert({
          raw_text: transcript.text,
          recording_id: recording.id,
          segments: transcript.tokens,
          speakers,
          transcription_job_id: null,
          user_id: user.id
        })
        .select("id,recording_id,user_id,raw_text,segments,speakers")
        .single();

    if (transcriptWrite.error || !transcriptWrite.data) {
      throw new Error("Unable to save transcript");
    }

    const indexResult = await replaceTranscriptSearchChunks(admin, transcriptWrite.data);

    const completion = await persistTranscriptCompletionTransition({
      admin,
      durationSeconds,
      generationIdentity,
      generationKind: "async",
      transcriptId: transcriptWrite.data.id,
      transcriptionJobId: latestJob.id,
      user
    });
    if (completion.automatic_timeline_scheduled) {
      await reconcileAutomaticTimeline({
        admin,
        transcriptId: transcriptWrite.data.id,
        userId: user.id
      }).catch(() => {
        console.error("[Vosio automatic timeline] Post-completion enqueue failed.");
      });
    }

    return NextResponse.json({
      job: { ...getPublicTranscriptionJob(latestJob), status: jobStatus },
      transcript: { id: transcript.id, text: transcript.text },
      ...getTranscriptSearchWarningPayload(indexResult)
    });
  } catch (error) {
    return routeErrorResponse(error, "Nepodařilo se zkontrolovat stav přepisu.");
  }
}
