// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructuredItemsContent } from "@/components/transcript-tabs/structured-items-content";
import type { StructuredAiItems, StructuredDecisionRow, StructuredRiskRow } from "@/lib/ai/structured-types";

let mayDelete = true;
vi.mock("@/components/recording-capability-context", () => ({
  useRecordingCapabilities: () => ({ capabilities: { delete: mayDelete, editTaskStatus: mayDelete } })
}));

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

const transcriptId = "00000000-0000-4000-8000-000000000004";
const base = {
  ai_output_id: "00000000-0000-4000-8000-000000000002",
  processing_job_id: "00000000-0000-4000-8000-000000000003",
  raw_item: {},
  transcript_id: transcriptId,
  user_id: "00000000-0000-4000-8000-000000000005"
};
const decision = {
  ...base,
  evidence_end_ms: 75000,
  evidence_quote: "Já nevím, co jakoby co půjde.",
  evidence_start_ms: 72000,
  id: "00000000-0000-4000-8000-0000000000d1",
  owner_category: null,
  owner_role: null,
  position: 1,
  source_type: "explicit",
  status: "needs_confirmation",
  title: "Potvrdit rozsah dotazníku."
} as unknown as StructuredDecisionRow;
const risk = {
  ...base,
  evidence_end_ms: null,
  evidence_quote: "To nás asi bude brzdit.",
  evidence_start_ms: null,
  id: "00000000-0000-4000-8000-0000000000e1",
  impact: null,
  mitigation: "Naplánovat napojení Dropboxu.",
  owner_category: null,
  owner_role: null,
  position: 1,
  source_type: "explicit",
  title: "Dropbox může brzdit práci."
} as unknown as StructuredRiskRow;
const items: StructuredAiItems = {
  chapters: [],
  decisions: [decision],
  risks: [risk],
  tasks: [{
    ...base,
    deadline: "pondělí",
    deadline_confidence: null,
    deadline_normalized: null,
    description: null,
    evidence_end_ms: 12000,
    evidence_quote: "Takže tam dáme defaultně ty tři.",
    evidence_start_ms: 10000,
    id: "00000000-0000-4000-8000-000000000001",
    owner_category: "Moje práce",
    owner_name: "Honza a Mira",
    position: 1,
    source_type: "explicit",
    status: "new",
    title: "Upravit fáze v přehledu oken."
  }]
};

// Renders the structured block with a speaker resolver so full-item copy includes "who said it".
async function render(extra: Partial<Parameters<typeof StructuredItemsContent>[0]> = {}) {
  await act(async () => root.render(
    <StructuredItemsContent
      items={items}
      onOpenEvidence={vi.fn()}
      resolveEvidenceSpeaker={() => "Mira"}
      {...extra}
    />
  ));
}

// Clicks one button and lets the async clipboard/fetch promise settle.
async function click(selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  return button!;
}

beforeEach(() => {
  mayDelete = true;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("structured item copy actions", () => {
  it("copies only the task sentence from the inline action after the title", async () => {
    await render();
    const button = await click('button[aria-label="Kopírovat text: Upravit fáze v přehledu oken."]');
    expect(writeText).toHaveBeenCalledWith("Upravit fáze v přehledu oken.");
    expect(button.getAttribute("aria-label")).toBe("Zkopírováno");
    expect(button.textContent).toBe("");
    expect(button.closest(".structured-title-tail")?.textContent).toBe("oken. ");
  });

  it("copies the whole task with chips, evidence time and speaker", async () => {
    await render();
    await click(".structured-task-row .structured-item-copy");
    expect(writeText).toHaveBeenCalledWith([
      "Upravit fáze v přehledu oken.",
      "Honza a Mira · Termín: pondělí",
      "Důkaz (00:10 · Mira): \"Takže tam dáme defaultně ty tři.\""
    ].join("\n"));
  });

  it("copies a whole decision including its confirmation state", async () => {
    await render();
    await click("li[data-decision-status] .structured-item-copy");
    expect(writeText).toHaveBeenCalledWith([
      "Potvrdit rozsah dotazníku.",
      "K potvrzení",
      "Důkaz (01:12 · Mira): \"Já nevím, co jakoby co půjde.\""
    ].join("\n"));
  });

  it("copies a whole risk with its next step and an unlocated quote", async () => {
    await render();
    await click("li[data-risk-row] .structured-item-copy");
    expect(writeText).toHaveBeenCalledWith([
      "Dropbox může brzdit práci.",
      "Další krok: Naplánovat napojení Dropboxu.",
      "Důkaz: \"To nás asi bude brzdit.\""
    ].join("\n"));
  });

  it("places full-item copy before delete in every section", async () => {
    await render();
    const rows = container.querySelectorAll(".structured-item-actions");
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      const buttons = row.querySelectorAll("button");
      expect(buttons[0]?.classList.contains("structured-item-copy")).toBe(true);
      expect(buttons[1]?.classList.contains("structured-task-delete")).toBe(true);
    });
  });

  it("reports a clipboard failure instead of claiming success", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    await render();
    const button = await click('button[aria-label="Kopírovat text: Dropbox může brzdit práci."]');
    expect(button.getAttribute("aria-label")).toBe("Nelze kopírovat");
  });
});

describe("decision and risk delete", () => {
  it("deletes a decision group and reports the server-confirmed ids", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ids: [decision.id, "sibling"], ok: true }), { status: 200 }));
    const onItemsDeleted = vi.fn();
    await render({ onItemsDeleted });
    await click('button[aria-label="Smazat rozhodnutí: Potvrdit rozsah dotazníku."]');
    expect(fetchMock).toHaveBeenCalledWith(`/api/transcript-decisions/${decision.id}`, expect.objectContaining({ method: "DELETE" }));
    expect(onItemsDeleted).toHaveBeenCalledWith([decision.id, "sibling"]);
    expect(container.querySelector<HTMLLIElement>("li[data-decision-status]")?.hidden).toBe(true);
  });

  it("restores a risk and shows an error when the server rejects the delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "x" }), { status: 409 }));
    const onItemsDeleted = vi.fn();
    await render({ onItemsDeleted });
    await click('button[aria-label="Smazat riziko: Dropbox může brzdit práci."]');
    expect(fetchMock).toHaveBeenCalledWith(`/api/transcript-risks/${risk.id}`, expect.objectContaining({ method: "DELETE" }));
    expect(onItemsDeleted).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLLIElement>("li[data-risk-row]")?.hidden).toBe(false);
    expect(container.textContent).toContain("Riziko se nepodařilo smazat.");
  });

  it("sends nothing when the user cancels the confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await render();
    await click('button[aria-label="Smazat riziko: Dropbox může brzdit práci."]');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables decision and risk delete without the delete capability", async () => {
    mayDelete = false;
    await render();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="Smazat rozhodnutí"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label^="Smazat riziko"]')?.disabled).toBe(true);
  });
});
