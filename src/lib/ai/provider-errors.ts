export const AI_FAILURE_CODES = [
  "insufficient_credit_or_quota",
  "rate_limited",
  "invalid_model",
  "provider_unavailable",
  "provider_configuration",
  "execution_interrupted",
  "persistence_failed",
  "unknown"
] as const;

export type AiFailureCode = typeof AI_FAILURE_CODES[number];
export type SafeAiFailure = { failureCode: AiFailureCode; retryAfterAt: string | null };

const SAFE_PROVIDER_ERROR_MESSAGE = "AI provider request failed.";
const MAX_RETRY_SECONDS = 24 * 60 * 60;
const IMF_FIXDATE_PATTERN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const OPENAI_QUOTA_SIGNALS = new Set(["billing_hard_limit_reached", "billing_not_active", "insufficient_quota"]);
const OPENAI_MODEL_SIGNALS = new Set(["invalid_model", "model_not_found", "unsupported_model"]);
const OPENAI_CONFIGURATION_SIGNALS = new Set(["authentication_error", "invalid_api_key", "permission_denied"]);
const GEMINI_QUOTA_REASONS = new Set([
  "BILLING_ACCOUNT_CLOSED",
  "BILLING_DISABLED",
  "QUOTA_EXCEEDED"
]);
const GEMINI_MODEL_REASONS = new Set(["MODEL_NOT_FOUND", "MODEL_UNSUPPORTED"]);

// SafeAiProviderError carries only allowlisted machine-readable metadata across server layers.
export class SafeAiProviderError extends Error {
  readonly failureCode: AiFailureCode;
  readonly retryAfterAt: string | null;

  constructor(failure: SafeAiFailure) {
    super(SAFE_PROVIDER_ERROR_MESSAGE);
    this.name = "SafeAiProviderError";
    this.failureCode = failure.failureCode;
    this.retryAfterAt = failure.retryAfterAt;
  }
}

// getManualAiFailureMessage maps persisted safe codes to fixed Czech UI copy.
export function getManualAiFailureMessage(code: AiFailureCode | null) {
  const messages: Record<AiFailureCode, string> = {
    execution_interrupted: "AI zpracování bylo přerušené. Spusťte nový pokus.",
    insufficient_credit_or_quota: "AI účet nemá dostatečný kredit nebo kvótu. Doplňte limit a spusťte nový pokus.",
    invalid_model: "Vybraný AI model není dostupný. Zvolte jiný model a spusťte nový pokus.",
    persistence_failed: "AI výstup se nepodařilo bezpečně uložit. Spusťte nový pokus.",
    provider_configuration: "AI služba není správně nakonfigurovaná. Zkontrolujte serverové nastavení.",
    provider_unavailable: "AI služba je dočasně nedostupná. Spusťte nový pokus.",
    rate_limited: "AI služba dočasně omezuje požadavky. Zkuste to znovu později.",
    unknown: "AI zpracování selhalo. Spusťte nový pokus."
  };
  return code ? messages[code] : messages.unknown;
}

// parseImfFixdate accepts only the standard HTTP wire-date and rejects Date.parse extensions.
function parseImfFixdate(value: string) {
  if (!IMF_FIXDATE_PATTERN.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toUTCString() === value ? timestamp : null;
}

// parseRetryAfter converts only integer delta-seconds or IMF-fixdate into a bounded timestamp.
function parseRetryAfter(value: string | null | undefined, nowMs: number) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let target: number;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds) || seconds > MAX_RETRY_SECONDS) return null;
    target = nowMs + seconds * 1_000;
  } else {
    const httpDate = parseImfFixdate(trimmed);
    if (httpDate === null) return null;
    target = httpDate;
  }
  return Number.isFinite(target) && target >= nowMs && target <= nowMs + MAX_RETRY_SECONDS * 1_000
    ? new Date(target).toISOString()
    : null;
}

