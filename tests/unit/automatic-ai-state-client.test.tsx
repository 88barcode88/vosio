// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TranscriptAiStateProvider, useTranscriptAiState, type TranscriptAiStateContextValue } from "@/components/transcript-tabs/use-transcript-ai-state";
import { classifyAutomaticJob } from "@/lib/ai/automatic-job-state";
import type { ManualAiJobSummary } from "@/lib/ai/manual-job-state";

// Harness observes automatic-only hydration while preserving one mounted local draft.
function Harness() {
  const state = useTranscriptAiState();
  const { setActivePurpose, loadForPurpose } = state;
  useEffect(() => { setActivePurpose("ai"); void loadForPurpose("ai"); }, [setActivePurpose, loadForPurpose]);
  return <><input aria-label="draft" defaultValue="kept" /><output>{state.loadedOutputs.map((item) => item.id).join(",")}|{state.structuredItems.tasks.length}|{state.jobs.map((job) => job.status).join(",")}</output></>;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("polls only automatic work, hydrates successful siblings and stops after all become terminal", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-15T10:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let phase = 0;
  const jobs = () => ["summary", "action_items", "crm_note"].map((type, index) => ({
    id: `j${index}`, execution_mode: "automatic", processing_type: type, model: "gpt-5.6-terra",
    attempt_count: index === 1 && phase > 0 ? 3 : 1, max_attempts: 3,
    status: phase === 0 ? "running" : index === 1 ? "failed" : (index === 2 && phase === 1 ? "running" : "done"),
    lease_expires_at: "2026-09-15T10:15:00Z", created_at: "2026-09-15T10:00:00Z", started_at: "2026-09-15T10:00:00Z",
    completed_at: null, failure_code: null, retry_after_at: null
  } as ManualAiJobSummary));
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/ai-state")) {
      const current = jobs();
      return Response.json({ jobs: current, automaticGenerationKey: "generation", classifications: current.map((job) => classifyAutomaticJob(job)),
        outputs: current.filter((job) => job.status === "done").map((job) => ({ id: `o${job.id}`, processing_job_id: job.id, processing_type: job.processing_type, created_at: "2026-09-15", transcript_id: "t", body_loaded: false })) });
    }
    const id = url.split("/").at(-1)!.split("?")[0];
    return Response.json({ output: { id, created_at: "2026-09-15", output_text: "Synthetic" },
      structuredItems: { chapters: [], decisions: [], risks: [], tasks: [{ id: id + "task", ai_output_id: id, title: id, position: 1 }] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t"><Harness /></TranscriptAiStateProvider>));
    const draft = container.querySelector("input")!; draft.value = "edited";
    phase = 1; await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(container.querySelector("output")!.textContent).toContain("oj0");
    expect(container.querySelector("output")!.textContent).toContain("failed");
    phase = 2; await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(container.querySelector("output")!.textContent).toContain("oj2");
    expect(container.querySelector("output")!.textContent).toContain("|2|");
    expect(container.querySelector("input")).toBe(draft); expect(draft.value).toBe("edited");
    const calls = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  } finally { await act(async () => root.unmount()); }
});

// ExportHarness exposes committed provider state without remounting the draft or audio element.
function ExportHarness({ observe }: { observe: (state: TranscriptAiStateContextValue) => void }) {
  const state = useTranscriptAiState();
  useEffect(() => observe(state), [observe, state]);
  return <><input aria-label="draft" defaultValue="kept" /><audio src="/synthetic.mp3" /></>;
}

it.each(["stale deferred page", "new generation page", "stale deferred refresh after new page"])("aborts export across %s without mixing cached bodies or projections", async (scenario) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let state!: TranscriptAiStateContextValue;
  const observe = (next: TranscriptAiStateContextValue) => { state = next; };
  let currentGeneration = "old";
  let resolvePage!: (response: Response) => void;
  const page = new Promise<Response>((resolve) => { resolvePage = resolve; });
  let deferRefresh = false;
  let resolveRefresh!: (response: Response) => void;
  const refresh = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
  const snapshot = (generation: string, paginated = false) => ({
    automaticGenerationKey: generation, jobs: [], classifications: [],
    outputs: [{ id: generation, processing_job_id: `${generation}-job`, processing_type: "summary", created_at: "2026-09-15", transcript_id: "t", body_loaded: false }],
    nextOutputOffset: paginated ? 50 : null
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("outputOffset=")) return page;
    if (url.includes("/ai-state")) return deferRefresh ? refresh : Response.json(snapshot(currentGeneration, currentGeneration === "old"));
    const id = url.split("/").at(-1)!.split("?")[0];
    return Response.json({ output: { id, created_at: "2026-09-15", output_text: id },
      structuredItems: { chapters: [], decisions: [], risks: [], tasks: [{ id: `${id}-task`, ai_output_id: id, title: id, position: 1 }] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t"><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    await act(async () => state.loadForPurpose("ai"));
    expect(state.loadedOutputs.map((item) => item.id)).toEqual(["old"]);
    const draft = container.querySelector("input")!; draft.value = "edited";
    const audio = container.querySelector("audio")!; audio.currentTime = 17;
    let pending!: ReturnType<TranscriptAiStateContextValue["loadAllOutputs"]>;
    await act(async () => { pending = state.loadAllOutputs(); });
    expect(fetchMock.mock.calls.some(([url]) => url.includes("outputOffset=50"))).toBe(true);
    let pendingRefresh: Promise<void> | undefined;
    if (scenario === "stale deferred refresh after new page") {
      deferRefresh = true;
      await act(async () => { pendingRefresh = state.loadForPurpose("metadata"); });
    }
    currentGeneration = "new";
    if (scenario === "stale deferred page") await act(async () => state.loadForPurpose("ai"));
    let result: Awaited<typeof pending> | undefined;
    await act(async () => {
      resolvePage(Response.json(snapshot(scenario === "stale deferred page" ? "old" : "new")));
      result = await pending;
    });
    expect(result).toBeNull();
    expect(state.automaticGenerationKey).toBe("new");
    if (pendingRefresh) {
      await act(async () => {
        resolveRefresh(Response.json(snapshot("old")));
        await pendingRefresh;
      });
      deferRefresh = false;
    }
    expect(state.automaticGenerationKey).toBe("new");
    expect(state.outputs.map((item) => item.id)).toEqual(["new"]);
    expect(state.loadedOutputs.map((item) => item.id)).toEqual(scenario === "stale deferred page" ? ["new"] : []);
    expect(state.structuredItems.tasks.map((item) => item.ai_output_id)).toEqual(scenario === "stale deferred page" ? ["new"] : []);
    expect(state.error).toContain("Export");
    await act(async () => { result = await state.loadAllOutputs(); });
    expect(result?.loadedOutputs.map((item) => item.id)).toEqual(["new"]);
    expect(result?.structuredItems.tasks.map((item) => item.ai_output_id)).toEqual(["new"]);
    expect(container.querySelector("input")).toBe(draft); expect(draft.value).toBe("edited");
    expect(container.querySelector("audio")).toBe(audio); expect(audio.currentTime).toBe(17);
  } finally { await act(async () => root.unmount()); }
});
