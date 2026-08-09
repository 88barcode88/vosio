// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructuredItemsContent } from "@/components/transcript-tabs/structured-items-content";
import type { StructuredAiItems } from "@/lib/ai/structured-types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/recordings/detail",
  useRouter: () => ({ refresh: vi.fn() })
}));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const items: StructuredAiItems = {
  chapters: [],
  decisions: [],
  risks: [],
  tasks: [{
    ai_output_id: "00000000-0000-4000-8000-000000000002",
    deadline: null,
    deadline_confidence: null,
    deadline_normalized: null,
    description: "Odeslat podklady klientovi.",
    evidence_end_ms: null,
    evidence_quote: null,
    evidence_start_ms: null,
    id: "00000000-0000-4000-8000-000000000001",
    owner_category: "Moje práce",
    owner_name: null,
    position: 1,
    processing_job_id: "00000000-0000-4000-8000-000000000003",
    raw_item: {},
    source_type: "explicit",
    status: "new",
    title: "Poslat podklady",
    transcript_id: "00000000-0000-4000-8000-000000000004",
    user_id: "00000000-0000-4000-8000-000000000005"
  }]
};

const siblingTask = {
  ...items.tasks[0]!,
  id: "00000000-0000-4000-8000-000000000006",
  position: 2,
  title: "Připravit nabídku"
};

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("individual structured task delete", () => {
  it("shows one compact trash icon per task and no whole checklist delete", async () => {
    await act(async () => root.render(
      <StructuredItemsContent items={items} onOpenEvidence={vi.fn()} />
    ));

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Smazat úkol: Poslat podklady"]'
    );
    expect(deleteButton).not.toBeNull();
    expect(deleteButton?.textContent).toBe("");
    expect(container.textContent).not.toContain("Smazat checklist");
  });

  it("keeps the task visible and sends no request when deletion is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => root.render(
      <StructuredItemsContent items={items} onOpenEvidence={vi.fn()} />
    ));

    const row = container.querySelector<HTMLElement>(".structured-task-row");
    await act(async () => row?.querySelector<HTMLButtonElement>(".structured-task-delete")?.click());

    expect(row?.hidden).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides only the pending task while an unrelated sibling stays actionable", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveDelete: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    }));
    await act(async () => root.render(
      <StructuredItemsContent items={{ ...items, tasks: [...items.tasks, siblingTask] }} onOpenEvidence={vi.fn()} />
    ));

    const rows = Array.from(container.querySelectorAll<HTMLElement>(".structured-task-row"));
    await act(async () => rows[0]?.querySelector<HTMLButtonElement>(".structured-task-delete")?.click());

    expect(rows[0]?.hidden).toBe(true);
    expect(rows[1]?.hidden).toBe(false);
    expect(rows[1]?.querySelector<HTMLButtonElement>(".structured-task-delete")?.disabled).toBe(false);

    await act(async () => resolveDelete?.(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    expect(rows[0]?.hidden).toBe(true);
  });

  it("keeps a successful delete hidden and restores the exact task after failure", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await act(async () => root.render(
      <StructuredItemsContent items={items} onOpenEvidence={vi.fn()} />
    ));
    const firstRow = container.querySelector<HTMLElement>(".structured-task-row");
    await act(async () => firstRow?.querySelector<HTMLButtonElement>('.structured-task-delete')?.click());
    expect(firstRow?.hidden).toBe(true);

    fetchMock.mockRejectedValueOnce(new Error("network detail"));
    await act(async () => root.render(
      <StructuredItemsContent items={{ ...items, tasks: [siblingTask] }} onOpenEvidence={vi.fn()} />
    ));
    const secondRow = container.querySelector<HTMLElement>(".structured-task-row");
    await act(async () => secondRow?.querySelector<HTMLButtonElement>('.structured-task-delete')?.click());
    expect(secondRow?.hidden).toBe(false);
    expect(secondRow?.textContent).toContain("Úkol se nepodařilo smazat");
  });
});
