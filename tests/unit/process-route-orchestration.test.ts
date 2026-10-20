import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistCompletedAiProcessing } from "@/lib/ai/process-route-orchestration";
import { NO_RECORDING_CAPABILITIES } from "@/lib/recording-sharing/resolve-capabilities";
import { POST } from "../../app/api/transcripts/[transcriptId]/process/route";

const routeMocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
  afterError: null as Error | null,
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  rateLimit: vi.fn(),
  runGeminiProcessing: vi.fn(),
  runManualAiJob: vi.fn(),
  runOpenAIProcessing: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (callback: () => unknown) => {
    if (routeMocks.afterError) throw routeMocks.afterError;
    routeMocks.afterCallbacks.push(callback);
  }
}));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => routeMocks.rateLimit,
}));
vi.mock("@/lib/env.server", () => ({ getAiProviderConfigurationError: () => null }));
vi.mock("@/lib/ai/gemini", () => ({ runGeminiProcessing: routeMocks.runGeminiProcessing }));
vi.mock("@/lib/ai/manual-processing.server", () => ({ runManualAiJob: routeMocks.runManualAiJob }));
vi.mock("@/lib/ai/openai", () => ({ runOpenAIProcessing: routeMocks.runOpenAIProcessing }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: routeMocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: routeMocks.createClient }));

const transcriptId = "00000000-0000-4000-8000-000000000811";
const userId = "00000000-0000-4000-8000-000000000812";
const systemPromptId = "00000000-0000-4000-8000-000000000813";
const overrideId = "00000000-0000-4000-8000-000000000814";

beforeEach(() => {
  vi.resetAllMocks();
  routeMocks.afterCallbacks.length = 0;
  routeMocks.afterError = null;
  routeMocks.rateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
});

// createRouteFixture exposes the authenticated resolver, durable job insert and provider order.
function createRouteFixture(effectivePrompt: {
  system_prompt_id: string;
  override_id: string | null;
  name: string;
  processing_type: "action_items";
  prompt_text: string;
  output_schema: unknown;
  source: "system" | "user_override";
  revision: number | null;
}) {
  const events: string[] = [];
  const transcriptQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  transcriptQuery.select.mockReturnValue(transcriptQuery);
  transcriptQuery.eq.mockReturnValue(transcriptQuery);
  transcriptQuery.single.mockResolvedValue({
    data: { id: transcriptId, recording_id: transcriptId, raw_text: "Potvrzený přepis hovoru.", segments: [], speakers: [], user_id: userId },
    error: null,
  });
  const resolverChain = { returns: vi.fn(), single: vi.fn() };
  resolverChain.returns.mockReturnValue(resolverChain);
  resolverChain.single.mockResolvedValue({ data: effectivePrompt, error: null });
  const rpc = vi.fn().mockImplementation((name) => name === "recording_capabilities_v1"
    ? Promise.resolve({ data: { ...NO_RECORDING_CAPABILITIES, read: true, runPersonalAi: true }, error: null }) : resolverChain);
  routeMocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn((tableName: string) => {
      if (tableName !== "transcripts") throw new Error(`Unexpected authenticated table ${tableName}`);
      return transcriptQuery;
    }),
    rpc,
  });

  const jobInsert = vi.fn((_payload: unknown) => {
    events.push("job-inserted");
    return jobQuery;
  });
  const jobQuery = {
    eq: vi.fn(),
    insert: jobInsert,
    maybeSingle: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    update: vi.fn(),
  };
  jobQuery.select.mockReturnValue(jobQuery);
  jobQuery.eq.mockReturnValue(jobQuery);
  jobQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
  jobQuery.single.mockResolvedValue({ data: { id: "job-1" }, error: null });
  jobQuery.update.mockReturnValue(jobQuery);
  const outputQuery = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };
  outputQuery.insert.mockReturnValue(outputQuery);
  outputQuery.select.mockReturnValue(outputQuery);
  outputQuery.single.mockResolvedValue({
    data: { id: "output-1", output_json: { markdown: "Hotovo" }, output_text: '{"markdown":"Hotovo"}' },
    error: null,
  });
  routeMocks.createAdminClient.mockReturnValue({
    from: vi.fn((tableName: string) => {
      if (tableName === "ai_processing_jobs") return jobQuery;
      if (tableName === "ai_outputs") return outputQuery;
      throw new Error(`Unexpected admin table ${tableName}`);
    }),
  });
  routeMocks.runOpenAIProcessing.mockImplementation(async (input) => {
    events.push("provider-called");
    return { inputTokenCount: 10, outputText: '{"markdown":"Hotovo"}', outputTokenCount: 5, input };
  });

  return { events, jobInsert, jobQuery, rpc };
}

