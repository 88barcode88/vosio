// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteTranscriptChecklistButton } from "@/components/delete-transcript-checklist-button";
import { StructuredItemsContent } from "@/components/transcript-tabs/structured-items-content";
import type { ChecklistReview } from "@/lib/ai/checklist-delete";
import { TranscriptAiStateProvider, useTranscriptAiState, type TranscriptAiStateContextValue } from "@/components/transcript-tabs/use-transcript-ai-state";
import type { StructuredAiItems, StructuredDecisionRow, StructuredRiskRow, StructuredTaskRow } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";

let mayDelete = true;
vi.mock("@/components/recording-capability-context", () => ({ useRecordingCapabilities: () => ({ capabilities: { delete: mayDelete } }) }));
const transcriptId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const outputId = "00000000-0000-4000-8000-000000000003";
const decisionId = "00000000-0000-4000-8000-000000000005";
const riskId = "00000000-0000-4000-8000-000000000006";
const allIds = [taskId, decisionId, riskId];
const review: ChecklistReview = { rowCount: 3, logicalCounts: { tasks: 1, decisions: 1, risks: 1 }, snapshot: {
  transcriptId, generation: "generation", transcriptVersion: "1", outputs: [{ id: outputId, version: "1" }],
  tasks: [{ id: taskId, version: "1", updatedAt: "2026-10-03", status: "new" }],
  decisions: [{ id: decisionId, version: "1" }], risks: [{ id: riskId, version: "1" }]
} };
const receipt = { ok: true, transcriptId, deletedIds: allIds, suppressionIds: [outputId] };
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mayDelete = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("offers deletion only to managers and performs no hidden request", async () => {
  mayDelete = false;
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} />));
  expect(container.querySelector("button")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
});

it("reviews complete server scope before confirmation and cancellation sends no delete", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fetchMock.mockResolvedValueOnce(Response.json(review));
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(confirm).toHaveBeenCalledWith("Smazat celý checklist? Odstraní se 1 úkol, 1 rozhodnutí a 1 bloker tohoto přepisu. Původní AI výstupy, zápisy, shrnutí, nahrávka a přepis zůstanou.");
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/transcripts/${transcriptId}/checklist`, { cache: "no-store" });
});

it("lists only non-zero kinds with Czech plurals in the confirmation", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const many = { ...review, logicalCounts: { tasks: 12, decisions: 0, risks: 2 }, rowCount: 14, snapshot: { ...review.snapshot,
    tasks: Array.from({ length: 12 }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, version: "1", updatedAt: "x", status: "new" as const })),
    decisions: [], risks: Array.from({ length: 2 }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000002${i}0`, version: "1" })) } };
  fetchMock.mockResolvedValueOnce(Response.json(many));
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Odstraní se 12 úkolů a 2 blokery tohoto přepisu."));
});

it("refuses a review whose counts disagree with the snapshot", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock.mockResolvedValueOnce(Response.json({ ...review, logicalCounts: { tasks: 1, decisions: 2, risks: 1 } }));
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(confirm).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("nepodařilo připravit");
});

it("hides exactly reviewed task, decision and risk IDs while pending and commits only the exact receipt", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let resolveDelete!: (value: Response) => void;
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDelete = resolve; }));
  const onPending = vi.fn(); const onDeleted = vi.fn();
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} onPending={onPending} onDeleted={onDeleted} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(onPending).toHaveBeenCalledExactlyOnceWith(allIds);
  expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ snapshot: review.snapshot }) });
  await act(async () => resolveDelete(Response.json(receipt)));
  expect(onDeleted).toHaveBeenCalledExactlyOnceWith(allIds, [outputId]);
  expect(onPending).toHaveBeenLastCalledWith(null);
  expect(container.textContent).toContain("Checklist smazán (1 úkol, 1 rozhodnutí a 1 bloker).");
});

it("requires a fresh review and confirmation after a 409 conflict", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const next = { ...review, snapshot: { ...review.snapshot, transcriptVersion: "2" } };
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockResolvedValueOnce(Response.json({ error: "conflict" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(next)).mockResolvedValueOnce(Response.json(receipt));
  const onDeleted = vi.fn(); const onPending = vi.fn();
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} onDeleted={onDeleted} onPending={onPending} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(onDeleted).not.toHaveBeenCalled(); expect(onPending).toHaveBeenLastCalledWith(null);
  expect(container.textContent).toContain("nové potvrzení"); expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(confirm).toHaveBeenCalledTimes(2); expect(JSON.parse(fetchMock.mock.calls[3]![1].body).snapshot.transcriptVersion).toBe("2");
});

