// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructuredItemsContent } from "@/components/transcript-tabs/structured-items-content";
import type { StructuredAiItems } from "@/lib/ai/structured-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const task: StructuredAiItems["tasks"][number] = {
  ai_output_id: "output-1",
  deadline: null,
  deadline_confidence: null,
  deadline_normalized: null,
  description: null,
  evidence_end_ms: null,
  evidence_quote: null,
  evidence_start_ms: null,
  id: "00000000-0000-4000-8000-000000000201",
  owner_category: "Moje práce",
  owner_name: null,
  position: 1,
  processing_job_id: "job-1",
  raw_item: {},
  source_type: "explicit",
  status: "new",
  title: "Poslat podklady",
  transcript_id: "transcript-1",
  user_id: "user-1"
};

const items: StructuredAiItems = { chapters: [], decisions: [], risks: [], tasks: [task] };
let container: HTMLDivElement;
let root: Root;

function statusButton() {
  const button = container.querySelector<HTMLButtonElement>("button[aria-pressed]");
  if (!button) throw new Error("Missing task status button.");
  return button;
}

async function render() {
  await act(async () => root.render(createElement(StructuredItemsContent, {
    items,
    onOpenEvidence: vi.fn()
  })));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("structured task status UI", () => {
  it("rolls back after a rejected request and shows safe inline error", async () => {
    const request = vi.fn().mockRejectedValue(new Error("private network detail"));
    vi.stubGlobal("fetch", request);
    await render();

    await act(async () => {
      statusButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("article")?.getAttribute("data-task-status")).toBe("new");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Stav úkolu se nepodařilo uložit.");
    expect(container.textContent).not.toContain("private network detail");
  });

  it("rejects a successful transport with invalid response payload and rolls back", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ok: true, status: "new" }) });
    vi.stubGlobal("fetch", request);
    await render();

    await act(async () => {
      statusButton().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("article")?.getAttribute("data-task-status")).toBe("new");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});