// postActionItems invokes the route with the intentionally prompt-agnostic browser contract.
function postActionItems(overrides: { metadata?: Record<string, unknown>; model?: string; reasoningEffort?: string; temperature?: number } = {}) {
  return POST(
    new NextRequest(`https://vosio.test/api/transcripts/${transcriptId}/process`, {
      body: JSON.stringify({
        metadata: { source: "manual-button", workspace: "sales" },
        model: "gpt-6.1-sol",
        processingType: "action_items",
        requestId: "00000000-0000-4000-8000-000000000815",
        temperature: 0.7,
        ...overrides
      }),
      headers: { "Content-Type": "application/json", Origin: "https://vosio.test" },
      method: "POST",
    }),
    { params: Promise.resolve({ transcriptId }) },
  );
}

// createRetryFixture supplies an exact historical snapshot independently of today's prompt resolver.
function createRetryFixture(sourceOverrides: Record<string, unknown> = {}) {
  const fixture = createRouteFixture({ system_prompt_id: systemPromptId, override_id: null,
    name: "Changed current prompt", processing_type: "action_items", prompt_text: "Different current text",
    output_schema: null, source: "system", revision: null });
  const source = {
    id: "00000000-0000-4000-8000-000000000816", execution_mode: "manual", status: "failed",
    user_id: userId, transcript_id: transcriptId, processing_type: "action_items", model: "gpt-6-astra-low",
    provider: "openai", provider_config: { provider: "openai", provider_model: "gpt-6-astra",
      reasoning_effort: "low", temperature: 0.7, metadata: { source: "old-button" }, response_format: "json_schema" },
    prompt_id: systemPromptId, prompt_override_id: overrideId, prompt_source: "user_override",
    prompt_name_snapshot: "Historical name", prompt_text_snapshot: "Historical {{raw_text}}",
    prompt_output_schema_snapshot: { type: "object", properties: { old: { type: "string" } } },
    prompt_revision_snapshot: 2, prompt_snapshot_exact: true, retry_source_job_id: null,
    failure_code: "unknown", retry_after_at: null, ...sourceOverrides
  };
  fixture.jobQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: source, error: null });
  return { ...fixture, source };
}

// postRetry uses lineage alone; the server supplies every model and prompt input from the source.
function postRetry(overrides: Record<string, unknown> = {}) {
  return POST(new NextRequest(`https://vosio.test/api/transcripts/${transcriptId}/process`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://vosio.test" },
    body: JSON.stringify({ processingType: "action_items",
      requestId: "00000000-0000-4000-8000-000000000815",
      retryOfJobId: "00000000-0000-4000-8000-000000000816", ...overrides })
  }), { params: Promise.resolve({ transcriptId }) });
}