it.each([403, 500, 200])("restores pending IDs and refuses an unconfirmed receipt (%s)", async (status) => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockResolvedValueOnce(Response.json({ ...receipt, deletedIds: [outputId] }, { status }));
  const onDeleted = vi.fn(); const onPending = vi.fn();
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} onDeleted={onDeleted} onPending={onPending} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(onDeleted).not.toHaveBeenCalled(); expect(onPending).toHaveBeenLastCalledWith(null);
  expect(container.textContent).toContain("ověřte aktuální stav");
});

it("delivers a committed receipt to its durable owner after the control unmounts", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let resolveDelete!: (value: Response) => void;
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDelete = resolve; }));
  const onDeleted = vi.fn();
  await act(async () => root.render(<DeleteTranscriptChecklistButton key={transcriptId} transcriptId={transcriptId} onDeleted={onDeleted} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => root.render(<p>Another tab</p>));
  await act(async () => resolveDelete(Response.json(receipt)));
  expect(onDeleted).toHaveBeenCalledExactlyOnceWith(allIds, [outputId]); expect(container.textContent).not.toContain("Checklist smazán");
});

// ScopedHarness keeps mutation ownership in the transcript provider across detail tab switches.
function ScopedHarness({ showButton, scope, observe }: { showButton: boolean; scope: string; observe: (state: TranscriptAiStateContextValue) => void }) {
  const state = useTranscriptAiState();
  useEffect(() => observe(state), [state, observe]);
  return showButton ? <DeleteTranscriptChecklistButton transcriptId={scope} onDeleted={state.confirmChecklistDeletion} /> : <p>Another tab</p>;
}

it.each([false, true])("reconciles a committed delete across tab switches but fences transcript navigation (%s)", async (navigate) => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let state!: TranscriptAiStateContextValue;
  const observe = (next: TranscriptAiStateContextValue) => { state = next; };
  const oldTask = { id: taskId, ai_output_id: outputId, title: "Old task", owner_category: "Moje práce", status: "new", position: 1 } as StructuredTaskRow;
  const oldDecision = { id: decisionId, ai_output_id: outputId, title: "Old decision", position: 1 } as StructuredDecisionRow;
  const oldRisk = { id: riskId, ai_output_id: outputId, title: "Old risk", position: 1 } as StructuredRiskRow;
  const oldItems: StructuredAiItems = { tasks: [oldTask], chapters: [], decisions: [oldDecision], risks: [oldRisk] };
  const oldOutputs = [{ id: outputId, transcript_id: transcriptId, output_text: "Raw source retained" }] as AiOutputView[];
  const nextScope = navigate ? "00000000-0000-4000-8000-000000000004" : transcriptId;
  const nextTask = { ...oldTask, id: "next-task", ai_output_id: "next-output", title: "Other transcript task" };
  const nextItems = navigate ? { ...oldItems, tasks: [nextTask], decisions: [], risks: [] } : oldItems;
  const nextOutputs = navigate ? [{ ...oldOutputs[0], id: "next-output", transcript_id: nextScope }] : oldOutputs;
  let resolveDelete!: (value: Response) => void;
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDelete = resolve; }))
    .mockImplementation(async () => Response.json({ jobs: [], outputs: nextOutputs.map((output) => ({ ...output, body_loaded: true })) }));
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={transcriptId} initialAiOutputs={oldOutputs} initialStructuredItems={oldItems}>
    <ScopedHarness scope={transcriptId} showButton observe={observe} /></TranscriptAiStateProvider>));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={nextScope} initialAiOutputs={nextOutputs} initialStructuredItems={nextItems}>
    <ScopedHarness scope={nextScope} showButton={false} observe={observe} /></TranscriptAiStateProvider>));
  await act(async () => resolveDelete(Response.json(receipt)));
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={nextScope} initialAiOutputs={nextOutputs} initialStructuredItems={nextItems}>
    <ScopedHarness scope={nextScope} showButton observe={observe} /></TranscriptAiStateProvider>));
  expect(state.structuredItems.tasks.map((task) => task.id)).toEqual(navigate ? ["next-task"] : []);
  expect(state.structuredItems.decisions).toEqual([]);
  expect(state.structuredItems.risks).toEqual([]);
  expect(state.loadedOutputs.map((output) => output.id)).toEqual(navigate ? ["next-output"] : [outputId]);
  let exported: Awaited<ReturnType<TranscriptAiStateContextValue["loadAllOutputs"]>>;
  await act(async () => { exported = await state.loadAllOutputs(); });
  expect(exported!.structuredItems.tasks.map((task) => task.id)).toEqual(navigate ? ["next-task"] : []);
});

