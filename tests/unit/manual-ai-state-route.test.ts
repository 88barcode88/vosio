// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getManualAiJobDisplayStatus,
  mergeManualAiState
} from "@/lib/ai/manual-job-state";
import { GET as getOutput } from "../../app/api/ai-outputs/[outputId]/route";
import {
  TranscriptAiStateProvider,
  useTranscriptAiState
} from "@/components/transcript-tabs/use-transcript-ai-state";

const routeMocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: routeMocks.createClient }));

beforeEach(() => vi.resetAllMocks());
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
    createElement("button", { "data-purpose": "ai", onClick: () => void state.loadForPurpose("ai") }, "AI"),
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

describe("manual AI state contract", () => {
  it("derives stalled queued and running jobs without mutating persisted status", () => {
    const queued = {
      completed_at: null,
      created_at: "2026-09-03T09:00:00.000Z",
      error_message: null,
      id: "job-queued",
      processing_type: "summary",
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
        { completed_at: null, created_at: "2026-09-03T09:01:00.000Z", error_message: null, id: "job-2", processing_type: "summary", started_at: null, status: "queued" },
        { completed_at: null, created_at: "2026-09-03T09:00:00.000Z", error_message: null, id: "job-1", processing_type: "summary", started_at: null, status: "running" }
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
    expect(stateRoute).not.toMatch(/output_text|output_json|prompt_text_snapshot|provider_config|raw_text/);
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

  it("polls at two seconds, pauses hidden, and deduplicates focus catch-up", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobs: [{ completed_at: null, created_at: new Date().toISOString(), error_message: null, id: "job-running", processing_type: "summary", started_at: new Date().toISOString(), status: "running" }],
      outputs: []
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderAiStateHarness();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-purpose="metadata"]')?.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
  });
});