describe("explicit manual retry lineage", () => {
  it.each([
    { model: "gpt-6-astra-low" }, { model: "gpt-5.6-terra", provider_config: {
      provider: "openai", provider_model: "gpt-5.6-terra", reasoning_effort: "high", temperature: 0.9, metadata: {} } },
    { model: "gemini-3.8-flash", provider: "gemini", provider_config: {
      provider: "gemini", provider_model: "gemini-3.8-flash", thinking_level: "medium", temperature: 0.2, metadata: {} } }
  ])("clones every accepted historical snapshot field unchanged for $model", async (sourceOverrides) => {
    const fixture = createRetryFixture(sourceOverrides);
    const before = structuredClone(fixture.source);
    expect((await postRetry()).status).toBe(202);
    const { id: sourceId, status: _status, failure_code: _failure, retry_after_at: _retry, ...snapshot } = before;
    expect(fixture.jobInsert).toHaveBeenCalledWith(expect.objectContaining({ ...snapshot,
      retry_source_job_id: sourceId, attempt_count: 0, max_attempts: 1, lease_token: null,
      lease_expires_at: null, status: "queued", retry_after_at: null, failure_code: null }));
    expect(fixture.source).toEqual(before);
    expect(fixture.jobQuery.update).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalledWith("resolve_effective_prompt_template_v1", expect.anything());
    expect(routeMocks.afterCallbacks).toHaveLength(1);
    expect(routeMocks.runManualAiJob).not.toHaveBeenCalled();
    await routeMocks.afterCallbacks[0]!();
    expect(routeMocks.runManualAiJob).toHaveBeenCalledWith({ jobId: "job-1", transcriptId, userId });
  });

  it.each([
    { user_id: overrideId }, { transcript_id: overrideId }, { execution_mode: "automatic" },
    { processing_type: "summary" }, { status: "running" }, { status: "queued" }, { status: "done" },
    { status: "cancelled" }, { prompt_snapshot_exact: false }, { prompt_text_snapshot: "" },
    { provider_config: {} }
  ])("rejects an ineligible source %j without inserting or scheduling", async (sourceOverrides) => {
    const fixture = createRetryFixture(sourceOverrides);
    expect((await postRetry()).status).toBe(409);
    expect(fixture.jobInsert).not.toHaveBeenCalled();
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it.each([{ model: "gpt-6.1-sol" }, { reasoningEffort: "medium" }, { temperature: 0.3 }, { metadata: {} }])(
    "rejects conflicting retry overrides %j", async (overrides) => {
      const fixture = createRetryFixture();
      expect((await postRetry(overrides)).status).toBe(409);
      expect(fixture.jobInsert).not.toHaveBeenCalled();
    });

  it("accepts matching compatibility fields without rebuilding the snapshot", async () => {
    const fixture = createRetryFixture();
    expect((await postRetry({ model: fixture.source.model, reasoningEffort: "low", temperature: 0.7,
      metadata: fixture.source.provider_config.metadata })).status).toBe(202);
    expect(fixture.jobInsert).toHaveBeenCalledWith(expect.objectContaining({ provider_config: fixture.source.provider_config }));
  });

  it("enforces the existing rate-limited source deadline", async () => {
    const fixture = createRetryFixture({ failure_code: "rate_limited", retry_after_at: new Date(Date.now() + 60_000).toISOString() });
    const response = await postRetry();
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fixture.jobInsert).not.toHaveBeenCalled();
  });

  it("allows a retry after the source backoff expires", async () => {
    createRetryFixture({ failure_code: "rate_limited", retry_after_at: new Date(Date.now() - 1_000).toISOString() });
    expect((await postRetry()).status).toBe(202);
  });

  it("rejects a missing source instead of treating lineage as a fresh request", async () => {
    const fixture = createRetryFixture();
    fixture.jobQuery.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
    expect((await postRetry()).status).toBe(409);
    expect(fixture.jobInsert).not.toHaveBeenCalled();
  });

  it("requires current personal AI authority before reading retry lineage", async () => {
    const fixture = createRetryFixture();
    fixture.rpc.mockResolvedValue({ data: { ...NO_RECORDING_CAPABILITIES, read: true }, error: null });
    expect((await postRetry()).status).toBe(403);
    expect(fixture.jobQuery.maybeSingle).not.toHaveBeenCalled();
    expect(fixture.jobInsert).not.toHaveBeenCalled();
  });

  it("replays accepted lineage without reading a subsequently deleted source or scheduling work", async () => {
    const fixture = createRetryFixture();
    fixture.jobQuery.maybeSingle.mockReset().mockResolvedValue({ data: {
      ...fixture.source, id: "00000000-0000-4000-8000-000000000815", status: "done",
      retry_source_job_id: fixture.source.id }, error: null });
    expect((await postRetry()).status).toBe(202);
    expect(fixture.jobQuery.maybeSingle).toHaveBeenCalledTimes(1);
    expect(fixture.jobInsert).not.toHaveBeenCalled();
    expect(routeMocks.rateLimit).not.toHaveBeenCalled();
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it.each([{ retry_source_job_id: null }, { retry_source_job_id: overrideId }, { user_id: overrideId },
    { transcript_id: overrideId }, { processing_type: "summary" }])("rejects retry UUID collisions %j", async (collision) => {
    const fixture = createRetryFixture();
    fixture.jobQuery.maybeSingle.mockReset().mockResolvedValue({ data: {
      ...fixture.source, retry_source_job_id: fixture.source.id, ...collision }, error: null });
    expect((await postRetry()).status).toBe(409);
    expect(fixture.jobInsert).not.toHaveBeenCalled();
  });

  it("does not replay an accepted retry as a fresh picker request", async () => {
    const fixture = createRetryFixture({ model: "gpt-6.1-sol", provider_config: {
      provider: "openai", provider_model: "gpt-6.1-sol", reasoning_effort: "medium", temperature: 0.3,
      metadata: { source: "manual-button", workspace: "sales" }, response_format: "json_schema" } });
    fixture.jobQuery.maybeSingle.mockReset().mockResolvedValue({ data: {
      ...fixture.source, retry_source_job_id: fixture.source.id }, error: null });
    expect((await postActionItems()).status).toBe(409);
  });

  it("returns a matching raced retry insert without scheduling twice", async () => {
    const fixture = createRetryFixture();
    fixture.jobQuery.single.mockResolvedValue({ data: null, error: { code: "23505" } });
    fixture.jobQuery.maybeSingle.mockResolvedValueOnce({ data: {
      ...fixture.source, retry_source_job_id: fixture.source.id, status: "queued" }, error: null });
    expect((await postRetry()).status).toBe(202);
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it("rejects a raced insert with unrelated lineage", async () => {
    const fixture = createRetryFixture();
    fixture.jobQuery.single.mockResolvedValue({ data: null, error: { code: "23505" } });
    fixture.jobQuery.maybeSingle.mockResolvedValueOnce({ data: {
      ...fixture.source, retry_source_job_id: overrideId, status: "queued" }, error: null });
    expect((await postRetry()).status).toBe(409);
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });
});

describe("process route prompt resolution", () => {
  it.each([
    ["gpt-6-astra", "low"], ["gpt-6.1-sol", "medium"],
    ["gpt-6.1-sol", "xhigh"], ["gpt-6.1-sol", "max"]
  ])("snapshots selected %s effort %s before scheduling", async (model, reasoningEffort) => {
    const fixture = createRouteFixture({ system_prompt_id: systemPromptId, override_id: null,
      name: "Action items", processing_type: "action_items", prompt_text: "{{raw_text}}",
      output_schema: null, source: "system", revision: null });
    expect((await postActionItems({ model, reasoningEffort })).status).toBe(202);
    expect(fixture.jobInsert).toHaveBeenCalledWith(expect.objectContaining({ model,
      provider_config: expect.objectContaining({ reasoning_effort: reasoningEffort, temperature: 0.3 }) }));
  });

  it.each([
    { model: "gpt-6-astra", reasoningEffort: "ultra" },
    { model: "gemini-3.8-flash", reasoningEffort: "max" },
    { model: "mistral-small-2603", reasoningEffort: "low" },
    { model: "gpt-5.6-terra" }
  ])("rejects unsupported new selection %j before insert/provider", async (selection) => {
    const fixture = createRouteFixture({ system_prompt_id: systemPromptId, override_id: null,
      name: "Action items", processing_type: "action_items", prompt_text: "{{raw_text}}",
      output_schema: null, source: "system", revision: null });
    expect((await postActionItems(selection)).status).toBe(400);
    expect(fixture.jobInsert).not.toHaveBeenCalled();
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it("snapshots an owner override before registering provider work after the response", async () => {
    const effectivePrompt = {
      system_prompt_id: systemPromptId,
      override_id: overrideId,
      name: "System action items",
      processing_type: "action_items" as const,
      prompt_text: "Uživatelský prompt použitý přes stejné tlačítko Úkoly.",
      output_schema: { type: "object" },
      source: "user_override" as const,
      revision: 5,
    };
    const fixture = createRouteFixture(effectivePrompt);

    const response = await postActionItems();

    expect(response.status).toBe(202);
    expect(fixture.rpc).toHaveBeenCalledWith("resolve_effective_prompt_template_v1", {
      p_processing_type: "action_items",
    });
    expect(fixture.events).toEqual(["job-inserted"]);
    expect(routeMocks.afterCallbacks).toHaveLength(1);
    expect(fixture.jobInsert).toHaveBeenCalledWith(expect.objectContaining({
      processing_type: "action_items",
      prompt_id: systemPromptId,
      prompt_override_id: overrideId,
      prompt_source: "user_override",
      prompt_name_snapshot: "System action items",
      prompt_text_snapshot: effectivePrompt.prompt_text,
      prompt_output_schema_snapshot: effectivePrompt.output_schema,
      prompt_revision_snapshot: 5,
      prompt_snapshot_exact: true,
      provider_config: expect.objectContaining({
        metadata: { source: "manual-button", workspace: "sales" },
        provider_model: "gpt-6.1-sol",
        temperature: 0.3
      })
    }));
    const jobPayload = fixture.jobInsert.mock.calls[0]?.[0];
    expect(JSON.stringify((jobPayload as { provider_config: unknown }).provider_config)).not.toContain(effectivePrompt.prompt_text);
    expect(routeMocks.runOpenAIProcessing).not.toHaveBeenCalled();
    await routeMocks.afterCallbacks[0]!();
    expect(routeMocks.runManualAiJob).toHaveBeenCalledWith({
      jobId: "job-1",
      transcriptId,
      userId
    });
  });

  it.each([
    ["gemini-3.8-flash", "gemini", "gemini-3.8-flash"],
    ["gpt-6.1-sol", "openai", "gpt-6.1-sol"],
    ["gpt-6-astra", "openai", "gpt-6-astra"],
    ["mistral-small-2603", "mistral", "mistral-small-2603"],
    ["mistral-large-2512", "mistral", "mistral-large-2512"]
  ])("snapshots profile %s with exact %s API model", async (model, provider, providerModel) => {
    const fixture = createRouteFixture({
      system_prompt_id: systemPromptId,
      override_id: null,
      name: "System action items",
      processing_type: "action_items",
      prompt_text: "Systémový prompt.",
      output_schema: { type: "object" },
      source: "system",
      revision: null
    });

    const response = await postActionItems({ model });

    expect(response.status).toBe(202);
    expect(fixture.jobInsert).toHaveBeenCalledWith(expect.objectContaining({
      model,
      provider,
      provider_config: expect.objectContaining({
        provider,
        provider_model: providerModel
      })
    }));
  });

  it("snapshots the authoritative system fallback without inventing an override revision", async () => {
    const effectivePrompt = {
      system_prompt_id: systemPromptId,
      override_id: null,
      name: "System action items",
      processing_type: "action_items" as const,
      prompt_text: "Systémový prompt použitý přes stejné tlačítko Úkoly.",
      output_schema: { type: "object" },
      source: "system" as const,
      revision: null,
    };
    const fixture = createRouteFixture(effectivePrompt);

    const response = await postActionItems();

    expect(response.status).toBe(202);
    expect(fixture.jobInsert).toHaveBeenCalledWith(expect.objectContaining({
      prompt_id: systemPromptId,
      prompt_override_id: null,
      prompt_source: "system",
      prompt_revision_snapshot: null,
      prompt_snapshot_exact: true,
    }));
    expect(routeMocks.afterCallbacks).toHaveLength(1);
    expect(routeMocks.runOpenAIProcessing).not.toHaveBeenCalled();
  });

  it("returns an existing same-owner request before charging the rate limiter again", async () => {
    const effectivePrompt = {
      system_prompt_id: systemPromptId,
      override_id: null,
      name: "System action items",
      processing_type: "action_items" as const,
      prompt_text: "Systémový prompt.",
      output_schema: { type: "object" },
      source: "system" as const,
      revision: null,
    };
    const fixture = createRouteFixture(effectivePrompt);
    fixture.jobQuery.maybeSingle.mockResolvedValue({
      data: {
        execution_mode: "manual",
        id: "00000000-0000-4000-8000-000000000815",
        model: "gpt-5.6-terra",
        processing_type: "action_items",
        prompt_output_schema_snapshot: { type: "object" },
        provider: "openai",
        provider_config: {
          reasoning_effort: "high",
          temperature: 0.7,
          response_format: "json_schema",
          provider: "openai",
          metadata: { workspace: "sales", source: "manual-button" }
        },
        status: "running",
        transcript_id: transcriptId,
        user_id: userId
      },
      error: null
    });

    const response = await postActionItems({ model: "gpt-5.6-terra" });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      job: { id: "00000000-0000-4000-8000-000000000815", status: "running" }
    });
    expect(routeMocks.rateLimit).not.toHaveBeenCalled();
    expect(fixture.jobInsert).not.toHaveBeenCalled();
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it.each([
    ["temperature", { temperature: 0.8 }],
    ["metadata", { metadata: { source: "manual-button", workspace: "support" } }]
  ])("rejects same UUID reuse with changed normalized %s", async (_label, overrides) => {
    const fixture = createRouteFixture({
      system_prompt_id: systemPromptId,
      override_id: null,
      name: "System action items",
      processing_type: "action_items",
      prompt_text: "Systémový prompt.",
      output_schema: { type: "object" },
      source: "system",
      revision: null
    });
    fixture.jobQuery.maybeSingle.mockResolvedValue({
      data: {
        execution_mode: "manual",
        id: "00000000-0000-4000-8000-000000000815",
        model: "gpt-5.6-terra",
        processing_type: "action_items",
        prompt_output_schema_snapshot: { type: "object" },
        provider: "openai",
        provider_config: {
          metadata: { source: "manual-button", workspace: "sales" },
          provider: "openai",
          reasoning_effort: "high",
          response_format: "json_schema",
          temperature: 0.7
        },
        status: "queued",
        transcript_id: transcriptId,
        user_id: userId
      },
      error: null
    });

    const response = await postActionItems({ ...overrides, model: "gpt-5.6-terra" });

    expect(response.status).toBe(409);
    expect(routeMocks.rateLimit).not.toHaveBeenCalled();
    expect(fixture.jobInsert).not.toHaveBeenCalled();
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it("returns conflict when a raced same UUID has a different provider snapshot", async () => {
    const fixture = createRouteFixture({
      system_prompt_id: systemPromptId,
      override_id: null,
      name: "System action items",
      processing_type: "action_items",
      prompt_text: "Systémový prompt.",
      output_schema: { type: "object" },
      source: "system",
      revision: null
    });
    fixture.jobQuery.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          execution_mode: "manual",
          id: "00000000-0000-4000-8000-000000000815",
          model: "gpt-5.6-terra",
          processing_type: "action_items",
          prompt_output_schema_snapshot: { type: "object" },
          provider: "openai",
          provider_config: {
            metadata: { source: "manual-button", workspace: "sales" },
            provider: "openai",
            reasoning_effort: "high",
            response_format: "json_schema",
            temperature: 0.7
          },
          status: "queued",
          transcript_id: transcriptId,
          user_id: userId
        },
        error: null
      });
    fixture.jobQuery.single.mockResolvedValueOnce({
      data: null,
      error: { message: "SECRET-SENTINEL-duplicate" }
    });

    const response = await postActionItems({ temperature: 0.8 });

    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("SECRET-SENTINEL");
    expect(routeMocks.afterCallbacks).toHaveLength(0);
  });

  it("terminalizes a new queued row safely when after scheduling fails", async () => {
    const fixture = createRouteFixture({
      system_prompt_id: systemPromptId,
      override_id: null,
      name: "System action items",
      processing_type: "action_items",
      prompt_text: "Systémový prompt.",
      output_schema: { type: "object" },
      source: "system",
      revision: null
    });
    fixture.jobQuery.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: "job-1" }, error: null });
    routeMocks.afterError = new Error("SECRET-SENTINEL-scheduler");
    const response = await postActionItems();
    expect(response.status).toBe(500);
    expect(fixture.jobQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      error_message: null,
      failure_code: "execution_interrupted",
      status: "failed"
    }));
    expect(JSON.stringify(await response.json())).not.toContain("SECRET-SENTINEL");
  });

  it.each([
    ["database error", { data: null, error: { message: "SECRET-SENTINEL-update" } }],
    ["zero rows", { data: null, error: null }]
  ])("does not report scheduling terminalization as successful after %s", async (_label, terminalizeResult) => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fixture = createRouteFixture({
      system_prompt_id: systemPromptId,
      override_id: null,
      name: "System action items",
      processing_type: "action_items",
      prompt_text: "Systémový prompt.",
      output_schema: { type: "object" },
      source: "system",
      revision: null
    });
    fixture.jobQuery.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(terminalizeResult);
    routeMocks.afterError = new Error("SECRET-SENTINEL-scheduler");

    const response = await postActionItems();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "AI zpracování se nepodařilo naplánovat ani bezpečně ukončit."
    });
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain("SECRET-SENTINEL");
    consoleSpy.mockRestore();
  });
});

