// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getManualAiJobDisplayStatus,
  mergeManualAiState
} from "@/lib/ai/manual-job-state";
import { GET as getOutput } from "../../app/api/ai-outputs/[outputId]/route";
import { GET as getAiState } from "../../app/api/transcripts/[transcriptId]/ai-state/route";
import {
  TranscriptAiStateProvider,
  useTranscriptAiState
} from "@/components/transcript-tabs/use-transcript-ai-state";
import { TranscriptTabs } from "@/components/transcript-tabs";
import type { AiOutputView } from "@/lib/ai/types";
import type { StructuredAiItems } from "@/lib/ai/structured-types";

const routeMocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: routeMocks.createClient }));
vi.mock("@/components/transcript-tabs/recording-audio-player", () => ({ RecordingAudioPlayer: () => null }));
vi.mock("@/components/transcript-tabs/chat-content", () => ({ ChatContent: () => null }));
vi.mock("@/components/transcript-tabs/files-content", () => ({ FilesContent: () => null }));
vi.mock("@/components/transcript-tabs/transcript-content", () => ({ TranscriptContent: () => null }));
vi.mock("@/components/transcript-tabs/ai-processing-content", () => ({ AiProcessingContent: renderAiSnapshot }));
vi.mock("@/components/transcript-tabs/timeline-content", () => ({ TimelineContent: renderAiSnapshot }));

// renderAiSnapshot observes the real tabs' hydrated props without unrelated artifact presentation.
function renderAiSnapshot({ aiOutputs, structuredItems }: { aiOutputs: AiOutputView[]; structuredItems: StructuredAiItems }) {
  return createElement("output", null, JSON.stringify({ aiOutputs, structuredItems }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const emptyStructuredItems = { chapters: [], decisions: [], risks: [], tasks: [] };

// AiStateHarness exposes lazy metadata and body loads through observable controls.
function AiStateHarness() {
  const state = useTranscriptAiState();
  return createElement(
    "div",
    null,
    createElement("button", { "data-purpose": "metadata", onClick: () => void state.loadForPurpose("metadata") }, "Metadata"),
    createElement("button", { "data-purpose": "ai", onClick: () => {
      state.setActivePurpose("ai");
      void state.loadForPurpose("ai");
    } }, "AI"),
    createElement("button", { "data-purpose": "all", onClick: () => void state.loadAllOutputs() }, "All"),
    createElement("button", { "data-purpose": "inactive", onClick: () => state.setActivePurpose(null) }, "Inactive"),
    createElement("output", null, state.loadedOutputs.map((output) => output.id).join(","))
  );
}

// renderAiStateHarness mounts one transcript-scoped provider for polling and hydration tests.
async function renderAiStateHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(
    TranscriptAiStateProvider,
    {
      initialAiOutputs: [],
      initialStructuredItems: emptyStructuredItems,
      transcriptId: "00000000-0000-4000-8000-000000000921"
    },
    createElement(AiStateHarness)
  )));
  return { container, root };
}

// detailTree recreates server props while keeping the actual provider and tabs mounted.
function detailTree(tab: "ai" | "timeline" | "transcript" = "ai", transcriptId = "transcript-1") {
  const outputs: AiOutputView[] = [];
  const items: StructuredAiItems = { chapters: [], decisions: [], risks: [], tasks: [] };
  return createElement(TranscriptAiStateProvider, {
    transcriptId, initialAiOutputs: outputs, initialStructuredItems: items
  }, createElement(TranscriptTabs, {
    activeAiOutputs: outputs, activeRecording: null, activeStructuredItems: items,
    activeTranscript: { id: transcriptId, segments: [], speakers: [] } as never,
    initialTab: tab, initialTabFromUrl: true, userSettings: {} as never
  }));
}

// outputPayload supplies a saved artifact and a projection whose deletion can be observed.
function outputPayload(id = "saved-output", transcriptId = "transcript-1") {
  return {
    output: {
      id, transcript_id: transcriptId, processing_job_id: `job-${id}`, processing_type: "timeline_chapters",
      created_at: "2026-09-05T10:00:00Z", output_text: `Body ${id}`, output_json: null, user_id: "user-1"
    },
    structuredItems: {
      ...emptyStructuredItems,
      chapters: [{
        ai_output_id: id, transcript_id: transcriptId, processing_job_id: `job-${id}`, user_id: "user-1",
        position: 0, title: `Projection ${id}`, confidence: null, dominant_roles: [], end_time: null,
        raw_item: null, source_type: null, speakers: [], start_time: null, summary: null, topics: []
      }]
    }
  };
}

