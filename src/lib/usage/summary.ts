import type { SupabaseClient } from "@supabase/supabase-js";
import { aiModelOptions } from "@/lib/model-options";

export type AiUsageRow = {
  created_at: string;
  input_token_count: number | null;
  model: string;
  output_token_count: number | null;
  status: string;
};

export type RecordingUsageRow = {
  created_at: string;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  id: string;
  status: string;
};
export type TranscriptionUsageRow = {
  created_at: string;
  mode: string;
  provider: string;
  recording_id: string;
  status: string;
};

type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type UsageModelBreakdown = {
  estimatedCostUsd: number | null;
  inputTokens: number;
  jobCount: number;
  model: string;
  outputTokens: number;
};

export type CurrentMonthUsageSummary = {
  ai: {
    estimatedCostUsd: number;
    inputTokens: number;
    jobCount: number;
    jobsMissingTokenUsage: number;
    modelBreakdown: UsageModelBreakdown[];
    outputTokens: number;
    unpricedModelIds: string[];
  };
  period: {
    endIso: string;
    startIso: string;
  };
  recordings: {
    count: number;
    deletedCount: number;
    totalDurationSeconds: number | null;
    totalFileSizeBytes: number | null;
    withDurationCount: number;
    withFileSizeCount: number;
  };
  soniox: {
    asyncDurationSeconds: number;
    asyncEstimatedCostUsd: number;
    billableDurationSeconds: number;
    estimatedCostUsd: number;
    jobCount: number;
    jobsMissingDurationCount: number;
    jobsWithDurationCount: number;
    realtimeDurationSeconds: number;
    realtimeEstimatedCostUsd: number;
  };
};

export type CurrentMonthUsageState =
  | {
      error: null;
      summary: CurrentMonthUsageSummary;
    }
  | {
      error: string;
      summary: null;
    };

// Legacy prices keep historical usage estimates stable without exposing removed models in the UI.
const LEGACY_AI_PRICING_USD_PER_1M_TOKENS: Record<string, ModelPricing> = {
  "gemini-3.1-flash-lite": { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 1.5 },
  "gemini-3.1-pro-preview": { inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 12 },
  "gemini-3.5-flash": { inputUsdPerMillionTokens: 1.5, outputUsdPerMillionTokens: 9 },
  "gpt-4.1-mini": { inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6 },
  "gpt-4.1-nano": { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.4 },
  "gpt-5.4": { inputUsdPerMillionTokens: 2.5, outputUsdPerMillionTokens: 15 },
  "gpt-5.4-mini": { inputUsdPerMillionTokens: 0.75, outputUsdPerMillionTokens: 4.5 },
  "gpt-5.4-nano": { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 1.25 }
};

const AI_PRICING_USD_PER_1M_TOKENS: Record<string, ModelPricing> = {
  ...LEGACY_AI_PRICING_USD_PER_1M_TOKENS,
  ...Object.fromEntries(
    aiModelOptions.map((option) => [
      option.id,
      {
        inputUsdPerMillionTokens: option.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: option.outputUsdPerMillionTokens
      }
    ])
  )
};
const SONIOX_STT_EQUIVALENT_PRICING_USD_PER_HOUR = {
  async: 0.1,
  realtime: 0.12
} as const;

const aiUsageColumns = `
  created_at,
  input_token_count,
  model,
  output_token_count,
  status
`;

const recordingUsageColumns = `
  created_at,
  duration_seconds,
  file_size_bytes,
  id,
  status
`;
const transcriptionUsageColumns = `
  created_at,
  mode,
  provider,
  recording_id,
  status
`;

// getCurrentMonthPeriod returns the UTC month-to-date window used for usage queries.
function getCurrentMonthPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    endIso: end.toISOString(),
    startIso: start.toISOString()
  };
}

// calculateModelCostUsd estimates AI cost from stored token counts and local pricing metadata.
function calculateModelCostUsd(inputTokens: number, outputTokens: number, pricing: ModelPricing) {
  return (
    inputTokens * (pricing.inputUsdPerMillionTokens / 1_000_000)
    + outputTokens * (pricing.outputUsdPerMillionTokens / 1_000_000)
  );
}

// calculateHourlyCostUsd estimates duration-priced provider usage from seconds.
function calculateHourlyCostUsd(seconds: number, usdPerHour: number) {
  return (seconds / 3600) * usdPerHour;
}