// readObject narrows untrusted provider JSON without inspecting free-text fields.
function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// classifyOpenAIProviderError uses only status, error code/type and Retry-After.
export function classifyOpenAIProviderError(input: {
  nowMs?: number;
  payload: unknown;
  retryAfter?: string | null;
  status: number;
  transportFailure?: boolean;
}): SafeAiFailure {
  const payload = readObject(input.payload);
  const error = readObject(payload?.error);
  const code = typeof error?.code === "string" ? error.code : null;
  const type = typeof error?.type === "string" ? error.type : null;
  let failureCode: AiFailureCode = "unknown";
  if ((code !== null && OPENAI_QUOTA_SIGNALS.has(code)) || (type !== null && OPENAI_QUOTA_SIGNALS.has(type))) {
    failureCode = "insufficient_credit_or_quota";
  } else if (code === "rate_limit_exceeded" || type === "rate_limit_error") {
    failureCode = "rate_limited";
  } else if (code !== null && OPENAI_MODEL_SIGNALS.has(code)) {
    failureCode = "invalid_model";
  } else if ((code !== null && OPENAI_CONFIGURATION_SIGNALS.has(code)) || input.status === 401 || input.status === 403) {
    failureCode = "provider_configuration";
  } else if (input.transportFailure || input.status === 408 || (input.status >= 500 && input.status <= 599)) {
    failureCode = "provider_unavailable";
  } else if (input.status === 429) {
    failureCode = "rate_limited";
  }
  return {
    failureCode,
    retryAfterAt: failureCode === "rate_limited"
      ? parseRetryAfter(input.retryAfter, input.nowMs ?? Date.now())
      : null
  };
}

// parseGeminiRetryInfo accepts only google.rpc.RetryInfo retryDelay metadata.
function parseGeminiRetryInfo(details: unknown[], nowMs: number) {
  for (const detailValue of details) {
    const detail = readObject(detailValue);
    if (detail?.["@type"] !== "type.googleapis.com/google.rpc.RetryInfo") continue;
    const delay = typeof detail.retryDelay === "string" ? detail.retryDelay.match(/^(\d+)(?:\.(\d+))?s$/) : null;
    if (!delay) continue;
    const seconds = Number(delay[1]) + Number(`0.${delay[2] ?? "0"}`);
    if (seconds <= MAX_RETRY_SECONDS) return new Date(nowMs + seconds * 1_000).toISOString();
  }
  return null;
}

// classifyGeminiProviderError uses numeric code, allowlisted status and typed detail metadata only.
export function classifyGeminiProviderError(input: {
  nowMs?: number;
  payload: unknown;
  status: number;
  transportFailure?: boolean;
}): SafeAiFailure {
  const payload = readObject(input.payload);
  const error = readObject(payload?.error);
  const details = Array.isArray(error?.details) ? error.details : [];
  const status = typeof error?.status === "string" ? error.status : null;
  const numericCode = typeof error?.code === "number" ? error.code : null;
  let explicitQuota = false;
  let explicitModel = false;
  for (const detailValue of details) {
    const detail = readObject(detailValue);
    if (!detail) continue;
    if (detail["@type"] === "type.googleapis.com/google.rpc.QuotaFailure") explicitQuota = true;
    if (detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" && detail.domain === "googleapis.com") {
      const reason = typeof detail.reason === "string" ? detail.reason : "";
      if (GEMINI_QUOTA_REASONS.has(reason)) explicitQuota = true;
      if (GEMINI_MODEL_REASONS.has(reason)) explicitModel = true;
    }
  }
  let failureCode: AiFailureCode = "unknown";
  if (explicitQuota) failureCode = "insufficient_credit_or_quota";
  else if (explicitModel) failureCode = "invalid_model";
  else if (input.status === 401 || input.status === 403 || numericCode === 401 || numericCode === 403
    || status === "UNAUTHENTICATED" || status === "PERMISSION_DENIED") failureCode = "provider_configuration";
  else if (input.transportFailure || input.status === 408 || numericCode === 408
    || (input.status >= 500 && input.status <= 599) || (numericCode !== null && numericCode >= 500 && numericCode <= 599)
    || status === "DEADLINE_EXCEEDED" || status === "INTERNAL" || status === "UNAVAILABLE") failureCode = "provider_unavailable";
  else if (input.status === 429 || numericCode === 429 || status === "RESOURCE_EXHAUSTED") failureCode = "rate_limited";
  return {
    failureCode,
    retryAfterAt: failureCode === "rate_limited"
      ? parseGeminiRetryInfo(details, input.nowMs ?? Date.now())
      : null
  };
}

// getSafeAiFailure normalizes arbitrary worker failures into a non-sensitive settlement code.
export function getSafeAiFailure(error: unknown): SafeAiFailure {
  return error instanceof SafeAiProviderError
    ? { failureCode: error.failureCode, retryAfterAt: error.retryAfterAt }
    : { failureCode: "unknown", retryAfterAt: null };
}
