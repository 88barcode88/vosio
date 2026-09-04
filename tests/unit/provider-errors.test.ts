import { describe, expect, it } from "vitest";
import {
  classifyGeminiProviderError,
  classifyOpenAIProviderError,
  getManualAiFailureMessage,
  SafeAiProviderError
} from "@/lib/ai/provider-errors";

const secret = "SECRET-SENTINEL-provider-message";

describe("safe provider error classification", () => {
  it.each([
    [429, "insufficient_quota", null, "insufficient_credit_or_quota"],
    [429, "billing_hard_limit_reached", null, "insufficient_credit_or_quota"],
    [429, null, "billing_not_active", "insufficient_credit_or_quota"],
    [429, "rate_limit_exceeded", null, "rate_limited"],
    [400, null, "rate_limit_error", "rate_limited"],
    [429, null, null, "rate_limited"],
    [404, "model_not_found", null, "invalid_model"],
    [400, "invalid_model", null, "invalid_model"],
    [400, "unsupported_model", null, "invalid_model"],
    [401, "invalid_api_key", null, "provider_configuration"],
    [403, "authentication_error", null, "provider_configuration"],
    [400, "permission_denied", null, "provider_configuration"],
    [401, null, null, "provider_configuration"],
    [403, null, null, "provider_configuration"],
    [408, null, null, "provider_unavailable"],
    [503, null, null, "provider_unavailable"],
    [400, "rate_limit_error", null, "unknown"],
    [400, null, "rate_limit_exceeded", "unknown"],
    [400, null, "unsupported_model", "unknown"],
    [400, null, null, "unknown"]
  ])("classifies OpenAI status=%s code=%s type=%s", (status, code, type, expected) => {
    expect(classifyOpenAIProviderError({
      payload: { error: { code, message: secret, type } },
      status: status as number
    }).failureCode).toBe(expected);
  });

  it.each([
    [429, "RESOURCE_EXHAUSTED", [], "rate_limited"],
    [429, null, [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure" }], "insufficient_credit_or_quota"],
    [429, null, [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: "BILLING_DISABLED" }], "insufficient_credit_or_quota"],
    [429, null, [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: "BILLING_ACCOUNT_CLOSED" }], "insufficient_credit_or_quota"],
    [429, null, [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: "QUOTA_EXCEEDED" }], "insufficient_credit_or_quota"],
    [400, "INVALID_ARGUMENT", [], "unknown"],
    [404, "NOT_FOUND", [], "unknown"],
    [404, "NOT_FOUND", [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: "MODEL_NOT_FOUND" }], "invalid_model"],
    [400, "INVALID_ARGUMENT", [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: "MODEL_UNSUPPORTED" }], "invalid_model"],
    [400, "UNAUTHENTICATED", [], "provider_configuration"],
    [400, "PERMISSION_DENIED", [], "provider_configuration"],
    [408, "UNKNOWN", [], "provider_unavailable"],
    [500, "UNKNOWN", [], "provider_unavailable"],
    [400, "DEADLINE_EXCEEDED", [], "provider_unavailable"],
    [400, "INTERNAL", [], "provider_unavailable"],
    [400, "UNAVAILABLE", [], "provider_unavailable"],
    [400, "FAILED_PRECONDITION", [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "example.invalid", reason: "BILLING_DISABLED" }], "unknown"],
    [400, "FAILED_PRECONDITION", [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", domain: "googleapis.com", reason: "RATE_LIMIT_EXCEEDED" }], "unknown"]
  ])("classifies Gemini status=%s structuredStatus=%s", (httpStatus, status, details, expected) => {
    expect(classifyGeminiProviderError({
      payload: { error: { code: httpStatus, details, message: secret, status } },
      status: httpStatus as number
    }).failureCode).toBe(expected);
  });

  it("classifies only an explicit transport discriminator as unavailable", () => {
    expect(classifyOpenAIProviderError({ payload: null, status: 0, transportFailure: true }).failureCode)
      .toBe("provider_unavailable");
    expect(classifyGeminiProviderError({ payload: null, status: 0, transportFailure: true }).failureCode)
      .toBe("provider_unavailable");
  });

  it.each([
    [401, "provider_configuration"],
    [403, "provider_configuration"],
    [408, "provider_unavailable"],
    [429, "rate_limited"],
    [502, "provider_unavailable"]
  ])("accepts Gemini numeric code %s as structured transport metadata", (numericCode, expected) => {
    expect(classifyGeminiProviderError({
      payload: { error: { code: numericCode, message: secret, status: "UNKNOWN" } },
      status: 400
    }).failureCode).toBe(expected);
  });

  it("never exposes provider free text and parses only bounded typed retry metadata", () => {
    const openai = classifyOpenAIProviderError({
      nowMs: Date.parse("2026-09-04T10:00:00Z"),
      payload: { error: { code: "rate_limit_exceeded", message: secret } },
      retryAfter: "30",
      status: 429
    });
    const gemini = classifyGeminiProviderError({
      nowMs: Date.parse("2026-09-04T10:00:00Z"),
      payload: { error: { code: 429, details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "45s" }], message: secret } },
      status: 429
    });
    expect(openai.retryAfterAt).toBe("2026-09-04T10:00:30.000Z");
    expect(gemini.retryAfterAt).toBe("2026-09-04T10:00:45.000Z");
    expect(JSON.stringify([openai, gemini])).not.toContain(secret);
    expect(new SafeAiProviderError(openai).message).not.toContain(secret);
  });

  it.each(["-1", "1.5", "1e2", "+10", "86401"])("rejects unsafe Retry-After delta %s", (retryAfter) => {
    expect(classifyOpenAIProviderError({
      nowMs: Date.parse("2026-09-04T10:00:00Z"),
      payload: { error: { code: "rate_limit_exceeded" } },
      retryAfter,
      status: 429
    }).retryAfterAt).toBeNull();
  });

  it("accepts a bounded Retry-After HTTP date and rejects an excessive typed retry delay", () => {
    const nowMs = Date.parse("2026-09-04T10:00:00Z");
    expect(classifyOpenAIProviderError({
      nowMs,
      payload: { error: { code: "rate_limit_exceeded" } },
      retryAfter: "Fri, 04 Sep 2026 10:01:00 GMT",
      status: 429
    }).retryAfterAt).toBe("2026-09-04T10:01:00.000Z");
    expect(classifyGeminiProviderError({
      nowMs,
      payload: { error: { code: 429, details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "86401s" }] } },
      status: 429
    }).retryAfterAt).toBeNull();
  });

  it.each([
    "2026-09-04T10:01:00.000Z",
    "09/04/2026 10:01:00 GMT",
    "Friday, 04-Sep-26 10:01:00 GMT"
  ])("rejects non-IMF Retry-After date %s", (retryAfter) => {
    expect(classifyOpenAIProviderError({
      nowMs: Date.parse("2026-09-04T10:00:00Z"),
      payload: { error: { code: "rate_limit_exceeded" } },
      retryAfter,
      status: 429
    }).retryAfterAt).toBeNull();
  });

  it.each([
    ["insufficient_credit_or_quota", "AI účet nemá dostatečný kredit nebo kvótu. Doplňte limit a spusťte nový pokus."],
    ["rate_limited", "AI služba dočasně omezuje požadavky. Zkuste to znovu později."],
    ["invalid_model", "Vybraný AI model není dostupný. Zvolte jiný model a spusťte nový pokus."],
    ["provider_unavailable", "AI služba je dočasně nedostupná. Spusťte nový pokus."],
    ["provider_configuration", "AI služba není správně nakonfigurovaná. Zkontrolujte serverové nastavení."],
    ["execution_interrupted", "AI zpracování bylo přerušené. Spusťte nový pokus."],
    ["persistence_failed", "AI výstup se nepodařilo bezpečně uložit. Spusťte nový pokus."],
    ["unknown", "AI zpracování selhalo. Spusťte nový pokus."]
  ] as const)("uses fixed Czech recovery copy for %s", (code, message) => {
    expect(getManualAiFailureMessage(code)).toBe(message);
  });
});