// summarizeAiUsageRows aggregates AI processing jobs without mutating Supabase response rows.
export function summarizeAiUsageRows(rows: AiUsageRow[]) {
  const rowsByModel = rows.reduce<Record<string, UsageModelBreakdown>>((accumulator, row) => {
    const inputTokens = row.input_token_count ?? 0;
    const outputTokens = row.output_token_count ?? 0;
    const existing = accumulator[row.model] ?? {
      estimatedCostUsd: null,
      inputTokens: 0,
      jobCount: 0,
      model: row.model,
      outputTokens: 0
    };

    return {
      ...accumulator,
      [row.model]: {
        ...existing,
        inputTokens: existing.inputTokens + inputTokens,
        jobCount: existing.jobCount + 1,
        outputTokens: existing.outputTokens + outputTokens
      }
    };
  }, {});

  const modelBreakdown = Object.values(rowsByModel)
    .map((modelUsage) => {
      const pricing = AI_PRICING_USD_PER_1M_TOKENS[modelUsage.model];

      return {
        ...modelUsage,
        estimatedCostUsd: pricing
          ? calculateModelCostUsd(modelUsage.inputTokens, modelUsage.outputTokens, pricing)
          : null
      };
    })
    .sort((left, right) => right.jobCount - left.jobCount || left.model.localeCompare(right.model));

  return {
    estimatedCostUsd: modelBreakdown.reduce(
      (total, modelUsage) => total + (modelUsage.estimatedCostUsd ?? 0),
      0
    ),
    inputTokens: rows.reduce((total, row) => total + (row.input_token_count ?? 0), 0),
    jobCount: rows.length,
    jobsMissingTokenUsage: rows.filter(
      (row) => row.input_token_count === null && row.output_token_count === null
    ).length,
    modelBreakdown,
    outputTokens: rows.reduce((total, row) => total + (row.output_token_count ?? 0), 0),
    unpricedModelIds: modelBreakdown
      .filter((modelUsage) => modelUsage.estimatedCostUsd === null)
      .map((modelUsage) => modelUsage.model)
  };
}

// summarizeRecordingUsageRows aggregates recording counts and stored media metadata for the month.
export function summarizeRecordingUsageRows(rows: RecordingUsageRow[]) {
  const rowsWithDuration = rows.filter((row) => row.duration_seconds !== null);
  const rowsWithFileSize = rows.filter((row) => row.file_size_bytes !== null);

  return {
    count: rows.length,
    deletedCount: rows.filter((row) => row.status === "deleted").length,
    totalDurationSeconds: rowsWithDuration.length > 0
      ? rowsWithDuration.reduce((total, row) => total + (row.duration_seconds ?? 0), 0)
      : null,
    totalFileSizeBytes: rowsWithFileSize.length > 0
      ? rowsWithFileSize.reduce((total, row) => total + (row.file_size_bytes ?? 0), 0)
      : null,
    withDurationCount: rowsWithDuration.length,
    withFileSizeCount: rowsWithFileSize.length
  };
}

// summarizeSonioxUsageRows estimates STT spend from completed Soniox jobs and known audio durations.
export function summarizeSonioxUsageRows(
  jobs: TranscriptionUsageRow[],
  recordings: RecordingUsageRow[]
) {
  const recordingDurationById = new Map(
    recordings.map((recording) => [recording.id, recording.duration_seconds] as const)
  );
  const completedSonioxJobs = jobs.filter((job) => job.provider === "soniox" && job.status === "done");

  return completedSonioxJobs.reduce(
    (summary, job) => {
      const durationSeconds = recordingDurationById.get(job.recording_id) ?? null;

      if (durationSeconds === null) {
        return {
          ...summary,
          jobCount: summary.jobCount + 1,
          jobsMissingDurationCount: summary.jobsMissingDurationCount + 1
        };
      }

      const isRealtime = job.mode === "realtime";
      const cost = calculateHourlyCostUsd(
        durationSeconds,
        isRealtime
          ? SONIOX_STT_EQUIVALENT_PRICING_USD_PER_HOUR.realtime
          : SONIOX_STT_EQUIVALENT_PRICING_USD_PER_HOUR.async
      );

      return {
        ...summary,
        asyncDurationSeconds: isRealtime
          ? summary.asyncDurationSeconds
          : summary.asyncDurationSeconds + durationSeconds,
        asyncEstimatedCostUsd: isRealtime
          ? summary.asyncEstimatedCostUsd
          : summary.asyncEstimatedCostUsd + cost,
        billableDurationSeconds: summary.billableDurationSeconds + durationSeconds,
        estimatedCostUsd: summary.estimatedCostUsd + cost,
        jobCount: summary.jobCount + 1,
        jobsWithDurationCount: summary.jobsWithDurationCount + 1,
        realtimeDurationSeconds: isRealtime
          ? summary.realtimeDurationSeconds + durationSeconds
          : summary.realtimeDurationSeconds,
        realtimeEstimatedCostUsd: isRealtime
          ? summary.realtimeEstimatedCostUsd + cost
          : summary.realtimeEstimatedCostUsd
      };
    },
    {
      asyncDurationSeconds: 0,
      asyncEstimatedCostUsd: 0,
      billableDurationSeconds: 0,
      estimatedCostUsd: 0,
      jobCount: 0,
      jobsMissingDurationCount: 0,
      jobsWithDurationCount: 0,
      realtimeDurationSeconds: 0,
      realtimeEstimatedCostUsd: 0
    }
  );
}