describe("real detail tabs after server revalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-09-05T10:00:00Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.localStorage.clear();
  });

  it.each(["ai", "timeline"] as const)("reloads %s after revalidation and removes deleted projections without generating again", async (tab) => {
    let saved = outputPayload();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("automatic-timeline") ? { status: "not_scheduled" }
        : url.includes("/ai-state") ? { jobs: [], outputs: [{ ...saved.output, body_loaded: false }] } : saved
    )));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(detailTree(tab)));
      expect(container.textContent).toContain("Body saved-output");
      expect(container.textContent).toContain("Projection saved-output");
      const postsBefore = fetchMock.mock.calls.filter(([url]) => url.includes("automatic-timeline")).length;
      await act(async () => root.render(detailTree(tab)));
      expect(container.textContent).toContain("Body saved-output");
      // Simulate the authoritative post-delete response after an explicit mutation revalidates detail.
      saved = outputPayload("remaining-output");
      const sameTree = detailTree(tab);
      await act(async () => root.render(sameTree));
      expect(container.textContent).not.toContain("saved-output");
      expect(container.textContent).toContain("Body remaining-output");
      const afterReload = fetchMock.mock.calls.length;
      await act(async () => root.render(sameTree));
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(fetchMock).toHaveBeenCalledTimes(afterReload);
      expect(fetchMock.mock.calls.filter(([url]) => url.includes("automatic-timeline"))).toHaveLength(postsBefore);
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/process"))).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it.each(["hidden", "offline"])("defers a %s revalidation and coalesces the first eligible catch-up", async (mode) => {
    const saved = outputPayload();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes("/ai-state") ? { jobs: [], outputs: [{ ...saved.output, body_loaded: false }] } : saved
    )));
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(detailTree()));
      const baseline = fetchMock.mock.calls.length;
      Object.defineProperty(document, "visibilityState", { configurable: true, value: mode === "hidden" ? "hidden" : "visible" });
      Object.defineProperty(navigator, "onLine", { configurable: true, value: mode !== "offline" });
      await act(async () => root.render(detailTree()));
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(fetchMock).toHaveBeenCalledTimes(baseline);
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
      expect(fetchMock).toHaveBeenCalledTimes(baseline + 2);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("keeps active jobs polling after revalidation and does not load an inactive tab", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      jobs: [{ id: "active-job", status: "queued", created_at: new Date().toISOString() }], outputs: []
    })));
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(detailTree("transcript")));
      expect(fetchMock).not.toHaveBeenCalled();
      await act(async () => root.render(detailTree()));
      await act(async () => root.render(detailTree()));
      const afterRefresh = fetchMock.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      expect(fetchMock).toHaveBeenCalledTimes(afterRefresh + 1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("ignores an old transcript response and remains bounded in StrictMode", async () => {
    let resolveOld!: (response: Response) => void;
    const oldRequest = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const saved = outputPayload("new-output", "transcript-2");
    const fetchMock = vi.fn(async (url: string) => url.includes("/transcripts/transcript-1/") ? oldRequest
      : new Response(JSON.stringify(url.includes("/ai-state")
        ? { jobs: [], outputs: [{ ...saved.output, body_loaded: false }] } : saved)));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(StrictMode, null, detailTree())));
      await act(async () => root.render(createElement(StrictMode, null, detailTree("ai", "transcript-2"))));
      expect(container.textContent).toContain("new-output");
      await act(async () => resolveOld(new Response(JSON.stringify({ jobs: [], outputs: [{ ...outputPayload().output, body_loaded: false }] }))));
      expect(container.textContent).not.toContain("saved-output");
      expect(container.textContent).toContain("new-output");
      const afterSettlement = fetchMock.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(fetchMock).toHaveBeenCalledTimes(afterSettlement);
      expect(afterSettlement).toBeLessThanOrEqual(4);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

// createSelectQuery builds the narrow fluent read shape used by owner-scoped routes.
function createSelectQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    order: vi.fn(),
    select: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

// createStateQuery models the bounded metadata queries including export-only output pagination.
function createStateQuery(result: { data: unknown; error: unknown }) {
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    returns: vi.fn().mockResolvedValue(result),
    select: vi.fn()
  };
  for (const method of ["eq", "in", "limit", "order", "range", "select"] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

describe("manual AI state contract", () => {
  it("derives stalled queued and running jobs without mutating persisted status", () => {
    const queued = {
      attempt_count: 0,
      completed_at: null,
      created_at: "2026-09-03T09:00:00.000Z",
      failure_code: null,
      id: "job-queued",
      lease_expires_at: null,
      max_attempts: 1,
      model: "gpt-5.6-terra",
      processing_type: "summary",
      retry_after_at: null,
      started_at: null,
      status: "queued" as const
    };
    const running = { ...queued, id: "job-running", started_at: "2026-09-03T09:01:00.000Z", status: "running" as const };

    expect(getManualAiJobDisplayStatus(queued, Date.parse("2026-09-03T09:08:01.000Z"))).toBe("stalled");
    expect(getManualAiJobDisplayStatus(running, Date.parse("2026-09-03T09:09:01.000Z"))).toBe("stalled");
    expect(queued.status).toBe("queued");
    expect(running.status).toBe("running");
  });

  it("merges parallel same-type jobs and metadata idempotently", () => {
    const initial = mergeManualAiState(undefined, {
      jobs: [
        { attempt_count: 0, completed_at: null, created_at: "2026-09-03T09:01:00.000Z", failure_code: null, id: "job-2", lease_expires_at: null, max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary", retry_after_at: null, started_at: null, status: "queued" },
        { attempt_count: 1, completed_at: null, created_at: "2026-09-03T09:00:00.000Z", failure_code: null, id: "job-1", lease_expires_at: "2026-09-03T09:08:00.000Z", max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary", retry_after_at: null, started_at: "2026-09-03T09:00:00.000Z", status: "running" }
      ],
      outputs: []
    });
    const merged = mergeManualAiState(initial, {
      jobs: [{ ...initial.jobs[0]!, completed_at: "2026-09-03T09:02:00.000Z", status: "done" }],
      outputs: [{ body_loaded: false, created_at: "2026-09-03T09:02:00.000Z", id: "output-2", processing_job_id: "job-2", processing_type: "summary", transcript_id: "transcript-1" }]
    });

    expect(merged.jobs.map((entry) => entry.id)).toEqual(["job-2", "job-1"]);
    expect(merged.jobs[0]?.status).toBe("done");
    expect(merged.outputs).toHaveLength(1);
  });

  it("keeps both owner-scoped routes metadata-minimal in source", () => {
    const stateRoute = readFileSync("app/api/transcripts/[transcriptId]/ai-state/route.ts", "utf8");
    const outputRoute = readFileSync("app/api/ai-outputs/[outputId]/route.ts", "utf8");

    expect(stateRoute).toContain("execution_mode");
    expect(stateRoute).not.toMatch(/output_text|output_json|prompt_text_snapshot|provider_config|raw_text|error_message|lease_token/);
    expect(outputRoute).toContain('.eq("transcript_id", transcriptId)');
    expect(outputRoute).toContain('.eq("user_id", user.id)');
    expect(outputRoute).toContain("transcript_tasks");
  });

  it("returns the same 404 when an output is absent from the requested owner/transcript scope", async () => {
    const transcriptQuery = createSelectQuery({ data: { id: "00000000-0000-4000-8000-000000000921" }, error: null });
    const outputQuery = createSelectQuery({ data: null, error: null });
    routeMocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      from: vi.fn((table: string) => table === "transcripts" ? transcriptQuery : outputQuery)
    });

    const response = await getOutput(
      new NextRequest("https://vosio.test/api/ai-outputs/00000000-0000-4000-8000-000000000922?transcriptId=00000000-0000-4000-8000-000000000921"),
      { params: Promise.resolve({ outputId: "00000000-0000-4000-8000-000000000922" }) }
    );

    expect(response.status).toBe(404);
    expect(outputQuery.eq).toHaveBeenCalledWith("transcript_id", "00000000-0000-4000-8000-000000000921");
    expect(outputQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns a bounded later metadata page with an advancing export offset", async () => {
    const transcriptQuery = createSelectQuery({ data: { id: "00000000-0000-4000-8000-000000000921" }, error: null });
    const jobsQuery = createStateQuery({ data: [], error: null });
    const rows = Array.from({ length: 51 }, (_, index) => ({
      ai_processing_jobs: { processing_type: "summary" },
      created_at: new Date(Date.UTC(2026, 8, 3, 10, 0, index)).toISOString(),
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      processing_job_id: `job-${index}`,
      transcript_id: "00000000-0000-4000-8000-000000000921"
    }));
    const outputsQuery = createStateQuery({ data: rows, error: null });
    routeMocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      from: vi.fn((table: string) => {
        if (table === "transcripts") return transcriptQuery;
        if (table === "ai_processing_jobs") return jobsQuery;
        return outputsQuery;
      })
    });

    const response = await getAiState(
      new NextRequest("https://vosio.test/api/transcripts/00000000-0000-4000-8000-000000000921/ai-state?outputOffset=50"),
      { params: Promise.resolve({ transcriptId: "00000000-0000-4000-8000-000000000921" }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(outputsQuery.range).toHaveBeenCalledWith(50, 100);
    expect(payload.outputs).toHaveLength(50);
    expect(payload.nextOutputOffset).toBe(100);
  });

  it("rehydrates metadata first and only the newest default AI body afterward", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/ai-state")) {
        return new Response(JSON.stringify({
          jobs: [],
          outputs: [
            { body_loaded: false, created_at: "2026-09-03T09:02:00.000Z", id: "output-new", processing_job_id: "job-new", processing_type: "summary", transcript_id: "00000000-0000-4000-8000-000000000921" },
            { body_loaded: false, created_at: "2026-09-03T09:01:00.000Z", id: "output-old", processing_job_id: "job-old", processing_type: "summary", transcript_id: "00000000-0000-4000-8000-000000000921" }
          ]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        output: { created_at: "2026-09-03T09:02:00.000Z", id: "output-new", output_json: null, output_text: "Nový", processing_job_id: "job-new", processing_type: "summary", transcript_id: "00000000-0000-4000-8000-000000000921" },
        structuredItems: emptyStructuredItems
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();

    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("output-new"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("output-old"))).toBe(false);
    expect(container.querySelector("output")?.textContent).toBe("output-new");
    await act(async () => root.unmount());
  });

  it("deduplicates concurrent state loads to one request in flight", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((settle) => { resolve = settle; });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click();
      container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(new Response(JSON.stringify({ jobs: [], outputs: [] }), { status: 200 })));
    await act(async () => root.unmount());
  });

  it("does not let old invalidated metadata clear the current request deduplication", async () => {
    let resolveOld!: (response: Response) => void;
    let resolveCurrent!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveCurrent = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    try {
      await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="metadata"]')?.click());
      await act(async () => root.render(createElement(TranscriptAiStateProvider, {
        transcriptId: "00000000-0000-4000-8000-000000000921", initialAiOutputs: [], initialStructuredItems: emptyStructuredItems
      }, createElement(AiStateHarness))));
      await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="metadata"]')?.click());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => resolveOld(new Response(JSON.stringify({ jobs: [], outputs: [] }))));
      await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="metadata"]')?.click());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => resolveCurrent(new Response(JSON.stringify({ jobs: [], outputs: [] }))));
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("paginates metadata and hydrates all 55 bodies for an AI-inclusive export", async () => {
    const metadata = Array.from({ length: 55 }, (_, index) => ({
      body_loaded: false,
      created_at: new Date(Date.UTC(2026, 8, 3, 10, 0, 55 - index)).toISOString(),
      id: `output-${String(index).padStart(2, "0")}`,
      processing_job_id: `job-${index}`,
      processing_type: "summary",
      transcript_id: "00000000-0000-4000-8000-000000000921"
    }));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/ai-state")) {
        const offset = new URL(url, "https://vosio.test").searchParams.get("outputOffset");
        return new Response(JSON.stringify(offset === "50"
          ? { jobs: [], nextOutputOffset: null, outputs: metadata.slice(50) }
          : { jobs: [], nextOutputOffset: 50, outputs: metadata.slice(0, 50) }
        ), { status: 200 });
      }
      const outputId = url.match(/\/api\/ai-outputs\/([^?]+)/)?.[1] ?? "missing";
      return new Response(JSON.stringify({
        output: {
          created_at: "2026-09-03T10:00:00.000Z",
          id: outputId,
          output_json: null,
          output_text: outputId,
          processing_job_id: `job-${outputId}`,
          processing_type: "summary",
          transcript_id: "00000000-0000-4000-8000-000000000921"
        },
        structuredItems: emptyStructuredItems
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-purpose="all"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector("output")?.textContent?.split(",")).toHaveLength(55);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/ai-state"))).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(57);
    await act(async () => root.unmount());
  });

  it("polls at five seconds only for active visible online AI and deduplicates focus catch-up", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      jobs: [{ completed_at: null, created_at: new Date().toISOString(), error_message: null, id: "job-running", processing_type: "summary", started_at: new Date().toISOString(), status: "running" }],
      outputs: []
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });

  it("does not poll for metadata-only or inactive tabs", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      jobs: [{ attempt_count: 0, completed_at: null, created_at: new Date().toISOString(), failure_code: null, id: "job-queued", lease_expires_at: null, max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary", retry_after_at: null, started_at: null, status: "queued" }],
      outputs: []
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="metadata"]')?.click());
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click();
      await Promise.resolve();
    });
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="inactive"]')?.click());
    const afterInactive = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(afterInactive);
    await act(async () => root.unmount());
  });

  it("pauses offline, deduplicates online/focus/visibility burst, and uses old persisted age", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      jobs: [{ attempt_count: 1, completed_at: null, created_at: new Date(Date.now() - 300_000).toISOString(), failure_code: null, id: "job-running", lease_expires_at: new Date(Date.now() + 180_000).toISOString(), max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary", retry_after_at: null, started_at: new Date(Date.now() - 300_000).toISOString(), status: "running" }],
      outputs: []
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click());
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });

  it("queues only one catch-up when lifecycle events burst during an in-flight poll", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const startedAt = new Date().toISOString();
    const activePayload = {
      jobs: [{ attempt_count: 1, completed_at: null, created_at: startedAt, failure_code: null, id: "job-running", lease_expires_at: new Date(Date.now() + 480_000).toISOString(), max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary", retry_after_at: null, started_at: startedAt, status: "running" }],
      outputs: []
    };
    let resolveScheduledPoll!: (response: Response) => void;
    const scheduledPoll = new Promise<Response>((resolve) => { resolveScheduledPoll = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(activePayload), { status: 200 }))
      .mockReturnValueOnce(scheduledPoll)
      .mockResolvedValue(new Response(JSON.stringify(activePayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click());

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveScheduledPoll(new Response(JSON.stringify(activePayload), { status: 200 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(4_999));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => root.unmount());
  });

  it("backs off a transient state fetch failure for at least thirty seconds", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const startedAt = new Date().toISOString();
    const activePayload = {
      jobs: [{ attempt_count: 1, completed_at: null, created_at: startedAt, failure_code: null, id: "job-running", lease_expires_at: new Date(Date.now() + 480_000).toISOString(), max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary", retry_after_at: null, started_at: startedAt, status: "running" }],
      outputs: []
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(activePayload), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "temporary" }), { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify(activePayload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click());

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });

  it("stays within 25 state requests during five visible minutes", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const startedAt = new Date().toISOString();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      jobs: [{ attempt_count: 1, completed_at: null, created_at: startedAt, failure_code: null, id: "job-running", lease_expires_at: new Date(Date.now() + 480_000).toISOString(), max_attempts: 1, model: "gpt-5.6-terra", processing_type: "summary", retry_after_at: null, started_at: startedAt, status: "running" }],
      outputs: []
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="ai"]')?.click());
    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    const stateRequests = fetchMock.mock.calls.filter(([url]) => String(url).includes("/ai-state"));
    expect(stateRequests.length).toBeLessThanOrEqual(25);
    await act(async () => root.unmount());
  });
});
