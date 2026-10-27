// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteTranscriptChecklistButton } from "@/components/delete-transcript-checklist-button";
import { StructuredItemsContent } from "@/components/transcript-tabs/structured-items-content";
import type { ChecklistReview } from "@/lib/ai/checklist-delete";
import { TranscriptAiStateProvider, useTranscriptAiState, type TranscriptAiStateContextValue } from "@/components/transcript-tabs/use-transcript-ai-state";
import type { StructuredAiItems, StructuredTaskRow } from "@/lib/ai/structured-types";
import type { AiOutputView } from "@/lib/ai/types";

let mayDelete = true;
vi.mock("@/components/recording-capability-context", () => ({ useRecordingCapabilities: () => ({ capabilities: { delete: mayDelete } }) }));
const transcriptId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const outputId = "00000000-0000-4000-8000-000000000003";
const review: ChecklistReview = { rowCount: 1, logicalCount: 1, snapshot: {
  transcriptId, generation: "generation", transcriptVersion: "1", outputs: [{ id: outputId, version: "1" }],
  tasks: [{ id: taskId, version: "1", updatedAt: "2026-10-03", status: "new" }]
} };
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
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("(1 položek)"));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("všech zdrojových výstupů"));
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/transcripts/${transcriptId}/checklist`, { cache: "no-store" });
});

it("hides exactly reviewed task IDs while pending and commits only the exact receipt", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let resolveDelete!: (value: Response) => void;
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDelete = resolve; }));
  const onPending = vi.fn(); const onDeleted = vi.fn();
  await act(async () => root.render(<DeleteTranscriptChecklistButton transcriptId={transcriptId} onPending={onPending} onDeleted={onDeleted} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(onPending).toHaveBeenCalledExactlyOnceWith([taskId]);
  expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ snapshot: review.snapshot }) });
  await act(async () => resolveDelete(Response.json({ ok: true, transcriptId, deletedIds: [taskId], suppressionIds: [outputId] })));
  expect(onDeleted).toHaveBeenCalledExactlyOnceWith([taskId], [outputId]);
  expect(onPending).toHaveBeenLastCalledWith(null);
});

it("requires a fresh review and confirmation after a 409 conflict", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const next = { ...review, snapshot: { ...review.snapshot, transcriptVersion: "2" } };
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockResolvedValueOnce(Response.json({ error: "conflict" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(next)).mockResolvedValueOnce(Response.json({ ok: true, transcriptId, deletedIds: [taskId], suppressionIds: [outputId] }));
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
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockResolvedValueOnce(Response.json({ ok: true, transcriptId, deletedIds: [outputId], suppressionIds: [outputId] }, { status }));
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
  await act(async () => resolveDelete(Response.json({ ok: true, transcriptId, deletedIds: [taskId], suppressionIds: [outputId] })));
  expect(onDeleted).toHaveBeenCalledExactlyOnceWith([taskId], [outputId]); expect(container.textContent).not.toContain("Checklist smazán");
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
  const oldItems: StructuredAiItems = { tasks: [oldTask], chapters: [], decisions: [], risks: [] };
  const oldOutputs = [{ id: outputId, transcript_id: transcriptId, output_text: "Raw source retained" }] as AiOutputView[];
  const nextScope = navigate ? "00000000-0000-4000-8000-000000000004" : transcriptId;
  const nextTask = { ...oldTask, id: "next-task", ai_output_id: "next-output", title: "Other transcript task" };
  const nextItems = navigate ? { ...oldItems, tasks: [nextTask] } : oldItems;
  const nextOutputs = navigate ? [{ ...oldOutputs[0], id: "next-output", transcript_id: nextScope }] : oldOutputs;
  let resolveDelete!: (value: Response) => void;
  fetchMock.mockResolvedValueOnce(Response.json(review)).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveDelete = resolve; }))
    .mockImplementation(async () => Response.json({ jobs: [], outputs: nextOutputs.map((output) => ({ ...output, body_loaded: true })) }));
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={transcriptId} initialAiOutputs={oldOutputs} initialStructuredItems={oldItems}>
    <ScopedHarness scope={transcriptId} showButton observe={observe} /></TranscriptAiStateProvider>));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={nextScope} initialAiOutputs={nextOutputs} initialStructuredItems={nextItems}>
    <ScopedHarness scope={nextScope} showButton={false} observe={observe} /></TranscriptAiStateProvider>));
  await act(async () => resolveDelete(Response.json({ ok: true, transcriptId, deletedIds: [taskId], suppressionIds: [outputId] })));
  await act(async () => root.render(<TranscriptAiStateProvider transcriptId={nextScope} initialAiOutputs={nextOutputs} initialStructuredItems={nextItems}>
    <ScopedHarness scope={nextScope} showButton observe={observe} /></TranscriptAiStateProvider>));
  expect(state.structuredItems.tasks.map((task) => task.id)).toEqual(navigate ? ["next-task"] : []);
  expect(state.loadedOutputs.map((output) => output.id)).toEqual(navigate ? ["next-output"] : [outputId]);
  let exported: Awaited<ReturnType<TranscriptAiStateContextValue["loadAllOutputs"]>>;
  await act(async () => { exported = await state.loadAllOutputs(); });
  expect(exported!.structuredItems.tasks.map((task) => task.id)).toEqual(navigate ? ["next-task"] : []);
});

// ChecklistHeaderHarness mirrors optimistic task hiding while retaining the header mutation owner.
function ChecklistHeaderHarness() {
  const [pending, setPending] = useState<string[] | null>(null);
  const [deleted, setDeleted] = useState(false);
  const task = { id: taskId, ai_output_id: outputId, title: "Current task", owner_category: "Moje práce", status: "new", position: 1 } as StructuredTaskRow;
  return <StructuredItemsContent items={{ tasks: pending || deleted ? [] : [task], chapters: [], decisions: [], risks: [] }}
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
  expect(container.querySelector(".structured-ai-block > header")).toBe(header);
  expect([...header.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  await act(async () => finish(success ? Response.json({ ok: true, transcriptId, deletedIds: [taskId], suppressionIds: [outputId] }) : Response.json({ error: "unavailable" }, { status: 500 })));
  if (success) {
    expect(container.querySelector(".structured-ai-block")).toBeNull();
    expect(container.querySelector(".checklist-delete-control")).toBeNull();
  } else {
    expect(container.textContent).toContain("Current task");
    expect(container.textContent).toContain("ověřte aktuální stav");
    expect(remove.disabled).toBe(false);
  }
});

it("does not render an orphan checklist action when no task exists", async () => {
  await act(async () => root.render(<StructuredItemsContent items={{ tasks: [], chapters: [], decisions: [], risks: [] }}
    onOpenEvidence={() => undefined} checklistAction={<DeleteTranscriptChecklistButton transcriptId={transcriptId} />} />));
  expect(container.querySelector("button")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
