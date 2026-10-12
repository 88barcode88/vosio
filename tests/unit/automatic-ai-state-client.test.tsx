// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TranscriptAiStateProvider, useTranscriptAiState, type TranscriptAiStateContextValue } from "@/components/transcript-tabs/use-transcript-ai-state";
import type { StructuredAiItems, StructuredTaskRow } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";
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

it("keeps checklist tombstones through late hydration and exports while allowing a new output", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let state!: TranscriptAiStateContextValue;
  const observe = (next: TranscriptAiStateContextValue) => { state = next; };
  let outputIds = ["old"];
  let resolveOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/ai-state")) return Response.json({ jobs: [], automaticGenerationKey: "generation", outputs: outputIds.map((id) => ({
      id, transcript_id: "t", processing_job_id: `${id}-job`, processing_type: "action_items", created_at: id === "new" ? "2026-10-04" : "2026-10-03", body_loaded: false
    })) });
    const id = url.split("/").at(-1)!.split("?")[0];
    if (id === "old") return oldResponse;
    return Response.json({ output: { id, output_text: "New source" }, structuredItems: { chapters: [], decisions: [], risks: [], tasks: [{ id: "new-task", ai_output_id: id, title: "Same title", position: 1 }] } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t"><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    await act(async () => state.loadForPurpose("metadata"));
    let pending!: ReturnType<TranscriptAiStateContextValue["loadOutput"]>;
    await act(async () => { pending = state.loadOutput("old"); });
    await act(async () => state.confirmChecklistDeletion(["old-task"], ["old"]));
    await act(async () => {
      resolveOld(Response.json({ output: { id: "old", output_text: "Original source still exists" }, structuredItems: {
        chapters: [], decisions: [{ id: "decision", ai_output_id: "old" }], risks: [], tasks: [{ id: "old-task", ai_output_id: "old", title: "Same title", position: 1 }]
      } }));
      expect((await pending)?.structuredItems.tasks).toEqual([]);
    });
    expect(state.loadedOutputs.map((output) => output.id)).toEqual(["old"]);
    expect(state.structuredItems.tasks).toEqual([]); expect(state.structuredItems.decisions).toHaveLength(1);
    let exported: Awaited<ReturnType<TranscriptAiStateContextValue["loadAllOutputs"]>>;
    await act(async () => { exported = await state.loadAllOutputs(); });
    expect(exported!.structuredItems.tasks).toEqual([]);
    outputIds = ["new", "old"];
    await act(async () => state.loadForPurpose("ai"));
    expect(state.structuredItems.tasks.map((task) => task.id)).toEqual(["new-task"]);
    expect(state.loadedOutputs.map((output) => output.id)).toContain("old");
  } finally { await act(async () => root.unmount()); }
});

// taskFixture gives repeated generations the same logical identity but distinct source custody.
function taskFixture(id: string, outputId: string, status: StructuredTaskRow["status"]): StructuredTaskRow {
  return { id, ai_output_id: outputId, status, title: "Same title", position: 1, owner_category: "Moje práce",
    deadline: null, deadline_normalized: null, deadline_confidence: null, description: null, evidence_end_ms: null,
    evidence_quote: null, evidence_start_ms: null, owner_name: null, processing_job_id: `${outputId}-job`,
    raw_item: {}, source_type: "explicit", transcript_id: "t", user_id: "owner" };
}

it.each([
  ["late body", false], ["stale props", false], ["late body", true], ["stale props", true]
] as const)("keeps a new task after %s arrives following checklist deletion (old override %s)", async (scenario, oldOverride) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let state!: TranscriptAiStateContextValue;
  const observe = (next: TranscriptAiStateContextValue) => { state = next; };
  const oldTask = taskFixture("old-task", "old", "done");
  const newTask = taskFixture("new-task", "new", "new");
  const oldItems: StructuredAiItems = { tasks: [oldTask], chapters: [], decisions: [], risks: [] };
  const oldOutput = { id: "old", output_text: "Original source retained" } as AiOutputView;
  let resolveOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/ai-state")) return Response.json({ jobs: [], outputs: ["old", "new"].map((id) => ({
      id, transcript_id: "t", processing_job_id: `${id}-job`, processing_type: "action_items", created_at: "2026-10-03", body_loaded: false
    })) });
    if (url.includes("/ai-outputs/old?")) return oldResponse;
    return Response.json({ output: { id: "new", output_text: "New source" }, structuredItems: { ...oldItems, tasks: [newTask] } });
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t" initialStructuredItems={oldItems}><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    await act(async () => state.loadForPurpose("metadata"));
    let pending: ReturnType<TranscriptAiStateContextValue["loadOutput"]> | undefined;
    if (scenario === "late body") await act(async () => { pending = state.loadOutput("old"); });
    if (oldOverride) await act(async () => state.confirmTaskStatus(oldTask, "done"));
    await act(async () => state.confirmChecklistDeletion(["old-task"], ["old"]));
    await act(async () => state.loadOutput("new"));
    expect(state.structuredItems.tasks).toMatchObject([{ id: "new-task", status: "new" }]);
    if (scenario === "late body") {
      await act(async () => {
        resolveOld(Response.json({ output: oldOutput, structuredItems: oldItems }));
        await pending;
      });
    } else {
      await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t" initialAiOutputs={[oldOutput]} initialStructuredItems={{ ...oldItems }}><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    }
    expect(state.structuredItems.tasks).toMatchObject([{ id: "new-task", status: "new" }]);
    expect(state.loadedOutputs.map((output) => output.id)).toContain("old");
    let exported: Awaited<ReturnType<TranscriptAiStateContextValue["loadAllOutputs"]>>;
    await act(async () => { exported = await state.loadAllOutputs(); });
    expect(exported!.structuredItems.tasks).toMatchObject([{ id: "new-task", status: "new" }]);
  } finally { await act(async () => root.unmount()); }
});

it("rejects a late old-source status receipt after checklist deletion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let state!: TranscriptAiStateContextValue;
  const observe = (next: TranscriptAiStateContextValue) => { state = next; };
  const oldTask = taskFixture("old-task", "old", "new");
  const newTask = taskFixture("new-task", "new", "new");
  const items: StructuredAiItems = { tasks: [oldTask], chapters: [], decisions: [], risks: [] };
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t" initialStructuredItems={items}><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    const pendingStatusReceipt = state.confirmTaskStatus;
    await act(async () => state.confirmChecklistDeletion(["old-task"], ["old"]));
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t" initialStructuredItems={{ ...items, tasks: [newTask] }}><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    await act(async () => pendingStatusReceipt(oldTask, "done"));
    expect(state.structuredItems.tasks).toMatchObject([{ id: "new-task", status: "new" }]);
  } finally { await act(async () => root.unmount()); }
});

it("retains a new source status edit when an older checklist deletion settles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let state!: TranscriptAiStateContextValue;
  const observe = (next: TranscriptAiStateContextValue) => { state = next; };
  const newTask = taskFixture("new-task", "new", "new");
  const items: StructuredAiItems = { tasks: [newTask], chapters: [], decisions: [], risks: [] };
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t" initialStructuredItems={items}><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    await act(async () => state.confirmTaskStatus(newTask, "done"));
    await act(async () => state.confirmChecklistDeletion(["old-task"], ["old"]));
    await act(async () => root.render(<TranscriptAiStateProvider transcriptId="t" initialStructuredItems={{ ...items }}><ExportHarness observe={observe} /></TranscriptAiStateProvider>));
    expect(state.structuredItems.tasks).toMatchObject([{ id: "new-task", status: "done" }]);
  } finally { await act(async () => root.unmount()); }
});

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