// getUniqueRecordingIds extracts stable recording ids from transcription jobs for duration lookup.
function getUniqueRecordingIds(jobs: TranscriptionUsageRow[]) {
  return Array.from(new Set(jobs.map((job) => job.recording_id).filter(Boolean)));
}

// loadRecordingsForTranscriptionJobs loads recording durations for the selected job rows through RLS.
async function loadRecordingsForTranscriptionJobs(
  supabase: SupabaseClient,
  jobs: TranscriptionUsageRow[]
) {
  const recordingIds = getUniqueRecordingIds(jobs);

  if (recordingIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("recordings")
    .select(recordingUsageColumns)
    .in("id", recordingIds)
    .returns<RecordingUsageRow[]>();

  if (error) {
    throw new Error(`Unable to load Soniox recording durations: ${error.message}`);
  }

  return data ?? [];
}

// loadCurrentMonthUsageSummary loads authenticated usage data through Supabase RLS.
export async function loadCurrentMonthUsageSummary(supabase: SupabaseClient) {
  const period = getCurrentMonthPeriod();
  const [aiJobsResult, recordingsResult, transcriptionJobsResult] = await Promise.all([
    supabase
      .from("ai_processing_jobs")
      .select(aiUsageColumns)
      .gte("created_at", period.startIso)
      .lt("created_at", period.endIso)
      .order("created_at", { ascending: false })
      .returns<AiUsageRow[]>(),
    supabase
      .from("recordings")
      .select(recordingUsageColumns)
      .gte("created_at", period.startIso)
      .lt("created_at", period.endIso)
      .order("created_at", { ascending: false })
      .returns<RecordingUsageRow[]>(),
    supabase
      .from("transcription_jobs")
      .select(transcriptionUsageColumns)
      .eq("provider", "soniox")
      .gte("created_at", period.startIso)
      .lt("created_at", period.endIso)
      .order("created_at", { ascending: false })
      .returns<TranscriptionUsageRow[]>(),
  ]);

  if (aiJobsResult.error) {
    throw new Error(`Unable to load AI usage: ${aiJobsResult.error.message}`);
  }

  if (recordingsResult.error) {
    throw new Error(`Unable to load recording usage: ${recordingsResult.error.message}`);
  }

  if (transcriptionJobsResult.error) {
    throw new Error(`Unable to load Soniox usage: ${transcriptionJobsResult.error.message}`);
  }

  const sonioxRecordingRows = await loadRecordingsForTranscriptionJobs(
    supabase,
    transcriptionJobsResult.data ?? []
  );

  return {
    ai: summarizeAiUsageRows(aiJobsResult.data ?? []),
    period,
    recordings: summarizeRecordingUsageRows(recordingsResult.data ?? []),
    soniox: summarizeSonioxUsageRows(transcriptionJobsResult.data ?? [], sonioxRecordingRows)
  } satisfies CurrentMonthUsageSummary;
}

// loadCurrentMonthUsageState loads usage for settings while keeping the page usable on query errors.
export async function loadCurrentMonthUsageState(supabase: SupabaseClient): Promise<CurrentMonthUsageState> {
  try {
    return {
      error: null,
      summary: await loadCurrentMonthUsageSummary(supabase)
    };
  } catch {
    return {
      error: "Usage se teď nepodařilo načíst.",
      summary: null
    };
  }
}