// createAdminMock records the durable write order without contacting Supabase.
function createAdminMock(events: string[]) {
  const rawOutputQuery = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn()
  };
  const jobQuery = {
    eq: vi.fn(),
    update: vi.fn()
  };

  rawOutputQuery.insert.mockReturnValue(rawOutputQuery);
  rawOutputQuery.select.mockReturnValue(rawOutputQuery);
  rawOutputQuery.single.mockImplementation(async () => {
    events.push("raw-output-saved");
    return {
      data: { id: "output-1", output_json: {}, output_text: "raw provider output" },
      error: null
    };
  });
  jobQuery.update.mockReturnValue(jobQuery);
  jobQuery.eq.mockImplementation(async () => {
    events.push("job-done");
    return { error: null };
  });

  const from = vi.fn((tableName: string) => {
    if (tableName === "ai_outputs") {
      return rawOutputQuery;
    }

    if (tableName === "ai_processing_jobs") {
      return jobQuery;
    }

    throw new Error(`Unexpected table ${tableName}`);
  });

  return { admin: { from }, from, jobQuery, rawOutputQuery };
}

describe("process route output orchestration", () => {
  it("uses full saved segments and persists verified structured rows between raw output and job completion", async () => {
    const events: string[] = [];
    const mock = createAdminMock(events);
    const savedTranscriptSegments = [
      { end_ms: 1_000, start_ms: 0, text: "Uvod." },
      { end_ms: 8_400, start_ms: 8_000, text: "Schvalili" },
      { end_ms: 8_900, start_ms: 8_400, text: " jsme termin." }
    ];
    const outputJson = {
      data: {
        decisions: [{
          decision: "Potvrdit termin",
          evidence_end_ms: 99_999,
          evidence_quote: "schvalili jsme termin",
          evidence_start_ms: 99_000
        }]
      }
    };
    const persistStructuredRows = vi.fn(async (_admin, items) => {
      events.push("structured-rows-saved");
      expect(items.decisions[0]).toMatchObject({
        ai_output_id: "output-1",
        evidence_end_ms: 8_900,
        evidence_start_ms: 8_000
      });
    });

    await expect(persistCompletedAiProcessing({
      admin: mock.admin as never,
      inputTokenCount: 120,
      jobId: "job-1",
      outputJson,
      outputText: "raw provider output",
      outputTokenCount: 40,
      transcriptId: "transcript-1",
      transcriptSegments: savedTranscriptSegments,
      userId: "user-1"
    }, { persistStructuredRows })).resolves.toMatchObject({ id: "output-1" });

    expect(events).toEqual(["raw-output-saved", "structured-rows-saved", "job-done"]);
    expect(mock.rawOutputQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      output_json: outputJson,
      output_text: "raw provider output"
    }));
    expect(mock.jobQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });
});
