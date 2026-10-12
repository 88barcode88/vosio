import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAiModelOption } from "@/lib/model-options";

export type AiUsageRow = {
  created_at: string;
  input_token_count: number | null;
  model: string;
  output_token_count: number | null;
  status: string;
};

export type RecordingDurationRow = {
  duration_seconds: number | null;
  id: string;
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

const SONIOX_STT_EQUIVALENT_PRICING_USD_PER_HOUR = {
  async: 0.1,
  realtime: 0.12
} as const;

const ownedJobsSchema = z.object({
  ai: z.array(z.object({ created_at: z.string(), model: z.string(), status: z.string(),
    input_token_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    output_token_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable() })),
  soniox: z.array(z.object({ created_at: z.string(), mode: z.string(), provider: z.literal("soniox"), recording_id: z.string(), status: z.string() }))
});

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
      const pricing = getAiModelOption(modelUsage.model)
        ?? LEGACY_AI_PRICING_USD_PER_1M_TOKENS[modelUsage.model];

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

// Parses PostgREST bigint/numeric values only when their integer value is exactly representable.
function parseUsageInteger(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) {
    throw new Error("Invalid recording usage number");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid recording usage number");
  return parsed;
}

// Validates the single owner aggregate row while preserving NULL sums and their coverage counts.
function parseOwnedRecordingSummary(data: unknown): CurrentMonthUsageSummary["recordings"] {
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== "object") {
    throw new Error("Invalid recording usage response");
  }
  const row = data[0];
  const result = {
    count: parseUsageInteger(row.count),
    deletedCount: parseUsageInteger(row.deleted_count),
    totalDurationSeconds: row.total_duration_seconds === null ? null : parseUsageInteger(row.total_duration_seconds),
    totalFileSizeBytes: row.total_file_size_bytes === null ? null : parseUsageInteger(row.total_file_size_bytes),
    withDurationCount: parseUsageInteger(row.with_duration_count),
    withFileSizeCount: parseUsageInteger(row.with_file_size_count)
  };
  if (result.deletedCount > result.count || result.withDurationCount > result.count || result.withFileSizeCount > result.count
    || (result.withDurationCount === 0) !== (result.totalDurationSeconds === null)
    || (result.withFileSizeCount === 0) !== (result.totalFileSizeBytes === null)) {
    throw new Error("Invalid recording usage coverage");
  }
  return result;
}

// summarizeSonioxUsageRows estimates STT spend from completed Soniox jobs and known audio durations.
export function summarizeSonioxUsageRows(
  jobs: TranscriptionUsageRow[],
  recordings: RecordingDurationRow[]
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

// Loads only technical-owner durations in bounded session RPC batches, independent of current content access.
async function loadRecordingsForTranscriptionJobs(
  supabase: SupabaseClient,
  jobs: TranscriptionUsageRow[]
) {
  const recordingIds = getUniqueRecordingIds(jobs);

  const rows: RecordingDurationRow[] = [];
  for (let offset = 0; offset < recordingIds.length; offset += 1000) {
    const ids = recordingIds.slice(offset, offset + 1000);
    const { data, error } = await supabase.rpc("get_owned_recording_durations_v1", { p_recording_ids: ids });
    if (error || !Array.isArray(data)) throw new Error("Unable to load Soniox recording durations");
    const requested = new Set(ids);
    const seen = new Set<string>();
    for (const row of data) {
      if (!row || typeof row !== "object" || typeof row.recording_id !== "string"
        || !requested.has(row.recording_id) || seen.has(row.recording_id)
        || (row.duration_seconds !== null && (typeof row.duration_seconds !== "number"
          || !Number.isInteger(row.duration_seconds) || row.duration_seconds < 0 || row.duration_seconds > 2147483647))) {
        throw new Error("Invalid owned recording duration response");
      }
      seen.add(row.recording_id);
      rows.push({ id: row.recording_id, duration_seconds: row.duration_seconds });
    }
  }
  return rows;
}

// Loads owner-only jobs and narrow recording accounting RPCs, never the broader shared content scope.
export async function loadCurrentMonthUsageSummary(supabase: SupabaseClient) {
  const period = getCurrentMonthPeriod();
  const [jobsResult, recordingsResult] = await Promise.all([
    supabase.rpc("get_owned_job_usage_v1", { p_created_from: period.startIso, p_created_before: period.endIso }),
    supabase.rpc("get_owned_recording_usage_summary_v1", {
      p_created_from: period.startIso,
      p_created_before: period.endIso
    })
  ]);

  if (jobsResult.error) {
    throw new Error("Unable to load owned job accounting");
  }

  if (recordingsResult.error) {
    throw new Error(`Unable to load recording usage: ${recordingsResult.error.message}`);
  }

  const jobs = ownedJobsSchema.parse(jobsResult.data);
  const recordings = parseOwnedRecordingSummary(recordingsResult.data);
  const sonioxRecordingRows = await loadRecordingsForTranscriptionJobs(
    supabase,
    jobs.soniox
  );

  return {
    ai: summarizeAiUsageRows(jobs.ai),
    period,
    recordings,
    soniox: summarizeSonioxUsageRows(jobs.soniox, sonioxRecordingRows)
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