it("keeps deleted decisions and risks absent after same-transcript rehydration but admits a new generation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let state!: TranscriptAiStateContextValue;
  const observe = (next: TranscriptAiStateContextValue) => { state = next; };
  const outputs = [{ id: outputId, transcript_id: transcriptId, output_text: "Raw source retained" }] as AiOutputView[];
  const oldDecision = { id: decisionId, ai_output_id: outputId, title: "Old decision", position: 1 } as StructuredDecisionRow;
  const oldRisk = { id: riskId, ai_output_id: outputId, title: "Old risk", position: 1 } as StructuredRiskRow;
  const items: StructuredAiItems = { tasks: [], chapters: [], decisions: [oldDecision], risks: [oldRisk] };
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockResolvedValueOnce(Response.json(receipt));
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={transcriptId} initialAiOutputs={outputs} initialStructuredItems={items}>
    <ScopedHarness scope={transcriptId} showButton observe={observe} /></TranscriptAiStateProvider>));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(state.structuredItems.decisions).toEqual([]); expect(state.structuredItems.risks).toEqual([]);
  const fresh = { id: "00000000-0000-4000-8000-000000000007", ai_output_id: "fresh-output", title: "New decision", position: 1 } as StructuredDecisionRow;
  const stale: StructuredAiItems = { ...items, decisions: [{ ...oldDecision, id: "00000000-0000-4000-8000-000000000008" }, fresh] };
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={transcriptId} initialAiOutputs={outputs} initialStructuredItems={stale}>
    <ScopedHarness scope={transcriptId} showButton observe={observe} /></TranscriptAiStateProvider>));
  expect(state.structuredItems.decisions.map((row) => row.title)).toEqual(["New decision"]);
  expect(state.structuredItems.risks).toEqual([]);
});

// ChecklistHeaderHarness mirrors optimistic task hiding while retaining the header mutation owner.
function ChecklistHeaderHarness() {
  const [pending, setPending] = useState<string[] | null>(null);
  const [deleted, setDeleted] = useState(false);
  const task = { id: taskId, ai_output_id: outputId, title: "Current task", owner_category: "Moje práce", status: "new", position: 1 } as StructuredTaskRow;
  const decision = { id: decisionId, ai_output_id: outputId, title: "Current decision", position: 1 } as StructuredDecisionRow;
  const risk = { id: riskId, ai_output_id: outputId, title: "Current risk", position: 1 } as StructuredRiskRow;
  const hidden = pending !== null || deleted;
  return <StructuredItemsContent items={{ tasks: hidden ? [] : [task], chapters: [], decisions: hidden ? [] : [decision], risks: hidden ? [] : [risk] }}
    onOpenEvidence={() => undefined} checklistPending={pending !== null}
    checklistAction={<DeleteTranscriptChecklistButton transcriptId={transcriptId} onPending={setPending} onDeleted={() => setDeleted(true)} />} />;
}

it.each([false, true])("keeps the checklist header mounted during optimistic hiding and reconciles its outcome (%s)", async (success) => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let finish!: (response: Response) => void;
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
  await act(async () => root.render(<ChecklistHeaderHarness />));
  const header = container.querySelector(".structured-ai-block > header")!;
  const remove = header.querySelector<HTMLButtonElement>(".checklist-delete-control button")!;
  expect(remove).not.toBeNull();
  await act(async () => remove.click());
  expect(container.textContent).not.toContain("Current task");
  expect(container.textContent).not.toContain("Current decision"); expect(container.textContent).not.toContain("Current risk");
  expect(container.querySelector(".structured-ai-block > header")).toBe(header);
  expect([...header.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  await act(async () => finish(success ? Response.json(receipt) : Response.json({ error: "unavailable" }, { status: 500 })));
  if (success) {
    expect(container.querySelector(".structured-ai-block")).toBeNull();
    expect(container.querySelector(".checklist-delete-control")).toBeNull();
  } else {
    expect(container.textContent).toContain("Current task");
    expect(container.textContent).toContain("Current decision"); expect(container.textContent).toContain("Current risk");
    expect(container.textContent).toContain("ověřte aktuální stav");
    expect(remove.disabled).toBe(false);
  }
});

it("offers the delete action when only decisions or risks remain", async () => {
  const risk = { id: riskId, ai_output_id: outputId, title: "Lone risk", position: 1 } as StructuredRiskRow;
  await act(async () => root.render(<StructuredItemsContent items={{ tasks: [], chapters: [], decisions: [], risks: [risk] }}
    onOpenEvidence={() => undefined} checklistAction={<DeleteTranscriptChecklistButton transcriptId={transcriptId} />} />));
  expect(container.querySelector(".structured-ai-block > header .checklist-delete-control button")).not.toBeNull();
  expect(container.textContent).toContain("Lone risk");
});

it("does not render an orphan checklist action when no checklist item exists", async () => {
  await act(async () => root.render(<StructuredItemsContent items={{ tasks: [], chapters: [], decisions: [], risks: [] }}
    onOpenEvidence={() => undefined} checklistAction={<DeleteTranscriptChecklistButton transcriptId={transcriptId} />} />));
  expect(container.querySelector("button")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
